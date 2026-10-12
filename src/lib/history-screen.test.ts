import { describe, expect, it } from "vitest";
import type { HistoryEntry } from "./history-storage";
import {
	HISTORY_PREVIEW_MAX,
	canRetryHistory,
	extractHistoryWords,
	normalizeRetryWords,
	planRetry,
} from "./history-screen";

function entry(words: string[]): Pick<HistoryEntry, "rows"> {
	return {
		rows: words.map((word) => ({
			word,
			audioName: "",
			fields: [{ kind: "word" as const, expected: word, graded: true }],
		})),
	};
}

describe("normalizeRetryWords", () => {
	it("trim、丢空并按顺序去重", () => {
		expect(
			normalizeRetryWords([" apple ", "", "apple", "banana", "  ", "banana"]),
		).toEqual(["apple", "banana"]);
	});

	it("全空输入返回空数组", () => {
		expect(normalizeRetryWords(["", "   "])).toEqual([]);
	});
});

describe("extractHistoryWords / canRetryHistory", () => {
	it("由 rows 提取词表并规整", () => {
		expect(extractHistoryWords(entry([" apple ", "banana", "apple"]))).toEqual([
			"apple",
			"banana",
		]);
	});

	it("无可提取词的老数据条目不可再次默写", () => {
		expect(canRetryHistory(entry([]))).toBe(false);
		expect(canRetryHistory(entry(["", "  "]))).toBe(false);
		expect(canRetryHistory(entry(["apple"]))).toBe(true);
	});
});

describe("planRetry", () => {
	it("覆盖前暂存当前非空词表", () => {
		const plan = planRetry({ currentWords: ["x", "y"], historyWords: ["a"] });
		expect(plan.nextWords).toEqual(["a"]);
		expect(plan.stashed).toEqual(["x", "y"]);
	});

	it("当前词表为空时不产生暂存", () => {
		const plan = planRetry({ currentWords: [], historyWords: ["a"] });
		expect(plan.nextWords).toEqual(["a"]);
		expect(plan.stashed).toBeNull();
	});

	it("历史词规整（trim/去重），保持顺序", () => {
		const plan = planRetry({
			currentWords: ["x"],
			historyWords: [" a ", "a", "b"],
		});
		expect(plan.nextWords).toEqual(["a", "b"]);
	});
});

describe("HISTORY_PREVIEW_MAX", () => {
	it("预览上限为不 太少的合理值", () => {
		expect(HISTORY_PREVIEW_MAX).toBeGreaterThanOrEqual(12);
	});
});
