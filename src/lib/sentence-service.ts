/**
 * 短句业务编排：缓存命中 → 生句请求 → 超长项收紧重试一次 → 只写合格项并复读验证。
 *
 * 「短」是硬约束（见 sentence-provider）：超过 8 词的句子不会进缓存、不会进默写。
 * 超长项先做一次收紧重试（提示词压到 ≤5 词）；仍不合格的词由调用方降级为单词轮，
 * 本模块只负责如实报告 `missing`。
 *
 * 缓存与释义同一套约定（`sentences.json`）：
 * - 文件里带 `model` + `contentLevel`，任一变化即视为整体失效
 * - 原子写 + 写后复读；写入失败只丢缓存，不影响本次结果
 * - 不缓存缺失项/失败状态（下次仍会重新请求）
 */
import type { RuntimeCacheStorage } from "./cache-storage";
import { DEFAULT_CONTENT_LEVEL, type ContentLevel } from "./content-level";
import {
	DefinitionProviderError,
	type DefinitionProviderDiagnosticEvent,
	type DefinitionProviderDiagnostics,
} from "./definition-provider";
import type { RuntimeDiagnosticLogger } from "./runtime-logger";
import {
	fetchShortSentences,
	type SentenceRejection,
} from "./sentence-provider";

export interface SentenceCacheFile {
	model?: unknown;
	contentLevel?: unknown;
	sentences?: unknown;
}

export interface GetSentencesOptions {
	words: string[];
	baseUrl: string;
	apiKey: string;
	model: string;
	contentLevel?: ContentLevel;
	storage: Pick<RuntimeCacheStorage, "readSentences" | "writeSentences">;
	logger?: RuntimeDiagnosticLogger;
	signal?: AbortSignal;
	fetchImpl?: typeof fetch;
}

export interface GetSentencesResult {
	sentences: Record<string, string>;
	/** 最终没拿到合格短句的词（调用方降级为单词轮） */
	missing: string[];
	cachedCount: number;
	/** 超长被拒的明细（诊断用） */
	rejected: SentenceRejection[];
	warning?: string;
	diagnostics?: DefinitionProviderDiagnostics;
}

/** 只接受字符串值，坏文件当未命中 */
function readCache(
	storage: GetSentencesOptions["storage"],
	model: string,
	contentLevel: ContentLevel,
): Record<string, string> {
	let raw: SentenceCacheFile | undefined;
	try {
		const value = storage.readSentences();
		raw =
			typeof value === "object" && value !== null
				? (value as SentenceCacheFile)
				: undefined;
	} catch {
		return {};
	}
	if (!raw || raw.model !== model) return {};
	// 级别不同 → 句子难度口径不同，整体失效重取
	if ((raw.contentLevel ?? DEFAULT_CONTENT_LEVEL) !== contentLevel) return {};
	const holder = raw.sentences;
	if (!holder || typeof holder !== "object") return {};
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(holder as Record<string, unknown>)) {
		if (typeof value === "string" && value.trim()) out[key] = value;
	}
	return out;
}

function writeCache(
	storage: GetSentencesOptions["storage"],
	model: string,
	contentLevel: ContentLevel,
	previous: Record<string, string>,
	incoming: Record<string, string>,
): void {
	const merged = { ...previous, ...incoming };
	try {
		storage.writeSentences({ model, contentLevel, sentences: merged });
	} catch {
		return; // 写失败不影响本次结果
	}
	// 写后复读：确认这次写入真的落盘（缓存层历史上出现过坏文件被持续命中）
	const readBack = readCache(storage, model, contentLevel);
	for (const [word, sentence] of Object.entries(incoming)) {
		if (readBack[word] !== sentence) {
			throw new Error(`短句缓存写入后复读不一致：${word}`);
		}
	}
}

/** 从已有缓存里挑出本次要用的词 */
function pickCached(
	words: string[],
	cache: Record<string, string>,
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const word of words) {
		if (Object.hasOwn(cache, word)) out[word] = cache[word] as string;
	}
	return out;
}

export async function getShortSentences(
	options: GetSentencesOptions,
): Promise<GetSentencesResult> {
	const contentLevel = options.contentLevel ?? DEFAULT_CONTENT_LEVEL;
	const cached = readCache(options.storage, options.model, contentLevel);
	const cachedPairs = pickCached(options.words, cached);
	const cachedCount = Object.keys(cachedPairs).length;
	const pending = options.words.filter((word) => !Object.hasOwn(cachedPairs, word));

	if (pending.length === 0) {
		return { sentences: cachedPairs, missing: [], cachedCount, rejected: [] };
	}

	const onDiagnostic = (entry: DefinitionProviderDiagnosticEvent) =>
		options.logger?.write(entry);

	const first = await fetchShortSentences({
		words: pending,
		baseUrl: options.baseUrl,
		apiKey: options.apiKey,
		model: options.model,
		contentLevel,
		signal: options.signal,
		fetchImpl: options.fetchImpl,
		onDiagnostic,
	});

	// 超长/不合格的词做一次收紧重试；只重试「有句子但被判不合格」的词
	const rejectedWords = first.rejected.map((item) => item.word);
	const retryWords = [...new Set(rejectedWords)];
	let retried: Record<string, string> = {};
	let rejected: SentenceRejection[] = first.rejected;
	let extraDiagnostics: DefinitionProviderDiagnostics | undefined;
	if (retryWords.length > 0) {
		const previous: Record<string, string> = {};
		for (const item of first.rejected) previous[item.word] = item.sentence;
		const retry = await fetchShortSentences({
			words: retryWords,
			baseUrl: options.baseUrl,
			apiKey: options.apiKey,
			model: options.model,
			contentLevel,
			strict: true,
			previous,
			signal: options.signal,
			fetchImpl: options.fetchImpl,
			onDiagnostic,
		});
		retried = retry.sentences;
		// 重试仍不合格的，保留其（更短的）理由，便于诊断
		rejected = retry.rejected;
		extraDiagnostics = retry.diagnostics;
	}

	const fresh: Record<string, string> = { ...first.sentences, ...retried };
	if (Object.keys(fresh).length > 0) {
		try {
			writeCache(options.storage, options.model, contentLevel, cached, fresh);
		} catch (error) {
			options.logger?.write({
				event: "sentence-cache-write-failed",
				level: "error",
				details: {
					model: options.model,
					message: error instanceof Error ? error.message : String(error),
				},
			});
		}
	}

	const sentences = { ...cachedPairs, ...fresh };
	const missing = options.words.filter((word) => !Object.hasOwn(sentences, word));
	const warnings = [first.warning].filter((value): value is string => Boolean(value));
	if (missing.length > 0) {
		warnings.push(
			`${missing.length} 个词没有合格短句（超过 8 词或缺词），将降级为单词默写`,
		);
	}
	return {
		sentences,
		missing,
		cachedCount,
		rejected,
		...(warnings.length > 0 ? { warning: warnings.join("；") } : {}),
		diagnostics: extraDiagnostics ?? first.diagnostics,
	};
}

/** 判断错误是否属于「AI 不可用」应当整体降级的情形（与释义一致） */
export function isUnavailableError(error: unknown): boolean {
	return (
		error instanceof DefinitionProviderError &&
		error.code !== "aborted"
	);
}
