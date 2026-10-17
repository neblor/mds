import { describe, expect, it } from "vitest";
import {
	buildResultRows,
	highlightWordSegments,
	rowJudgement,
	correctCount,
	isAllCorrectRows,
	JUDGEMENT_NOTES,
	CONTENT_MODE_LABELS,
	type WordRoundLike,
} from "./results";

function round(overrides: Partial<WordRoundLike> = {}): WordRoundLike {
	return {
		kind: "word",
		word: "apple",
		audioName: "apple.mp3",
		...overrides,
	};
}

describe("buildResultRows 赛博模式", () => {
	it("单词模式：单词判定字段，严格匹配", () => {
		const [row] = buildResultRows(
			[round({ answer: "apple" }), round({ answer: "Apple" })],
			"cyber",
			"word",
		);
		const [wrong] = buildResultRows(
			[round({ answer: "Apple" })],
			"cyber",
			"word",
		);
		expect(row.fields).toEqual([
			{
				kind: "word",
				expected: "apple",
				userValue: "apple",
				graded: true,
				correct: true,
			},
		]);
		expect(wrong.fields[0].correct).toBe(false);
		expect(rowJudgement(row)).toBe(true);
		expect(rowJudgement(wrong)).toBe(false);
	});

	it("释义模式：单词判定（严格）+ 释义判定（本地兜底口径）", () => {
		const [row] = buildResultRows(
			[
				round({
					word: "apple",
					definition: "A round fruit.",
					answer: "apple",
					answerDef: "a round fruit",
				}),
			],
			"cyber",
			"definition",
		);
		expect(row.fields).toEqual([
			{
				kind: "word",
				expected: "apple",
				userValue: "apple",
				graded: true,
				correct: true,
			},
			{
				kind: "definition",
				expected: "A round fruit.",
				userValue: "a round fruit",
				graded: true,
				correct: true,
			},
		]);
		expect(rowJudgement(row)).toBe(true);
	});

	it("释义模式：AI 批改覆盖本地匹配（改述算对/判错）", () => {
		const [paraphrase] = buildResultRows(
			[
				round({
					word: "apple",
					definition: "A round fruit.",
					answer: "apple",
					answerDef: "fruit that is red and round",
				}),
			],
			"cyber",
			"definition",
			{ apple: { correct: true, note: "意思相同" } },
		);
		expect(paraphrase.fields[1]).toMatchObject({
			kind: "definition",
			correct: true,
			note: "意思相同",
		});
		expect(rowJudgement(paraphrase)).toBe(true);

		const [marked] = buildResultRows(
			[
				round({
					word: "apple",
					definition: "A round fruit.",
					answer: "apple",
					answerDef: "A round fruit.",
				}),
			],
			"cyber",
			"definition",
			{ apple: { correct: false, note: "抄了题干之外的内容" } },
		);
		expect(marked.fields[1].correct).toBe(false);
		expect(rowJudgement(marked)).toBe(false);
	});

	it("释义模式：单词写错但释义再对也不算整行对", () => {
		const [row] = buildResultRows(
			[round({ word: "apple", answer: "aple", answerDef: "A round fruit." })],
			"cyber",
			"definition",
		);
		expect(rowJudgement(row)).toBe(false);
	});

	it("释义模式：AI 未取到标准释义时释义不批改，单词仍判定", () => {
		const [row] = buildResultRows(
			[round({ word: "apple", definition: "", answer: "apple", answerDef: "x" })],
			"cyber",
			"definition",
		);
		expect(row.fields[0]).toMatchObject({ kind: "word", graded: true });
		expect(row.fields[1]).toMatchObject({ kind: "definition", graded: false });
		expect(rowJudgement(row)).toBe(true);
	});

	it("中文词模式：英文单词（严格）+ 中文词（本地归一化匹配）双判定", () => {
		const [ok] = buildResultRows(
			[
				round({
					word: "hello",
					chineseWord: "你好",
					answer: "hello",
					answerDef: "你好！",
				}),
			],
			"cyber",
			"chinese",
		);
		const [wrongZh] = buildResultRows(
			[
				round({
					word: "hello",
					chineseWord: "你好",
					answer: "hello",
					answerDef: "您好",
				}),
			],
			"cyber",
			"chinese",
		);
		const [wrongWord] = buildResultRows(
			[
				round({
					word: "hello",
					chineseWord: "你好",
					answer: "helo",
					answerDef: "你好",
				}),
			],
			"cyber",
			"chinese",
		);
		expect(ok.fields).toEqual([
			{
				kind: "word",
				expected: "hello",
				userValue: "hello",
				graded: true,
				correct: true,
			},
			{
				kind: "chinese",
				expected: "你好",
				userValue: "你好！",
				graded: true,
				correct: true,
			},
		]);
		expect(rowJudgement(ok)).toBe(true);
		expect(wrongZh.fields[1].correct).toBe(false);
		expect(wrongWord.fields[0].correct).toBe(false);
		expect(rowJudgement(wrongWord)).toBe(false);
	});

	it("中文词模式：AI 批改结果覆盖本地匹配（同义词算对）", () => {
		const [row] = buildResultRows(
			[
				round({
					word: "hello",
					chineseWord: "你好",
					answer: "hello",
					answerDef: "哈喽",
				}),
			],
			"cyber",
			"chinese",
			{ hello: { correct: true, note: "同义词" } },
		);
		expect(row.fields[1]).toMatchObject({
			kind: "chinese",
			correct: true,
			note: "同义词",
		});
		expect(rowJudgement(row)).toBe(true);

		// AI 判错则覆盖本地匹配的正确结论
		const [row2] = buildResultRows(
			[
				round({
					word: "hello",
					chineseWord: "你好",
					answer: "hello",
					answerDef: "你好",
				}),
			],
			"cyber",
			"chinese",
			{ hello: { correct: false, note: "字写错了" } },
		);
		expect(row2.fields[1].correct).toBe(false);
		expect(rowJudgement(row2)).toBe(false);
	});

	it("中文词模式：AI 未取到标准词时该行中文词不批改（参考性质），单词仍判定", () => {
		const [row] = buildResultRows(
			[
				round({
					word: "hello",
					chineseWord: "",
					answer: "hello",
					answerDef: "你好",
				}),
			],
			"cyber",
			"chinese",
		);
		expect(row.fields[0]).toMatchObject({ kind: "word", graded: true });
		expect(row.fields[1]).toMatchObject({ kind: "chinese", graded: false });
		expect(row.fields[1].correct).toBeUndefined();
		expect(rowJudgement(row)).toBe(true); // 单词对即可
	});
});

