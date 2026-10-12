/**
 * 服务端路由工具
 * SolidStart 2 的路由事件是 rou3 风格：event.request (Web Request)、event.params，
 * 不是 h3 的 event.req 结构，因此不能直接用 h3 的 readBody/getRouterParam。
 */
import { HTTPError } from "h3";
import { isAudioCacheName, runtimeCache } from "./cache-storage";

/** rou3 风格路由事件的最小结构 */
export interface RouteEvent {
	request: Request;
	params: Record<string, string>;
}

export async function readJsonBody(event: RouteEvent): Promise<unknown> {
	try {
		const text = await event.request.text();
		return text ? JSON.parse(text) : {};
	} catch {
		return {};
	}
}

/** 读路由参数（/api/xxx/:id 这种路径参数），不是查询参数 */
export function getParam(event: RouteEvent, name: string): string {
	return String(event.params?.[name] ?? "");
}

/**
 * 读查询参数（?bankId=xxx&target=20）。
 * 与 getParam 分开命名：本项目路由都是「单文件 + 查询参数」风格（见 audio.ts），
 * 把两者混用会静默拿到空字符串，最终变成“词库不存在”这种很难查的 404。
 */
export function getQuery(event: RouteEvent, name: string): string {
	try {
		return new URL(event.request.url).searchParams.get(name) ?? "";
	} catch {
		return "";
	}
}

/** 从请求体提取去重后的单词列表（服务端通用） */
export function extractWords(raw: unknown): string[] {
	const holder = raw as { words?: unknown[] } | null;
	const list = Array.isArray(holder?.words) ? holder.words : [];
	const words: string[] = [];
	for (const w of list) {
		if (typeof w !== "string") continue; // 只收字符串元素，拒绝数字/布尔/null 等垃圾输入
		const s = w.trim();
		if (s && !words.includes(s)) words.push(s);
	}
	return words;
}

/**
 * 校验缓存文件名并返回音频响应（带 Content-Length + Accept-Ranges，
 * Chrome 媒体栈对无 Content-Length 的 chunked 响应会拒播）。
 * 文件名由 tts-filename 生成：小写字母/数字/下划线/连字符 + .mp3。
 */
export function serveCacheFile(fileName: string): Response {
	if (!isAudioCacheName(fileName)) {
		throw new HTTPError({
			status: 400,
			statusText: "Bad Request",
			message: "非法文件名",
		});
	}
	const data = runtimeCache.readAudio(fileName);
	if (!data) {
		throw new HTTPError({
			status: 404,
			statusText: "Not Found",
			message: "音频不存在",
		});
	}
	// SAFETY: readFileSync 返回 Buffer (Uint8Array<ArrayBufferLike>)，与 DOM BodyInit 里的
	// Uint8Array<ArrayBuffer> 在 TS 泛型上不兼容，但运行时是合法的 Response body。
	return new Response(data as unknown as BodyInit, {
		headers: {
			"content-type": "audio/mpeg",
			"content-length": String(data.byteLength),
			"accept-ranges": "bytes",
			"cache-control": "public, max-age=86400",
		},
	});
}
