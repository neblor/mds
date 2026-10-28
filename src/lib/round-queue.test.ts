import { describe, expect, it } from "vitest";
import type { BankEntry } from "./bank-types";
import type { StoredCard, StoredCards } from "./review-types";
import {
	BATCH_MANDATORY_BASE,
	BATCH_SIZE_STEP,
	buildRoundQueue as buildProductionRoundQueue,
	clampBatchSize,
	mandatoryCountForBatch,
	MAX_BATCH_SIZE,
	MIN_BATCH_SIZE,
	QUEUE_CANDIDATE_POOL_SIZE,
	type RoundQueueInput,
} from "./round-queue";

const NOW = new Date(2026, 9, 12, 10, 0, 0); // 本地 2026-10-12 10:00
const identityShuffle = <T,>(list: T[]): T[] => [...list];
const reverseShuffle = <T,>(list: T[]): T[] => [...list].reverse();

/** 旧断言固定洗牌以专测候选排序；随机段行为由独立测试覆盖。 */
function buildRoundQueue(input: RoundQueueInput) {
	return buildProductionRoundQueue({
		shuffleFn: identityShuffle,
		...input,
	});
}

function stored(due: Date, extra: Partial<StoredCard> = {}): StoredCard {
	return {
		due: due.toISOString(),
		stability: 5,
		difficulty: 5,
		elapsed_days: 3,
		scheduled_days: 3,
		learning_steps: 0,
		reps: 2,
		lapses: 0,
		state: 2,
		...extra,
	};
}

function words(list: [string, number?][]): BankEntry[] {
	return list.map(([word, frq]) => (frq === undefined ? { word } : { word, frq }));
}

function numberedWords(count: number): BankEntry[] {
	return Array.from({ length: count }, (_, index) => ({
		word: `word-${String(index + 1).padStart(3, "0")}`,
		frq: index + 1,
	}));
}

function numbered(count: number): string {
	return `word-${String(count).padStart(3, "0")}`;
}

function minutes(n: number): Date {
	return new Date(NOW.getTime() + n * 60 * 1000);
}

function hours(n: number): Date {
	return new Date(NOW.getTime() + n * 60 * 60 * 1000);
}

describe("clampBatchSize", () => {
	it("夹取 5–30 并归一到 5 的整数倍，非法回落 20", () => {
		expect(MIN_BATCH_SIZE).toBe(5);
		expect(MAX_BATCH_SIZE).toBe(30);
		expect(BATCH_SIZE_STEP).toBe(5);
		expect(clampBatchSize(20)).toBe(20);
		expect(clampBatchSize(5)).toBe(5);
		expect(clampBatchSize(1)).toBe(MIN_BATCH_SIZE);
		expect(clampBatchSize(9999)).toBe(MAX_BATCH_SIZE);
		expect(clampBatchSize("30")).toBe(30);
		expect(clampBatchSize("x")).toBe(20);
		expect(clampBatchSize(undefined)).toBe(20);
		expect(clampBatchSize(20.6)).toBe(20);
		expect(clampBatchSize(22.5)).toBe(25);
		expect(clampBatchSize(7)).toBe(5);
		expect(clampBatchSize(8)).toBe(10);
		expect(clampBatchSize(26)).toBe(25);
		expect(clampBatchSize(29)).toBe(30);
	});
});

describe("mandatoryCountForBatch", () => {
	it("5 词→2，之后每多 5 词 +1，30 词→7（崔总 2026-10-28 确认）", () => {
		expect(BATCH_MANDATORY_BASE).toBe(2);
		expect(mandatoryCountForBatch(5)).toBe(2);
		expect(mandatoryCountForBatch(10)).toBe(3);
		expect(mandatoryCountForBatch(15)).toBe(4);
		expect(mandatoryCountForBatch(20)).toBe(5);
		expect(mandatoryCountForBatch(25)).toBe(6);
		expect(mandatoryCountForBatch(30)).toBe(7);
	});

	it("0 词→0；更小的值不超过本批数量", () => {
		expect(mandatoryCountForBatch(0)).toBe(0);
		expect(mandatoryCountForBatch(1)).toBe(1);
		expect(mandatoryCountForBatch(3)).toBe(2);
	});
});

