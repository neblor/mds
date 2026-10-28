/**
 * 取词队列（纯逻辑，可单测）
 *
 * 口径（崔总 2026-10-24 / 2026-10-28 更正）：
 * 界面上只有一个数字 = **本次取几个词**（5–30，步长 5），不是「今天一共默几个」。
 * 队列只跟 SRS 状态有关，**不引入任何「每日」概念**：
 *   - 到期复习：`due <= now`（不按「今天结束」提前取）
 *   - 新词：还没有卡片的词（学过一次就不再算新词）
 *   - 数量：到 `size` 为止
 *
 * 选词分两层：
 *   1. 推荐排序先给出前 100 个候选（复习按逾期、新词按词频）。
 *   2. 本批 = 候选池前 K 个「必默」+ 从剩余候选里随机抽 `size-K` 个。
 *      K：5 词→2，之后每多 5 词 +1（10→3 … 30→7）。
 *
 * 必默前缀保证高优先词不会被随机漏掉，候选池会随着卡片状态向前推进；
 * 随机段让「重新取词」在卡片状态不变时也能换出一批不同的词。
 * 候选不足本批数量时返回全部候选，不为凑数或制造变化而减词。
 */
import type { Card } from "ts-fsrs";
import type { BankEntry } from "./bank-types";
import { wordKey } from "./bank-parse";
import { localDateKey } from "./day";
import { parseCard } from "./srs";
import type { StoredCards } from "./review-types";

/** 「本次取几个词」：默认 20，可调区间 5–30，步长 5 */
export const DEFAULT_BATCH_SIZE = 20;
export const MIN_BATCH_SIZE = 5;
export const MAX_BATCH_SIZE = 30;
export const BATCH_SIZE_STEP = 5;
/** 推荐排序只决定候选池；本批从池内选。 */
export const QUEUE_CANDIDATE_POOL_SIZE = 100;
/** 5 词时必默 2 个，之后每多 5 词 +1。 */
export const BATCH_MANDATORY_BASE = 2;

/** 可注入的洗牌器：生产用随机洗牌，测试可锁随机段。 */
export type QueueShuffle = <T>(list: T[]) => T[];

/** 夹取「本次取几个词」；非法输入回落默认值，旧档位值归一到 5 的整数倍 */
export function clampBatchSize(value: unknown): number {
	const num =
		typeof value === "number"
			? value
			: typeof value === "string" && value.trim()
				? Number(value)
				: Number.NaN;
	if (!Number.isFinite(num)) return DEFAULT_BATCH_SIZE;
	// 只允许 5 的整数倍：旧版存过 100/23 这类值，读时一并归一到新档位。
	const snapped = Math.round(num / BATCH_SIZE_STEP) * BATCH_SIZE_STEP;
	return Math.min(MAX_BATCH_SIZE, Math.max(MIN_BATCH_SIZE, snapped));
}

/**
 * 本批的必默前缀数量。
 * 生产只会在 5–30 之间调用；更小的值按「不超过本批数量」兜底。
 */
export function mandatoryCountForBatch(size: number): number {
	const batch = Math.max(0, Math.floor(size) || 0);
	if (batch === 0) return 0;
	const steps = Math.max(
		0,
		Math.floor((batch - MIN_BATCH_SIZE) / BATCH_SIZE_STEP),
	);
	return Math.min(batch, BATCH_MANDATORY_BASE + steps);
}

export interface RoundQueueInput {
	/** 当前词表内容（顺序即自建词表的录入顺序） */
	entries: BankEntry[];
	/** 卡片状态（wordKey → 存储形态；坏卡按新词处理） */
	cards: StoredCards;
	now: Date;
	/** 「本次取几个词」 */
	size: number;
	/** 测试注入；缺省为 Fisher–Yates 随机洗牌。 */
	shuffleFn?: QueueShuffle;
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

interface QueueCandidate {
	key: string;
	word: string;
	kind: "review" | "fresh";
}

function cardOf(cards: StoredCards, key: string): Card | null {
	return parseCard(cards[key]);
}

function randomShuffle<T>(list: T[]): T[] {
	const shuffled = [...list];
	for (let index = shuffled.length - 1; index > 0; index -= 1) {
		const other = Math.floor(Math.random() * (index + 1));
		[shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
	}
	return shuffled;
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
	const freshCandidates = unique.filter((item) => !withCard.has(item.key));
	// 高频优先：有词频的按词频升序，无词频的保持词表顺序排在后面
	freshCandidates.sort((a, b) => {
		const frqA = a.entry.frq ?? Number.MAX_SAFE_INTEGER;
		const frqB = b.entry.frq ?? Number.MAX_SAFE_INTEGER;
		return frqA - frqB || a.index - b.index;
	});

	// 推荐算法先给出有序候选：复习在前、新词在后；只保留前 100 个进池。
	const ranked: QueueCandidate[] = [
		...due.map((item) => ({
			key: item.key,
			word: item.word,
			kind: "review" as const,
		})),
		...freshCandidates.map((item) => ({
			key: item.key,
			word: item.entry.word,
			kind: "fresh" as const,
		})),
	];
	const pool = ranked.slice(0, Math.max(QUEUE_CANDIDATE_POOL_SIZE, size));

	// 必默前缀永远入批；其余名额从池内剩余候选随机抽。
	// 候选不足本批数量时直接全取，保证“换批”不会把队列变短。
	const pickedKeys = new Set<string>();
	if (pool.length <= size) {
		for (const item of pool) pickedKeys.add(item.key);
	} else {
		const mandatoryCount = Math.min(
			mandatoryCountForBatch(size),
			pool.length,
		);
		for (const item of pool.slice(0, mandatoryCount)) {
			pickedKeys.add(item.key);
		}
		const rest = pool.slice(mandatoryCount);
		const randomCount = size - mandatoryCount;
		const shuffle = input.shuffleFn ?? randomShuffle;
		for (const item of shuffle([...rest]).slice(0, randomCount)) {
			pickedKeys.add(item.key);
		}
	}
	// 按池内顺序输出：复习仍在新词前，必默词在其分组内靠前。
	const picked = pool.filter((item) => pickedKeys.has(item.key));
	const reviews: string[] = [];
	const fresh: string[] = [];
	for (const item of picked) {
		(item.kind === "review" ? reviews : fresh).push(item.word);
	}

	return {
		date: localDateKey(now),
		reviews,
		fresh,
		words: [...reviews, ...fresh],
		size,
	};
}
