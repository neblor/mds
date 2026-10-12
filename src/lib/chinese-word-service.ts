/**
 * 中文对应词业务编排（英文单词 → 常用简体中文词）。
 * 通用编排实现在 ai-pair-service.ts；独立缓存文件 chinese-words.json。
 */
import { asAiPairCacheFile, getAiPairs } from "./ai-pair-service";
import type { RuntimeCacheStorage } from "./cache-storage";
import type { RuntimeDiagnosticLogger } from "./runtime-logger";
import type { DefinitionProviderDiagnostics } from "./definition-provider";

export interface GetChineseWordsOptions {
	words: string[];
	baseUrl: string;
	apiKey: string;
	model: string;
	storage: Pick<
		RuntimeCacheStorage,
		"readChineseWords" | "writeChineseWords"
	>;
	logger?: RuntimeDiagnosticLogger;
	signal?: AbortSignal;
	fetchImpl?: typeof fetch;
}

export interface GetChineseWordsResult {
	words: Record<string, string>;
	missing?: string[];
	cachedCount: number;
	warning?: string;
	diagnostics?: DefinitionProviderDiagnostics;
}

export async function getChineseWords(
	options: GetChineseWordsOptions,
): Promise<GetChineseWordsResult> {
	const result = await getAiPairs({
		kind: "chinese",
		words: options.words,
		baseUrl: options.baseUrl,
		apiKey: options.apiKey,
		model: options.model,
		storage: {
			read: () => asAiPairCacheFile(options.storage.readChineseWords()),
			write: (value) => options.storage.writeChineseWords(value),
		},
		logger: options.logger,
		signal: options.signal,
		fetchImpl: options.fetchImpl,
	});
	return {
		words: result.pairs,
		...(result.missing ? { missing: result.missing } : {}),
		cachedCount: result.cachedCount,
		...(result.warning ? { warning: result.warning } : {}),
		...(result.diagnostics ? { diagnostics: result.diagnostics } : {}),
	};
}
