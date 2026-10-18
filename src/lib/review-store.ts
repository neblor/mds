/**
 * 复习状态存储工厂（正常路径 SQLite；迁移失败/模块缺失时兼容模式）
 *
 * 业务代码只 import createReviewStore；不判断运行环境、不碰文件路径。
 * 类型与校验集中在 review-types.ts，兼容旧 import 的 re-export 保留在文件末尾。
 */
import { prepareReviewDatabase } from "./review-migrate";
import { createLegacyReviewStore } from "./review-store-legacy";
import { createSqliteReviewStore } from "./review-store-sqlite";
import type { ReviewStore } from "./review-types";

/** 运行时取内置模块：拿不到时不让整个服务 import 崩掉（Node 24 / Electron 43 已实测） */
export function loadSqliteModule(): typeof import("node:sqlite") | null {
	try {
		return process.getBuiltinModule("node:sqlite") ?? null;
	} catch {
		return null;
	}
}

export function createReviewStore(
	rootDir: string,
	options: { forceLegacy?: boolean } = {},
): ReviewStore {
	if (options.forceLegacy) return createLegacyReviewStore(rootDir);
	const sqlite = loadSqliteModule();
	if (!sqlite) {
		// 运行时不带 node:sqlite：兼容模式，保证默写不中断
		console.warn("[review-store] node:sqlite 不可用，使用兼容模式");
		return createLegacyReviewStore(rootDir);
	}
	const prepared = prepareReviewDatabase({ reviewDir: rootDir, sqlite });
	if (prepared.status === "failed") {
		console.warn(
			`[review-store] 迁移失败，使用兼容模式：${prepared.reason ?? "unknown"}`,
		);
		return createLegacyReviewStore(rootDir);
	}
	return createSqliteReviewStore(prepared.dbPath, sqlite);
}

export {
	logToJson,
	parseCards,
	parseLogRecord,
	parseSessionRecord,
	sessionToJson,
} from "./review-types";
export type {
	BankStatsQuery,
	CommitPayload,
	DayStats,
	GenMode,
	QueueKind,
	ReviewLogRecord,
	ReviewMode,
	ReviewStore,
	SessionLogRecord,
	StoredCard,
	StoredCards,
} from "./review-types";
