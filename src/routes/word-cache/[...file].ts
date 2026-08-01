/**
 * GET /word-cache/[...file] — 服务缓存音频（与 public/word-cache 静态目录同名路径）
 * dev 模式：vite 直接服务 public/ 下的真实文件（media 请求在 dev 只认 public 静态）
 * prod/client 模式：此 catch-all 路由从缓存目录读取运行时生成的文件
 */
import { getParam, serveCacheFile, type RouteEvent } from "~/lib/server-body";

export function GET(event: RouteEvent) {
	const name = getParam(event, "file");
	return serveCacheFile(name);
}
