import { afterEach, describe, expect, it } from "vitest";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localDateKey } from "./day";
import { createReviewStore, loadSqliteModule, parseLogRecord } from "./review-store";
import { createLegacyReviewStore } from "./review-store-legacy";
import { createSqliteReviewStore } from "./review-store-sqlite";
import {
	parseSessionRecord,
	sessionToJson,
	type ReviewLogRecord,
	type ReviewStore,
	type SessionLogRecord,
	type StoredCard,
} from "./review-types";

const dirs: string[] = [];
const stores: ReviewStore[] = [];

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "mds-review-"));
	dirs.push(dir);
	return dir;
}

function openStore(dir: string): ReviewStore {
	const store = createReviewStore(dir);
	stores.push(store);
	return store;
}

function openLegacy(dir: string): ReviewStore {
	const store = createLegacyReviewStore(dir);
	stores.push(store);
	return store;
}

afterEach(() => {
	for (const store of stores.splice(0)) {
		try {
			store.close();
		} catch {
			// 清理阶段忽略
		}
	}
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const NOW = new Date(2026, 9, 12, 10, 0, 0);
const AT = NOW.getTime();
const TODAY = localDateKey(NOW);

function makeCard(overrides: Partial<StoredCard> = {}): StoredCard {
	return {
		due: new Date(AT + 3 * 24 * 60 * 60 * 1000).toISOString(),
		stability: 3.2,
		difficulty: 5.1,
		elapsed_days: 0,
		scheduled_days: 3,
		learning_steps: 0,
		reps: 1,
		lapses: 0,
		state: 1,
		...overrides,
	};
}

function makeLog(overrides: Partial<ReviewLogRecord> = {}): ReviewLogRecord {
	return {
		at: AT,
		word: "apple",
		bankId: "cet4",
		rating: 3,
		correct: true,
		mode: "definition",
		genMode: "cyber",
		elapsedMs: 4200,
		queueKind: "review",
		stateBefore: 2,
		intervalBeforeDays: 3,
		intervalAfterDays: 7,
		stabilityAfter: 7.4,
		difficultyAfter: 5.1,
		...overrides,
	};
}

function makeSession(overrides: Partial<SessionLogRecord> = {}): SessionLogRecord {
	return {
		id: "session-1",
		at: AT,
		bankId: "cet4",
		genMode: "cyber",
		contentMode: "definition",
		words: ["apple", "banana"],
		correct: 1,
		activeMs: 4200,
		wallMs: 9000,
		...overrides,
	};
}

describe("SQLite store", () => {
	it("一场结算原子写入卡片、日志、场次，并能读回", () => {
		const store = openStore(tempDir());
		expect(store.mode).toBe("sqlite");
		const session = makeSession();
		const log = { ...makeLog(), sessionId: session.id };
		const result = store.commit("cet4", {
			cards: [{ key: "apple", card: makeCard() }],
			logs: [log],
			session,
		});
		expect(result.duplicate).toBe(false);

		const cards = store.readCards("cet4");
		expect(cards.apple).toMatchObject({
			stability: 3.2,
			difficulty: 5.1,
			scheduled_days: 3,
			state: 1,
		});
		expect(cards.apple.due).toBe(makeCard().due);

		const logs = store.readLogs("cet4");
		expect(logs).toHaveLength(1);
		expect(logs[0]).toMatchObject({
			word: "apple",
			sessionId: session.id,
			mode: "definition",
			correct: true,
		});

		const sessions = store.readSessions("cet4");
		expect(sessions).toHaveLength(1);
		expect(sessions[0]).toMatchObject({
			id: session.id,
			genMode: "cyber",
			contentMode: "definition",
			correct: 1,
			words: ["apple", "banana"],
		});

		expect(store.readDayStats("cet4", TODAY)).toEqual({
			date: TODAY,
			words: 2,
			correct: 1,
			total: 1,
			elapsedMs: 4200,
		});
	});

	it("同一 session.id 重放不重复写卡片/日志/场次", () => {
		const store = openStore(tempDir());
		const session = makeSession();
		store.commit("cet4", {
			cards: [{ key: "apple", card: makeCard() }],
			logs: [{ ...makeLog(), sessionId: session.id }],
			session,
		});
		const second = store.commit("cet4", {
			cards: [{ key: "banana", card: makeCard() }],
			logs: [{ ...makeLog({ word: "banana" }), sessionId: session.id }],
			session,
		});
		expect(second.duplicate).toBe(true);
		expect(Object.keys(store.readCards("cet4"))).toEqual(["apple"]);
		expect(store.readLogs("cet4")).toHaveLength(1);
		expect(store.readSessions("cet4")).toHaveLength(1);
	});

	it("场次与日志可以分开写：书写场次 items 为空也保留使用记录", () => {
		const store = openStore(tempDir());
		const session = makeSession({
			id: "writing-1",
			genMode: "writing",
			contentMode: "word",
			correct: null,
			words: ["apple"],
		});
		store.commit("cet4", { cards: [], logs: [], session });
		expect(store.readCards("cet4")).toEqual({});
		expect(store.readLogs("cet4")).toEqual([]);
		expect(store.readSessions("cet4")[0]).toMatchObject({
			id: "writing-1",
			genMode: "writing",
			correct: null,
			words: ["apple"],
		});
	});

	it("删库清除卡片、日志、场次与 session_word", () => {
		const store = openStore(tempDir());
		const session = makeSession();
		store.commit("cet4", {
			cards: [{ key: "apple", card: makeCard() }],
			logs: [makeLog()],
			session,
		});
		store.removeBankState("cet4");
		expect(store.readCards("cet4")).toEqual({});
		expect(store.readLogs("cet4")).toEqual([]);
		expect(store.readSessions("cet4")).toEqual([]);
		expect(store.readDayStats("cet4", TODAY).total).toBe(0);
		expect(store.stats?.writingWords("cet4")).toEqual([]);
	});

	it("空日返回 0；非法词库 id 抛错", () => {
		const store = openStore(tempDir());
		expect(store.readDayStats("cet4", TODAY)).toEqual({
			date: TODAY,
			words: 0,
			correct: 0,
			total: 0,
			elapsedMs: 0,
		});
		expect(() => store.readCards("../evil")).toThrow();
		expect(() => store.commit("A1", { cards: [], logs: [], session: null })).toThrow();
	});

	it("重复 id 的 session_word 在库内去重", () => {
		const store = openStore(tempDir());
		const session = makeSession({ words: ["apple", "Apple", "banana"] });
		store.commit("cet4", { cards: [], logs: [], session });
		expect(store.readSessions("cet4")[0].words).toEqual(["apple", "banana"]);
	});
});

describe("兼容模式 store", () => {
	it("commit 写 JSON/JSONL，读回形状与 SQLite 一致", () => {
		const dir = tempDir();
		const store = openLegacy(dir);
		expect(store.mode).toBe("legacy");
		expect(store.stats).toBeNull();
		const session = makeSession();
		store.commit("cet4", {
			cards: [{ key: "apple", card: makeCard() }],
			logs: [{ ...makeLog(), sessionId: session.id }],
			session,
		});
		expect(store.readCards("cet4").apple).toMatchObject({ state: 1 });
		expect(store.readLogs("cet4")[0].sessionId).toBe(session.id);
		expect(store.readSessions("cet4")[0].words).toEqual(["apple", "banana"]);
		expect(store.readDayStats("cet4", TODAY)).toMatchObject({
			words: 2,
			correct: 1,
			total: 1,
			elapsedMs: 4200,
		});
		expect(existsSync(join(dir, "cet4.sessions.jsonl"))).toBe(true);
	});

	it("同一 session.id 重放不重复追加", () => {
		const store = openLegacy(tempDir());
		const session = makeSession();
		store.commit("cet4", { cards: [], logs: [makeLog()], session });
		const second = store.commit("cet4", {
			cards: [],
			logs: [makeLog({ word: "banana" })],
			session,
		});
		expect(second.duplicate).toBe(true);
		expect(store.readLogs("cet4")).toHaveLength(1);
		expect(store.readSessions("cet4")).toHaveLength(1);
	});
});

describe("旧数据迁移", () => {
	function writeLegacy(dir: string): void {
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, "cet4.cards.json"),
			JSON.stringify({
				version: 1,
				cards: { apple: makeCard(), broken: { due: "x" } },
			}),
		);
		writeFileSync(
			join(dir, "cet4.log.jsonl"),
			[
				JSON.stringify(makeLog()),
				"{ broken",
				JSON.stringify(makeLog({ word: "banana", correct: false, rating: 1 })),
			].join("\n"),
		);
		writeFileSync(
			join(dir, "cet4.sessions.jsonl"),
			[
				JSON.stringify({
					id: "legacy-session",
					at: AT,
					bankId: "cet4",
					genMode: "writing",
					contentMode: "word",
					words: ["apple"],
					correct: null,
					activeMs: 2000,
					wallMs: 3000,
				}),
			].join("\n"),
		);
		writeFileSync(join(dir, "daily.json"), "{\"version\":1,\"days\":{}}");
	}

	it("导入 cards/logs/sessions、归档旧文件、忽略 daily、二次打开不重复导入", () => {
		const dir = tempDir();
		writeLegacy(dir);
		const store = openStore(dir);
		expect(store.mode).toBe("sqlite");
		expect(Object.keys(store.readCards("cet4"))).toEqual(["apple"]);
		expect(store.readLogs("cet4")).toHaveLength(2);
		const sessions = store.readSessions("cet4");
		expect(sessions).toHaveLength(1);
		expect(sessions[0].words).toEqual(["apple"]);
		expect(store.readDayStats("cet4", TODAY)).toMatchObject({
			words: 1,
			correct: 1,
			total: 2,
			elapsedMs: 8400,
		});

		expect(existsSync(join(dir, "review.sqlite"))).toBe(true);
		expect(existsSync(join(dir, "cet4.cards.json"))).toBe(false);
		expect(existsSync(join(dir, "daily.json"))).toBe(false);
		const archive = join(dir, "migrated-v1");
		expect(existsSync(join(archive, "cet4.cards.json"))).toBe(true);
		expect(existsSync(join(archive, "cet4.log.jsonl"))).toBe(true);
		expect(existsSync(join(archive, "cet4.sessions.jsonl"))).toBe(true);
		expect(existsSync(join(archive, "daily.json"))).toBe(true);
		expect(readFileSync(join(dir, "migration.log"), "utf8")).toContain(
			"migration-ok",
		);

		// 二次打开：DB 已在，旧文件已归档，计数保持
		store.close();
		const reopened = openStore(dir);
		expect(reopened.mode).toBe("sqlite");
		expect(reopened.readLogs("cet4")).toHaveLength(2);
		expect(reopened.readCards("cet4").apple).toBeTruthy();
	});

	it("迁移失败时保留旧文件并回退兼容模式", () => {
		const dir = tempDir();
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "review.sqlite"), "not a sqlite database");
		writeFileSync(join(dir, "cet4.log.jsonl"), JSON.stringify(makeLog()));
		const store = openStore(dir);
		expect(store.mode).toBe("legacy");
		expect(store.readLogs("cet4")).toHaveLength(1);
		expect(existsSync(join(dir, "cet4.log.jsonl"))).toBe(true);
		expect(readFileSync(join(dir, "migration.log"), "utf8")).toContain(
			"open-failed",
		);
	});

	it("没有旧文件时创建空库", () => {
		const dir = tempDir();
		const store = openStore(dir);
		expect(store.mode).toBe("sqlite");
		expect(store.readCards("cet4")).toEqual({});
		expect(existsSync(join(dir, "review.sqlite"))).toBe(true);
	});
});

