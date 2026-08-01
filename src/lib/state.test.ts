import { describe, it, expect } from "vitest";
import {
	createState,
	canAdvance,
	isLastRound,
	isAllCorrect,
	type Round,
} from "./state";

function round(overrides: Partial<Round> = {}): Round {
	return {
		word: "apple",
		repeatCount: 2,
		durationSec: 10,
		countdownDone: false,
		speechDone: false,
		...overrides,
	};
}

describe("createState", () => {
	it("洗牌并初始化", () => {
		const s = createState(["a", "b", "c"], "cyber", false, (l) =>
			[...l].reverse(),
		);
		expect(s.words).toEqual(["c", "b", "a"]);
		expect(s.phase).toBe("idle");
		expect(s.mode).toBe("cyber");
		expect(s.currentIndex).toBe(0);
	});
});

describe("canAdvance", () => {
	it("两个标记都完成才能跳转", () => {
		expect(canAdvance(round())).toBe(false);
		expect(canAdvance(round({ countdownDone: true }))).toBe(false);
		expect(canAdvance(round({ speechDone: true }))).toBe(false);
		expect(canAdvance(round({ countdownDone: true, speechDone: true }))).toBe(
			true,
		);
	});
});

describe("isLastRound", () => {
	it("最后一轮判定", () => {
		const s = createState(["a", "b"], "writing", false, (l) => l);
		s.rounds = [round(), round()];
		s.currentIndex = 1;
		expect(isLastRound(s)).toBe(true);
		s.currentIndex = 0;
		expect(isLastRound(s)).toBe(false);
	});
});

describe("isAllCorrect", () => {
	it("书写模式不判定", () => {
		const s = createState(["a"], "writing", false, (l) => l);
		s.rounds = [round()];
		expect(isAllCorrect(s)).toBe(false);
	});
	it("赛博模式全对判定", () => {
		const s = createState(["apple"], "cyber", false, (l) => l);
		s.rounds = [round({ word: "apple", answer: "apple" })];
		expect(isAllCorrect(s)).toBe(true);
	});
	it("有空答案不算全对", () => {
		const s = createState(["apple"], "cyber", false, (l) => l);
		s.rounds = [round({ word: "apple", answer: undefined })];
		expect(isAllCorrect(s)).toBe(false);
	});
});

describe("state 边界用例", () => {
	it("空单词列表", () => {
		const s = createState([], "writing", false, (l) => l);
		expect(s.words).toEqual([]);
		expect(s.rounds).toEqual([]);
	});
	it("shuffle 不修改原数组", () => {
		const orig = ["a", "b", "c"];
		const s = createState(orig, "writing", false, (l) => [...l].reverse());
		expect(orig).toEqual(["a", "b", "c"]); // 原数组不变
		expect(s.words).toEqual(["c", "b", "a"]);
	});
	it("单元素 shuffle", () => {
		const s = createState(["only"], "writing", false, (l) => l);
		expect(s.words).toEqual(["only"]);
	});
	it("isLastRound 空 rounds 边界", () => {
		const s = createState([], "writing", false, (l) => l);
		expect(isLastRound(s)).toBe(true); // 0 >= -1
	});
	it("canAdvance 未定义轮防御（不会 crash）", () => {
		expect(canAdvance({} as Round)).toBe(false); // undefined && undefined = false
	});
	it("isAllCorrect 赛博模式缺答案轮 → 非全对", () => {
		const s = createState(["a", "b"], "cyber", false, (l) => l);
		s.rounds = [
			{
				word: "a",
				repeatCount: 2,
				durationSec: 5,
				countdownDone: true,
				speechDone: true,
				answer: "a",
			},
			{
				word: "b",
				repeatCount: 2,
				durationSec: 5,
				countdownDone: true,
				speechDone: true,
			},
		];
		expect(isAllCorrect(s)).toBe(false);
	});
	it("isAllCorrect 赛博模式答案严格匹配（大小写敏感）", () => {
		const s = createState(["a"], "cyber", false, (l) => l);
		s.rounds = [
			{
				word: "Apple",
				repeatCount: 2,
				durationSec: 5,
				countdownDone: true,
				speechDone: true,
				answer: "apple",
			},
		];
		expect(isAllCorrect(s)).toBe(false);
	});
});
