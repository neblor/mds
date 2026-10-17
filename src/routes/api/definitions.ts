/** POST /api/definitions — 参数校验与 HTTP 适配；业务位于 definition-service。 */
import { HTTPError } from "h3";
import { runtimeCache } from "~/lib/cache-storage";
import {
	DefinitionProviderError,
	type DefinitionProviderErrorCode,
} from "~/lib/definition-provider";
import { getEnglishDefinitions } from "~/lib/definition-service";
import { parseContentLevel } from "~/lib/content-level";
import { runtimeDiagnosticLogger } from "~/lib/runtime-logger";
import { extractWords, readJsonBody, type RouteEvent } from "~/lib/server-body";

interface DefinitionsRequestBody {
	words?: unknown[];
	baseUrl?: string;
	apiKey?: string;
	model?: string;
	contentLevel?: unknown;
}

function errorResult(code: DefinitionProviderErrorCode, message: string) {
	return { error: code, message };
}

export async function POST(event: RouteEvent) {
	const body = (await readJsonBody(event)) as DefinitionsRequestBody;
	const words = extractWords(body);
	const baseUrl = String(body?.baseUrl ?? "").trim();
	const apiKey = String(body?.apiKey ?? "").trim();
	const model = String(body?.model ?? "").trim() || "gpt-4o-mini";
	const contentLevel = parseContentLevel(body?.contentLevel);
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
		return await getEnglishDefinitions({
			words,
			baseUrl,
			apiKey,
			model,
			contentLevel,
			storage: runtimeCache,
			logger: runtimeDiagnosticLogger,
			signal: event.request.signal,
		});
	} catch (error) {
		if (error instanceof DefinitionProviderError) {
			return errorResult(error.code, error.message);
		}
		runtimeDiagnosticLogger.write({
			event: "definition-service-failed",
			level: "error",
			details: {
				model,
				wordCount: words.length,
				message: error instanceof Error ? error.message : String(error),
			},
		});
		return errorResult("network", "释义服务发生未预期错误，请重试");
	}
}
