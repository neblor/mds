import { describe, expect, it } from "vitest";
import type { BankEntry } from "./bank-types";
import type { StoredCard, StoredCards } from "./review-store";
import {
	buildDailyQueue,
	endOfLocalDay,
	localDateKey,
} from "./daily-queue";

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

function days(n: number): Date {
	return new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000);
}

describe("日期边界", () => {
	it("localDateKey 用本地日", () => {
		expect(localDateKey(NOW)).toBe("2026-10-12");
		expect(localDateKey(new Date(2026, 0, 5, 0, 0, 0))).toBe("2026-01-05");
	});

	it("endOfLocalDay 是本地 23:59:59.999", () => {
		const end = endOfLocalDay(NOW);
		expect(end.getHours()).toBe(23);
		expect(end.getMinutes()).toBe(59);
		expect(end.getDate()).toBe(12);
	});
});

describe("buildDailyQueue", () => {
	it("空词表 / 目标 0 → 空队列", () => {
		expect(buildDailyQueue({ entries: [], cards: {}, now: NOW, target: 20 }).words).toEqual([]);
		expect(
			buildDailyQueue({ entries: words([["a"]]), cards: {}, now: NOW, target: 0 }).words,
		).toEqual([]);
	});

	it("全是新词时按词频升序取前 N 个", () => {
		const queue = buildDailyQueue({
			entries: words([
				["low", 9000],
				["high", 100],
				["mid", 5000],
				["no-frq"],
			]),
			cards: {},
			now: NOW,
			target: 3,
		});
		expect(queue.reviews).toEqual([]);
		expect(queue.fresh).toEqual(["high", "mid", "low"]);
		expect(queue.words).toEqual(["high", "mid", "low"]);
	});

	it("无词频的排在后面，且保持词表顺序", () => {
		const queue = buildDailyQueue({
			entries: words([["b1"], ["a1"], ["with-frq", 10]]),
			cards: {},
			now: NOW,
			target: 3,
		});
		expect(queue.fresh).toEqual(["with-frq", "b1", "a1"]);
	});

	it("到期复习优先，剩余名额用新词补足", () => {
		const cards: StoredCards = {
			"old-1": stored(days(-1)),
			"old-2": stored(days(-5)),
		};
		const queue = buildDailyQueue({
			entries: words([["old-1"], ["old-2"], ["fresh-1"], ["fresh-2"], ["fresh-3"]]),
			cards,
			now: NOW,
			target: 4,
		});
		// 逾期最重的排前面
		expect(queue.reviews).toEqual(["old-2", "old-1"]);
		expect(queue.fresh).toEqual(["fresh-1", "fresh-2"]);
		expect(queue.words).toEqual(["old-2", "old-1", "fresh-1", "fresh-2"]);
	});

	it("到期数量超过目标时，只取逾期最重的 N 个", () => {
		const cards: StoredCards = {
			a: stored(days(-1)),
			b: stored(days(-10)),
			c: stored(days(-3)),
		};
		const queue = buildDailyQueue({
			entries: words([["a"], ["b"], ["c"], ["d"]]),
			cards,
			now: NOW,
			target: 2,
		});
		expect(queue.reviews).toEqual(["b", "c"]);
		expect(queue.fresh).toEqual([]);
	});

	it("有卡但未到期的词既不是复习也不是新词（不会重复考）", () => {
		const cards: StoredCards = { later: stored(days(3)) };
		const queue = buildDailyQueue({
			entries: words([["later"], ["fresh"]]),
			cards,
			now: NOW,
			target: 5,
		});
		expect(queue.words).toEqual(["fresh"]);
	});

	it("今天已默过的词不再排；但真正到点的卡（重学步内）会回来", () => {
		const cards: StoredCards = {
			"done-today": stored(days(2)), // 已排到后天，不该回来
			lapsed: stored(new Date(NOW.getTime() - 60 * 1000)), // 10 分钟前到期，该回来
		};
		const queue = buildDailyQueue({
			entries: words([["done-today"], ["lapsed"], ["fresh"]]),
			cards,
			now: NOW,
			target: 5,
			doneToday: ["done-today"],
		});
		expect(queue.reviews).toEqual(["lapsed"]);
		expect(queue.fresh).toEqual(["fresh"]);
	});

	it("今天已默过的新词不会再作为新词补足", () => {
		const queue = buildDailyQueue({
			entries: words([["a"], ["b"]]),
			cards: {},
			now: NOW,
			target: 2,
			doneToday: ["A"],
		});
		expect(queue.fresh).toEqual(["b"]);
	});

	it("due 落在今天 23:59:59.999 的算今天；明天 0 点的不算", () => {
		const cards: StoredCards = {
			today: stored(endOfLocalDay(NOW)),
			tomorrow: stored(new Date(2026, 9, 13, 0, 0, 0)),
		};
		const queue = buildDailyQueue({
			entries: words([["today"], ["tomorrow"]]),
			cards,
			now: NOW,
			target: 5,
		});
		expect(queue.reviews).toEqual(["today"]);
	});

	it("重复词条与坏卡都被安全处理", () => {
		const cards: StoredCards = { broken: {} };
		const queue = buildDailyQueue({
			entries: words([["dup", 10], ["DUP", 20], ["broken"]]),
			cards,
			now: NOW,
			target: 5,
		});
		expect(queue.fresh).toEqual(["dup", "broken"]);
	});

	it("目标数大于可用词数时取全部，不报错", () => {
		const queue = buildDailyQueue({
			entries: words([["a"], ["b"]]),
			cards: {},
			now: NOW,
			target: 100,
		});
		expect(queue.words).toEqual(["a", "b"]);
		expect(queue.target).toBe(100);
	});

	it("同一时刻到期的卡按 word 稳定排序（每次结果一致）", () => {
		const same = days(-1);
		const cards: StoredCards = { c: stored(same), a: stored(same), b: stored(same) };
		const input = { entries: words([["c"], ["a"], ["b"]]), cards, now: NOW, target: 3 };
		expect(buildDailyQueue(input).reviews).toEqual(["a", "b", "c"]);
		expect(buildDailyQueue(input).reviews).toEqual(["a", "b", "c"]);
	});

	it("按天粒度：当天 20:00 到期的卡，早上建队列时就算到期", () => {
		const cards: StoredCards = { a: stored(new Date(2026, 9, 12, 20, 0, 0)) };
		const before = buildDailyQueue({
			entries: words([["a"], ["b"]]),
			cards,
			now: NOW,
			target: 1,
		});
		expect(before.reviews).toEqual(["a"]);
		expect(before.fresh).toEqual([]);

		const nextDay = new Date(2026, 9, 13, 9, 0, 0);
		const after = buildDailyQueue({
			entries: words([["a"], ["b"]]),
			cards,
			now: nextDay,
			target: 1,
		});
		expect(after.reviews).toEqual(["a"]);
		expect(after.date).toBe("2026-10-13");
	});
});
