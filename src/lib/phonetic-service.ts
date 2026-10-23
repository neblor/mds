/**
 * AI 音标兜底业务编排：缓存命中 → 只请求缺失词 → 校验合并 → 原子写 → 写后复读。
 *
 * 缓存文件 `phonetics.json` 独立于释义/中文词/短句，格式演进互不牵连；
 * 只缓存通过 `parsePhoneticVariants` 校验的音标，缺失/失败不写负缓存。
 */
import type { RuntimeCacheStorage } from "./cache-storage";
import type { DefinitionProviderDiagnostics } from "./definition-provider";
import { DefinitionProviderError } from "./definition-provider";
import { parsePhoneticVariants } from "./phonetic-parse";
import {
	fetchPhonetics,
	PHONETIC_PROMPT_VERSION,
} from "./phonetic-provider";
import type { RuntimeDiagnosticLogger } from "./runtime-logger";

export interface GetPhoneticsOptions {
	words: string[];
	baseUrl: string;
	apiKey: string;
	model: string;
	storage: Pick<RuntimeCacheStorage, "readPhonetics" | "writePhonetics">;
	logger?: RuntimeDiagnosticLogger;
	signal?: AbortSignal;
	fetchImpl?: typeof fetch;
}

export interface GetPhoneticsResult {
	phonetics: Record<string, string[][]>;
	missing: string[];
	cachedCount: number;
	warning?: string;
	diagnostics?: DefinitionProviderDiagnostics;
}

interface PhoneticCacheFile {
	model?: unknown;
	promptVersion?: unknown;
	phonetics?: unknown;
}

function own<T>(record: Record<string, T>, key: string): T | undefined {
	return Object.hasOwn(record, key) ? record[key] : undefined;
}

function validVariants(value: unknown): string[][] {
	if (!Array.isArray(value)) return [];
	return parsePhoneticVariants(
		value.filter(
			(item): item is string[] =>
				Array.isArray(item) && item.every((token) => typeof token === "string"),
		),
		"ai",
	);
}

/** 读缓存：model/promptVersion 不匹配或坏文件一律视为未命中 */
function readCache(
	read: () => unknown,
	model: string,
): Record<string, string[][]> {
	try {
		const raw = read();
		if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
			return {};
		}
		const file = raw as PhoneticCacheFile;
		if (file.model !== model || file.promptVersion !== PHONETIC_PROMPT_VERSION) {
			return {};
		}
		if (
			typeof file.phonetics !== "object" ||
			file.phonetics === null ||
			Array.isArray(file.phonetics)
		) {
			return {};
		}
		const out = Object.create(null) as Record<string, string[][]>;
		for (const [word, value] of Object.entries(
			file.phonetics as Record<string, unknown>,
		)) {
			const key = word.trim().toLocaleLowerCase("en-US");
			if (!key) continue;
			const variants = validVariants(value);
			if (variants.length > 0) out[key] = variants;
		}
		return out;
	} catch {
		return {};
	}
}

/** 按请求词对齐缓存/结果（大小写不敏感；保留请求词的键） */
function requested(
	words: string[],
	table: Record<string, string[][]>,
): Record<string, string[][]> {
	const out = Object.create(null) as Record<string, string[][]>;
	for (const word of words) {
		const key = word.trim().toLocaleLowerCase("en-US");
		const value = key ? own(table, key) : undefined;
		if (value && value.length > 0) out[word] = value;
	}
	return out;
}

function joinWarnings(...warnings: (string | undefined)[]) {
	const values = warnings.filter((value): value is string => Boolean(value));
	return values.length > 0 ? values.join("；") : undefined;
}

export async function getPhonetics(
	options: GetPhoneticsOptions,
): Promise<GetPhoneticsResult> {
	const cached = readCache(options.storage.readPhonetics, options.model);
	const cachedPairs = requested(options.words, cached);
	const cachedCount = Object.keys(cachedPairs).length;
	const toFetch = options.words.filter(
		(word) => !own(cachedPairs, word),
	);
	if (toFetch.length === 0) {
		return {
			phonetics: cachedPairs,
			missing: [],
			cachedCount,
		};
	}

	let providerResult;
	try {
		providerResult = await fetchPhonetics({
			words: toFetch,
			baseUrl: options.baseUrl,
			apiKey: options.apiKey,
			model: options.model,
			signal: options.signal,
			fetchImpl: options.fetchImpl,
			onDiagnostic: (event) => options.logger?.write(event),
		});
	} catch (error) {
		if (
			error instanceof DefinitionProviderError &&
			(error.code === "invalid-response" || error.code === "empty")
		) {
			return {
				phonetics: cachedPairs,
				missing: toFetch,
				cachedCount,
				warning: error.message,
			};
		}
		throw error;
	}

	const provided = requested(toFetch, providerResult.phonetics);
	const merged = { ...cached, ...provided };
	let cacheWarning: string | undefined;
	if (!options.signal?.aborted && Object.keys(provided).length > 0) {
		try {
			options.storage.writePhonetics({
				model: options.model,
				promptVersion: PHONETIC_PROMPT_VERSION,
				phonetics: merged,
			});
			const verified = readCache(options.storage.readPhonetics, options.model);
			for (const [word, variants] of Object.entries(provided)) {
				const key = word.trim().toLocaleLowerCase("en-US");
				if (JSON.stringify(own(verified, key)) !== JSON.stringify(variants)) {
					throw new Error(`复读校验缺少 ${word}`);
				}
			}
		} catch (error) {
			cacheWarning = "AI 音标已获取，但写入本地缓存失败";
			options.logger?.write({
				event: "cache-write-failed",
				level: "error",
				details: {
					model: options.model,
					entryCount: Object.keys(provided).length,
					message: error instanceof Error ? error.message : String(error),
				},
			});
		}
	}

	const phonetics = requested(options.words, merged);
	const missing = options.words.filter((word) => !own(phonetics, word));
	return {
		phonetics,
		missing,
		cachedCount,
		warning: joinWarnings(providerResult.warning, cacheWarning),
		diagnostics: providerResult.diagnostics,
	};
}
