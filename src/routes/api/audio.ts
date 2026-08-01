/**
 * GET /api/audio?name=xxx — 返回缓存的 mp3
 * 查询参数形式（dev 模式下 [name] 动态路由注册有兼容问题）
 * 文件名仅允许 [a-z0-9_-].mp3（由 tts-filename 生成，天然安全）
 */
import { HTTPError } from "h3";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cacheDir } from "~/lib/word-cache";
import type { RouteEvent } from "~/lib/server-body";

export function GET(event: RouteEvent) {
	let name = "";
	try {
		name = new URL(event.request.url).searchParams.get("name") ?? "";
	} catch {
		name = "";
	}
	// 文件名由 tts-filename 生成：小写字母/数字/下划线/连字符 + .mp3（连字符来自音色 slug）
	if (!/^[a-z0-9_-]{1,80}\.mp3$/.test(name)) {
		throw new HTTPError({
			status: 400,
			statusText: "Bad Request",
			message: "非法文件名",
		});
	}
	const file = join(cacheDir, name);
	if (!existsSync(file)) {
		throw new HTTPError({
			status: 404,
			statusText: "Not Found",
			message: "音频不存在",
		});
	}
	// 显式 Content-Length + Accept-Ranges：Chrome 媒体栈对无 Content-Length 的 chunked 响应会拒播
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
