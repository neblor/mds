/**
 * AI 音标兜底（只补内置词典缺失的词）
 *
 * 设计原则（见 plans/phonetic-mode.md §3.2.3）：
 * - 提示词要求返回「词 → 音素 token 数组」，不做自由文本解释；
 * - 所有输出必须经过 `parsePhoneticVariants` 的白名单/重音归位/主重音数量校验；
 * - 任何不合格/缺失都不写入缓存（不做负缓存），下次准备仍会重试；
 * - 结果来源标为 ai，结果页提示「AI 生成，仅供参考」。
 */
import {
	callChatCompletion,
	contentCandidates,
	DefinitionProviderError,
	readChatSources,
	type DefinitionProviderDiagnosticEvent,
	type DefinitionProviderDiagnostics,
} from "./definition-provider";
import { parsePhoneticVariants } from "./phonetic-parse";
import { IPA_SYMBOLS, IPA_TOKEN_SET } from "./phonetic-symbols";

export const PHONETIC_PROMPT_VERSION = 1;

const TOKEN_HINT = IPA_SYMBOLS.join(" ");

export const PHONETIC_SYSTEM_PROMPT = `You are a British English (Received Pronunciation) pronouncing dictionary.

Return ONLY a JSON object in this exact shape:
{"phonetics":{"word":[["ˈ","æ","p","ə","l"]]}}

Rules:
- Each pronunciation must be an ARRAY of tokens, not a string.
- Use ONLY these tokens: ${TOKEN_HINT}
- British RP, not American. Use ɒ, ɔː, əʊ, ɑː etc. Do not use ɹ, ɚ, ɝ, ɛ, ɐ, g (ASCII), or ʧ/ʤ.
- Primary stress is the separate token "ˈ"; secondary stress is "ˌ". Put stress before the first consonant of the stressed syllable (maximal onset), e.g. ["ˈ","w","ɔː","t","ə"].
- Do not add slashes, spaces, explanations, or Chinese text.
- Include only the requested words. If you are unsure about a word, omit it rather than guessing.
- At most one primary stress per pronunciation; a word may have up to 3 variants.`;

export interface FetchPhoneticsOptions {
	words: string[];
	baseUrl: string;
	apiKey: string;
	model: string;
	signal?: AbortSignal;
	timeoutMs?: number;
	fetchImpl?: typeof fetch;
	onDiagnostic?: (event: DefinitionProviderDiagnosticEvent) => void;
}

export interface FetchPhoneticsResult {
	/** 请求词 → 读音变体（token 数组；键与请求词一致） */
	phonetics: Record<string, string[][]>;
	missing: string[];
	warning?: string;
	diagnostics: DefinitionProviderDiagnostics;
}

function own<T>(record: Record<string, T>, key: string): T | undefined {
	return Object.hasOwn(record, key) ? record[key] : undefined;
}

/**
 * 把一个 AI 返回的 value 归一成「待解析的读音列表」：
 * - 字符串 → 一个待 tokenize 的读音；
 * - 平铺的合法 token 数组 → 一个读音；
 * - 字符串数组（含斜杠/空格）→ 多个读音；
 * - 数组的数组 → 多个 token 数组。
 */
function variantsOf(value: unknown): Array<string | string[]> {
	if (typeof value === "string") return [value];
	if (!Array.isArray(value)) return [];
	if (value.every((item): item is string => typeof item === "string")) {
		if (value.length > 0 && value.every((token) => IPA_TOKEN_SET.has(token))) {
			return [value];
		}
		return value;
	}
	return value.filter(
		(item): item is string[] =>
			Array.isArray(item) && item.every((token) => typeof token === "string"),
	);
}

