/**
 * POST /api/chinese-words — 参数校验与 HTTP 适配；业务位于 chinese-word-service。
 * 请求：{ words, baseUrl, apiKey, model } → 返回 { words: {word: 中文词}, missing?, cachedCount, warning? }
 */
import { HTTPError } from "h3";
import { runtimeCache } from "~/lib/cache-storage";
import {
	DefinitionProviderError,
	type DefinitionProviderErrorCode,
} from "~/lib/definition-provider";
import { getChineseWords } from "~/lib/chinese-word-service";
import { runtimeDiagnosticLogger } from "~/lib/runtime-logger";
import { extractWords, readJsonBody, type RouteEvent } from "~/lib/server-body";

interface ChineseWordsRequestBody {
	words?: unknown[];
	baseUrl?: string;
	apiKey?: string;
	model?: string;
}

function errorResult(code: DefinitionProviderErrorCode, message: string) {
	return { error: code, message };
}

export async function POST(event: RouteEvent) {
	const body = (await readJsonBody(event)) as ChineseWordsRequestBody;
	const words = extractWords(body);
	const baseUrl = String(body?.baseUrl ?? "").trim();
	const apiKey = String(body?.apiKey ?? "").trim();
	const model = String(body?.model ?? "").trim() || "gpt-4o-mini";
	if (words.length === 0) {
		throw new HTTPError({
			status: 400,
			statusText: "Bad Request",
			message: "words 不能为空",
		});
	}
	if (!baseUrl || !apiKey) {
		throw new HTTPError({
			status: 400,
			statusText: "no-config",
			message: "未配置 AI 服务地址或 Key（设置中填写）",
		});
	}

	try {
		return await getChineseWords({
			words,
			baseUrl,
			apiKey,
			model,
			storage: runtimeCache,
			logger: runtimeDiagnosticLogger,
			signal: event.request.signal,
		});
	} catch (error) {
		if (error instanceof DefinitionProviderError) {
			return errorResult(error.code, error.message);
		}
		runtimeDiagnosticLogger.write({
			event: "chinese-word-service-failed",
			level: "error",
			details: {
				model,
				wordCount: words.length,
				message: error instanceof Error ? error.message : String(error),
			},
		});
		return errorResult("network", "中文词服务发生未预期错误，请重试");
	}
}
