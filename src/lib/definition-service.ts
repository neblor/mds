/**
 * 英文释义业务编排（definition 词条）。
 * 通用编排实现在 ai-pair-service.ts，本文件保持原导出签名与结果形状：
 * 路由、诊断脚本与既有测试无需改动。
 */
import { asAiPairCacheFile, getAiPairs } from "./ai-pair-service";
import type { RuntimeCacheStorage } from "./cache-storage";
import type { RuntimeDiagnosticLogger } from "./runtime-logger";
import type { DefinitionProviderDiagnostics } from "./definition-provider";

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

export async function getEnglishDefinitions(
	options: GetDefinitionsOptions,
): Promise<GetDefinitionsResult> {
	const result = await getAiPairs({
		kind: "definition",
		words: options.words,
		baseUrl: options.baseUrl,
		apiKey: options.apiKey,
		model: options.model,
		storage: {
			read: () => asAiPairCacheFile(options.storage.readDefinitions()),
			write: (value) => options.storage.writeDefinitions(value),
		},
		logger: options.logger,
		signal: options.signal,
		fetchImpl: options.fetchImpl,
	});
	return {
		definitions: result.pairs,
		...(result.missing ? { missing: result.missing } : {}),
		cachedCount: result.cachedCount,
		...(result.warning ? { warning: result.warning } : {}),
		...(result.diagnostics ? { diagnostics: result.diagnostics } : {}),
	};
}
