import { describe, it, expect } from "vitest";
import {
	wordLength,
	definitionLength,
	repeatCount,
	speechIntervals,
	scaleTime,
	countdownDuration,
	THINK_SECONDS,
	LETTER_SECONDS,
	DEF_THINK_SECONDS,
	DEF_LETTER_SECONDS,
	SPEED_RATE,
} from "./timing";

describe("wordLength", () => {
	it("统计字母数字", () => {
		expect(wordLength("transform")).toBe(9);
		expect(wordLength("apple")).toBe(5);
		expect(wordLength("give up")).toBe(6);
		expect(wordLength("don't")).toBe(4);
	});
	it("空串至少为 1", () => {
		expect(wordLength("")).toBe(1);
	});
});

describe("definitionLength", () => {
	it("统计释义字母数", () => {
		expect(definitionLength("a round fruit")).toBe(11);
		expect(definitionLength("apple")).toBe(5);
	});
	it("空串至少为 1", () => {
		expect(definitionLength("")).toBe(1);
	});
});

describe("repeatCount", () => {
	it("释义模式必然 3 遍", () => {
		expect(repeatCount("a", true)).toBe(3);
	});
	it("非释义 <6 字母 2 遍", () => {
		expect(repeatCount("cat", false)).toBe(2);
		expect(repeatCount("apple", false)).toBe(2);
	});
	it("非释义 ≥6 字母 3 遍", () => {
		expect(repeatCount("banana", false)).toBe(3);
		expect(repeatCount("transform", false)).toBe(3);
	});
});

describe("speechIntervals", () => {
	it("3 遍：transform → [2, 4.7, 2.7]", () => {
		expect(speechIntervals("transform", 3)).toEqual([2, 4.7, 2.7]);
	});
	it("3 遍一般式：第1=思考，第2=思考+字长，第3=字长", () => {
		const L = wordLength("banana");
		const r = (v: number) => Math.round(v * 10) / 10;
		expect(speechIntervals("banana", 3)).toEqual([
			THINK_SECONDS,
			r(THINK_SECONDS + LETTER_SECONDS * L),
			r(LETTER_SECONDS * L),
		]);
	});
	it("2 遍：第1=思考，第2=思考+字长", () => {
		const L = wordLength("cat");
		const r = (v: number) => Math.round(v * 10) / 10;
		expect(speechIntervals("cat", 2)).toEqual([
			THINK_SECONDS,
			r(THINK_SECONDS + LETTER_SECONDS * L),
		]);
	});
});

describe("scaleTime", () => {
	it("round 至 0.1s 并乘速率×倍率", () => {
		expect(scaleTime(14.1, "normal")).toBe(14.1);
		expect(scaleTime(14.1, "fast")).toBeCloseTo(
			Math.round(14.1 * 0.85 * 10) / 10,
		);
		expect(scaleTime(14.1, "slow", 1)).toBeCloseTo(
			Math.round(14.1 * 1.3 * 10) / 10,
		);
		expect(scaleTime(10, "normal", 1.5)).toBe(15);
	});
	it("三档速率为 0.85/1/1.3", () => {
		expect(SPEED_RATE.fast).toBe(0.85);
		expect(SPEED_RATE.normal).toBe(1);
		expect(SPEED_RATE.slow).toBe(1.3);
	});
});

describe("countdownDuration", () => {
	it("transform 中档无释义 → (2+0.3×9)×3 = 14.1", () => {
		expect(
			countdownDuration({
				word: "transform",
				level: "normal",
				withDefinition: false,
			}),
		).toBe(14.1);
	});
	it("cat 中档无释义 → (2+0.3×3)×2 = 5.8", () => {
		expect(
			countdownDuration({
				word: "cat",
				level: "normal",
				withDefinition: false,
			}),
		).toBe(5.8);
	});
	it("快档 0.85 倍", () => {
		expect(
			countdownDuration({
				word: "transform",
				level: "fast",
				withDefinition: false,
			}),
		).toBe(Math.round(14.1 * 0.85 * 10) / 10);
	});
	it("释义段：单词段 + (5 + 0.4×释义字母数)", () => {
		const def = "a round fruit that grows on trees";
		const defLetters = definitionLength(def);
		const wordSeg = (THINK_SECONDS + LETTER_SECONDS * wordLength("apple")) * 3;
		const expectTotal =
			wordSeg + DEF_THINK_SECONDS + DEF_LETTER_SECONDS * defLetters;
		expect(
			countdownDuration({
				word: "apple",
				level: "normal",
				withDefinition: true,
				definitionText: def,
			}),
		).toBeCloseTo(expectTotal);
	});
	it("倍率调整整体生效且 round 0.1", () => {
		const base = countdownDuration({
			word: "transform",
			level: "normal",
			withDefinition: false,
		});
		const scaled = countdownDuration({
			word: "transform",
			level: "normal",
			withDefinition: false,
			multiplier: 1.5,
		});
		expect(scaled).toBeCloseTo(Math.round(base * 1.5 * 10) / 10);
	});
});

