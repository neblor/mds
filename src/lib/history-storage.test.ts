import { afterEach, describe, expect, it, vi } from "vitest";
import {
	appendHistory,
	buildHistoryEntry,
	HISTORY_MAX,
	HISTORY_STORAGE_KEY,
	loadHistory,
	normalizeHistory,
	type HistoryEntry,
} from "./history-storage";
import { buildResultRows, type ResultRow } from "./results";
import type { ContentMode } from "./state";

function cyberRows(
	answers: { word: string; answer: string; definition?: string; answerDef?: string }[],
	contentMode: ContentMode = "word",
): ResultRow[] {
	return buildResultRows(
		answers.map((a) => ({
			word: a.word,
			audioName: `${a.word}.mp3`,
			definition: a.definition,
			answer: a.answer,
			answerDef: a.answerDef,
		})),
		"cyber",
		contentMode,
	);
}

function entry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
	const rows = overrides.rows ?? cyberRows([{ word: "apple", answer: "apple" }]);
	return {
		id: "1000",
		finishedAt: 1000,
		mode: "cyber",
		contentMode: "word",
		correctCount: 1,
		wordCount: 1,
		gradeNote: null,
		rows,
		...overrides,
	};
}

afterEach(() => vi.unstubAllGlobals());

describe("normalizeHistory 校验", () => {
	it("非数组输入返回空列表", () => {
		expect(normalizeHistory(undefined)).toEqual([]);
		expect(normalizeHistory({})).toEqual([]);
		expect(normalizeHistory("broken")).toEqual([]);
	});

	it("丢弃损坏条目，保留有效条目", () => {
		const list = normalizeHistory([
			entry(), // 有效
			{ finishedAt: 2000, contentMode: "word", rows: [] }, // 无有效行
			{ finishedAt: "x", contentMode: "word", rows: [{}] }, // 时间非数字
			{ finishedAt: 3000, contentMode: "hacker", rows: [{}] }, // 模式非法
			{ finishedAt: 4000 }, // 缺 rows
			null, // 非对象
		]);
		expect(list).toHaveLength(1);
		expect(list[0].finishedAt).toBe(1000);
	});

	it("老数据无 mode 字段兼容为 cyber；书写条目保留 writing 并计 0 分", () => {
		const legacy = { finishedAt: 1000, contentMode: "word", rows: cyberRows([{ word: "apple", answer: "apple" }]) };
		const [legacyEntry] = normalizeHistory([legacy]);
		expect(legacyEntry.mode).toBe("cyber");

		const writingRows = [
			{ word: "apple", audioName: "apple.mp3", fields: [] as never[] },
		];
		const [writingEntry] = normalizeHistory([
			{ finishedAt: 2000, mode: "writing", contentMode: "word", rows: writingRows },
		]);
		expect(writingEntry.mode).toBe("writing");
		expect(writingEntry.wordCount).toBe(1);
		expect(writingEntry.correctCount).toBe(0);
	});

	it("重算计数与汇总，不信任存储值", () => {
		const rows = cyberRows([
			{ word: "apple", answer: "apple" },
			{ word: "banana", answer: "banan" },
		]);
		const [e] = normalizeHistory([
			{ ...entry(), rows, correctCount: 999, wordCount: 999, gradeNote: 42 },
		]);
		expect(e.correctCount).toBe(1);
		expect(e.wordCount).toBe(2);
		expect(e.gradeNote).toBeNull();
	});

	it("行内损坏字段被剔除、audioName 缺失容忍、无有效字段的行保留单词", () => {
		const [e] = normalizeHistory([
			{
				finishedAt: 1000,
				contentMode: "definition",
				rows: [
					{
						word: "apple",
						audioName: 123,
						fields: [
							{ kind: "word", expected: "apple", graded: true, correct: true },
							{ kind: "evil", expected: "x", graded: true },
							{ kind: "word", graded: true, correct: false },
						],
					},
				],
			},
		]);
		expect(e.rows[0].word).toBe("apple");
		expect(e.rows[0].audioName).toBe("");
		expect(e.rows[0].fields).toEqual([
			{ kind: "word", expected: "apple", graded: true, correct: true },
		]);
		expect(e.correctCount).toBe(1); // 剩余判定字段全对
	});

	it("按时间倒序并截断至上限", () => {
		const many = Array.from({ length: 8 }, (_, i) =>
			entry({ id: `${i}`, finishedAt: 1000 + i }),
		);
		const list = normalizeHistory(many);
		expect(list).toHaveLength(HISTORY_MAX);
		expect(list.map((e) => e.finishedAt)).toEqual([1007, 1006, 1005, 1004, 1003]);
	});

	it("组句条目：接受 contentMode=cloze，并保留句子上下文", () => {
		const [e] = normalizeHistory([
			{
				finishedAt: 2000,
				mode: "cyber",
				contentMode: "cloze",
				rows: [
					{
						word: "apple",
						audioName: "apple.mp3",
						context: "I like to eat apple after lunch.",
						fields: [
							{
								kind: "word",
								expected: "apple",
								userValue: "apple",
								graded: true,
								correct: true,
							},
						],
					},
				],
			},
		]);
		expect(e.contentMode).toBe("cloze");
		expect(e.rows[0].context).toBe("I like to eat apple after lunch.");
		expect(e.correctCount).toBe(1);
	});

	it("context 非字符串时丢弃，不影响其余字段", () => {
		const [e] = normalizeHistory([
			{
				finishedAt: 3000,
				contentMode: "cloze",
				rows: [
					{
						word: "apple",
						context: 42,
						fields: [
							{ kind: "word", expected: "apple", graded: true, correct: true },
						],
					},
				],
			},
		]);
		expect(e.rows[0].context).toBeUndefined();
	});
});

