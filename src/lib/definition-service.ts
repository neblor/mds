/** 释义业务编排：缓存命中 → 第三方请求 → 校验合并 → 原子缓存与复读验证。 */
import type { RuntimeCacheStorage } from "./cache-storage";
import type { RuntimeDiagnosticLogger } from "./runtime-logger";
import {
	DefinitionProviderError,
	fetchEnglishDefinitions,
	ownDefinition,
	type DefinitionProviderDiagnostics,
} from "./definition-provider";

export interface GetDefinitionsOptions {
	words: string[];
	baseUrl: string;
	apiKey: string;
	model: string;
	storage: Pick<
		RuntimeCacheStorage,
		"readDefinitions" | "writeDefinitions"
	>;
	logger?: RuntimeDiagnosticLogger;
	signal?: AbortSignal;
	fetchImpl?: typeof fetch;
}

export interface GetDefinitionsResult {
	definitions: Record<string, string>;
	missing?: string[];
	cachedCount: number;
	warning?: string;
	diagnostics?: DefinitionProviderDiagnostics;
}

function readCache(
	storage: GetDefinitionsOptions["storage"],
	model: string,
): Record<string, string> {
	try {
		const raw = storage.readDefinitions() as
			| { model?: unknown; defs?: unknown }
			| undefined;
		if (!raw || raw.model !== model || !raw.defs || typeof raw.defs !== "object") {
			return {};
		}
		const definitions: Record<string, string> = {};
		for (const key of Object.keys(raw.defs)) {
			const value = ownDefinition(
				raw.defs as Record<string, unknown>,
				key,
			);
			if (value) definitions[key] = value;
		}
		return definitions;
	} catch {
		return {};
	}
}

function requestedDefinitions(
	words: string[],
	definitions: Record<string, string>,
): Record<string, string> {
	const selected: Record<string, string> = {};
	for (const word of words) {
		const definition = ownDefinition(definitions, word);
		if (definition) selected[word] = definition;
	}
	return selected;
}

function joinWarnings(...warnings: (string | undefined)[]) {
	const values = warnings.filter((value): value is string => Boolean(value));
	return values.length > 0 ? values.join("；") : undefined;
}

export async function getEnglishDefinitions(
	options: GetDefinitionsOptions,
): Promise<GetDefinitionsResult> {
	const cached = readCache(options.storage, options.model);
	const cachedDefinitions = requestedDefinitions(options.words, cached);
	const cachedCount = Object.keys(cachedDefinitions).length;
	const toFetch = options.words.filter(
		(word) => !ownDefinition(cachedDefinitions, word),
	);
	if (toFetch.length === 0) {
		return { definitions: cachedDefinitions, cachedCount };
	}

	let providerResult;
	try {
		providerResult = await fetchEnglishDefinitions({
			words: toFetch,
			baseUrl: options.baseUrl,
			apiKey: options.apiKey,
			model: options.model,
			signal: options.signal,
			fetchImpl: options.fetchImpl,
			onDiagnostic: (entry) => options.logger?.write(entry),
		});
	} catch (error) {
		if (
			error instanceof DefinitionProviderError &&
			(error.code === "invalid-response" || error.code === "empty")
		) {
			return {
				definitions: cachedDefinitions,
				missing: toFetch,
				cachedCount,
				warning: error.message,
			};
		}
		throw error;
	}

	const merged = { ...cached, ...providerResult.definitions };
	let cacheWarning: string | undefined;
	if (!options.signal?.aborted && Object.keys(providerResult.definitions).length > 0) {
		try {
			options.storage.writeDefinitions({ model: options.model, defs: merged });
			const verified = readCache(options.storage, options.model);
			for (const [word, definition] of Object.entries(
				providerResult.definitions,
			)) {
				if (ownDefinition(verified, word) !== definition) {
					throw new Error(`复读校验缺少 ${word}`);
				}
			}
		} catch (error) {
			cacheWarning = "释义已获取，但写入本地缓存失败";
			options.logger?.write({
				event: "cache-write-failed",
				level: "error",
				details: {
					model: options.model,
					definitionCount: Object.keys(providerResult.definitions).length,
					message: error instanceof Error ? error.message : String(error),
				},
			});
		}
	}

	const definitions = requestedDefinitions(options.words, merged);
	const missing = options.words.filter(
		(word) => !ownDefinition(definitions, word),
	);
	return {
		definitions,
		...(missing.length > 0 ? { missing } : {}),
		cachedCount,
		warning: joinWarnings(providerResult.warning, cacheWarning),
		diagnostics: providerResult.diagnostics,
	};
}
