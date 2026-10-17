/**
 * OpenAI Chat Completions 兼容的英文释义提供器。
 *
 * 只负责远端请求、兼容响应解析与请求词对齐；不依赖路由或磁盘缓存，
 * 因而可以被 API、单元测试和命令行诊断脚本共同调用。
 */

import {
	CONTENT_LEVEL_PROMPTS,
	DEFAULT_CONTENT_LEVEL,
	type ContentLevel,
} from "./content-level";

export type DefinitionProviderErrorCode =
	| "http"
	| "network"
	| "timeout"
	| "aborted"
	| "invalid-response"
	| "empty";

export class DefinitionProviderError extends Error {
	readonly code: DefinitionProviderErrorCode;
	readonly status?: number;

	constructor(
		code: DefinitionProviderErrorCode,
		message: string,
		status?: number,
	) {
		super(message);
		this.name = "DefinitionProviderError";
		this.code = code;
		this.status = status;
	}
}

export interface DefinitionProviderDiagnostics {
	endpoint: string;
	model: string;
	requestedCount: number;
	returnedCount: number;
	finishReason?: string;
	fallbackUsed: boolean;
	elapsedMs: number;
	usage?: {
		promptTokens?: number;
		completionTokens?: number;
		totalTokens?: number;
	};
}

export interface DefinitionProviderResult {
	definitions: Record<string, string>;
	missing: string[];
	warning?: string;
	diagnostics: DefinitionProviderDiagnostics;
}

export interface FetchEnglishDefinitionsOptions {
	words: string[];
	baseUrl: string;
	apiKey: string;
	model: string;
	/** 生成级别（用户设置，默认初中）；只影响释义句的词汇与句法难度 */
	contentLevel?: ContentLevel;
	signal?: AbortSignal;
	timeoutMs?: number;
	fetchImpl?: typeof fetch;
	onDiagnostic?: (event: DefinitionProviderDiagnosticEvent) => void;
}

export interface DefinitionProviderDiagnosticEvent {
	event:
		| "compatibility-fallback"
		| "request-failed"
		| "response-invalid"
		| "response-incomplete";
	level: "warning" | "error";
	details: Record<string, unknown>;
}

interface ParsedAiResponse {
	definitions: Record<string, string>;
	finishReason?: string;
	usage?: DefinitionProviderDiagnostics["usage"];
}

export type AiPairKind = "definition" | "chinese";

/**
 * 释义 system prompt：按生成级别约束释义句的词汇与句法难度（级别描述见 content-level.ts）。
 * 客观陈述，只写要求与真护栏（输出非 JSON、漏词、中英混写）。
 */
export function buildDefinitionSystemPrompt(contentLevel: ContentLevel): string {
	return (
		"You write one-sentence English definitions. " +
		'Reply with STRICT JSON only, no markdown fences and no extra text: {"definitions":{"<exact original word>":"<one clear English sentence>"}}. ' +
		`Write each definition in ${CONTENT_LEVEL_PROMPTS[contentLevel]}. Definitions are in English only. ` +
		"Include every requested word exactly once, spelled as requested."
	);
}

/** 中文对应词 system prompt：一个词对一两个中文词，与难度级别无关 */
export const CHINESE_SYSTEM_PROMPT =
	"You translate English words into Simplified Chinese. " +
	'Reply with STRICT JSON only, no markdown fences and no extra text: {"words":{"<exact original word>":"<one Simplified Chinese word>"}}. ' +
	"Give the most common everyday Chinese translation (a word or short phrase) for each requested word. " +
	"Use Simplified Chinese characters only - no pinyin, no English explanation. " +
	"Include every requested word exactly once, spelled as requested.";

export function buildPairSystemPrompt(
	kind: AiPairKind,
	contentLevel: ContentLevel,
): string {
	return kind === "chinese"
		? CHINESE_SYSTEM_PROMPT
		: buildDefinitionSystemPrompt(contentLevel);
}

/** 安全读取非空自有字符串属性，避免 constructor/__proto__ 原型键误命中。 */
export function ownDefinition(
	record: Record<string, unknown> | null | undefined,
	key: string,
): string | undefined {
	if (!record || typeof record !== "object" || !Object.hasOwn(record, key)) {
		return undefined;
	}
	const value = record[key];
	return typeof value === "string" && value.trim()
		? value.trim()
		: undefined;
}

