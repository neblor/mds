import { describe, expect, it } from "vitest";
import type { BankEntry } from "./bank-types";
import {
	HEATMAP_DAYS,
	MIN_ACCURACY_SAMPLE,
	WEAK_LIMIT,
	computeBankStats,
	type BankStatsInput,
} from "./bank-stats";
import { localDateKey } from "./day";
import type {
	CardStatRow,
	LogDayRow,
	ModeStatRow,
	SessionDayRow,
	WordLogRow,
	WritingWordRow,
} from "./review-types";

const NOW = new Date(2026, 9, 18, 10, 0, 0);

function atDay(offset: number, hour = 10): Date {
	return new Date(2026, 9, 18 + offset, hour, 0, 0);
}

function key(offset: number): string {
	return localDateKey(atDay(offset));
}

function entry(word: string): BankEntry {
	return { word, definition: `${word} definition` };
}

function card(
	word: string,
	options: {
		state?: number;
		scheduledDays?: number;
		dueOffset?: number;
		lapses?: number;
		difficulty?: number;
	} = {},
): CardStatRow {
	const due = atDay(options.dueOffset ?? 0).getTime();
	return {
		wordKey: word,
		word,
		due,
		dueDay: localDateKey(new Date(due)),
		state: options.state ?? 2,
		stability: 10,
		difficulty: options.difficulty ?? 5,
		scheduledDays: options.scheduledDays ?? 10,
		lapses: options.lapses ?? 0,
		lastReview: atDay(-1).getTime(),
	};
}

function logDay(date: string, reviews: number, correct: number, elapsedMs = 1000): LogDayRow {
	return { date, reviews, correct, elapsedMs };
}

function sessionDay(
	date: string,
	sessions: number,
	writingWords = 0,
	writingActiveMs = 0,
): SessionDayRow {
	return { date, sessions, writingWords, writingActiveMs };
}

function wordLog(
	word: string,
	options: {
		seen?: number;
		correct?: number;
		wrong30?: number;
		firstAt?: number;
		lastAt?: number;
	} = {},
): WordLogRow {
	return {
		wordKey: word,
		word,
		seen: options.seen ?? 1,
		correct: options.correct ?? 0,
		wrong30: options.wrong30 ?? 0,
		firstAt: options.firstAt ?? atDay(-10).getTime(),
		lastAt: options.lastAt ?? atDay(0).getTime(),
	};
}

function writing(word: string, practiced: number, lastAt = atDay(0).getTime()): WritingWordRow {
	return { wordKey: word, word, practiced, lastAt };
}

function baseInput(overrides: Partial<BankStatsInput> = {}): BankStatsInput {
	return {
		bank: {
			id: "b1",
			name: "测试词库",
			source: "custom",
			count: 4,
			updatedAt: NOW.getTime(),
		},
		entries: [entry("apple"), entry("banana"), entry("cherry"), entry("date")],
		cards: [
			card("apple", { state: 2, scheduledDays: 21, dueOffset: 5 }),
			card("banana", { state: 2, scheduledDays: 7, dueOffset: -1, lapses: 2 }),
			card("cherry", { state: 1, scheduledDays: 0, dueOffset: 1 }),
		],
		logDays: [
			logDay(key(0), 3, 2, 6000),
			logDay(key(-1), 2, 2, 4000),
			logDay(key(-40), 1, 0, 1000),
		],
		sessionDays: [
			sessionDay(key(0), 1, 2, 8000),
			sessionDay(key(-10), 1, 0, 0),
		],
		accuracy: {
			last7: { correct: 4, total: 5 },
			last30: { correct: 5, total: 7 },
			all: { correct: 6, total: 9 },
		},
		modes: [{ mode: "word", reviews: 5, correct: 4, elapsedMs: 10000 }],
		words: [
			wordLog("apple", { seen: 5, correct: 4, wrong30: 2 }),
			wordLog("banana", { seen: 3, correct: 1, wrong30: 2, firstAt: atDay(-40).getTime() }),
			wordLog("cherry", { seen: 1, correct: 0, wrong30: 0 }),
		],
		writingWords: [writing("apple", 2), writing("banana", 1)],
		sessionTotals: {
			total: 2,
			firstAt: atDay(-10).getTime(),
			lastAt: atDay(0).getTime(),
		},
		recentSessions: [
			{ at: atDay(0).getTime(), genMode: "cyber", contentMode: "word", wordCount: 2, judged: 2, correct: 1, activeMs: 5000 },
			{ at: atDay(-1).getTime(), genMode: "writing", contentMode: "word", wordCount: 2, judged: 0, correct: null, activeMs: 4000 },
			{ at: atDay(-2).getTime(), genMode: "cyber", contentMode: "definition", wordCount: 1, judged: 1, correct: 1, activeMs: 2000 },
			{ at: atDay(-3).getTime(), genMode: "cyber", contentMode: "word", wordCount: 1, judged: 1, correct: 0, activeMs: 1000 },
		],
		now: NOW,
		heatmapDays: HEATMAP_DAYS,
		...overrides,
	};
}

