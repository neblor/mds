import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createReviewStore,
	parseLogRecord,
	type DailyStat,
	type ReviewLogRecord,
} from "./review-store";

const dirs: string[] = [];

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "mds-review-"));
	dirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeLog(overrides: Partial<ReviewLogRecord> = {}): ReviewLogRecord {
	return {
		at: 1_700_000_000_000,
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

describe("卡片状态", () => {
	it("写入后读回同一形状", () => {
		const store = createReviewStore(tempDir());
		store.writeCards("cet4", {
			apple: { due: "2026-10-15T00:00:00.000Z", stability: 3.2, state: 1 },
		});
		expect(store.readCards("cet4")).toEqual({
			apple: { due: "2026-10-15T00:00:00.000Z", stability: 3.2, state: 1 },
		});
	});

	it("文件缺失返回空对象；损坏文件返回空对象而不是抛错", () => {
		const dir = tempDir();
		const store = createReviewStore(dir);
		expect(store.readCards("cet4")).toEqual({});
		writeFileSync(join(dir, "cet4.cards.json"), "{ broken");
		expect(store.readCards("cet4")).toEqual({});
	});

	it("非对象条目被跳过，其余照常读出", () => {
		const dir = tempDir();
		const store = createReviewStore(dir);
		writeFileSync(
			join(dir, "cet4.cards.json"),
			JSON.stringify({
				version: 1,
				cards: { apple: { due: "x" }, bad: 42, worse: ["no"], ok: { due: "y" } },
			}),
		);
		expect(store.readCards("cet4")).toEqual({
			apple: { due: "x" },
			ok: { due: "y" },
		});
	});

	it("非法词库 id 抛错（防路径穿越）", () => {
		const store = createReviewStore(tempDir());
		expect(() => store.readCards("../evil")).toThrow();
		expect(() => store.writeCards("A1", {})).toThrow();
	});
});

describe("复习日志", () => {
	it("追加写入并按行读回（append-only，不覆盖历史）", () => {
		const dir = tempDir();
		const store = createReviewStore(dir);
		store.appendLogs("cet4", [makeLog()]);
		store.appendLogs("cet4", [makeLog({ word: "banana", rating: 1, correct: false })]);
		const logs = store.readLogs("cet4");
		expect(logs.map((log) => log.word)).toEqual(["apple", "banana"]);
		expect(logs[1].rating).toBe(1);
		expect(readFileSync(join(dir, "cet4.log.jsonl"), "utf8").trim().split("\n")).toHaveLength(2);
	});

	it("坏行跳过，不影响同一文件里的其它记录", () => {
		const dir = tempDir();
		const store = createReviewStore(dir);
		store.appendLogs("cet4", [makeLog()]);
		writeFileSync(
			join(dir, "cet4.log.jsonl"),
			`${readFileSync(join(dir, "cet4.log.jsonl"), "utf8")}{ broken\n`,
		);
		expect(store.readLogs("cet4")).toHaveLength(1);
	});

	it("没有日志时返回空数组", () => {
		expect(createReviewStore(tempDir()).readLogs("cet4")).toEqual([]);
	});

	it("空数组不写文件", () => {
		const dir = tempDir();
		createReviewStore(dir).appendLogs("cet4", []);
		expect(() => readFileSync(join(dir, "cet4.log.jsonl"), "utf8")).toThrow();
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

	it("越界的 rating 被夹到 1–4，认识的 mode/queueKind 保留", () => {
		expect(parseLogRecord({ ...makeLog(), rating: 99 })?.rating).toBe(4);
		expect(parseLogRecord({ ...makeLog(), rating: -1 })?.rating).toBe(1);
		expect(parseLogRecord({ ...makeLog(), mode: "cloze" })?.mode).toBe("cloze");
		expect(parseLogRecord({ ...makeLog(), mode: "nope" })?.mode).toBe("word");
		expect(parseLogRecord({ ...makeLog(), queueKind: "new" })?.queueKind).toBe("new");
		expect(parseLogRecord({ ...makeLog(), queueKind: "nope" })?.queueKind).toBe("review");
	});
});

describe("每日汇总", () => {
	const stat: DailyStat = {
		date: "2026-10-12",
		target: 20,
		done: 8,
		correct: 6,
		total: 8,
		elapsedMs: 90_000,
	};

	it("写入后读回", () => {
		const store = createReviewStore(tempDir());
		store.writeDaily({ "2026-10-12": stat });
		expect(store.readDaily()).toEqual({ "2026-10-12": stat });
	});

	it("坏日期与坏字段被丢弃，其余保留", () => {
		const dir = tempDir();
		const store = createReviewStore(dir);
		writeFileSync(
			join(dir, "daily.json"),
			JSON.stringify({
				version: 1,
				days: {
					"2026-10-12": stat,
					"not-a-date": stat,
					"2026-10-13": { date: "2026-10-13", target: "x" },
				},
			}),
		);
		expect(Object.keys(store.readDaily())).toEqual(["2026-10-12"]);
	});

	it("文件缺失或损坏时返回空对象", () => {
		const dir = tempDir();
		const store = createReviewStore(dir);
		expect(store.readDaily()).toEqual({});
		writeFileSync(join(dir, "daily.json"), "nope");
		expect(store.readDaily()).toEqual({});
	});
});
