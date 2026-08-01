/**
 * POST /api/definitions — 一次调用 AI 为全部单词生成英文释义，并写入 public/word-cache 缓存
 * 请求：{ words: string[], baseUrl, apiKey, model }
 * 返回：{ definitions: { [word]: string } } 或 { error, message }
 * 错误码：no-config / http / network / timeout / invalid-response / empty
 *
 * 释义缓存：<cwd>/public/word-cache/definitions.json = { model, defs: { word: def } }
 * - 缓存不随音色走（释义与音色无关）；模型名变化时视为缓存失效
 * - 命中缓存的词不再调用 AI（增量缓存）
 */
import { HTTPError } from "h3";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { readJsonBody, extractWords, type RouteEvent } from "~/lib/server-body";
import { definitionsFile } from "~/lib/word-cache";

export interface DefinitionsResult {
	definitions: Record<string, string>;
	missing?: string[];
	cachedCount?: number;
}

interface DefsCache {
	model: string;
	defs: Record<string, string>;
}

type AiParseResult =
	| { defs: Record<string, string> }
	| { error: string; message: string };

function readDefsCache(model: string): Record<string, string> {
	try {
		if (!existsSync(definitionsFile)) return {};
		const raw = JSON.parse(readFileSync(definitionsFile, "utf-8")) as DefsCache;
		// 模型变化视为缓存失效
		if (raw.model !== model) return {};
		return raw.defs ?? {};
	} catch {
		return {};
	}
}

function writeDefsCache(model: string, defs: Record<string, string>): void {
	try {
		writeFileSync(definitionsFile, JSON.stringify({ model, defs }, null, 2));
	} catch {
		// 写缓存失败不影响主流程
	}
}

function extractJson(text: string): unknown {
	const cleaned = text
		.trim()
		.replace(/^```(?:json)?\s*/i, "")
		.replace(/\s*```$/, "");
	try {
		return JSON.parse(cleaned);
	} catch {
		// 尝试截取第一个 { ... } 块
		const start = cleaned.indexOf("{");
		const end = cleaned.lastIndexOf("}");
		if (start >= 0 && end > start) {
			return JSON.parse(cleaned.slice(start, end + 1));
		}
		throw new Error("invalid-json");
	}
}

/** 解析 AI 响应 → { defs } 或 { error, message } */
async function parseAiResponse(res: Response): Promise<AiParseResult> {
	if (!res.ok) {
		const detail = await res.text().catch(() => "");
		return {
			error: "http",
			message: `AI 服务返回 ${res.status}${detail ? `：${detail.slice(0, 120)}` : ""}`,
		};
	}

	let data: { choices?: { message?: { content?: string } }[] };
	try {
		data = await res.json();
	} catch {
		return { error: "invalid-response", message: "AI 返回了无法解析的内容" };
	}
	const content = data?.choices?.[0]?.message?.content;
	if (!content) {
		return { error: "invalid-response", message: "AI 响应缺少内容" };
	}

	let parsed: unknown;
	try {
		parsed = extractJson(content);
	} catch {
		return { error: "invalid-response", message: "AI 未返回 JSON 格式的释义" };
	}

	let items: unknown[];
	if (Array.isArray(parsed)) {
		items = parsed;
	} else if (
		Array.isArray((parsed as { definitions?: unknown[] })?.definitions)
	) {
		items = (parsed as { definitions: unknown[] }).definitions;
	} else {
		items = [];
	}

	const defs: Record<string, string> = {};
	for (const item of items) {
		const w = String((item as { word?: unknown })?.word ?? "").trim();
		const d = String(
			(item as { definition?: unknown })?.definition ?? "",
		).trim();
		if (w && d) defs[w] = d;
	}
	if (Object.keys(defs).length === 0) {
		return { error: "empty", message: "AI 未返回任何有效释义，请重试" };
	}
	return { defs };
}

interface Prepared {
	words: string[];
	baseUrl: string;
	apiKey: string;
	model: string;
	cached: Record<string, string>;
	cachedCount: number;
	toFetch: string[];
}

/** 校验 + 释义缓存命中拆分 */
async function prepare(event: RouteEvent): Promise<Prepared> {
	const body = await readJsonBody(event);
	const raw = body as {
		words?: unknown[];
		baseUrl?: string;
		apiKey?: string;
		model?: string;
	};
	const words = extractWords(raw);
	const baseUrl = String(raw?.baseUrl ?? "").trim();
	const apiKey = String(raw?.apiKey ?? "").trim();
	const model = String(raw?.model ?? "").trim() || "gpt-4o-mini";

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

	const cached = readDefsCache(model);
	const definitions: Record<string, string> = {};
	let cachedCount = 0;
	const toFetch: string[] = [];
	for (const w of words) {
		if (cached[w]) {
			definitions[w] = cached[w];
			cachedCount++;
		} else {
			toFetch.push(w);
		}
	}
	return { words, baseUrl, apiKey, model, cached, cachedCount, toFetch };
}

export async function POST(event: RouteEvent) {
	const p = await prepare(event);
	if (p.toFetch.length === 0) {
		const all: Record<string, string> = {};
		for (const w of p.words) all[w] = p.cached[w];
		const result: DefinitionsResult = {
			definitions: all,
			cachedCount: p.cachedCount,
		};
		return result;
	}

	// 2) 只请求未命中的词
	const endpoint = `${p.baseUrl.replace(/\/+$/, "")}/chat/completions`;
	const systemPrompt =
		"You are an English dictionary for kids. Reply with STRICT JSON only (no markdown fences, no extra text): " +
		'{"definitions":[{"word":"<exact original word>","definition":"<one clear English sentence>"}]}. ' +
		"Definitions must be written in English only, simple and kid-friendly. Include every requested word exactly once.";
	const userContent = JSON.stringify(p.toFetch);
	const baseBody = {
		model: p.model,
		temperature: 0,
		messages: [
			{ role: "system", content: systemPrompt },
			{ role: "user", content: userContent },
		],
	};
	// senseNova 等推理模型默认开启思考会拖慢响应，显式关闭；json_object 保证输出可解析。
	// 部分严格兼容 OpenAI 的服务商不接受这些扩展参数，400/422 时降级为最小请求体重试。
	const extendedBody = {
		...baseBody,
		reasoning_effort: "none",
		response_format: { type: "json_object" },
	};

	const callAi = (body: unknown) =>
		fetch(endpoint, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${p.apiKey}`,
			},
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(60_000),
		});

	let res: Response;
	try {
		res = await callAi(extendedBody);
		if (res.status === 400 || res.status === 422) {
			res = await callAi(baseBody);
		}
	} catch (err) {
		const aborted = err instanceof DOMException && err.name === "TimeoutError";
		return {
			error: aborted ? "timeout" : "network",
			message: aborted
				? "AI 请求超时（60 秒），请重试"
				: "无法连接 AI 服务，请检查网络与地址",
		};
	}

	const fresh = await parseAiResponse(res);
	if ("error" in fresh) return fresh;

	// 3) 合并并写缓存
	const merged: Record<string, string> = { ...p.cached, ...fresh.defs };
	writeDefsCache(p.model, merged);
	const finalDefs: Record<string, string> = {};
	for (const w of p.words) {
		if (merged[w]) finalDefs[w] = merged[w];
	}
	const missing = p.words.filter((w) => !finalDefs[w]);
	const result: DefinitionsResult = {
		definitions: finalDefs,
		cachedCount: p.cachedCount,
	};
	if (missing.length > 0) result.missing = missing;
	return result;
}