describe("computeBankStats 覆盖与到期", () => {
	it("状态分桶、未学与到期预测", () => {
		const stats = computeBankStats(baseInput());
		expect(stats.coverage).toEqual({
			total: 4,
			started: 3,
			unstarted: 1,
			mastered: 1,
			reviewing: 1,
			learning: 1,
		});
		expect(stats.due.overdue).toBe(1);
		expect(stats.due.today).toBe(0);
		expect(stats.due.next7).toBe(2);
		expect(stats.due.next30).toBe(2);
		expect(stats.due.forecast).toHaveLength(14);
		expect(stats.due.forecast[5]).toEqual({ date: key(5), count: 1 });
	});

	it("孤儿卡片不计入任何桶，也不进预测", () => {
		const stats = computeBankStats(
			baseInput({
				cards: [card("ghost", { dueOffset: 0 }), card("apple", { dueOffset: 5 })],
				entries: [entry("apple")],
			}),
		);
		expect(stats.coverage.total).toBe(1);
		expect(stats.coverage.started).toBe(1);
		expect(stats.due.overdue).toBe(0);
		expect(stats.due.today).toBe(0);
		expect(stats.coverage.mastered + stats.coverage.reviewing + stats.coverage.learning).toBe(1);
	});

	it("掌握边界：20 天算复习中，21 天算已掌握", () => {
		const stats = computeBankStats(
			baseInput({
				entries: [entry("a"), entry("b")],
				cards: [
					card("a", { scheduledDays: 20 }),
					card("b", { scheduledDays: 21 }),
				],
			}),
		);
		expect(stats.coverage.reviewing).toBe(1);
		expect(stats.coverage.mastered).toBe(1);
	});
});

describe("computeBankStats 使用频率与正确率", () => {
	it("热力、场次、活跃天数、连续、用时", () => {
		const stats = computeBankStats(baseInput());
		expect(stats.activity.heatmap).toHaveLength(HEATMAP_DAYS);
		const today = stats.activity.heatmap.at(-1);
		expect(today).toEqual({
			date: key(0),
			attempts: 5,
			reviews: 3,
			correct: 2,
		});
		expect(stats.activity.sessions).toEqual({ last7: 1, last30: 2, total: 2 });
		expect(stats.activity.sessionsAvailable).toBe(true);
		expect(stats.activity.activeDays30).toBe(3);
		expect(stats.activity.streak).toBe(2);
		expect(stats.activity.practiceMs7).toBe(18000);
		expect(stats.activity.practiceMs30).toBe(18000);
		expect(stats.activity.lastUsedAt).toBe(atDay(0).getTime());
		expect(stats.activity.firstUsedAt).toBe(atDay(-40).getTime());
	});

	it("今天没练时从昨天算连续；断一天即停", () => {
		const input = baseInput({
			logDays: [logDay(key(-1), 1, 1), logDay(key(-2), 1, 1)],
			sessionDays: [],
			sessionTotals: { total: 0, firstAt: null, lastAt: null },
		});
		const stats = computeBankStats(input);
		expect(stats.activity.streak).toBe(2);
		expect(stats.activity.sessionsAvailable).toBe(false);
	});

	it("正确率原样返回，样本是否足够由界面处理", () => {
		const stats = computeBankStats(baseInput());
		expect(stats.accuracy.last7).toEqual({ correct: 4, total: 5 });
		expect(MIN_ACCURACY_SAMPLE).toBeGreaterThan(stats.accuracy.last7.total);
	});
});

describe("computeBankStats 重点词", () => {
	it("薄弱词按理由优先级与分数排序，最多 5 个", () => {
		const entries = Array.from({ length: 7 }, (_, index) => entry(`w${index}`));
		const cards = entries.map((item, index) =>
			card(item.word, {
				lapses: index % 3,
				difficulty: index >= 4 ? 8 : 5,
			}),
		);
		const words = entries.map((item, index) =>
			wordLog(item.word, {
				seen: 3,
				wrong30: index % 3,
				firstAt: atDay(-10).getTime(),
			}),
		);
		const stats = computeBankStats(
			baseInput({ entries, cards, words, writingWords: [], sessionDays: [] }),
		);
		expect(stats.words.weak.length).toBeLessThanOrEqual(WEAK_LIMIT);
		expect(stats.words.weak[0].reason).toMatch(/近 30 天错|累计重学|难度偏高/);
	});

	it("常练词同时计入书写场次；书写-only 也出现", () => {
		const stats = computeBankStats(
			baseInput({
				words: [wordLog("apple", { seen: 5, correct: 4 })],
				writingWords: [writing("apple", 2), writing("date", 4)],
			}),
		);
		expect(stats.words.mostPracticed[0]).toMatchObject({
			word: "apple",
			practiced: 7,
			judged: 5,
		});
		expect(stats.words.mostPracticed.some((item) => item.word === "date")).toBe(true);
	});
});

describe("computeBankStats 评估条", () => {
	it("近 30 天新开始 ≥ 9 时给出剩余天数估算", () => {
		const entries = Array.from({ length: 100 }, (_, index) => entry(`w${index}`));
		const words = entries.slice(0, 9).map((item) =>
			wordLog(item.word, {
				seen: 1,
				firstAt: atDay(-5).getTime(),
				lastAt: atDay(-5).getTime(),
			}),
		);
		const stats = computeBankStats(
			baseInput({
				entries,
				cards: [],
				words,
				logDays: [],
				sessionDays: [],
				sessionTotals: { total: 0, firstAt: null, lastAt: null },
			}),
		);
		expect(stats.estimate).not.toBeNull();
		expect(stats.estimate?.newStarted30).toBe(9);
		expect(stats.estimate?.remainingUnstarted).toBe(100);
		expect(stats.estimate?.daysLeft).toBe(Math.ceil(100 / (9 / 30)));
	});

	it("样本不足时 estimate 为 null", () => {
		const stats = computeBankStats(baseInput());
		expect(stats.estimate).toBeNull();
	});
});
