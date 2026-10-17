import { describe, it, expect } from "vitest";
import {
	wordLength,
	definitionLength,
	chineseLength,
	repeatCount,
	speechIntervals,
	scaleTime,
	countdownDuration,
	clozeDuration,
	CLOZE_BASE_SECONDS,
	CLOZE_CHAR_SECONDS,
	CLOZE_BLANK_SECONDS,
	THINK_SECONDS,
	LETTER_SECONDS,
	DEF_THINK_SECONDS,
	DEF_LETTER_SECONDS,
	SPEED_RATE,
	sentenceCharCount,
	sentenceSpeechIntervals,
	sentenceCountdownDuration,
	SENTENCE_REPEATS,
	SENTENCE_THINK_SECONDS,
	SENTENCE_CHAR_SECONDS,
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
	it("中文词模式：单词段 + 第二步中文作答段（思考2 + 1.5×字符数）", () => {
		// hello（5 字母，2 遍）：(2+0.3×5)×2 = 7.0；你好（2 字）：2+1.5×2 = 5.0 → 12.0
		expect(
			countdownDuration({
				word: "hello",
				level: "normal",
				withDefinition: false,
				chineseText: "你好",
			}),
		).toBe(Math.round((7.0 + 5.0) * 10) / 10);
		// beautiful（9 字母，3 遍）：(2+0.3×9)×3 = 14.1；图书馆（3 字）：2+1.5×3 = 6.5 → 20.6
		expect(
			countdownDuration({
				word: "beautiful",
				level: "normal",
				withDefinition: false,
				chineseText: "图书馆",
			}),
		).toBe(Math.round((14.1 + 6.5) * 10) / 10);
	});
	it("中文词段按 UTF-8 字符数计（含标点），空中文词不加段", () => {
		const withPunct = countdownDuration({
			word: "hello",
			level: "normal",
			withDefinition: false,
			chineseText: "你好！",
		});
		// 3 个字符 → 单词段 7.0 + (2+1.5×3) = 13.5
		expect(withPunct).toBe(Math.round((7.0 + 6.5) * 10) / 10);
		const noSeg = countdownDuration({
			word: "hello",
			level: "normal",
			withDefinition: false,
			chineseText: "   ",
		});
		expect(noSeg).toBe(Math.round(7.0 * 10) / 10);
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

	describe("chineseLength", () => {
		it("UTF-8 字符计数：每个汉字/字符记 1，忽略空白", () => {
			expect(chineseLength("你好")).toBe(2);
			expect(chineseLength("图书馆")).toBe(3);
			expect(chineseLength(" 你好 ")).toBe(2);
		});
		it("标点也计字符；字母数字计字符", () => {
			expect(chineseLength("你好！")).toBe(3);
			expect(chineseLength("abc你好")).toBe(5);
		});
		it("空文本至少 1", () => {
			expect(chineseLength("")).toBe(1);
			expect(chineseLength("   ")).toBe(1);
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

describe("clozeDuration", () => {
	const round1 = (v: number) => Math.round(v * 10) / 10;

	it("基准 + 每字符阅读 + 每空选择（中档 ×1.0）", () => {
		const sentences = ["I like to eat ##1 after lunch.", "She bought an ##2."];
		const chars = [...sentences.join(" ").replace(/##\d+/g, " ")].filter(
			(char) => !/\s/u.test(char),
		).length;
		expect(
			clozeDuration({ sentences, blankCount: 2, level: "normal" }),
		).toBe(
			round1(CLOZE_BASE_SECONDS + CLOZE_CHAR_SECONDS * chars + CLOZE_BLANK_SECONDS * 2),
		);
	});

	it("占位符不计入字符数（##1 不是三个字符）", () => {
		const withMarkers = clozeDuration({
			sentences: ["Eat ##1 now.", "Drink ##2 now."],
			blankCount: 2,
			level: "normal",
		});
		const plain = clozeDuration({
			sentences: ["Eat now.", "Drink now."],
			blankCount: 2,
			level: "normal",
		});
		expect(withMarkers).toBe(plain);
	});

	it("句子越长、空越多，时长越长（单调性）", () => {
		const short = clozeDuration({
			sentences: ["Short ##1.", "Short ##2."],
			blankCount: 2,
			level: "normal",
		});
		const long = clozeDuration({
			sentences: ["A much longer sentence with ##1 here.", "Another long one with ##2 here."],
			blankCount: 2,
			level: "normal",
		});
		const moreBlanks = clozeDuration({
			sentences: ["Short ##1.", "Short ##2.", "Short ##3."],
			blankCount: 4,
			level: "normal",
		});
		expect(long).toBeGreaterThan(short);
		expect(moreBlanks).toBeGreaterThan(short);
	});

	it("档位与倍率生效（快 0.85 / 慢 1.3 / 倍率 2），保留 0.1s", () => {
		const sentences = ["I like to eat ##1 after lunch.", "She bought an ##2."];
		const chars = [...sentences.join(" ").replace(/##\d+/g, " ")].filter(
			(char) => !/\s/u.test(char),
		).length;
		const raw =
			CLOZE_BASE_SECONDS + CLOZE_CHAR_SECONDS * chars + CLOZE_BLANK_SECONDS * 2;
		expect(
			clozeDuration({ sentences, blankCount: 2, level: "fast" }),
		).toBe(round1(raw * SPEED_RATE.fast));
		expect(
			clozeDuration({ sentences, blankCount: 2, level: "slow" }),
		).toBe(round1(raw * SPEED_RATE.slow));
		expect(
			clozeDuration({
				sentences,
				blankCount: 2,
				level: "normal",
				multiplier: 2,
			}),
		).toBe(round1(raw * 2));
	});

	it("空句/负空数不产生负数时长", () => {
		expect(
			clozeDuration({ sentences: [], blankCount: 0, level: "normal" }),
		).toBe(CLOZE_BASE_SECONDS);
		expect(
			clozeDuration({ sentences: [], blankCount: -3, level: "normal" }),
		).toBe(CLOZE_BASE_SECONDS);
	});
});

describe("短句模式计时（只念整句 3 遍，基础公式按整句重设）", () => {
	const round1 = (v: number) => Math.round(v * 10) / 10;
	const SENTENCE = "I ate an apple after lunch";

	it("整句字符数含空格与标点（写的时候也要落笔）", () => {
		// 26 个字符（含 4 个空格）："I ate an apple after lunch"
		expect(sentenceCharCount(SENTENCE)).toBe(26);
		expect(sentenceCharCount("Hello, world!")).toBe(13);
		// 全空白按 1 处理，避免除零/负时长
		expect(sentenceCharCount("   ")).toBe(1);
	});

	it("只念整句：遍数为 3，间隔共 3 项", () => {
		expect(SENTENCE_REPEATS).toBe(3);
		const gaps = sentenceSpeechIntervals({ sentence: SENTENCE, level: "normal" });
		expect(gaps).toHaveLength(3);
	});

	it("播报间隔按「先思考、后书写」分配：[思考, 思考+书写, 书写]", () => {
		const write = SENTENCE_CHAR_SECONDS * sentenceCharCount(SENTENCE);
		const gaps = sentenceSpeechIntervals({ sentence: SENTENCE, level: "normal" });
		expect(gaps[0]).toBe(round1(SENTENCE_THINK_SECONDS));
		expect(gaps[1]).toBe(round1(SENTENCE_THINK_SECONDS + write));
		expect(gaps[2]).toBe(round1(write));
	});

	it("基础公式：整句 3 遍 ×（每遍思考 + 按整句字符数估的书写时间）", () => {
		const perRepeat =
			SENTENCE_THINK_SECONDS +
			SENTENCE_CHAR_SECONDS * sentenceCharCount(SENTENCE);
		expect(
			sentenceCountdownDuration({ sentence: SENTENCE, level: "normal" }),
		).toBe(round1(perRepeat * SENTENCE_REPEATS));
	});

	it("比原来的「先念词 + 整句 2 遍」口径更长（崔总反馈计时偏快）", () => {
		// 旧口径：词段 (2+0.3×5)×1 + 整句段 (2+0.3×19)×2 = 3.5 + 15.4 = 18.9
		const legacy = 3.5 + (2 + 0.3 * 19) * 2;
		const now = sentenceCountdownDuration({ sentence: SENTENCE, level: "normal" });
		expect(now).toBeGreaterThan(legacy * 1.5);
	});

	it("长句估时严格大于短句（逐句按长度估算，不是固定值）", () => {
		const short = sentenceCountdownDuration({ sentence: "a cat", level: "normal" });
		const long = sentenceCountdownDuration({
			sentence: "the cat sat quietly beside the old wooden window",
			level: "normal",
		});
		expect(long).toBeGreaterThan(short);
	});

	it("双重缩放仍由三档速率 × 倍率调整相乘（与基础公式相互独立）", () => {
		const base = sentenceCountdownDuration({ sentence: SENTENCE, level: "normal" });
		expect(
			sentenceCountdownDuration({ sentence: SENTENCE, level: "fast" }),
		).toBe(round1(base * SPEED_RATE.fast));
		expect(
			sentenceCountdownDuration({ sentence: SENTENCE, level: "slow" }),
		).toBe(round1(base * SPEED_RATE.slow));
		expect(
			sentenceCountdownDuration({ sentence: SENTENCE, level: "normal", multiplier: 1.5 }),
		).toBe(round1(base * 1.5));
		expect(
			sentenceCountdownDuration({ sentence: SENTENCE, level: "slow", multiplier: 2 }),
		).toBe(round1(base * SPEED_RATE.slow * 2));
	});

	it("间隔同样走双重缩放", () => {
		const base = sentenceSpeechIntervals({ sentence: SENTENCE, level: "normal" });
		const fast = sentenceSpeechIntervals({
			sentence: SENTENCE,
			level: "fast",
			multiplier: 1.5,
		});
		fast.forEach((gap, index) => {
			expect(gap).toBe(round1((base[index] as number) * SPEED_RATE.fast * 1.5));
		});
	});
});
