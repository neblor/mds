/**
 * POST /api/answer-grade — 答案 AI 批改：参数校验与 HTTP 适配；业务位于 answer-grade-service。
 * 请求：{ kind: "chinese" | "definition", items: [{word, expected, answer}], baseUrl, apiKey, model }
 * 返回：{ grades: [{word, correct, note?}], missing?, warning? }
 */
import { HTTPError } from "h3";
import {
	DefinitionProviderError,
	type DefinitionProviderErrorCode,
	type GradeKind,
} from "~/lib/definition-provider";
import { gradeAnswers } from "~/lib/answer-grade-service";
import { runtimeDiagnosticLogger } from "~/lib/runtime-logger";
import { readJsonBody, type RouteEvent } from "~/lib/server-body";

interface AnswerGradeRequestBody {
	kind?: unknown;
	items?: unknown[];
	baseUrl?: string;
	apiKey?: string;
	model?: string;
}

function errorResult(code: DefinitionProviderErrorCode, message: string) {
	return { error: code, message };
}

const GRADE_KINDS: GradeKind[] = ["chinese", "definition", "sentence"];

function extractKind(raw: unknown): GradeKind {
	const kind = String(raw ?? "").trim() as GradeKind;
	if (!GRADE_KINDS.includes(kind)) {
		throw new HTTPError({
			status: 400,
			statusText: "Bad Request",
			message: 'kind 必须是 "chinese"、"definition" 或 "sentence"',
		});
	}
	return kind;
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
	const body = (await readJsonBody(event)) as AnswerGradeRequestBody;
	const kind = extractKind(body?.kind);
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
		return await gradeAnswers({
			kind,
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
			event: "answer-grade-service-failed",
			level: "error",
			details: {
				kind,
				model,
				itemCount: items.length,
				message: error instanceof Error ? error.message : String(error),
			},
		});
		return errorResult("network", "AI 批改服务发生未预期错误，请重试");
	}
}
