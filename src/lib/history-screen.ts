/**
 * 全屏历史界面的纯逻辑：历史词汇提取/截断 + 再次默写的暂存编排
 *
 * - 历史条目理论上必带 rows（word 必填），但按防御式兼容处理：
 *   提取不出非空词汇的条目不渲染词汇区、也不提供「再次默写」
 * - 暂存仅存内存（刷新即失效，不做持久化），恢复是一次性的
 */
import type { HistoryEntry } from "./history-storage";

/** 列表条目里词汇胶囊的显示上限（超出部分不渲染，配渐变淡出示意） */
export const HISTORY_PREVIEW_MAX = 18;

/** 规整再次默写/暂存恢复用的词列表：trim、丢空、去重（保留顺序） */
export function normalizeRetryWords(words: string[]): string[] {
	const seen = new Set<string>();
	const next: string[] = [];
	for (const word of words) {
		const normalized = word.trim();
		if (normalized && !seen.has(normalized)) {
			seen.add(normalized);
			next.push(normalized);
		}
	}
	return next;
}

/** 由历史条目提取词汇列表；提取不出有效词时返回空数组（老数据兼容） */
export function extractHistoryWords(entry: Pick<HistoryEntry, "rows">): string[] {
	return normalizeRetryWords(entry.rows.map((r) => r.word));
}

/** 历史条目是否可「再次默写」（至少一个有效词） */
export function canRetryHistory(entry: Pick<HistoryEntry, "rows">): boolean {
	return extractHistoryWords(entry).length > 0;
}

/** 「暂存当前词表并用历史词覆盖」的编排；返回恢复动作所需信息 */
export function planRetry(args: {
	currentWords: string[];
	historyWords: string[];
}): { nextWords: string[]; stashed: string[] | null } {
	const stashable = normalizeRetryWords(args.currentWords);
	const nextWords = normalizeRetryWords(args.historyWords);
	return {
		nextWords,
		stashed: stashable.length > 0 ? stashable : null,
	};
}
