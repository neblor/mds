/**
 * 取词队列（纯逻辑，可单测）
 *
 * 口径（崔总 2026-10-24 更正，**取代**「今日目标」的理解）：
 * 界面上只有一个数字，它的意思是**本次取几个词**，不是「今天一共默几个」。
 * 队列只跟 SRS 状态有关，**不引入任何「每日」概念**：
 *   - 到期复习：`due <= now`（不按「今天结束」提前取）
 *   - 新词：还没有卡片的词（学过一次就不再算新词）
 *   - 数量：到 `size` 为止
 *
 * 因此每次「重新取词」都是**重新取一批**；已默过的词不会作为新词重复出现，
 * 只有学习/重学步真正到点时才作为复习词回来。
 */
import type { Card } from "ts-fsrs";
import type { BankEntry } from "./bank-types";
import { wordKey } from "./bank-parse";
import { localDateKey } from "./day";
import { parseCard } from "./srs";
import type { StoredCards } from "./review-types";

/** 「本次取几个词」：默认 20，可调区间 5–100 */
export const DEFAULT_BATCH_SIZE = 20;
export const MIN_BATCH_SIZE = 5;
export const MAX_BATCH_SIZE = 100;

/** 夹取「本次取几个词」；非法输入回落默认值 */
export function clampBatchSize(value: unknown): number {
	const num =
		typeof value === "number"
			? value
			: typeof value === "string" && value.trim()
				? Number(value)
				: Number.NaN;
	if (!Number.isFinite(num)) return DEFAULT_BATCH_SIZE;
	return Math.min(MAX_BATCH_SIZE, Math.max(MIN_BATCH_SIZE, Math.round(num)));
}

export interface RoundQueueInput {
	/** 当前词表内容（顺序即自建词表的录入顺序） */
	entries: BankEntry[];
	/** 卡片状态（wordKey → 存储形态；坏卡按新词处理） */
	cards: StoredCards;
	now: Date;
	/** 「本次取几个词」 */
	size: number;
}

export interface RoundQueue {
	/** 仅用于展示/日志的本地日期，不参与取词判断 */
	date: string;
	reviews: string[];
	fresh: string[];
	/** 本场顺序：复习在前、新词在后 */
	words: string[];
	/** 实际取到的数量（= 传入 size） */
	size: number;
}

interface DueItem {
	key: string;
	word: string;
	due: number;
}

function cardOf(cards: StoredCards, key: string): Card | null {
	return parseCard(cards[key]);
}

export function buildRoundQueue(input: RoundQueueInput): RoundQueue {
	const { now, entries } = input;
	const size = Math.max(0, Math.floor(input.size) || 0);
	const nowMs = now.getTime();

	const due: DueItem[] = [];
	// 按 wordKey 去重（词表文件可能被手工改出重复项）
	const unique: { entry: BankEntry; index: number; key: string }[] = [];
	const seen = new Set<string>();
	for (const [index, entry] of entries.entries()) {
		const key = wordKey(entry.word);
		if (seen.has(key)) continue;
		seen.add(key);
		unique.push({ entry, index, key });
	}
	const withCard = new Set<string>();
	for (const item of unique) {
		const card = cardOf(input.cards, item.key);
		if (!card) continue;
		withCard.add(item.key);
		if (card.due.getTime() > nowMs) continue;
		due.push({ key: item.key, word: item.entry.word, due: card.due.getTime() });
	}
	// 逾期最重的排前面；同一时刻按 wordKey 稳定排序
	due.sort((a, b) => a.due - b.due || a.key.localeCompare(b.key));
	const pickedReviews = due.slice(0, size);

	const reviews = pickedReviews.map((item) => item.word);
	const fresh: string[] = [];
	const remaining = Math.max(0, size - reviews.length);
	if (remaining > 0) {
		const taken = new Set(pickedReviews.map((item) => item.key));
		const candidates = unique.filter(
			(item) => !withCard.has(item.key) && !taken.has(item.key),
		);
		// 高频优先：有词频的按词频升序，无词频的保持词表顺序排在后面
		candidates.sort((a, b) => {
			const frqA = a.entry.frq ?? Number.MAX_SAFE_INTEGER;
			const frqB = b.entry.frq ?? Number.MAX_SAFE_INTEGER;
			return frqA - frqB || a.index - b.index;
		});
		for (const item of candidates.slice(0, remaining)) {
			fresh.push(item.entry.word);
		}
	}

	return {
		date: localDateKey(now),
		reviews,
		fresh,
		words: [...reviews, ...fresh],
		size,
	};
}