describe("buildResultRows 书写模式", () => {
	it("单词模式无参考字段", () => {
		const rows = buildResultRows([round()], "writing", "word");
		expect(rows[0].fields).toEqual([]);
		expect(rowJudgement(rows[0])).toBeUndefined();
	});

	it("释义模式展示释义参考供自检", () => {
		const rows = buildResultRows(
			[round({ definition: "A round fruit." })],
			"writing",
			"definition",
		);
		expect(rows[0].fields).toEqual([
			{ kind: "definition", expected: "A round fruit.", graded: false },
		]);
	});

	it("中文词模式展示中文词参考供自检", () => {
		const rows = buildResultRows(
			[round({ chineseWord: "苹果" })],
			"writing",
			"chinese",
		);
		expect(rows[0].fields).toEqual([
			{ kind: "chinese", expected: "苹果", graded: false },
		]);
	});
});

describe("统计与庆祝判定", () => {
	it("correctCount / isAllCorrectRows", () => {
		const rows = buildResultRows(
			[
				round({ answer: "apple" }),
				round({ answer: "apple" }),
				round({ answer: "Apple" }),
			],
			"cyber",
			"word",
		);
		expect(correctCount(rows)).toBe(2);
		expect(isAllCorrectRows(rows)).toBe(false);
		expect(
			isAllCorrectRows(
				buildResultRows(
					[round({ answer: "apple" }), round({ answer: "apple" })],
					"cyber",
					"word",
				),
			),
		).toBe(true);
		expect(isAllCorrectRows([])).toBe(false);
	});

	it("书写模式永远不算全对（无判定）", () => {
		expect(isAllCorrectRows(buildResultRows([round()], "writing", "word"))).toBe(
			false,
		);
	});
});

