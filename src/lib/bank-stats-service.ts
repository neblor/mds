/**
 * 学习档案编排：读词库 + SQL 查询行 → 纯计算视图
 *
 * 兼容模式（reviewStore.stats === null）由路由返回 503，不进入这里。
 */
import type { BankStore } from "./bank-store";
import { bankSummary } from "./bank-store";
import { computeBankStats, RECENT_SESSIONS, type BankStatsView } from "./bank-stats";
import { localDateKey } from "./daily-queue";
import type { ReviewStore } from "./review-types";

function shiftDay(now: Date, offset: number): string {
	return localDateKey(
		new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset),
	);
}

export function buildBankStats(options: {
	bankStore: BankStore;
	reviewStore: ReviewStore;
	bankId: string;
	now: Date;
	days?: number;
}): BankStatsView | null {
	const { bankStore, reviewStore, bankId, now } = options;
	const bank = bankStore.read(bankId);
	if (!bank) return null;
	const stats = reviewStore.stats;
	if (!stats) throw new Error("统计不可用：兼容模式");
	const since7 = shiftDay(now, -6);
	const since30 = shiftDay(now, -29);
	const activity = stats.activity(bankId);
	return computeBankStats({
		bank: bankSummary(bank),
		entries: bank.entries,
		cards: stats.cardRows(bankId),
		logDays: activity.logDays,
		sessionDays: activity.sessionDays,
		accuracy: stats.accuracy(bankId, since7, since30),
		modes: stats.modes(bankId, since30),
		words: stats.words(bankId, since30),
		writingWords: stats.writingWords(bankId),
		sessionTotals: stats.sessionTotals(bankId),
		recentSessions: stats.recentSessions(bankId, RECENT_SESSIONS),
		now,
		heatmapDays: options.days,
	});
}
