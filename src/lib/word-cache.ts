/**
 * 运行时缓存目录（服务端共享）。缓存与构建期 public 静态资源完全分离：
 * web 默认写入 <cwd>/.mds-data/word-cache，也可由 MDS_CACHE_DIR 覆盖；
 * client 必须由 Electron 主进程注入外置绝对路径。
 */
import { join, resolve } from "node:path";

export const VOICE = "en-US-AvaNeural";
export type RuntimeMode = "web" | "client";

export function resolveRuntimeMode(
	env: NodeJS.ProcessEnv = process.env,
): RuntimeMode {
	return env.MDS_RUNTIME_MODE === "client" ? "client" : "web";
}

export function resolveCacheDir(
	env: NodeJS.ProcessEnv = process.env,
	cwd = process.cwd(),
): string {
	const configured = env.MDS_CACHE_DIR?.trim();
	if (configured) return resolve(cwd, configured);
	if (resolveRuntimeMode(env) === "client") {
		throw new Error("client 模式必须由主进程设置 MDS_CACHE_DIR");
	}
	return join(cwd, ".mds-data", "word-cache");
}

export const runtimeMode = resolveRuntimeMode();
export const cacheDir = resolveCacheDir();
