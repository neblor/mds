import { describe, expect, it } from "vitest";
import type { BankEntry } from "./bank-types";
import type { StoredCard, StoredCards } from "./review-types";
import {
	buildRoundQueue,
	clampBatchSize,
	MAX_BATCH_SIZE,
	MIN_BATCH_SIZE,
} from "./round-queue";

const NOW = new Date(2026, 9, 12, 10, 0, 0); // 本地 2026-10-12 10:00

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

function minutes(n: number): Date {
	return new Date(NOW.getTime() + n * 60 * 1000);
}

function hours(n: number): Date {
	return new Date(NOW.getTime() + n * 60 * 60 * 1000);
}

describe("clampBatchSize", () => {
	it("夹取 5–100，非法回落 20", () => {
		expect(clampBatchSize(20)).toBe(20);
		expect(clampBatchSize(1)).toBe(MIN_BATCH_SIZE);
		expect(clampBatchSize(9999)).toBe(MAX_BATCH_SIZE);
		expect(clampBatchSize("30")).toBe(30);
		expect(clampBatchSize("x")).toBe(20);
		expect(clampBatchSize(undefined)).toBe(20);
		expect(clampBatchSize(20.6)).toBe(21);
	});
});

describe("buildRoundQueue", () => {
	it("空词表 / 数量 0 → 空队列", () => {
		expect(buildRoundQueue({ entries: [], cards: {}, now: NOW, size: 20 }).words).toEqual([]);
		expect(
			buildRoundQueue({ entries: words([["a"]]), cards: {}, now: NOW, size: 0 }).words,
		).toEqual([]);
	});

	it("全是新词时按词频升序取前 N 个", () => {
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
			entries: words([["learned"], ["fresh"]],),
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

	it("数量超过词表时只返回全部词", () => {
		const queue = buildRoundQueue({
			entries: words([["a"], ["b"]]),
			cards: {},
			now: NOW,
			size: 100,
		});
		expect(queue.words).toEqual(["a", "b"]);
	});
});
