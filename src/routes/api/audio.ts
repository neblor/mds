/**
 * GET /api/audio?name=xxx — 返回缓存的 mp3
 * 查询参数形式（dev 模式下 [name] 动态路由注册有兼容问题）
 * 文件名仅允许 [a-z0-9_-].mp3（由 tts-filename 生成，天然安全）
 */
import { serveCacheFile, type RouteEvent } from "~/lib/server-body";

export function GET(event: RouteEvent) {
	let name = "";
	try {
		name = new URL(event.request.url).searchParams.get("name") ?? "";
	} catch {
		name = "";
	}
	return serveCacheFile(name);
}
