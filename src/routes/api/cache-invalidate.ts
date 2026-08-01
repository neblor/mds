/**
 * POST /api/cache-invalidate — 失效单个缓存音频（文件名受白名单保护）
 * 用途：播放时发现缓存文件损坏（media-error/play-rejected），删除该文件，
 * 下次准备自动重新生成；防止错误文件被持续命中。
 */
import { HTTPError } from "h3";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { cacheDir } from "~/lib/word-cache";
import { readJsonBody, type RouteEvent } from "~/lib/server-body";

export async function POST(event: RouteEvent) {
	const body = await readJsonBody(event);
	const name = String((body as { name?: unknown })?.name ?? "").trim();
	// 与音频路由同源白名单，杜绝路径穿越
	if (!/^[a-z0-9_-]{1,80}\.mp3$/.test(name)) {
		throw new HTTPError({
			status: 400,
			statusText: "Bad Request",
			message: "非法文件名",
		});
	}
	const file = join(cacheDir, name);
	if (existsSync(file)) {
		try {
			rmSync(file);
		} catch {
			// 删除失败忽略（下次准备仍会尝试重新生成）
		}
	}
	return { ok: true };
}
