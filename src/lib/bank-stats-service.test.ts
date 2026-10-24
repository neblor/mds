import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBankStore } from "./bank-store";
import { buildBankStats } from "./bank-stats-service";
import { localDateKey } from "./day";
import { createReviewStore } from "./review-store";
import type { ReviewStore, StoredCard } from "./review-types";
import type { BankEntry, WordBank } from "./bank-types";

const dirs: string[] = [];
const stores: ReviewStore[] = [];
const NOW = new Date(2026, 9, 18, 10, 0, 0);

function tempStores(forceLegacy = false) {
	const dir = mkdtempSync(join(tmpdir(), "mds-bank-stats-"));
	dirs.push(dir);
	const bankStore = createBankStore(join(dir, "banks"));
	const reviewStore = createReviewStore(join(dir, "review"), { forceLegacy });
	stores.push(reviewStore);
	return { bankStore, reviewStore };
}

afterEach(() => {
	for (const store of stores.splice(0)) store.close();
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeBank(id: string, words: string[]): WordBank {
	const entries: BankEntry[] = words.map((word) => ({ word }));
	return {
		id,
		name: `库 ${id}`,
		source: "custom",
		version: 1,
		entries,
		createdAt: NOW.getTime(),
		updatedAt: NOW.getTime(),
	};
}

function dueCard(offsetDays: number, scheduledDays: number, lapses = 0): StoredCard {
	return {
		due: new Date(
			NOW.getFullYear(),
			NOW.getMonth(),
			NOW.getDate() + offsetDays,
			10,
		).toISOString(),
		stability: 10,
		difficulty: 5,
		elapsed_days: 0,
		scheduled_days: scheduledDays,
		learning_steps: 0,
		reps: 1,
		lapses,
		state: 2,
	};
}

function logAt(offsetDays: number, word: string, correct: boolean) {
	return {
		at: new Date(
			NOW.getFullYear(),
			NOW.getMonth(),
			NOW.getDate() + offsetDays,
			10,
		).getTime(),
		word,
		bankId: "b1",
		rating: correct ? 3 : 1,
		correct,
		mode: "word" as const,
		genMode: "cyber" as const,
		elapsedMs: 1000,
		queueKind: "review" as const,
		stateBefore: 2,
		intervalBeforeDays: 3,
		intervalAfterDays: 7,
		stabilityAfter: 10,
		difficultyAfter: 5,
	};
}

describe("buildBankStats（SQL + 纯计算）", () => {
	it("把卡片、日志、场次、词级查询串成档案视图", () => {
		const { bankStore, reviewStore } = tempStores();
		bankStore.write(makeBank("b1", ["apple", "banana", "cherry"]));
		reviewStore.commit("b1", {
			cards: [
				{ key: "apple", card: dueCard(5, 21) },
				{ key: "banana", card: dueCard(1, 7) },
			],
			logs: [
				logAt(0, "apple", true),
				logAt(0, "banana", false),
				logAt(0, "banana", false),
			],
			session: {
				id: "s-cyber",
				at: NOW.getTime(),
				bankId: "b1",
				genMode: "cyber",
				contentMode: "word",
				words: ["apple", "banana"],
				correct: 1,
				activeMs: 3000,
				wallMs: 5000,
			},
		});
		reviewStore.commit("b1", {
			cards: [],
			logs: [],
			session: {
				id: "s-writing",
				at: new Date(
					NOW.getFullYear(),
					NOW.getMonth(),
					NOW.getDate() - 2,
					18,
				).getTime(),
				bankId: "b1",
				genMode: "writing",
				contentMode: "word",
				words: ["banana", "cherry"],
				correct: null,
				activeMs: 5000,
				wallMs: 7000,
			},
		});

		const stats = buildBankStats({
			bankStore,
			reviewStore,
			bankId: "b1",
			now: NOW,
			days: 90,
		});
		expect(stats).not.toBeNull();
		if (!stats) return;
		expect(stats.coverage).toMatchObject({
			total: 3,
			started: 2,
			unstarted: 1,
			mastered: 1,
			reviewing: 1,
		});
		expect(stats.due).toMatchObject({ overdue: 0, today: 0, next7: 2 });
		expect(stats.activity.sessions).toEqual({
			last7: 2,
			last30: 2,
			total: 2,
		});
		expect(stats.activity.activeDays30).toBe(2);
		expect(stats.activity.streak).toBe(1);
		expect(stats.activity.practiceMs30).toBe(8000);
		expect(stats.words.mostPracticed[0]).toMatchObject({
			word: "banana",
			practiced: 3,
			judged: 2,
		});
		expect(stats.words.weak[0]).toMatchObject({
			word: "banana",
			wrong30: 2,
		});
		expect(stats.recentSessions).toHaveLength(2);
		// judged = 本场日志条数（得分分母）；书写场次没有判定 → 0
		expect(stats.recentSessions[0]).toMatchObject({
			judged: 3,
			wordCount: 2,
			correct: 1,
		});
		expect(stats.recentSessions[1]).toMatchObject({
			judged: 0,
			wordCount: 2,
			correct: null,
		});
		expect(stats.meta.heatmapDays).toBe(90);
		expect(stats.meta.statsSince).toBe(
			new Date(
				NOW.getFullYear(),
				NOW.getMonth(),
				NOW.getDate() - 2,
				18,
			).getTime(),
		);
		expect(stats.accuracy.last30).toMatchObject({ correct: 1, total: 3 });
	});

	it("词库不存在返回 null", () => {
		const { bankStore, reviewStore } = tempStores();
		expect(
			buildBankStats({ bankStore, reviewStore, bankId: "nope", now: NOW }),
		).toBeNull();
	});

	it("兼容模式（stats=null）抛出可识别错误，路由据此 503", () => {
		const { bankStore, reviewStore } = tempStores(true);
		bankStore.write(makeBank("b1", ["apple"]));
		expect(reviewStore.mode).toBe("legacy");
		expect(() =>
			buildBankStats({ bankStore, reviewStore, bankId: "b1", now: NOW }),
		).toThrow(/统计不可用/);
	});

	it("空库也能返回零值档案", () => {
		const { bankStore, reviewStore } = tempStores();
		bankStore.write(makeBank("b1", ["apple", "banana"]));
		const stats = buildBankStats({
			bankStore,
			reviewStore,
			bankId: "b1",
			now: NOW,
		});
		expect(stats?.coverage).toMatchObject({
			total: 2,
			started: 0,
			unstarted: 2,
		});
		expect(stats?.activity.sessionsAvailable).toBe(false);
		expect(stats?.activity.heatmap.at(-1)?.date).toBe(localDateKey(NOW));
		expect(stats?.words.weak).toEqual([]);
	});
});