describe("buildRoundQueue", () => {
	it("空词表 / 数量 0 → 空队列", () => {
		expect(buildRoundQueue({ entries: [], cards: {}, now: NOW, size: 20 }).words).toEqual([]);
		expect(
			buildRoundQueue({ entries: words([["a"]]), cards: {}, now: NOW, size: 0 }).words,
		).toEqual([]);
	});

	it("候选排序按词频升序（固定洗牌时首批取前 N 个）", () => {
		const queue = buildRoundQueue({
			entries: words([
				["low", 9000],
				["high", 100],
				["mid", 5000],
				["no-frq"],
			]),
			cards: {},
			now: NOW,
			size: 3,
		});
		expect(queue.reviews).toEqual([]);
		expect(queue.fresh).toEqual(["high", "mid", "low"]);
		expect(queue.size).toBe(3);
	});

	it("无词频的排在后面，且保持词表顺序", () => {
		const queue = buildRoundQueue({
			entries: words([["b1"], ["a1"], ["with-frq", 10]]),
			cards: {},
			now: NOW,
			size: 3,
		});
		expect(queue.fresh).toEqual(["with-frq", "b1", "a1"]);
	});

	it("只取 due <= now 的复习词；今天晚些时候到期的先不取", () => {
		const cards: StoredCards = {
			now: stored(minutes(-1)),
			soon: stored(minutes(30)),
			endOfDay: stored(new Date(2026, 9, 12, 23, 59, 59)),
			tomorrow: stored(new Date(2026, 9, 13, 0, 0, 0)),
		};
		const queue = buildRoundQueue({
			entries: words([["now"], ["soon"], ["endOfDay"], ["tomorrow"]]),
			cards,
			now: NOW,
			size: 10,
		});
		expect(queue.reviews).toEqual(["now"]);
	});

	it("到期复习按逾期程度排序，名额满时不再补新词", () => {
		const cards: StoredCards = {
			older: stored(hours(-2)),
			newer: stored(minutes(-5)),
		};
		const queue = buildRoundQueue({
			entries: words([["older"], ["newer"], ["fresh", 1]]),
			cards,
			now: NOW,
			size: 2,
		});
		expect(queue.reviews).toEqual(["older", "newer"]);
		expect(queue.fresh).toEqual([]);
	});

	it("复习不满名额时用未学过的新词补足", () => {
		const cards: StoredCards = { done: stored(minutes(-1)) };
		const queue = buildRoundQueue({
			entries: words([["done"], ["a", 1], ["b", 2], ["c", 3]]),
			cards,
			now: NOW,
			size: 3,
		});
		expect(queue.reviews).toEqual(["done"]);
		expect(queue.fresh).toEqual(["a", "b"]);
	});

	it("学过的词不会作为新词重复出现；只有真正到点才作为复习回来", () => {
		const cards: StoredCards = { learned: stored(hours(2)) };
		const queue = buildRoundQueue({
			entries: words([["learned"], ["fresh"]]),
			cards,
			now: NOW,
			size: 5,
		});
		expect(queue.words).toEqual(["fresh"]);
	});

	it("重复词条与坏卡都被安全处理", () => {
		const cards: StoredCards = { broken: {} };
		const queue = buildRoundQueue({
			entries: words([["dup"], ["dup"], ["broken"], ["ok"]]),
			cards,
			now: NOW,
			size: 10,
		});
		// broken 没有有效卡 → 按新词；dup 只出现一次
		expect(queue.fresh).toEqual(["dup", "broken", "ok"]);
	});

	it("候选不足本批数量时返回全部词，不为凑数或换批减少队列", () => {
		const queue = buildRoundQueue({
			entries: words([["a"], ["b"], ["c"]]),
			cards: {},
			now: NOW,
			size: 30,
		});
		expect(queue.words).toEqual(["a", "b", "c"]);
		expect(queue.size).toBe(30);
	});

	it("必默前缀恒为候选池最优先的 K 个，随机段从池内剩余抽", () => {
		const entries = numberedWords(QUEUE_CANDIDATE_POOL_SIZE + 20);
		const first = buildRoundQueue({ entries, cards: {}, now: NOW, size: 30 });
		const second = buildRoundQueue({
			entries,
			cards: {},
			now: NOW,
			size: 30,
			shuffleFn: reverseShuffle,
		});

		// 30 词 → 前 7 个必默；两次换批（未作答、卡片不变）必默完全相同。
		const mandatory = Array.from({ length: 7 }, (_, index) =>
			numbered(index + 1),
		);
		expect(first.fresh.slice(0, 7)).toEqual(mandatory);
		expect(second.fresh.slice(0, 7)).toEqual(mandatory);
		// 随机段变了，所以整批不是同一批。
		expect(second.fresh).not.toEqual(first.fresh);
		expect(second.fresh).toHaveLength(30);
		expect(new Set(second.fresh).size).toBe(30);
	});

	it("5 词时前 2 个必默，余下 3 个从池内剩余随机", () => {
		const queue = buildRoundQueue({
			entries: numberedWords(QUEUE_CANDIDATE_POOL_SIZE + 20),
			cards: {},
			now: NOW,
			size: 5,
			shuffleFn: reverseShuffle,
		});
		// 必默 word-001/002；随机段取池尾 word-100/099/098，输出仍按池内顺序。
		expect(queue.fresh).toEqual([
			numbered(1),
			numbered(2),
			numbered(98),
			numbered(99),
			numbered(100),
		]);
	});

	it("随机段只来自前 100 个候选，池外词不会跃入", () => {
		const queue = buildRoundQueue({
			entries: numberedWords(QUEUE_CANDIDATE_POOL_SIZE + 20),
			cards: {},
			now: NOW,
			size: 30,
			shuffleFn: reverseShuffle,
		});
		const expected = [
			...Array.from({ length: 7 }, (_, index) => numbered(index + 1)),
			...Array.from({ length: 23 }, (_, index) => numbered(78 + index)),
		];

		expect(queue.fresh).toEqual(expected);
		expect(queue.fresh).not.toContain(numbered(8));
		expect(queue.fresh).not.toContain(numbered(77));
		expect(queue.fresh).not.toContain(numbered(101));
		expect(queue.fresh.every((word) => {
			const n = Number(word.slice("word-".length));
			return n >= 1 && n <= QUEUE_CANDIDATE_POOL_SIZE;
		})).toBe(true);
	});

	it("候选池不足 100 时只从实际候选里抽，不会超出词表", () => {
		const queue = buildRoundQueue({
			entries: numberedWords(60),
			cards: {},
			now: NOW,
			size: 30,
			shuffleFn: reverseShuffle,
		});
		const expected = [
			...Array.from({ length: 7 }, (_, index) => numbered(index + 1)),
			...Array.from({ length: 23 }, (_, index) => numbered(38 + index)),
		];
		expect(queue.fresh).toEqual(expected);
		expect(queue.fresh).not.toContain(numbered(8));
		expect(queue.fresh).not.toContain(numbered(37));
	});

	it("复习词仍排在新词前，必默前缀优先于随机段", () => {
		const cards: StoredCards = {
			r1: stored(hours(-3)),
			r2: stored(hours(-2)),
			r3: stored(hours(-1)),
		};
		const queue = buildRoundQueue({
			entries: words([
				["r1"],
				["r2"],
				["r3"],
				["f1"],
				["f2"],
				["f3"],
				["f4"],
				["f5"],
			]),
			cards,
			now: NOW,
			size: 5,
		});
		expect(queue.reviews).toEqual(["r1", "r2", "r3"]);
		expect(queue.fresh).toEqual(["f1", "f2"]);
		expect(queue.words).toEqual(["r1", "r2", "r3", "f1", "f2"]);
	});
});