describe("模式文案", () => {
	it("五种模式的判定说明与标签齐全", () => {
		expect(JUDGEMENT_NOTES).toMatchObject({
			word: expect.stringContaining("单词判定"),
			definition: expect.stringContaining("AI 批改"),
			chinese: expect.stringContaining("AI 批改"),
			sentence: expect.stringContaining("忽略大小写与标点"),
			cloze: expect.stringContaining("每个空独立比对"),
		});
		expect(CONTENT_MODE_LABELS).toEqual({
			word: "单词",
			definition: "释义",
			chinese: "中文词",
			sentence: "短句",
			cloze: "组句",
		});
	});
});

describe("buildResultRows 组句模式", () => {
	/** 一题 2 空：apple 填对，umbrella 填成了 orange */
	function clozeRound() {
		return {
			kind: "cloze" as const,
			sentences: ["I like to eat ##1 after lunch.", "She took an ##2 because it will rain."],
			blanks: [
				{ index: 1, answer: "apple", chosen: "apple" },
				{ index: 2, answer: "umbrella", chosen: "orange" },
			],
			audioNames: { apple: "apple.mp3", umbrella: "umbrella.mp3" },
		};
	}

	it("每个空一行，带句上下文与逐空判定", () => {
		const rows = buildResultRows([clozeRound()], "cyber", "cloze");
		expect(rows).toHaveLength(2);
		expect(rows[0]).toMatchObject({
			word: "apple",
			audioName: "apple.mp3",
			context: "I like to eat apple after lunch.",
		});
		expect(rows[0].fields).toEqual([
			{
				kind: "word",
				expected: "apple",
				userValue: "apple",
				graded: true,
				correct: true,
			},
		]);
		expect(rows[1]).toMatchObject({
			word: "umbrella",
			context: "She took an umbrella because it will rain.",
		});
		expect(rowJudgement(rows[1])).toBe(false);
		expect(correctCount(rows)).toBe(1);
		expect(isAllCorrectRows(rows)).toBe(false);
	});

	it("未作答的空按未填处理（判定为错，不崩）", () => {
		const rows = buildResultRows(
			[
				{
					kind: "cloze",
					sentences: ["A ##1 sentence.", "B ##2 sentence."],
					blanks: [
						{ index: 1, answer: "apple" },
						{ index: 2, answer: "orange", chosen: "orange" },
					],
				},
			],
			"cyber",
			"cloze",
		);
		expect(rows).toHaveLength(2);
		expect(rows[0].fields[0].userValue).toBeUndefined();
		expect(rowJudgement(rows[0])).toBe(false);
		expect(rowJudgement(rows[1])).toBe(true);
	});

	it("同一个词被两个空用到时各自独立成行", () => {
		const rows = buildResultRows(
			[
				{
					kind: "cloze",
					sentences: ["Eat ##1 now.", "Eat ##2 again."],
					blanks: [
						{ index: 1, answer: "apple", chosen: "apple" },
						{ index: 2, answer: "apple", chosen: "banana" },
					],
				},
			],
			"cyber",
			"cloze",
		);
		expect(rows.map((row) => row.word)).toEqual(["apple", "apple"]);
		expect(rows.map((row) => rowJudgement(row))).toEqual([true, false]);
		expect(correctCount(rows)).toBe(1);
	});

	it("书写模式（无判定字段）只展示答案", () => {
		const rows = buildResultRows([clozeRound()], "writing", "cloze");
		expect(rows[0].fields[0]).toMatchObject({ graded: false });
		expect(rowJudgement(rows[0])).toBeUndefined();
	});
});

