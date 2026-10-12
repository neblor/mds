/**
 * 运行时数据目录（服务端共享）
 *
 * 布局（与音频/释义缓存同级，但**不是缓存**——用户自建词表与复习进度属于用户数据）：
 *   <dataDir>/banks/<bankId>.json        词库
 *   <dataDir>/banks/index.json           词库索引（可由磁盘重建）
 *   <dataDir>/review/<bankId>.cards.json 卡片状态
 *   <dataDir>/review/<bankId>.log.jsonl  复习日志（append-only）
 *   <dataDir>/review/daily.json          每日汇总
 *   <dataDir>/word-cache/…               音频与释义缓存（现有）
 *
 * 目录优先级：MDS_DATA_DIR > dirname(MDS_CACHE_DIR) > <cwd>/.mds-data
 * （Electron 主进程注入 MDS_CACHE_DIR=userData/mds-data/word-cache，
 *   于是 dataDir 自然是 userData/mds-data，卸载保留）
 */
import { dirname, join, resolve } from "node:path";

export function resolveDataDir(
	env: NodeJS.ProcessEnv = process.env,
	cwd = process.cwd(),
): string {
	const configured = env.MDS_DATA_DIR?.trim();
	if (configured) return resolve(cwd, configured);
	const cache = env.MDS_CACHE_DIR?.trim();
	if (cache) return dirname(resolve(cwd, cache));
	return join(cwd, ".mds-data");
}

export function resolveBankDir(dataDir: string): string {
	return join(dataDir, "banks");
}

export function resolveReviewDir(dataDir: string): string {
	return join(dataDir, "review");
}

export const dataDir = resolveDataDir();
export const bankDir = resolveBankDir(dataDir);
export const reviewDir = resolveReviewDir(dataDir);