describe("timing 边界用例", () => {
	describe("wordLength 混合字符", () => {
		it("emoji/中文/数字混合只计字母数字", () => {
			expect(wordLength("hello😀")).toBe(5);
			expect(wordLength("苹果apple")).toBe(5);
			expect(wordLength("123abc")).toBe(6);
		});
		it("全角字母不计（非 ASCII）", () => {
			expect(wordLength("ａｐｐｌｅ")).toBe(1); // 全角字符全部替换后至少 1
		});
		it("换行/制表符 trim 后统计", () => {
			expect(wordLength("\napple\t")).toBe(5);
		});
	});

	describe("speechIntervals 边界", () => {
		it("count=1（防御）→ [思考]", () => {
			expect(speechIntervals("apple", 1)).toEqual([THINK_SECONDS]);
		});
		it("count=3 与 count=2 的末间隔差异（第3遍只字长）", () => {
			const L = wordLength("banana");
			const three = speechIntervals("banana", 3);
			const two = speechIntervals("banana", 2);
			expect(three[2]).toBe(Math.round(LETTER_SECONDS * L * 10) / 10);
			expect(two[1]).toBe(
				Math.round((THINK_SECONDS + LETTER_SECONDS * L) * 10) / 10,
			);
			expect(three).toHaveLength(3);
			expect(two).toHaveLength(2);
		});
		it("超长单词间隔也 round 0.1 且不为负", () => {
			const long = "a".repeat(100);
			const ints = speechIntervals(long, 3);
			expect(ints[0]).toBe(THINK_SECONDS);
			expect(ints[2]).toBeGreaterThan(0);
			expect(
				ints.every((v) => Math.abs(v * 10 - Math.round(v * 10)) < 1e-9),
			).toBe(true);
		});
	});

	describe("scaleTime 边界", () => {
		it("multiplier 为 0 → 0", () => {
			expect(scaleTime(14.1, "normal", 0)).toBe(0);
		});
		it("multiplier 极小（0.3 下限）", () => {
			expect(scaleTime(10, "normal", 0.3)).toBe(3);
		});
		it("负数输入防御（不被 clamp）", () => {
			expect(scaleTime(-5, "normal")).toBe(-5);
		});
		it("round 0.1 对 0.05 进位", () => {
			expect(scaleTime(0.05, "normal")).toBe(0.1);
		});
	});

	describe("countdownDuration 边界", () => {
		it("withDefinition=true 但释义文本为空 → 仍加释义思考时间", () => {
			const d = countdownDuration({
				word: "apple",
				level: "normal",
				withDefinition: true,
				definitionText: "",
			});
			const wordSeg =
				(THINK_SECONDS + LETTER_SECONDS * wordLength("apple")) * 3;
			expect(d).toBe(wordSeg + DEF_THINK_SECONDS + DEF_LETTER_SECONDS * 1);
		});
		it("恰好 6 字母（repeatCount 边界）→ 3 遍", () => {
			expect(repeatCount("banana", false)).toBe(3);
			expect(repeatCount("apple", false)).toBe(2); // 5 字母
			const d = countdownDuration({
				word: "banana",
				level: "normal",
				withDefinition: false,
			});
			expect(d).toBeCloseTo((2 + 0.3 * 6) * 3);
		});
		it("单字母单词", () => {
			expect(
				countdownDuration({
					word: "a",
					level: "normal",
					withDefinition: false,
				}),
			).toBe(Math.round((2 + 0.3) * 2 * 10) / 10);
		});
		it("超长单词时长仍有限", () => {
			const d = countdownDuration({
				word: "a".repeat(100),
				level: "normal",
				withDefinition: false,
			});
			expect(d).toBeLessThan(200); // (2+30)*3 = 96
		});
	});
});