describe("parseLogRecord", () => {
	it("缺必填字段时丢弃", () => {
		expect(parseLogRecord(null)).toBeNull();
		expect(parseLogRecord([])).toBeNull();
		expect(parseLogRecord({ word: "apple" })).toBeNull();
		expect(parseLogRecord({ ...makeLog(), at: "yesterday" })).toBeNull();
		expect(parseLogRecord({ ...makeLog(), word: "  " })).toBeNull();
		expect(parseLogRecord({ ...makeLog(), correct: "yes" })).toBeNull();
	});

	it("可选字段缺失时补安全默认值（兼容将来字段更多的旧记录）", () => {
		const parsed = parseLogRecord({
			at: 1,
			word: "apple",
			bankId: "cet4",
			rating: 3,
			correct: true,
		});
		expect(parsed).toEqual({
			at: 1,
			word: "apple",
			bankId: "cet4",
			rating: 3,
			correct: true,
			mode: "word",
			genMode: "cyber",
			elapsedMs: 0,
			queueKind: "review",
			stateBefore: 0,
			intervalBeforeDays: 0,
			intervalAfterDays: 0,
			stabilityAfter: 0,
			difficultyAfter: 0,
		});
	});

	it("越界 rating 夹到 1–4；认识的 mode/queueKind 保留；sessionId 只留非空", () => {
		expect(parseLogRecord({ ...makeLog(), rating: 99 })?.rating).toBe(4);
		expect(parseLogRecord({ ...makeLog(), rating: -1 })?.rating).toBe(1);
		expect(parseLogRecord({ ...makeLog(), mode: "cloze" })?.mode).toBe("cloze");
		expect(parseLogRecord({ ...makeLog(), mode: "nope" })?.mode).toBe("word");
		expect(parseLogRecord({ ...makeLog(), queueKind: "new" })?.queueKind).toBe("new");
		expect(parseLogRecord({ ...makeLog(), queueKind: "nope" })?.queueKind).toBe("review");
		expect(parseLogRecord({ ...makeLog(), sessionId: "s1" })?.sessionId).toBe("s1");
		expect(parseLogRecord({ ...makeLog(), sessionId: "  " })?.sessionId).toBeUndefined();
	});
});

