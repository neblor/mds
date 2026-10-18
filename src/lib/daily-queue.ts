/**
 * 每日队列（纯逻辑，可单测）
 *
 * 口径（崔总 2026-10-12 定）：词表模式下**不选词**——本场默哪些词完全由算法排：
 *   1) 先排到期复习卡（`due <= 今天结束`），按逾期程度（due 早者优先）
 *   2) 入额未满时用新词补足到「今天默几个」（按词频升序 = 高频优先；无词频的保持词表顺序）
 *   3) 今天已经默过的词不再排，**除非**它的卡已经真的到点（学习/重学步内，due <= now）
 * 队列不落盘：每次进词表模式按当日状态重算；只有卡片状态与每日汇总落盘。
 */
import type { Card } from "ts-fsrs";
import type { BankEntry } from "./bank-types";
import { wordKey } from "./bank-parse";
import { parseCard, sameLocalDay } from "./srs";
import type { StoredCards } from "./review-types";

/** 「今天默几个」：默认 20，可调区间 5–100 */
export const DEFAULT_TODAY_TARGET = 20;
export const MIN_TODAY_TARGET = 5;
export const MAX_TODAY_TARGET = 100;

/** 夹取「今天默几个」；非法输入回落默认值 */
export function clampTodayTarget(value: unknown): number {
	const num =
		typeof value === "number"
			? value
			: typeof value === "string" && value.trim()
				? Number(value)
				: Number.NaN;
	if (!Number.isFinite(num)) return DEFAULT_TODAY_TARGET;
	return Math.min(
		MAX_TODAY_TARGET,
		Math.max(MIN_TODAY_TARGET, Math.round(num)),
	);
}

/** 本地时区日期键 YYYY-MM-DD（跨日判断一律用本地日，不用 UTC） */
export function localDateKey(date: Date): string {
	const year = date.getFullYear();
	const month = `${date.getMonth() + 1}`.padStart(2, "0");
	const day = `${date.getDate()}`.padStart(2, "0");
	return `${year}-${month}-${day}`;
}

/** 本地当天最后一毫秒 */
export function endOfLocalDay(date: Date): Date {
	return new Date(
		date.getFullYear(),
		date.getMonth(),
		date.getDate(),
		23,
		59,
		59,
		999,
	);
}

/**
 * 今天已默过的词：按卡片的 last_review 是否落在本地今天判断。
 * 用「最后复习时间」而不是另一份计数：刷新或重进页面后进度能自愈。
 */
export function doneWordsToday(
	entries: BankEntry[],
	cards: StoredCards,
	now: Date,
): string[] {
	const done: string[] = [];
	for (const entry of entries) {
		const card = cardOf(cards, wordKey(entry.word));
		if (card?.last_review && sameLocalDay(card.last_review, now)) {
			done.push(entry.word);
		}
	}
	return done;
}

export interface QueueInput {
	/** 当前词表内容（顺序即自建词表的录入顺序） */
	entries: BankEntry[];
	/** 卡片状态（wordKey → 存储形态；坏卡按新词处理） */
	cards: StoredCards;
	now: Date;
	/** 「今天默几个」 */
	target: number;
	/** 今天已经默过的词（按 wordKey 比较） */
	doneToday?: string[];
}

export interface DailyQueue {
	date: string;
	reviews: string[];
	fresh: string[];
	/** 本场顺序：复习在前、新词在后 */
	words: string[];
	/** 实际目标（= 传入 target，便于界面直接展示） */
	target: number;
}

interface DueItem {
	key: string;
	word: string;
	due: number;
}

function cardOf(cards: StoredCards, key: string): Card | null {
	return parseCard(cards[key]);
}

export function buildDailyQueue(input: QueueInput): DailyQueue {
	const { now, entries } = input;
	const endOfDay = endOfLocalDay(now).getTime();
	const nowMs = now.getTime();
	const target = Math.max(0, Math.floor(input.target) || 0);
	const done = new Set((input.doneToday ?? []).map(wordKey));

	const due: DueItem[] = [];
	// 先按 wordKey 去重（词表文件可能被手工改出重复项），后面的复习与新词两轮都用这份唯一列表
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
		const dueMs = card.due.getTime();
		if (dueMs > endOfDay) continue;
		// 今天已经默过、且尚未真正到点的卡，今天不再重复安排
		if (done.has(item.key) && dueMs > nowMs) continue;
		due.push({ key: item.key, word: item.entry.word, due: dueMs });
	}
	// 逾期最重的排前面；同一时刻按 wordKey 稳定排序
	due.sort((a, b) => a.due - b.due || a.key.localeCompare(b.key));
	const pickedReviews = due.slice(0, target);

	const reviews = pickedReviews.map((item) => item.word);
	const fresh: string[] = [];
	const remaining = target - reviews.length;
	if (remaining > 0) {
		const taken = new Set(pickedReviews.map((item) => item.key));
		const candidates = unique.filter(
			(item) =>
				!withCard.has(item.key) &&
				!done.has(item.key) &&
				!taken.has(item.key),
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
		target,
	};
}