describe("buildResultRows 短句模式", () => {
	const sentenceRound = (overrides: Partial<WordRoundLike> = {}): WordRoundLike => ({
		kind: "word",
		word: "apple",
		audioName: "a_red_apple.mp3",
		variant: "sentence",
		sentence: "a red apple",
		answer: "a red apple",
		...overrides,
	});

	it("标准整句进 context；判定是整句匹配（graded 的 sentence 字段）", () => {
		const [row] = buildResultRows([sentenceRound()], "cyber", "sentence");
		expect(row.context).toBe("a red apple");
		const field = row.fields.find((f) => f.kind === "sentence");
		expect(field).toMatchObject({
			expected: "a red apple",
			userValue: "a red apple",
			graded: true,
			correct: true,
		});
		expect(rowJudgement(row)).toBe(true);
	});

	it("忽略大小写：大小写写错不算错", () => {
		const [row] = buildResultRows(
			[sentenceRound({ answer: "A Red Apple" })],
			"cyber",
			"sentence",
		);
		expect(row.fields.find((f) => f.kind === "sentence")?.correct).toBe(true);
		expect(rowJudgement(row)).toBe(true);
	});

	it("标点与空格多少不影响（归一化后比较）", () => {
		for (const answer of ["a  red apple", "A red apple!", "a red,apple".replace(",", " ")]) {
			const [row] = buildResultRows(
				[sentenceRound({ answer })],
				"cyber",
				"sentence",
			);
			expect(row.fields.find((f) => f.kind === "sentence")?.correct).toBe(true);
		}
	});

	it("词序/词形/漏词仍然算错", () => {
		for (const answer of ["red a apple", "a red apples", "a apple"]) {
			const [row] = buildResultRows(
				[sentenceRound({ answer })],
				"cyber",
				"sentence",
			);
			expect(row.fields.find((f) => f.kind === "sentence")?.correct).toBe(false);
			expect(rowJudgement(row)).toBe(false);
		}
	});

	it("不做 AI 批改：即使传了 grades 也不影响短句判定、也不产生备注", () => {
		const [row] = buildResultRows(
			[sentenceRound({ answer: "a red appple" })],
			"cyber",
			"sentence",
			{ apple: { correct: true, note: "拼写差一个字母" } },
		);
		const field = row.fields.find((f) => f.kind === "sentence");
		expect(field?.correct).toBe(false);
		expect(field?.note).toBeUndefined();
		expect(correctCount([row])).toBe(0);
	});

	it("空作答算错", () => {
		const [row] = buildResultRows(
			[sentenceRound({ answer: "" })],
			"cyber",
			"sentence",
		);
		expect(rowJudgement(row)).toBe(false);
	});

	it("书写模式只给标准整句对照，不产生判定", () => {
		const [row] = buildResultRows([sentenceRound()], "writing", "sentence");
		expect(row.fields.map((f) => f.kind)).toEqual(["sentence"]);
		expect(row.fields[0]?.graded).toBe(false);
		expect(rowJudgement(row)).toBeUndefined();
	});

	it("降级轮（没有短句）按单词轮处理并带备注", () => {
		const [row] = buildResultRows(
			[{ kind: "word", word: "banana", audioName: "banana.mp3", variant: "word", answer: "banana" }],
			"cyber",
			"sentence",
		);
		expect(row.note).toContain("按单词默写");
		expect(row.context).toBeUndefined();
		expect(row.fields.map((f) => f.kind)).toEqual(["word"]);
		expect(rowJudgement(row)).toBe(true);
	});
});

describe("highlightWordSegments", () => {
	it("标记目标词（含屈折变化），其余保持原样", () => {
		const segments = highlightWordSegments("I ate two apples and an apple pie", "apple");
		expect(segments.map((s) => s.text).join("")).toBe(
			"I ate two apples and an apple pie",
		);
		expect(segments.filter((s) => s.hit).map((s) => s.text)).toEqual([
			"apples",
			"apple",
		]);
	});

	it("没有命中时返回整段", () => {
		expect(highlightWordSegments("a red apple", "banana")).toEqual([
			{ text: "a red apple", hit: false },
		]);
	});

	it("不去误伤子串（pineapple 不是 apple）", () => {
		const segments = highlightWordSegments("a pineapple", "apple");
		expect(segments.some((s) => s.hit)).toBe(false);
	});
});
