/**
 * 组句（范例组句）出题提供器：准备阶段**一次请求**生成本场全部题目。
 *
 * 与释义 / 中文词 / 批改共用 OpenAI 兼容 Chat Completions 调用与内容块抽取；
 * 契约校验在 cloze-parse.ts（纯函数，可单测）。任何失败（网络 / HTTP / 超时 /
 * JSON 不合法 / 校验不过）都抛 DefinitionProviderError，由调用方按
 * 「AI 当前不可用」结束本场——**不降级、不自动重试**（见 plans/wordbank-srs-cloze.md R7/D6）。
 */
import {
	DefinitionProviderError,
	callChatCompletion,
	contentCandidates,
	readChatSources,
	type DefinitionProviderDiagnosticEvent,
	type DefinitionProviderDiagnostics,
} from "./definition-provider";
import { ClozeParseError, parseClozeItems, type ClozeItem } from "./cloze-parse";
import {
	CONTENT_LEVEL_PROMPTS,
	DEFAULT_CONTENT_LEVEL,
	type ContentLevel,
} from "./content-level";

/** 候选词（可带英文释义，帮助 AI 选对义项；没有也能出题） */
export interface ClozeCandidate {
	word: string;
	definition?: string;
}

export interface FetchClozeOptions {
	candidates: ClozeCandidate[];
	baseUrl: string;
	apiKey: string;
	model: string;
	/** 生成级别（用户设置，默认初中）；只约束句子的词汇与句法难度 */
	contentLevel?: ContentLevel;
	signal?: AbortSignal;
	timeoutMs?: number;
	fetchImpl?: typeof fetch;
	onDiagnostic?: (event: DefinitionProviderDiagnosticEvent) => void;
}

export interface FetchClozeResult {
	items: ClozeItem[];
	diagnostics: DefinitionProviderDiagnostics;
}

/**
 * 组句出题 system prompt：平铺直叙只说「要什么」，加真护栏（输出非 JSON、编号与 index 对不上、编造池外单词）。
 * 句子的词汇与句法难度用生成级别（contentLevel）的客观描述指定，不使用任何主观定位。
 */
export function buildClozeSystemPrompt(contentLevel: ContentLevel): string {
	return (
		"You write fill-in-the-blank English exercises. " +
		"Reply with STRICT JSON only, no markdown fences and no extra text: " +
		'{"items":[{"id":1,"sentences":["First sentence with ##1 here.","Second sentence with ##2 here."],' +
		'"blanks":[{"index":1,"answer":"<candidate word>"},{"index":2,"answer":"<candidate word>"}]}]} ' +
		"Produce 3 to 6 items, each with 2 to 3 sentences and 2 to 4 blanks. " +
		"Mark each blank in the sentences as ##1, ##2, ... and give its entry in blanks the matching index. " +
		"Every answer is a candidate word from the user message, spelled as listed - never invent a word. " +
		`Write grammatically correct sentences in ${CONTENT_LEVEL_PROMPTS[contentLevel]}, and make each blank have exactly one clearly correct candidate. ` +
		"Across the items, cover 6 to 16 candidate words."
	);
}

/** 用户消息：候选词 + 可选释义（只给 AI 必需的信息） */
export function buildClozeUserPrompt(candidates: ClozeCandidate[]): string {
	return JSON.stringify(
		candidates.map((candidate) => {
			const word = candidate.word.trim();
			const definition = candidate.definition?.trim();
			return definition ? { word, definition } : { word };
		}),
	);
}

/**
 * 从兼容 Chat Completions 响应中提取并校验题目。
 * 逐个 JSON 候选尝试；契约不过时带上第一条原因（用户可见的诊断信息）。
 */
export async function parseClozeResponse(
	response: Response,
	candidates: string[],
): Promise<ClozeItem[]> {
	const { sources } = await readChatSources(response);
	const reasons: string[] = [];
	for (const source of sources) {
		for (const candidate of contentCandidates(source)) {
			try {
				return parseClozeItems(candidate, candidates);
			} catch (error) {
				if (error instanceof ClozeParseError) {
					reasons.push(error.reason);
					continue;
				}
				throw error;
			}
		}
	}
	if (reasons.length === 0) {
		throw new DefinitionProviderError("invalid-response", "AI 未返回 JSON 格式的题目");
	}
	throw new DefinitionProviderError(
		"invalid-response",
		`生成的题目不符合要求：${reasons[0]}`,
	);
}

/** 一次请求生成整场组句题；失败即抛错（调用方显示「AI 当前不可用」并结束本场） */
export async function fetchClozeItems(
	options: FetchClozeOptions,
): Promise<FetchClozeResult> {
	const candidates = options.candidates
		.map((candidate) => ({
			word: candidate.word.trim(),
			definition: candidate.definition?.trim() || undefined,
		}))
		.filter((candidate) => candidate.word.length > 0);
	if (candidates.length === 0) {
		throw new DefinitionProviderError("empty", "候选词为空，无法出题");
	}

	const startedAt = performance.now();
	const endpoint = `${options.baseUrl.replace(/\/+$/, "")}/chat/completions`;
	const fetchImpl = options.fetchImpl ?? fetch;
	const timeoutMs = options.timeoutMs ?? 90_000;
	const timeoutSec = Math.round(timeoutMs / 1000);
	const timeoutSignal = AbortSignal.timeout(timeoutMs);
	const signal = options.signal
		? AbortSignal.any([options.signal, timeoutSignal])
		: timeoutSignal;
	const baseBody = {
		model: options.model,
		temperature: 0.3,
		max_tokens: 4096,
		messages: [
			{
				role: "system",
				content: buildClozeSystemPrompt(
					options.contentLevel ?? DEFAULT_CONTENT_LEVEL,
				),
			},
			{ role: "user", content: buildClozeUserPrompt(candidates) },
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

	let items: ClozeItem[];
	try {
		items = await parseClozeResponse(
			response,
			candidates.map((candidate) => candidate.word),
		);
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

	return {
		items,
		diagnostics: {
			endpoint,
			model: options.model,
			requestedCount: candidates.length,
			returnedCount: items.length,
			fallbackUsed,
			elapsedMs: Math.round(performance.now() - startedAt),
		},
	};
}
