/**
 * POST /api/definitions — 一次调用 AI 为全部单词生成英文释义，并写入运行时缓存
 * 请求：{ words: string[], baseUrl, apiKey, model }
 * 返回：{ definitions: { [word]: string } } 或 { error, message }
 * 错误码：no-config / http / network / timeout / invalid-response / empty
 *
 * 释义缓存：<runtime-cache>/definitions.json = { model, defs: { word: def } }
 * - 缓存不随音色走（释义与音色无关）；模型名变化时视为缓存失效
 * - 命中缓存的词不再调用 AI（增量缓存）
 */
import { HTTPError } from "h3";
import { readJsonBody, extractWords, type RouteEvent } from "~/lib/server-body";
import { runtimeCache } from "~/lib/cache-storage";

export interface DefinitionsResult {
	definitions: Record<string, string>;
	missing?: string[];
	cachedCount?: number;
	warning?: string;
}

type AiParseResult =
	| { defs: Record<string, string> }
	| { error: string; message: string };

/**
 * 安全取值：仅自有属性 + 非空字符串，避免 constructor/__proto__ 等词键命中原型属性
 */
function ownString(
	record: Record<string, unknown> | null | undefined,
	key: string,
): string | undefined {
	if (!record || typeof record !== "object") return undefined;
	if (!Object.hasOwn(record, key)) return undefined;
	const v = record[key];
	return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** 明显非英文（含 CJK 字符）的释义不入缓存 */
function isLikelyEnglish(text: string): boolean {
	return !/\p{Script=Han}/u.test(text);
}

function readDefsCache(model: string): Record<string, string> {
	try {
		const raw = runtimeCache.readDefinitions() as {
			model?: unknown;
			defs?: unknown;
		} | undefined;
		if (!raw) return {};
		// 模型变化视为缓存失效
		if (raw?.model !== model) return {};
		// schema 清洗：只保留自有属性 + 非空字符串值，不信任 JSON 结构
		const out: Record<string, string> = {};
		if (raw.defs && typeof raw.defs === "object") {
			for (const k of Object.keys(raw.defs)) {
				const d = ownString(raw.defs as Record<string, unknown>, k);
				if (d) out[k] = d;
			}
		}
		return out;
	} catch {
		return {};
	}
}

function writeDefsCache(model: string, defs: Record<string, string>): void {
	try {
		runtimeCache.writeDefinitions({ model, defs });
	} catch {
		// 写缓存失败不影响主流程
	}
}

/** 从说明文字、思考块或多个代码块中提取所有可解析 JSON，而不是贪婪截取首尾大括号。 */
function extractJsonCandidates(text: string): unknown[] {
	const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
	const fragments = [cleaned];
	for (const match of cleaned.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
		fragments.push(match[1].trim());
	}

	// 扫描顶层平衡 JSON 片段；可跳过前面的说明性 {example}，继续寻找最终答案。
	let start = -1;
	const stack: string[] = [];
	let inString = false;
	let escaped = false;
	for (let index = 0; index < cleaned.length; index++) {
		const char = cleaned[index];
		if (inString) {
			if (escaped) escaped = false;
			else if (char === "\\") escaped = true;
			else if (char === '"') inString = false;
			continue;
		}
		if (char === '"') {
			inString = true;
			continue;
		}
		if (char === "{" || char === "[") {
			if (stack.length === 0) start = index;
			stack.push(char);
			continue;
		}
		if (char !== "}" && char !== "]") continue;
		const opener = stack.at(-1);
		if (
			(opener === "{" && char !== "}") ||
			(opener === "[" && char !== "]")
		) {
			stack.length = 0;
			start = -1;
			continue;
		}
		stack.pop();
		if (stack.length === 0 && start >= 0) {
			fragments.push(cleaned.slice(start, index + 1));
			start = -1;
		}
	}

	const parsed: unknown[] = [];
	const seen = new Set<string>();
	for (const fragment of fragments) {
		if (!fragment || seen.has(fragment)) continue;
		seen.add(fragment);
		try {
			parsed.push(JSON.parse(fragment));
		} catch {
			// 单个候选失败不影响后续候选
		}
	}
	return parsed;
}

function contentCandidates(content: unknown): unknown[] {
	if (content == null) return [];
	if (typeof content === "string") return extractJsonCandidates(content);
	if (!Array.isArray(content)) return [content];

	const candidates: unknown[] = [content];
	const textParts: string[] = [];
	for (const part of content) {
		if (typeof part === "string") {
			textParts.push(part);
			continue;
		}
		if (!part || typeof part !== "object") continue;
		const holder = part as {
			text?: unknown;
			content?: unknown;
		};
		if (typeof holder.text === "string") textParts.push(holder.text);
		else if (
			holder.text &&
			typeof holder.text === "object" &&
			typeof (holder.text as { value?: unknown }).value === "string"
		) {
			textParts.push((holder.text as { value: string }).value);
		}
		if (typeof holder.content === "string") textParts.push(holder.content);
	}
	if (textParts.length > 0) {
		candidates.push(...extractJsonCandidates(textParts.join("\n")));
	}
	return candidates;
}

function definitionsFromCandidate(candidate: unknown): Record<string, string> {
	let items: unknown[] = [];
	if (Array.isArray(candidate)) {
		items = candidate;
	} else if (candidate && typeof candidate === "object") {
		const holder = candidate as {
			definitions?: unknown;
			word?: unknown;
			definition?: unknown;
		};
		if (Array.isArray(holder.definitions)) {
			items = holder.definitions;
		} else if (
			typeof holder.word === "string" &&
			typeof holder.definition === "string"
		) {
			items = [holder];
		} else {
			const map =
				holder.definitions && typeof holder.definitions === "object"
					? (holder.definitions as Record<string, unknown>)
					: (candidate as Record<string, unknown>);
			items = Object.entries(map).map(([word, definition]) => ({
				word,
				definition,
			}));
		}
	}

	const defs: Record<string, string> = Object.create(null) as Record<
		string,
		string
	>;
	for (const item of items) {
		const rawWord = (item as { word?: unknown })?.word;
		const rawDefinition = (item as { definition?: unknown })?.definition;
		if (typeof rawWord !== "string" || typeof rawDefinition !== "string") {
			continue;
		}
		const w = rawWord.trim();
		const d = rawDefinition.trim();
		if (w && d && isLikelyEnglish(d)) defs[w] = d;
	}
	return defs;
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

	let data: {
		choices?: {
			message?: {
				content?: unknown;
				tool_calls?: { function?: { arguments?: unknown } }[];
			};
			text?: unknown;
		}[];
		output_text?: unknown;
	};
	try {
		data = await res.json();
	} catch {
		return { error: "invalid-response", message: "AI 返回了无法解析的内容" };
	}
	const choice = data?.choices?.[0];
	const sources: unknown[] = [
		choice?.message?.content,
		choice?.text,
		data?.output_text,
		...(choice?.message?.tool_calls?.map(
			(call) => call.function?.arguments,
		) ?? []),
	].filter((value) => value != null);
	if (sources.length === 0) {
		return { error: "invalid-response", message: "AI 响应缺少内容" };
	}

	let sawJson = false;
	for (const source of sources) {
		for (const candidate of contentCandidates(source)) {
			sawJson = true;
			const defs = definitionsFromCandidate(candidate);
			if (Object.keys(defs).length > 0) return { defs };
		}
	}
	if (!sawJson) {
		return { error: "invalid-response", message: "AI 未返回 JSON 格式的释义" };
	}
	return { error: "empty", message: "AI 未返回任何有效释义，请重试" };
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
		const d = ownString(cached, w);
		if (d) {
			definitions[w] = d;
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
		for (const w of p.words) {
			const d = ownString(p.cached, w);
			if (d) all[w] = d;
		}
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
			// 组合客户端请求 signal：用户中止时立即取消远端调用（不继续耗额度）
			signal: AbortSignal.any([
				event.request.signal,
				AbortSignal.timeout(60_000),
			]),
		});

	let res: Response;
	try {
		res = await callAi(extendedBody);
		if (
			(res.status === 400 || res.status === 422) &&
			!event.request.signal.aborted
		) {
			// 中止后不得发起第二次请求
			res = await callAi(baseBody);
		}
	} catch (err) {
		// 客户端中止优先判断（不算服务错误）
		if (event.request.signal.aborted) {
			return { error: "aborted", message: "已中止" };
		}
		const aborted = err instanceof DOMException && err.name === "TimeoutError";
		return {
			error: aborted ? "timeout" : "network",
			message: aborted
				? "AI 请求超时（60 秒），请重试"
				: "无法连接 AI 服务，请检查网络与地址",
		};
	}

	const fresh = await parseAiResponse(res);
	if ("error" in fresh) {
		// AI 输出格式和内容具有不确定性：无 JSON 或无有效英文释义时，保留已有缓存并继续准备。
		// 关键是绝不把这次失败写成负缓存，下一次准备仍会请求全部缺失项。
		if (fresh.error === "invalid-response" || fresh.error === "empty") {
			const definitions: Record<string, string> = {};
			for (const word of p.words) {
				const definition = ownString(p.cached, word);
				if (definition) definitions[word] = definition;
			}
			return {
				definitions,
				missing: p.words.filter((word) => !ownString(definitions, word)),
				cachedCount: p.cachedCount,
				warning: fresh.message,
			} satisfies DefinitionsResult;
		}
		return fresh;
	}

	// 3) 只缓存“请求词集合中、键精确匹配、值为非空英文字符串”的条目（不信任 AI 乱编的键）
	const validFresh: Record<string, string> = {};
	for (const w of p.toFetch) {
		const d = ownString(fresh.defs, w);
		if (d) validFresh[w] = d;
	}
	const merged: Record<string, string> = { ...p.cached, ...validFresh };
	// 用户中止后不再写缓存（后台结果不污染当前准备状态）
	if (event.request.signal.aborted) {
		return { error: "aborted", message: "已中止" };
	}
	writeDefsCache(p.model, merged);
	const finalDefs: Record<string, string> = {};
	for (const w of p.words) {
		const d = ownString(merged, w);
		if (d) finalDefs[w] = d;
	}
	const missing = p.words.filter((w) => !ownString(finalDefs, w));
	const result: DefinitionsResult = {
		definitions: finalDefs,
		cachedCount: p.cachedCount,
	};
	if (missing.length > 0) result.missing = missing;
	return result;
}
