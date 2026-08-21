/**
 * AI 双语词条业务编排（通用）：缓存命中 → 第三方请求 → 校验合并 → 原子缓存与复读验证。
 *
 * 按 kind 区分两类数据，各自使用独立缓存文件（definitions.json / chinese-words.json），
 * 避免一种数据损坏或格式演进影响另一种：
 * - definition：英文释义（defs 键）
 * - chinese：英文单词 → 常用简体中文词（words 键）
 */
import type { RuntimeCacheStorage } from "./cache-storage";
import type { RuntimeDiagnosticLogger } from "./runtime-logger";
import {
	DefinitionProviderError,
	fetchChineseWords,
	fetchEnglishDefinitions,
	ownDefinition,
	type AiPairKind,
	type DefinitionProviderDiagnosticEvent,
	type DefinitionProviderDiagnostics,
} from "./definition-provider";

export interface GetAiPairsOptions {
	kind: AiPairKind;
	words: string[];
	baseUrl: string;
	apiKey: string;
	model: string;
	storage: Pick<RuntimeCacheStorage, "readDefinitions" | "writeDefinitions"> &
		Partial<Pick<RuntimeCacheStorage, "readChineseWords" | "writeChineseWords">>;
	logger?: RuntimeDiagnosticLogger;
	signal?: AbortSignal;
	fetchImpl?: typeof fetch;
}

export interface GetAiPairsResult {
	pairs: Record<string, string>;
	missing?: string[];
	cachedCount: number;
	warning?: string;
	diagnostics?: DefinitionProviderDiagnostics;
}

/** 每类数据的缓存键与取值入口（隔离不同文件的读写） */
function kindStorage(
	kind: AiPairKind,
	storage: GetAiPairsOptions["storage"],
): { read(): unknown; write(value: unknown): void } {
	return kind === "chinese"
		? {
				read: () => storage.readChineseWords?.(),
				write: (value) => storage.writeChineseWords?.(value),
			}
		: {
				read: () => storage.readDefinitions(),
				write: (value) => storage.writeDefinitions(value),
			};
}

/** 缓存 JSON 的字段名：definitions.json 用 defs，chinese-words.json 用 words */
function cacheKey(kind: AiPairKind): "defs" | "words" {
	return kind === "chinese" ? "words" : "defs";
}

function readCache(
	read: () => unknown,
	model: string,
	key: "defs" | "words",
): Record<string, string> {
	try {
		const raw = read() as
			| { model?: unknown; [key: string]: unknown }
			| undefined;
		if (!raw || raw.model !== model || !raw[key] || typeof raw[key] !== "object") {
			return {};
		}
		const entries: Record<string, string> = {};
		for (const word of Object.keys(raw[key] as Record<string, unknown>)) {
			const value = ownDefinition(raw[key] as Record<string, unknown>, word);
			if (value) entries[word] = value;
		}
		return entries;
	} catch {
		return {};
	}
}

function requestedPairs(
	words: string[],
	pairs: Record<string, string>,
): Record<string, string> {
	const selected: Record<string, string> = {};
	for (const word of words) {
		const value = ownDefinition(pairs, word);
		if (value) selected[word] = value;
	}
	return selected;
}

function joinWarnings(...warnings: (string | undefined)[]) {
	const values = warnings.filter((value): value is string => Boolean(value));
	return values.length > 0 ? values.join("；") : undefined;
}

export async function getAiPairs(
	options: GetAiPairsOptions,
): Promise<GetAiPairsResult> {
	const key = cacheKey(options.kind);
	const storage = kindStorage(options.kind, options.storage);
	const cached = readCache(storage.read, options.model, key);
	const cachedPairs = requestedPairs(options.words, cached);
	const cachedCount = Object.keys(cachedPairs).length;
	const toFetch = options.words.filter(
		(word) => !ownDefinition(cachedPairs, word),
	);
	if (toFetch.length === 0) {
		return { pairs: cachedPairs, cachedCount };
	}

	const providerOptions = {
		words: toFetch,
		baseUrl: options.baseUrl,
		apiKey: options.apiKey,
		model: options.model,
		signal: options.signal,
		fetchImpl: options.fetchImpl,
		onDiagnostic: (entry: DefinitionProviderDiagnosticEvent) =>
			options.logger?.write(entry),
	};
	let providerResult;
	try {
		providerResult =
			options.kind === "chinese"
				? await fetchChineseWords(providerOptions)
				: await fetchEnglishDefinitions(providerOptions);
	} catch (error) {
		if (
			error instanceof DefinitionProviderError &&
			(error.code === "invalid-response" || error.code === "empty")
		) {
			return {
				pairs: cachedPairs,
				missing: toFetch,
				cachedCount,
				warning: error.message,
			};
		}
		throw error;
	}

	const provided =
		options.kind === "chinese"
			? providerResult.words
			: providerResult.definitions;
	const merged = { ...cached, ...provided };
	let cacheWarning: string | undefined;
	if (!options.signal?.aborted && Object.keys(provided).length > 0) {
		try {
			storage.write({ model: options.model, [key]: merged });
			const verified = readCache(storage.read, options.model, key);
			for (const [word, value] of Object.entries(provided)) {
				if (ownDefinition(verified, word) !== value) {
					throw new Error(`复读校验缺少 ${word}`);
				}
			}
		} catch (error) {
			cacheWarning = "AI 结果已获取，但写入本地缓存失败";
			options.logger?.write({
				event: "cache-write-failed",
				level: "error",
				details: {
					model: options.model,
					kind: options.kind,
					entryCount: Object.keys(provided).length,
					message: error instanceof Error ? error.message : String(error),
				},
			});
		}
	}

	const pairs = requestedPairs(options.words, merged);
	const missing = options.words.filter(
		(word) => !ownDefinition(pairs, word),
	);
	return {
		pairs,
		...(missing.length > 0 ? { missing } : {}),
		cachedCount,
		warning: joinWarnings(providerResult.warning, cacheWarning),
		diagnostics: providerResult.diagnostics,
	};
}