describe("parseSessionRecord", () => {
	it("id 缺失丢弃；bankId 可按文件覆盖", () => {
		expect(parseSessionRecord({ ...makeSession(), id: "" })).toBeNull();
		expect(parseSessionRecord(sessionToJson(makeSession()), "other")?.bankId).toBe(
			"other",
		);
	});

	it("书写场次 correct 强制 null；words 去重限长；wallMs 不小于 activeMs", () => {
		const parsed = parseSessionRecord({
			...makeSession(),
			genMode: "writing",
			correct: 99,
			words: ["apple", "Apple", " banana ", "  "],
			activeMs: 5000,
			wallMs: 1000,
		});
		expect(parsed).toMatchObject({
			correct: null,
			words: ["apple", "banana"],
			activeMs: 5000,
			wallMs: 5000,
		});
	});

	it("赛博场次 correct 夹到词数范围", () => {
		expect(
			parseSessionRecord({ ...makeSession(), correct: 99, words: ["a", "b"] })
				?.correct,
		).toBe(2);
		expect(
			parseSessionRecord({ ...makeSession(), correct: -3, words: ["a", "b"] })
				?.correct,
		).toBe(0);
	});
});

describe("SQLite 模块可用性", () => {
	it("当前 Node/Electron 运行时能拿到 node:sqlite", () => {
		expect(loadSqliteModule()).not.toBeNull();
		const dir = tempDir();
		const sqlite = loadSqliteModule();
		if (!sqlite) return;
		const store = createSqliteReviewStore(join(dir, "review.sqlite"), sqlite);
		stores.push(store);
		expect(store.mode).toBe("sqlite");
	});
});
