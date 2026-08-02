/**
 * OpenAI Chat Completions 兼容的英文释义提供器。
 *
 * 只负责远端请求、兼容响应解析与请求词对齐；不依赖路由或磁盘缓存，
 * 因而可以被 API、单元测试和命令行诊断脚本共同调用。
 */

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

const SYSTEM_PROMPT =
	"You are an English dictionary for kids. Reply with STRICT JSON only " +
	'(no markdown fences, no extra text) using this shape: {"definitions":{"<exact original word>":"<one clear English sentence>"}}. ' +
	"Definitions must be English only, simple, kid-friendly, and include every requested word exactly once.";

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

function contentCandidates(content: unknown): unknown[] {
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

function definitionsFromCandidate(candidate: unknown): Record<string, string> {
	let items: unknown[] = [];
	if (Array.isArray(candidate)) {
		items = candidate;
	} else if (candidate && typeof candidate === "object") {
		const holder = candidate as {
			definitions?: unknown;
			word?: unknown;
			definition?: unknown;
		};
		if (Array.isArray(holder.definitions)) {
			items = holder.definitions;
		} else if (
			typeof holder.word === "string" &&
			typeof holder.definition === "string"
		) {
			items = [holder];
		} else {
			const map =
				holder.definitions && typeof holder.definitions === "object"
					? (holder.definitions as Record<string, unknown>)
					: (candidate as Record<string, unknown>);
			items = Object.entries(map).map(([word, definition]) => ({
				word,
				definition,
			}));
		}
	}

	const definitions = Object.create(null) as Record<string, string>;
	for (const item of items) {
		const rawWord = (item as { word?: unknown })?.word;
		const rawDefinition = (item as { definition?: unknown })?.definition;
		if (typeof rawWord !== "string" || typeof rawDefinition !== "string") {
			continue;
		}
		const word = rawWord.trim();
		const definition = rawDefinition.trim();
		if (word && definition && isLikelyEnglish(definition)) {
			definitions[word] = definition;
		}
	}
	return definitions;
}

/** 解析兼容 Chat Completions 响应，并合并所有内容块中的有效释义。 */
export async function parseDefinitionAiResponse(
	response: Response,
): Promise<ParsedAiResponse> {
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

	let sawJson = false;
	const definitions = Object.create(null) as Record<string, string>;
	for (const source of sources) {
		for (const candidate of contentCandidates(source)) {
			sawJson = true;
			Object.assign(definitions, definitionsFromCandidate(candidate));
		}
	}
	if (Object.keys(definitions).length === 0) {
		throw new DefinitionProviderError(
			sawJson ? "empty" : "invalid-response",
			sawJson
				? "AI 未返回任何有效释义，请重试"
				: "AI 未返回 JSON 格式的释义",
		);
	}

	const numberOrUndefined = (value: unknown) =>
		typeof value === "number" && Number.isFinite(value) ? value : undefined;
	return {
		definitions,
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

export async function fetchEnglishDefinitions(
	options: FetchEnglishDefinitionsOptions,
): Promise<DefinitionProviderResult> {
	const startedAt = performance.now();
	const endpoint = `${options.baseUrl.replace(/\/+$/, "")}/chat/completions`;
	const fetchImpl = options.fetchImpl ?? fetch;
	const timeoutSignal = AbortSignal.timeout(options.timeoutMs ?? 60_000);
	const signal = options.signal
		? AbortSignal.any([options.signal, timeoutSignal])
		: timeoutSignal;
	const baseBody = {
		model: options.model,
		temperature: 0,
		max_tokens: 4096,
		messages: [
			{ role: "system", content: SYSTEM_PROMPT },
			{ role: "user", content: JSON.stringify(options.words) },
		],
	};
	const extendedBody = {
		...baseBody,
		reasoning_effort: "none",
		response_format: { type: "json_object" },
	};
	const reasoningBody = {
		...baseBody,
		reasoning_effort: "none",
	};
	const call = (body: unknown) =>
		fetchImpl(endpoint, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${options.apiKey}`,
			},
			body: JSON.stringify(body),
			signal,
		});

	let response: Response;
	let fallbackUsed = false;
	try {
		response = await call(extendedBody);
		if (
			(response.status === 400 || response.status === 422) &&
			!options.signal?.aborted
		) {
			fallbackUsed = true;
			options.onDiagnostic?.({
				event: "compatibility-fallback",
				level: "warning",
				details: {
					endpoint,
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
			!options.signal?.aborted
		) {
			options.onDiagnostic?.({
				event: "compatibility-fallback",
				level: "warning",
				details: {
					endpoint,
					model: options.model,
					status: response.status,
					stage: "minimal-body",
					reason: "reasoning_effort 仍被拒绝，改用最小兼容请求体",
				},
			});
			response = await call(baseBody);
		}
	} catch (error) {
		if (options.signal?.aborted) {
			options.onDiagnostic?.({
				event: "request-failed",
				level: "warning",
				details: { endpoint, model: options.model, code: "aborted" },
			});
			throw new DefinitionProviderError("aborted", "已中止");
		}
		const timeout =
			error instanceof DOMException && error.name === "TimeoutError";
		options.onDiagnostic?.({
			event: "request-failed",
			level: "error",
			details: {
				endpoint,
				model: options.model,
				code: timeout ? "timeout" : "network",
				message: error instanceof Error ? error.message : String(error),
			},
		});
		throw new DefinitionProviderError(
			timeout ? "timeout" : "network",
			timeout
				? `AI 请求超时（${Math.round((options.timeoutMs ?? 60_000) / 1000)} 秒），请重试`
				: "无法连接 AI 服务，请检查网络与地址",
		);
	}

	let parsed: ParsedAiResponse;
	try {
		parsed = await parseDefinitionAiResponse(response);
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
	const definitions = alignDefinitions(options.words, parsed.definitions);
	const missing = options.words.filter(
		(word) => !ownDefinition(definitions, word),
	);
	let warning: string | undefined;
	if (missing.length > 0) {
		warning = `AI 仅返回 ${options.words.length - missing.length}/${options.words.length} 个有效释义`;
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
				returnedCount: Object.keys(definitions).length,
				missing,
				finishReason: parsed.finishReason,
				fallbackUsed,
			},
		});
	}

	return {
		definitions,
		missing,
		warning,
		diagnostics: {
			endpoint,
			model: options.model,
			requestedCount: options.words.length,
			returnedCount: Object.keys(definitions).length,
			finishReason: parsed.finishReason,
			fallbackUsed,
			elapsedMs: Math.round(performance.now() - startedAt),
			usage: parsed.usage,
		},
	};
}