function isLikelyEnglish(text: string): boolean {
	return !/\p{Script=Han}/u.test(text);
}

/** 中文词必须包含汉字（过滤 AI 误返回英文/拼音/空内容） */
function isChineseText(text: string): boolean {
	return /\p{Script=Han}/u.test(text);
}

function isValidPairValue(kind: AiPairKind, value: string): boolean {
	return kind === "definition" ? isLikelyEnglish(value) : isChineseText(value);
}

/** 从说明文字、思考块或多个代码块中提取全部可解析 JSON。 */
export function extractJsonCandidates(text: string): unknown[] {
	const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
	const fragments = [cleaned];
	for (const match of cleaned.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
		fragments.push(match[1].trim());
	}

	let start = -1;
	const stack: string[] = [];
	let inString = false;
	let escaped = false;
	for (let index = 0; index < cleaned.length; index++) {
		const char = cleaned[index];
		if (inString) {
			if (escaped) escaped = false;
			else if (char === "\\") escaped = true;
			else if (char === '"') inString = false;
			continue;
		}
		if (char === '"') {
			inString = true;
			continue;
		}
		if (char === "{" || char === "[") {
			if (stack.length === 0) start = index;
			stack.push(char);
			continue;
		}
		if (char !== "}" && char !== "]") continue;
		const opener = stack.at(-1);
		if (
			(opener === "{" && char !== "}") ||
			(opener === "[" && char !== "]")
		) {
			stack.length = 0;
			start = -1;
			continue;
		}
		stack.pop();
		if (stack.length === 0 && start >= 0) {
			fragments.push(cleaned.slice(start, index + 1));
			start = -1;
		}
	}

	const parsed: unknown[] = [];
	const seen = new Set<string>();
	for (const fragment of fragments) {
		if (!fragment || seen.has(fragment)) continue;
		seen.add(fragment);
		try {
			parsed.push(JSON.parse(fragment));
		} catch {
			// 一个候选损坏时继续扫描后续候选。
		}
	}
	return parsed;
}

export function contentCandidates(content: unknown): unknown[] {
	if (content == null) return [];
	if (typeof content === "string") return extractJsonCandidates(content);
	if (!Array.isArray(content)) return [content];

	const candidates: unknown[] = [content];
	const textParts: string[] = [];
	for (const part of content) {
		if (typeof part === "string") {
			textParts.push(part);
			continue;
		}
		if (!part || typeof part !== "object") continue;
		const holder = part as { text?: unknown; content?: unknown };
		if (typeof holder.text === "string") textParts.push(holder.text);
		else if (
			holder.text &&
			typeof holder.text === "object" &&
			typeof (holder.text as { value?: unknown }).value === "string"
		) {
			textParts.push((holder.text as { value: string }).value);
		}
		if (typeof holder.content === "string") textParts.push(holder.content);
	}
	if (textParts.length > 0) {
		candidates.push(...extractJsonCandidates(textParts.join("\n")));
	}
	return candidates;
}

function pairsFromCandidate(
	candidate: unknown,
	isValid: (value: string) => boolean,
): Record<string, string> {
	let items: unknown[] = [];
	if (Array.isArray(candidate)) {
		items = candidate;
	} else if (candidate && typeof candidate === "object") {
		const holder = candidate as {
			definitions?: unknown;
			words?: unknown;
			word?: unknown;
			definition?: unknown;
			value?: unknown;
		};
		if (Array.isArray(holder.definitions)) {
			items = holder.definitions;
		} else if (Array.isArray(holder.words)) {
			items = holder.words;
		} else if (
			typeof holder.word === "string" &&
			(typeof holder.definition === "string" ||
				typeof holder.value === "string")
		) {
			items = [holder];
		} else {
			const map =
				holder.definitions && typeof holder.definitions === "object"
					? (holder.definitions as Record<string, unknown>)
					: holder.words && typeof holder.words === "object"
						? (holder.words as Record<string, unknown>)
						: (candidate as Record<string, unknown>);
			items = Object.entries(map).map(([word, definition]) => ({
				word,
				definition,
			}));
		}
	}

	const pairs = Object.create(null) as Record<string, string>;
	for (const item of items) {
		const rawWord = (item as { word?: unknown })?.word;
		const rawDefinition =
			(item as { definition?: unknown })?.definition ??
			(item as { value?: unknown })?.value;
		if (typeof rawWord !== "string" || typeof rawDefinition !== "string") {
			continue;
		}
		const word = rawWord.trim();
		const value = rawDefinition.trim();
		if (word && value && isValid(value)) {
			pairs[word] = value;
		}
	}
	return pairs;
}