/** 从一个候选 JSON 中收集词条；兼容 {phonetics:{...}} 与直接的 {word:...} */
function collectPhonetics(
	candidate: unknown,
	out: Record<string, string[][]>,
): boolean {
	if (Array.isArray(candidate)) {
		let saw = false;
		for (const item of candidate) saw = collectPhonetics(item, out) || saw;
		return saw;
	}
	if (typeof candidate !== "object" || candidate === null) return false;
	const holder = candidate as Record<string, unknown>;
	const table =
		typeof holder.phonetics === "object" && holder.phonetics !== null
			? (holder.phonetics as Record<string, unknown>)
			: holder;
	let saw = false;
	for (const [rawWord, rawValue] of Object.entries(table)) {
		if (rawWord === "phonetics") continue;
		const word = rawWord.trim().toLocaleLowerCase("en-US");
		if (!word) continue;
		const variants = variantsOf(rawValue);
		if (variants.length === 0) continue;
		const parsed = parsePhoneticVariants(variants, "ai");
		if (parsed.length === 0) continue;
		// 同一候选里重复词取并集；保持先出现的顺序
		const existing = own(out, word) ?? [];
		const seen = new Set(existing.map((tokens) => tokens.join(" ")));
		const merged = [...existing];
		for (const tokens of parsed) {
			const key = tokens.join(" ");
			if (seen.has(key)) continue;
			seen.add(key);
			merged.push(tokens);
			if (merged.length >= 3) break;
		}
		if (merged.length > 0) {
			out[word] = merged;
			saw = true;
		}
	}
	return saw;
}

function alignPhonetics(
	words: string[],
	provided: Record<string, string[][]>,
): Record<string, string[][]> {
	const aligned = Object.create(null) as Record<string, string[][]>;
	const folded = new Map<string, string[]>();
	for (const key of Object.keys(provided)) {
		const canonical = key.trim().toLocaleLowerCase("en-US");
		folded.set(canonical, [...(folded.get(canonical) ?? []), key]);
	}
	for (const word of words) {
		const exact = own(provided, word);
		if (exact) {
			aligned[word] = exact;
			continue;
		}
		const matches = folded.get(word.toLocaleLowerCase("en-US")) ?? [];
		if (matches.length !== 1) continue;
		const value = own(provided, matches[0]);
		if (value) aligned[word] = value;
	}
	return aligned;
}

export async function fetchPhonetics(
	options: FetchPhoneticsOptions,
): Promise<FetchPhoneticsResult> {
	const startedAt = performance.now();
	const endpoint = `${options.baseUrl.replace(/\/+$/, "")}/chat/completions`;
	const fetchImpl = options.fetchImpl ?? fetch;
	const timeoutMs = options.timeoutMs ?? 60_000;
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
			{ role: "system", content: PHONETIC_SYSTEM_PROMPT },
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

	const { sources, finishReason, usage } = await readChatSources(response);
	const collected = Object.create(null) as Record<string, string[][]>;
	let sawJson = false;
	for (const source of sources) {
		for (const candidate of contentCandidates(source)) {
			sawJson = true;
			collectPhonetics(candidate, collected);
		}
	}
	if (Object.keys(collected).length === 0) {
		throw new DefinitionProviderError(
			sawJson ? "empty" : "invalid-response",
			sawJson
				? "AI 未返回任何有效音标，请重试"
				: "AI 未返回 JSON 格式的音标",
		);
	}

	const phonetics = alignPhonetics(options.words, collected);
	const missing = options.words.filter((word) => !own(phonetics, word));
	let warning: string | undefined;
	if (missing.length > 0) {
		warning = `AI 仅返回 ${options.words.length - missing.length}/${options.words.length} 个有效音标`;
	}
	if (finishReason === "length") {
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
				returnedCount: Object.keys(phonetics).length,
				missing,
				finishReason,
				fallbackUsed,
			},
		});
	}

	return {
		phonetics,
		missing,
		warning,
		diagnostics: {
			endpoint,
			model: options.model,
			requestedCount: options.words.length,
			returnedCount: Object.keys(phonetics).length,
			finishReason,
			fallbackUsed,
			elapsedMs: Math.round(performance.now() - startedAt),
			usage,
		},
	};
}
