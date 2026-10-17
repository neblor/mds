/**
 * POST /api/cloze — 组句出题：参数校验与 HTTP 适配；业务位于 cloze-provider。
 * 请求：{ candidates?: [{word, definition?}], words?: string[], baseUrl, apiKey, model }
 * 返回：{ items: [{id, sentences, blanks, usedWords}] } 或 { error, message }
 *
 * 失败语义（与释义/批改不同）：任何失败都不降级，客户端按「AI 当前不可用」结束本场。
 */
import { HTTPError } from "h3";
import {
	DefinitionProviderError,
	type DefinitionProviderErrorCode,
} from "~/lib/definition-provider";
import { fetchClozeItems, type ClozeCandidate } from "~/lib/cloze-provider";
import { parseContentLevel } from "~/lib/content-level";
import { CLOZE_MAX_CANDIDATES } from "~/lib/cloze-parse";
import { runtimeDiagnosticLogger } from "~/lib/runtime-logger";
import { extractWords, readJsonBody, type RouteEvent } from "~/lib/server-body";

/** 候选池上限（R6：一屏最多 24 个候选词）；超出只取前 N 个 */
export { CLOZE_MAX_CANDIDATES as MAX_CLOZE_CANDIDATES };

interface ClozeRequestBody {
	words?: unknown[];
	candidates?: unknown[];
	baseUrl?: string;
	apiKey?: string;
	model?: string;
	contentLevel?: unknown;
}

function errorResult(code: DefinitionProviderErrorCode, message: string) {
	return { error: code, message };
}

/**
 * 提取候选词：优先 `candidates`（可带英文释义），否则退化为 `words`。
 * 去重按小写折叠（大小写不同的同一个词只留第一次出现的写法）。
 */
export function extractCandidates(raw: ClozeRequestBody): ClozeCandidate[] {
	const candidates: ClozeCandidate[] = [];
	const seen = new Set<string>();
	for (const item of Array.isArray(raw?.candidates) ? raw.candidates : []) {
		if (!item || typeof item !== "object") continue;
		const holder = item as { word?: unknown; definition?: unknown };
		const word = typeof holder.word === "string" ? holder.word.trim() : "";
		if (!word) continue;
		const key = word.toLocaleLowerCase("en-US");
		if (seen.has(key)) continue;
		seen.add(key);
		const definition =
			typeof holder.definition === "string" ? holder.definition.trim() : "";
		candidates.push(definition ? { word, definition } : { word });
	}
	if (candidates.length > 0) return candidates;
	const words: ClozeCandidate[] = [];
	for (const word of extractWords(raw)) {
		const key = word.toLocaleLowerCase("en-US");
		if (seen.has(key)) continue;
		seen.add(key);
		words.push({ word });
	}
	return words;
}

export async function POST(event: RouteEvent) {
	const body = (await readJsonBody(event)) as ClozeRequestBody;
	const candidates = extractCandidates(body);
	const baseUrl = String(body?.baseUrl ?? "").trim();
	const apiKey = String(body?.apiKey ?? "").trim();
	const model = String(body?.model ?? "").trim() || "gpt-4o-mini";
	if (candidates.length === 0) {
		throw new HTTPError({
			status: 400,
			statusText: "Bad Request",
			message: "candidates 不能为空",
		});
	}
	if (!baseUrl || !apiKey) {
		throw new HTTPError({
			status: 400,
			statusText: "no-config",
			message: "未配置 AI 服务地址或 Key（设置中填写）",
		});
	}

	const bounded = candidates.slice(0, CLOZE_MAX_CANDIDATES);
	try {
		const result = await fetchClozeItems({
			candidates: bounded,
			baseUrl,
			apiKey,
			model,
			contentLevel: parseContentLevel(body?.contentLevel),
			signal: event.request.signal,
			onDiagnostic: (entry) => runtimeDiagnosticLogger.write(entry),
		});
		return { items: result.items };
	} catch (error) {
		if (error instanceof DefinitionProviderError) {
			return errorResult(error.code, error.message);
		}
		runtimeDiagnosticLogger.write({
			event: "cloze-service-failed",
			level: "error",
			details: {
				model,
				candidateCount: bounded.length,
				message: error instanceof Error ? error.message : String(error),
			},
		});
		return errorResult("network", "组句服务发生未预期错误，请重试");
	}
}