/** 兼容 Chat Completions 响应里的内容块与元信息（不含业务语义） */
export interface ChatResponseContent {
	/** 所有可能承载内容的块（parsed / content / text / tool_calls arguments） */
	sources: unknown[];
	finishReason?: string;
	usage?: DefinitionProviderDiagnostics["usage"];
}

/**
 * 解析兼容 Chat Completions 响应：状态码 → JSON → 内容块抽取。
 * 只做传输层适配（释义 / 中文词 / 批改 / 组句共用），业务解析由各自的 parse 函数负责。
 */
export async function readChatSources(
	response: Response,
): Promise<ChatResponseContent> {
	if (!response.ok) {
		const detail = await response.text().catch(() => "");
		throw new DefinitionProviderError(
			"http",
			`AI 服务返回 ${response.status}${detail ? `：${detail.slice(0, 240)}` : ""}`,
			response.status,
		);
	}

	let data: {
		choices?: {
			finish_reason?: unknown;
			message?: {
				content?: unknown;
				parsed?: unknown;
				tool_calls?: { function?: { arguments?: unknown } }[];
			};
			text?: unknown;
		}[];
		output_text?: unknown;
		usage?: {
			prompt_tokens?: unknown;
			completion_tokens?: unknown;
			total_tokens?: unknown;
		};
	};
	try {
		data = await response.json();
	} catch {
		throw new DefinitionProviderError(
			"invalid-response",
			"AI 返回了无法解析的响应 JSON",
		);
	}

	const choice = data?.choices?.[0];
	const sources: unknown[] = [
		choice?.message?.parsed,
		choice?.message?.content,
		choice?.text,
		data?.output_text,
		...(choice?.message?.tool_calls?.map(
			(call) => call.function?.arguments,
		) ?? []),
	].filter((value) => value != null);
	if (sources.length === 0) {
		throw new DefinitionProviderError(
			"invalid-response",
			"AI 响应缺少可解析内容",
		);
	}

	const numberOrUndefined = (value: unknown) =>
		typeof value === "number" && Number.isFinite(value) ? value : undefined;
	return {
		sources,
		finishReason:
			typeof choice?.finish_reason === "string"
				? choice.finish_reason
				: undefined,
		usage: data.usage
			? {
					promptTokens: numberOrUndefined(data.usage.prompt_tokens),
					completionTokens: numberOrUndefined(data.usage.completion_tokens),
					totalTokens: numberOrUndefined(data.usage.total_tokens),
				}
			: undefined,
	};
}

/** 解析兼容 Chat Completions 响应，并合并所有内容块中的有效条目。 */
export async function parseDefinitionAiResponse(
	response: Response,
	kind: AiPairKind = "definition",
): Promise<ParsedAiResponse> {
	const { sources, finishReason, usage } = await readChatSources(response);

	let sawJson = false;
	const definitions = Object.create(null) as Record<string, string>;
	const pairLabel = kind === "definition" ? "释义" : "中文词";
	for (const source of sources) {
		for (const candidate of contentCandidates(source)) {
			sawJson = true;
			Object.assign(
				definitions,
				pairsFromCandidate(candidate, (value) =>
					isValidPairValue(kind, value),
				),
			);
		}
	}
	if (Object.keys(definitions).length === 0) {
		throw new DefinitionProviderError(
			sawJson ? "empty" : "invalid-response",
			sawJson
				? `AI 未返回任何有效${pairLabel}，请重试`
				: `AI 未返回 JSON 格式的${pairLabel}`,
		);
	}

	return {
		definitions,
		finishReason,
		usage,
	};
}

function alignDefinitions(
	words: string[],
	provided: Record<string, string>,
): Record<string, string> {
	const aligned = Object.create(null) as Record<string, string>;
	const folded = new Map<string, string[]>();
	for (const key of Object.keys(provided)) {
		const canonical = key.trim().toLocaleLowerCase("en-US");
		folded.set(canonical, [...(folded.get(canonical) ?? []), key]);
	}
	for (const word of words) {
		const exact = ownDefinition(provided, word);
		if (exact) {
			aligned[word] = exact;
			continue;
		}
		const matches = folded.get(word.toLocaleLowerCase("en-US")) ?? [];
		if (matches.length !== 1) continue;
		const value = ownDefinition(provided, matches[0]);
		if (value) aligned[word] = value;
	}
	return aligned;
}

