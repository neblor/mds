import { describe, it, expect } from "vitest";
import { isStrictMatch, isAllCorrect } from "./match";

describe("isStrictMatch", () => {
	it("完全一致算对", () => {
		expect(isStrictMatch("apple", "apple")).toBe(true);
		expect(isStrictMatch("give up", "give up")).toBe(true);
	});
	it("大小写不同算错", () => {
		expect(isStrictMatch("Hello", "hello")).toBe(false);
		expect(isStrictMatch("Umbrella", "umbrella")).toBe(false);
	});
	it("标点不同算错", () => {
		expect(isStrictMatch("don't", "dont")).toBe(false);
		expect(isStrictMatch("hello!", "hello")).toBe(false);
	});
	it("中间空格不同算错", () => {
		expect(isStrictMatch("giveup", "give up")).toBe(false);
		expect(isStrictMatch("give  up", "give up")).toBe(false);
	});
	it("首尾空白容忍（输入卫生）", () => {
		expect(isStrictMatch("  apple ", "apple")).toBe(true);
	});
});

describe("isAllCorrect", () => {
	it("全对", () => {
		expect(isAllCorrect([{ correct: true }, { correct: true }])).toBe(true);
	});
	it("有空列表不算全对", () => {
		expect(isAllCorrect([])).toBe(false);
	});
	it("有错不算全对", () => {
		expect(isAllCorrect([{ correct: true }, { correct: false }])).toBe(false);
	});
});

describe("match 边界用例", () => {
	it("全空白输入 vs 单词 → 错", () => {
		expect(isStrictMatch("   ", "apple")).toBe(false);
		expect(isStrictMatch("", "apple")).toBe(false);
	});
	it("expected 为空串", () => {
		expect(isStrictMatch("", "")).toBe(true);
		expect(isStrictMatch("a", "")).toBe(false);
	});
	it("换行/制表符 trim 后匹配", () => {
		expect(isStrictMatch("apple\n", "apple")).toBe(true);
		expect(isStrictMatch("\tapple", "apple")).toBe(true);
	});
	it("全角字符不归一（严格）", () => {
		expect(isStrictMatch("ａｐｐｌｅ", "apple")).toBe(false);
	});
	it("大小写混写", () => {
		expect(isStrictMatch("Apple", "apple")).toBe(false);
		expect(isStrictMatch("APPLE", "apple")).toBe(false);
	});
	it("内部多空格", () => {
		expect(isStrictMatch("give  up", "give up")).toBe(false);
	});
	it("isAllCorrect 空数组/全 undefined/混合", () => {
		expect(isAllCorrect([])).toBe(false);
		expect(
			isAllCorrect([
				{ correct: true },
				{ correct: undefined as unknown as boolean },
			]),
		).toBe(false);
		expect(isAllCorrect([{ correct: true }, { correct: false }])).toBe(false);
		expect(isAllCorrect([{ correct: true }, { correct: true }])).toBe(true);
	});
});
