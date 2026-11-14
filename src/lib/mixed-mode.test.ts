import { describe, expect, it } from "vitest";
import {
	applyMixedAvailability,
	buildMixedPlan,
	isSecondStepOnly,
	MIXED_BASE_MODES,
	mixedMinGap,
	type MixedBaseMode,
	type MixedRandom,
	roundAskOf,
	secondStepLabel,
	uniqueMixedWords,
} from "./mixed-mode";

/** 可复现的随机源（mulberry32）：测试里锁死洗牌结果 */
function seeded(seed: number): MixedRandom {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const WORDS = [
	"apple",
	"banana",
	"give up",
	"happy",
	"orange",
	"umbrella",
	"knowledge",
	"practice",
	"journey",
	"balance",
];

describe("buildMixedPlan 配对与轮数", () => {
	it("空词表返回空计划", () => {
		expect(buildMixedPlan({ words: [] })).toEqual([]);
		expect(buildMixedPlan({ words: ["  ", ""] })).toEqual([]);
	});

	it("每个词恰好 2 轮，且是两种不同的允许模式", () => {
		const plan = buildMixedPlan({ words: WORDS, random: seeded(7) });
		expect(plan).toHaveLength(WORDS.length * 2);
		for (const word of WORDS) {
			const rounds = plan.filter((slot) => slot.word === word);
			expect(rounds).toHaveLength(2);
			const modes = rounds.map((slot) => slot.mode);
			expect(new Set(modes).size).toBe(2);
			for (const mode of modes) {
				expect(MIXED_BASE_MODES).toContain(mode as MixedBaseMode);
			}
			// pass 必须一先一后
			expect(rounds.map((slot) => slot.pass).sort()).toEqual([1, 2]);
		}
	});

	it("pass 与最终顺序一致：先出现的为 1", () => {
		const plan = buildMixedPlan({ words: WORDS, random: seeded(11) });
		const seen = new Set<string>();
		for (const slot of plan) {
			const expected = seen.has(slot.word) ? 2 : 1;
			expect(slot.pass).toBe(expected);
			seen.add(slot.word);
		}
	});

	it("三种配对都会出现（不是只挑固定两种）", () => {
		const words = Array.from({ length: 30 }, (_, i) => `word${i}`);
		const plan = buildMixedPlan({ words, random: seeded(3) });
		const signatures = new Set<string>();
		for (const word of words) {
			const modes = plan
				.filter((slot) => slot.word === word)
				.map((slot) => slot.mode)
				.sort();
			signatures.add(modes.join("+"));
		}
		expect(signatures.size).toBe(3);
	});

	it("大小写/首尾空格重复的词按同词去重，仍只默 2 遍", () => {
		const plan = buildMixedPlan({
			words: ["Apple", "apple", " APPLE "],
			random: seeded(5),
		});
		expect(plan).toHaveLength(2);
		expect(plan.map((slot) => slot.word)).toEqual(["Apple", "Apple"]);
		expect(uniqueMixedWords(["Apple", " apple "])).toEqual(["Apple"]);
	});
});

describe("buildMixedPlan 顺序约束", () => {
	it.each([5, 10, 20, 30])("n=%i 时间隔下限成立", (n) => {
		const words = Array.from({ length: n }, (_, i) => `w${i}`);
		const gap = mixedMinGap(n);
		expect(gap).toBe(Math.max(3, Math.round(n * 0.3)));
		for (const seed of [1, 2, 3, 42, 99]) {
			const plan = buildMixedPlan({ words, random: seeded(seed) });
			expect(plan).toHaveLength(n * 2);
			for (const word of words) {
				const indexes = plan
					.map((slot, index) => (slot.word === word ? index : -1))
					.filter((index) => index >= 0);
				expect(indexes).toHaveLength(2);
				expect(indexes[1] - indexes[0]).toBeGreaterThanOrEqual(gap);
			}
		}
	});

	it("不是两遍制：第 2 次出现不会全部挤在后半场", () => {
		const words = Array.from({ length: 20 }, (_, i) => `w${i}`);
		const plan = buildMixedPlan({ words, random: seeded(17) });
		const secondInFirstHalf = plan
			.slice(0, words.length)
			.filter((slot) => slot.pass === 2).length;
		expect(secondInFirstHalf).toBeGreaterThan(0);
	});
});

describe("applyMixedAvailability 降级改配", () => {
	it("短句不可用时改配另一种可用模式，顺序与 pass 不变", () => {
		const plan = buildMixedPlan({ words: ["apple", "banana"], random: seeded(1) });
		// 强制 apple 的短句不可用（若它本来没有短句轮则跳过该断言）
		const result = applyMixedAvailability(plan, (_word, mode) => mode !== "sentence");
		expect(result.rounds).toHaveLength(plan.length);
		result.rounds.forEach((slot, index) => {
			expect(slot.word).toBe(plan[index].word);
			expect(slot.pass).toBe(plan[index].pass);
			expect(slot.mode).not.toBe("sentence");
		});
		for (const word of ["apple", "banana"]) {
			expect(result.rounds.filter((slot) => slot.word === word)).toHaveLength(2);
		}
	});

	it("两种都不可用时降级为普通单词轮，并留下降级记录", () => {
		const rounds = [
			{ word: "apple", mode: "definition" as const, pass: 1 as const },
			{ word: "apple", mode: "sentence" as const, pass: 2 as const },
		];
		const result = applyMixedAvailability(
			rounds,
			(_word, mode) => mode === "chinese",
		);
		// 第一个槽改配到中文词（唯一可用），第二个槽再没有可用模式 → word
		expect(result.rounds.map((slot) => slot.mode)).toEqual(["chinese", "word"]);
		expect(result.degraded).toHaveLength(2);
		expect(result.degraded[0]).toMatchObject({
			word: "apple",
			from: "definition",
			to: "chinese",
		});
		expect(result.degraded[1]).toMatchObject({ from: "sentence", to: "word" });
	});

	it("数据齐全时原样返回", () => {
		const plan = buildMixedPlan({ words: WORDS, random: seeded(9) });
		const result = applyMixedAvailability(plan, () => true);
		expect(result.rounds).toEqual(plan);
		expect(result.degraded).toEqual([]);
	});
});

describe("roundAskOf 作答形态", () => {
	it("单一模式回落（混合之外的既有行为不变）", () => {
		expect(roundAskOf({}, "word")).toBe("word");
		expect(roundAskOf({}, "definition")).toBe("word+second");
		expect(roundAskOf({}, "chinese")).toBe("word+second");
		expect(roundAskOf({}, "sentence")).toBe("sentence");
		expect(roundAskOf({}, "phonetic")).toBe("word");
		expect(roundAskOf({}, "cloze")).toBe("word");
	});

	it("混合场次按轮级模式与 pass 判定", () => {
		expect(roundAskOf({ mode: "definition", pass: 1 }, "mixed")).toBe(
			"word+second",
		);
		expect(roundAskOf({ mode: "definition", pass: 2 }, "mixed")).toBe("second");
		expect(roundAskOf({ mode: "chinese", pass: 2 }, "mixed")).toBe("second");
		expect(roundAskOf({ mode: "sentence", pass: 1 }, "mixed")).toBe("sentence");
		expect(roundAskOf({ mode: "word", pass: 2 }, "mixed")).toBe("word");
	});

	it("短句场次的降级轮按单词轮渲染", () => {
		expect(roundAskOf({ variant: "word" }, "sentence")).toBe("word");
		expect(roundAskOf({ mode: "sentence", variant: "word" }, "mixed")).toBe(
			"word",
		);
	});

	it("isSecondStepOnly 只认第 2 次出现的释义/中文词轮", () => {
		expect(isSecondStepOnly({ mode: "definition", pass: 2 })).toBe(true);
		expect(isSecondStepOnly({ mode: "chinese", pass: 2 })).toBe(true);
		expect(isSecondStepOnly({ mode: "definition", pass: 1 })).toBe(false);
		expect(isSecondStepOnly({ mode: "sentence", pass: 2 })).toBe(false);
		expect(isSecondStepOnly({ mode: "word", pass: 2 })).toBe(false);
	});

	it("secondStepLabel 区分释义与中文词", () => {
		expect(secondStepLabel({ mode: "definition" })).toBe("释义");
		expect(secondStepLabel({ mode: "chinese" })).toBe("中文词");
	});
});
