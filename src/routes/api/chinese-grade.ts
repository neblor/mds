/**
 * POST /api/chinese-grade — 中文词 AI 批改：参数校验与 HTTP 适配；业务位于 chinese-grade-service。
 * 请求：{ items: [{word, expected, answer}], baseUrl, apiKey, model }
 * 返回：{ grades: [{word, correct, note?}], missing?, warning? }
 */
import { HTTPError } from "h3";
import {
	DefinitionProviderError,
	type DefinitionProviderErrorCode,
} from "~/lib/definition-provider";
import { gradeChineseAnswers } from "~/lib/chinese-grade-service";
import { runtimeDiagnosticLogger } from "~/lib/runtime-logger";
import { readJsonBody, type RouteEvent } from "~/lib/server-body";

interface ChineseGradeRequestBody {
	items?: unknown[];
	baseUrl?: string;
	apiKey?: string;
	model?: string;
}

function errorResult(code: DefinitionProviderErrorCode, message: string) {
	return { error: code, message };
}

/** 提取并校验批改条目：word/answer 必填字符串，expected 可选 */
function extractGradeItems(raw: unknown[] | undefined) {
	const items: { word: string; expected: string; answer: string }[] = [];
	for (const item of Array.isArray(raw) ? raw : []) {
		if (!item || typeof item !== "object") continue;
		const holder = item as Record<string, unknown>;
		const word = typeof holder.word === "string" ? holder.word.trim() : "";
		const answer = typeof holder.answer === "string" ? holder.answer.trim() : "";
		if (!word || !answer) continue;
		const expected =
			typeof holder.expected === "string" ? holder.expected.trim() : "";
		items.push({ word, expected, answer });
	}
	return items;
}

export async function POST(event: RouteEvent) {
	const body = (await readJsonBody(event)) as ChineseGradeRequestBody;
	const items = extractGradeItems(body?.items);
	const baseUrl = String(body?.baseUrl ?? "").trim();
	const apiKey = String(body?.apiKey ?? "").trim();
	const model = String(body?.model ?? "").trim() || "gpt-4o-mini";
	if (items.length === 0) {
		throw new HTTPError({
			status: 400,
			statusText: "Bad Request",
			message: "items 不能为空",
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
		return await gradeChineseAnswers({
			items,
			baseUrl,
			apiKey,
			model,
			logger: runtimeDiagnosticLogger,
			signal: event.request.signal,
		});
	} catch (error) {
		if (error instanceof DefinitionProviderError) {
			return errorResult(error.code, error.message);
		}
		runtimeDiagnosticLogger.write({
			event: "chinese-grade-service-failed",
			level: "error",
			details: {
				model,
				itemCount: items.length,
				message: error instanceof Error ? error.message : String(error),
			},
		});
		return errorResult("network", "AI 批改服务发生未预期错误，请重试");
	}
}