export interface FetchAiPairsOptions {
	kind: AiPairKind;
	words: string[];
	baseUrl: string;
	apiKey: string;
	model: string;
	/** 生成级别（用户设置，默认初中） */
	contentLevel?: ContentLevel;
	signal?: AbortSignal;
	timeoutMs?: number;
	fetchImpl?: typeof fetch;
	onDiagnostic?: (event: DefinitionProviderDiagnosticEvent) => void;
}

export interface FetchAiPairsResult {
	pairs: Record<string, string>;
	missing: string[];
	warning?: string;
	diagnostics: DefinitionProviderDiagnostics;
}

interface ChatCompletionCallOptions {
	endpoint: string;
	model: string;
	fetchImpl: typeof fetch;
	apiKey: string;
	baseBody: Record<string, unknown>;
	signal: AbortSignal;
	/** 超时秒数（仅用于错误文案） */
	timeoutSec: number;
	onDiagnostic?: (event: DefinitionProviderDiagnosticEvent) => void;
}

/**
 * 调用 OpenAI 兼容 Chat Completions，带两级兼容降级（response_format → reasoning_effort → 最小请求体）
 * 与网络/超时/中止错误映射。返回响应与是否发生过降级。
 */
export async function callChatCompletion(
	options: ChatCompletionCallOptions,
): Promise<{ response: Response; fallbackUsed: boolean }> {
	const extendedBody = {
		...options.baseBody,
		reasoning_effort: "none",
		response_format: { type: "json_object" },
	};
	const reasoningBody = {
		...options.baseBody,
		reasoning_effort: "none",
	};
	const call = (body: unknown) =>
		options.fetchImpl(options.endpoint, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${options.apiKey}`,
			},
			body: JSON.stringify(body),
			signal: options.signal,
		});

	let response: Response;
	let fallbackUsed = false;
	try {
		response = await call(extendedBody);
		if (
			(response.status === 400 || response.status === 422) &&
			!options.signal.aborted
		) {
			fallbackUsed = true;
			options.onDiagnostic?.({
				event: "compatibility-fallback",
				level: "warning",
				details: {
					endpoint: options.endpoint,
					model: options.model,
					status: response.status,
					stage: "without-response-format",
					reason: "扩展参数请求被拒绝，先仅移除 response_format",
				},
			});
			response = await call(reasoningBody);
		}
		if (
			(response.status === 400 || response.status === 422) &&
			!options.signal.aborted
		) {
			options.onDiagnostic?.({
				event: "compatibility-fallback",
				level: "warning",
				details: {
					endpoint: options.endpoint,
					model: options.model,
					status: response.status,
					stage: "minimal-body",
					reason: "reasoning_effort 仍被拒绝，改用最小兼容请求体",
				},
			});
			response = await call(options.baseBody);
		}
	} catch (error) {
		if (options.signal.aborted) {
			options.onDiagnostic?.({
				event: "request-failed",
				level: "warning",
				details: {
					endpoint: options.endpoint,
					model: options.model,
					code: "aborted",
				},
			});
			throw new DefinitionProviderError("aborted", "已中止");
		}
		const timeout =
			error instanceof DOMException && error.name === "TimeoutError";
		options.onDiagnostic?.({
			event: "request-failed",
			level: "error",
			details: {
				endpoint: options.endpoint,
				model: options.model,
				code: timeout ? "timeout" : "network",
				message: error instanceof Error ? error.message : String(error),
			},
		});
		throw new DefinitionProviderError(
			timeout ? "timeout" : "network",
			timeout
				? `AI 请求超时（${options.timeoutSec} 秒），请重试`
				: "无法连接 AI 服务，请检查网络与地址",
		);
	}
	return { response, fallbackUsed };
}

export async function fetchAiPairs(
	options: FetchAiPairsOptions,
): Promise<FetchAiPairsResult> {
	const pairLabel = options.kind === "definition" ? "释义" : "中文词";
	const startedAt = performance.now();
	const endpoint = `${options.baseUrl.replace(/\/+$/, "")}/chat/completions`;
	const fetchImpl = options.fetchImpl ?? fetch;
	const timeoutSec = Math.round((options.timeoutMs ?? 60_000) / 1000);
	const timeoutSignal = AbortSignal.timeout(options.timeoutMs ?? 60_000);
	const signal = options.signal
		? AbortSignal.any([options.signal, timeoutSignal])
		: timeoutSignal;
	const baseBody = {
		model: options.model,
		temperature: 0,
		max_tokens: 4096,
		messages: [
			{
				role: "system",
				content: buildPairSystemPrompt(
					options.kind,
					options.contentLevel ?? DEFAULT_CONTENT_LEVEL,
				),
			},
			{ role: "user", content: JSON.stringify(options.words) },
		],
	};
	const { response, fallbackUsed } = await callChatCompletion({
		endpoint,
		model: options.model,
		fetchImpl,
		apiKey: options.apiKey,
		baseBody,
		signal,
		timeoutSec,
		onDiagnostic: options.onDiagnostic,
	});

	let parsed: ParsedAiResponse;
	try {
		parsed = await parseDefinitionAiResponse(response, options.kind);
	} catch (error) {
		const providerError =
			error instanceof DefinitionProviderError ? error : undefined;
		options.onDiagnostic?.({
			event: "response-invalid",
			level: "error",
			details: {
				endpoint,
				model: options.model,
				code: providerError?.code ?? "unknown",
				status: providerError?.status,
				message: error instanceof Error ? error.message : String(error),
				fallbackUsed,
			},
		});
		throw error;
	}
	const pairs = alignDefinitions(options.words, parsed.definitions);
	const missing = options.words.filter(
		(word) => !ownDefinition(pairs, word),
	);
	let warning: string | undefined;
	if (missing.length > 0) {
		warning = `AI 仅返回 ${options.words.length - missing.length}/${options.words.length} 个有效${pairLabel}`;
	}
	if (parsed.finishReason === "length") {
		warning = `${warning ? `${warning}；` : ""}响应因输出长度限制被截断`;
	}
	if (warning) {
		options.onDiagnostic?.({
			event: "response-incomplete",
			level: "warning",
			details: {
				endpoint,
				model: options.model,
				requestedCount: options.words.length,
				returnedCount: Object.keys(pairs).length,
				missing,
				finishReason: parsed.finishReason,
				fallbackUsed,
			},
		});
	}

	return {
		pairs,
		missing,
		warning,
		diagnostics: {
			endpoint,
			model: options.model,
			requestedCount: options.words.length,
			returnedCount: Object.keys(pairs).length,
			finishReason: parsed.finishReason,
			fallbackUsed,
			elapsedMs: Math.round(performance.now() - startedAt),
			usage: parsed.usage,
		},
	};
}

/** 英文释义（保持原签名与结果形状，供路由/服务/诊断脚本调用） */
export async function fetchEnglishDefinitions(
	options: FetchEnglishDefinitionsOptions,
): Promise<DefinitionProviderResult> {
	const result = await fetchAiPairs({ ...options, kind: "definition" });
	return {
		definitions: result.pairs,
		missing: result.missing,
		warning: result.warning,
		diagnostics: result.diagnostics,
	};
}

export interface ChineseWordsProviderResult {
	words: Record<string, string>;
	missing: string[];
	warning?: string;
	diagnostics: DefinitionProviderDiagnostics;
}

/** 中文对应词（英文单词 → 常用简体中文词） */
export async function fetchChineseWords(
	options: FetchEnglishDefinitionsOptions,
): Promise<ChineseWordsProviderResult> {
	const result = await fetchAiPairs({ ...options, kind: "chinese" });
	return {
		words: result.pairs,
		missing: result.missing,
		warning: result.warning,
		diagnostics: result.diagnostics,
	};
}

/* ---------- 答案 AI 批改（中文词 / 英文释义，结构同构） ---------- */

export type GradeKind = "chinese" | "definition";

export interface GradeItem {
	word: string;
	/** 准备阶段抓取的标准答案（中文对应词或英文释义） */
	expected: string;
	/** 学生作答 */
	answer: string;
}

export interface GradeResult {
	word: string;
	correct: boolean;
	note?: string;
}

export interface GradesProviderResult {
	grades: GradeResult[];
	missing: string[];
	warning?: string;
	diagnostics: DefinitionProviderDiagnostics;
}

export interface FetchGradesOptions {
	kind: GradeKind;
	items: GradeItem[];
	baseUrl: string;
	apiKey: string;
	model: string;
	signal?: AbortSignal;
	timeoutMs?: number;
	fetchImpl?: typeof fetch;
	onDiagnostic?: (event: DefinitionProviderDiagnosticEvent) => void;
}

const GRADE_SYSTEM_PROMPTS: Record<GradeKind, string> = {
	chinese:
		"You are a strict but fair grader for an English-to-Chinese dictation exercise. " +
		'Reply with STRICT JSON only (no markdown fences, no extra text) using this shape: ' +
		'{"results":[{"word":"<exact original word>","correct":true,"note":"<optional short reason>"}]}. ' +
		"For each item judge whether the student's Chinese answer is an acceptable translation of the English word: " +
		"common synonyms and reasonable word choices are acceptable; ignore leading/trailing whitespace and Chinese punctuation differences; " +
		"a blank answer is incorrect; include every requested word exactly once, keyed by the exact original word.",
	definition:
		"You are a strict but fair grader for an English vocabulary dictation exercise. " +
		'Reply with STRICT JSON only (no markdown fences, no extra text) using this shape: ' +
		'{"results":[{"word":"<exact original word>","correct":true,"note":"<optional short reason>"}]}. ' +
		"For each item judge whether the student's English definition expresses the same core meaning as the expected definition: " +
		"paraphrases and different wording are acceptable; ignore capitalization, punctuation, and article (a/the) differences; " +
		"minor spelling mistakes that do not obscure the meaning are acceptable; a blank answer is incorrect; " +
		"include every requested word exactly once, keyed by the exact original word.",
};

function parseCorrectValue(value: unknown): boolean | undefined {
	if (typeof value === "boolean") return value;
	if (typeof value === "number") return value === 1 ? true : value === 0 ? false : undefined;
	if (typeof value === "string") {
		const v = value.trim().toLowerCase();
		if (v === "true" || v === "yes" || v === "y" || v === "correct" || v === "1") return true;
		if (v === "false" || v === "no" || v === "n" || v === "incorrect" || v === "0") return false;
	}
	return undefined;
}

function gradesFromCandidate(
	candidate: unknown,
): Record<string, GradeResult> {
	const result = Object.create(null) as Record<string, GradeResult>;
	const addItem = (word: unknown, correct: unknown, note?: unknown) => {
		if (typeof word !== "string") return;
		const w = word.trim();
		const verdict = parseCorrectValue(correct);
		if (!w || verdict === undefined) return;
		result[w] = {
			word: w,
			correct: verdict,
			...(typeof note === "string" && note.trim() ? { note: note.trim() } : {}),
		};
	};

	let items: unknown[] = [];
	if (Array.isArray(candidate)) {
		items = candidate;
	} else if (candidate && typeof candidate === "object") {
		const holder = candidate as {
			results?: unknown;
			grades?: unknown;
			words?: unknown;
		};
		if (Array.isArray(holder.results)) items = holder.results;
		else if (Array.isArray(holder.grades)) items = holder.grades;
		else if (holder.words && typeof holder.words === "object") {
			for (const [word, v] of Object.entries(holder.words as Record<string, unknown>)) {
				if (v && typeof v === "object") {
					const o = v as { correct?: unknown; note?: unknown };
					addItem(word, o.correct, o.note);
				} else {
					addItem(word, v);
				}
			}
			return result;
		} else if (holder.words === undefined && holder.results === undefined && holder.grades === undefined) {
			// 直接 map：{hello: true, apple: {correct: true}}
			for (const [word, v] of Object.entries(candidate as Record<string, unknown>)) {
				if (v && typeof v === "object") {
					const o = v as { correct?: unknown; note?: unknown };
					addItem(word, o.correct, o.note);
				} else {
					addItem(word, v);
				}
			}
			return result;
		}
	}
	for (const item of items) {
		if (!item || typeof item !== "object") continue;
		const o = item as { word?: unknown; correct?: unknown; note?: unknown; answer?: unknown; value?: unknown };
		addItem(o.word, o.correct, o.note);
	}
	return result;
}

/** 解析兼容 Chat Completions 响应中的批改结果，合并所有内容块。 */
async function parseGradeAiResponse(response: Response): Promise<Record<string, GradeResult>> {
	if (!response.ok) {
		const detail = await response.text().catch(() => "");
		throw new DefinitionProviderError(
			"http",
			`AI 服务返回 ${response.status}${detail ? `：${detail.slice(0, 240)}` : ""}`,
			response.status,
		);
	}
	let data: {
		choices?: {
			message?: { content?: unknown; parsed?: unknown };
			text?: unknown;
		}[];
		output_text?: unknown;
	};
	try {
		data = await response.json();
	} catch {
		throw new DefinitionProviderError(
			"invalid-response",
			"AI 返回了无法解析的响应 JSON",
		);
	}
	const choice = data?.choices?.[0];
	const sources: unknown[] = [
		choice?.message?.parsed,
		choice?.message?.content,
		choice?.text,
		data?.output_text,
	].filter((value) => value != null);
	if (sources.length === 0) {
		throw new DefinitionProviderError(
			"invalid-response",
			"AI 响应缺少可解析内容",
		);
	}
	let sawJson = false;
	const grades = Object.create(null) as Record<string, GradeResult>;
	for (const source of sources) {
		for (const candidate of contentCandidates(source)) {
			sawJson = true;
			Object.assign(grades, gradesFromCandidate(candidate));
		}
	}
	if (Object.keys(grades).length === 0) {
		throw new DefinitionProviderError(
			sawJson ? "empty" : "invalid-response",
			sawJson
				? "AI 未返回任何有效批改结果，请重试"
				: "AI 未返回 JSON 格式的批改结果",
		);
	}
	return grades;
}

/** 一次请求批改全部作答（中文词/英文释义按 kind 选择判定口径；关 thinking，模型不支持时自动降级）。 */
export async function fetchAnswerGrades(
	options: FetchGradesOptions,
): Promise<GradesProviderResult> {
	const startedAt = performance.now();
	const endpoint = `${options.baseUrl.replace(/\/+$/, "")}/chat/completions`;
	const fetchImpl = options.fetchImpl ?? fetch;
	const timeoutMs = options.timeoutMs ?? 30_000;
	const timeoutSec = Math.round(timeoutMs / 1000);
	const timeoutSignal = AbortSignal.timeout(timeoutMs);
	const signal = options.signal
		? AbortSignal.any([options.signal, timeoutSignal])
		: timeoutSignal;
	const baseBody = {
		model: options.model,
		temperature: 0,
		max_tokens: 4096,
		messages: [
			{ role: "system", content: GRADE_SYSTEM_PROMPTS[options.kind] },
			{ role: "user", content: JSON.stringify(options.items) },
		],
	};
	const { response, fallbackUsed } = await callChatCompletion({
		endpoint,
		model: options.model,
		fetchImpl,
		apiKey: options.apiKey,
		baseBody,
		signal,
		timeoutSec,
		onDiagnostic: options.onDiagnostic,
	});

	let parsed: Record<string, GradeResult>;
	try {
		parsed = await parseGradeAiResponse(response);
	} catch (error) {
		const providerError =
			error instanceof DefinitionProviderError ? error : undefined;
		options.onDiagnostic?.({
			event: "response-invalid",
			level: "error",
			details: {
				endpoint,
				model: options.model,
				code: providerError?.code ?? "unknown",
				status: providerError?.status,
				message: error instanceof Error ? error.message : String(error),
				fallbackUsed,
			},
		});
		throw error;
	}

	const grades: GradeResult[] = [];
	const missing: string[] = [];
	for (const item of options.items) {
		const exact = parsed[item.word];
		if (exact) {
			grades.push(exact);
			continue;
		}
		// 大小写折叠对齐（AI 可能改写 key）
		const folded = Object.keys(parsed).find(
			(k) => k.trim().toLocaleLowerCase("en-US") === item.word.toLocaleLowerCase("en-US"),
		);
		if (folded) grades.push(parsed[folded]);
		else missing.push(item.word);
	}
	let warning: string | undefined;
	if (missing.length > 0) {
		warning = `AI 仅返回 ${options.items.length - missing.length}/${options.items.length} 个批改结果`;
	}
	if (warning) {
		options.onDiagnostic?.({
			event: "response-incomplete",
			level: "warning",
			details: {
				endpoint,
				model: options.model,
				requestedCount: options.items.length,
				returnedCount: grades.length,
				missing,
				fallbackUsed,
			},
		});
	}

	return {
		grades,
		missing,
		warning,
		diagnostics: {
			endpoint,
			model: options.model,
			requestedCount: options.items.length,
			returnedCount: grades.length,
			fallbackUsed,
			elapsedMs: Math.round(performance.now() - startedAt),
		},
	};
}
