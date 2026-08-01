/**
 * 服务端路由工具
 * SolidStart 2 的路由事件是 rou3 风格：event.request (Web Request)、event.params，
 * 不是 h3 的 event.req 结构，因此不能直接用 h3 的 readBody/getRouterParam。
 */
import { HTTPError } from "h3";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cacheDir } from "./word-cache";

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

export function getParam(event: RouteEvent, name: string): string {
	return String(event.params?.[name] ?? "");
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
	if (!/^[a-z0-9_-]{1,80}\.mp3$/.test(fileName)) {
		throw new HTTPError({
			status: 400,
			statusText: "Bad Request",
			message: "非法文件名",
		});
	}
	const file = join(cacheDir, fileName);
	if (!existsSync(file)) {
		throw new HTTPError({
			status: 404,
			statusText: "Not Found",
			message: "音频不存在",
		});
	}
	const data = readFileSync(file);
	return new Response(data, {
		headers: {
			"content-type": "audio/mpeg",
			"content-length": String(data.byteLength),
			"accept-ranges": "bytes",
			"cache-control": "public, max-age=86400",
		},
	});
}