describe("loadHistory / appendHistory", () => {
	it("读取有效历史；损坏 JSON 返回空列表", () => {
		const getItem = vi.fn().mockReturnValue(JSON.stringify([entry()]));
		vi.stubGlobal("localStorage", { getItem, setItem: vi.fn() });
		const list = loadHistory();
		expect(list).toHaveLength(1);
		expect(list[0].rows[0].word).toBe("apple");

		getItem.mockReturnValue("{broken");
		expect(loadHistory()).toEqual([]);
		getItem.mockReturnValue(null);
		expect(loadHistory()).toEqual([]);
	});

	it("localStorage 不可用（SSR）时安全返回空", () => {
		expect(loadHistory()).toEqual([]);
		expect(() => appendHistory(entry())).not.toThrow();
	});

	it("新纪录置顶、持久化并截断至 5 条", () => {
		const store = new Map<string, string>();
		vi.stubGlobal("localStorage", {
			getItem: (k: string) => store.get(k) ?? null,
			setItem: (k: string, v: string) => void store.set(k, v),
		});
		for (let i = 0; i < 7; i++) {
			appendHistory(entry({ id: `${i}`, finishedAt: 2000 + i }));
		}
		const saved = JSON.parse(store.get(HISTORY_STORAGE_KEY) ?? "[]");
		expect(saved).toHaveLength(HISTORY_MAX);
		expect(saved.map((e: HistoryEntry) => e.finishedAt)).toEqual([
			2006, 2005, 2004, 2003, 2002,
		]);
	});

	it("写入失败不影响业务", () => {
		vi.stubGlobal("localStorage", {
			getItem: vi.fn().mockReturnValue(null),
			setItem: vi.fn(() => {
				throw new Error("quota");
			}),
		});
		expect(() => appendHistory(entry())).not.toThrow();
	});
});

describe("buildHistoryEntry", () => {
	it("汇总正确数与词数，透传批改说明，id 取完成时间", () => {
		const rows = cyberRows(
			[
				{ word: "apple", answer: "apple" },
				{ word: "banana", answer: "banan" },
			],
			"definition",
		);
		const e = buildHistoryEntry({
			rows,
			mode: "cyber",
			contentMode: "definition",
			finishedAt: 1724250000000,
			gradeNote: "AI 批改失败，已改用本地匹配判定",
		});
		expect(e).toMatchObject({
			id: "1724250000000",
			finishedAt: 1724250000000,
			mode: "cyber",
			contentMode: "definition",
			correctCount: 1,
			wordCount: 2,
			gradeNote: "AI 批改失败，已改用本地匹配判定",
		});
		// 判定已烘入行内（回看不依赖现场状态）
		expect(e.rows[0].fields[0].correct).toBe(true);
		expect(e.rows[1].fields[0].correct).toBe(false);
	});
});
