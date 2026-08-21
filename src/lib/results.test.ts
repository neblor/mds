import { describe, expect, it } from "vitest";
import {
	buildResultRows,
	rowJudgement,
	correctCount,
	isAllCorrectRows,
	JUDGEMENT_NOTES,
	CONTENT_MODE_LABELS,
	type RoundLike,
} from "./results";

function round(overrides: Partial<RoundLike> = {}): RoundLike {
	return {
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
	it("三种模式的判定说明与标签齐全", () => {
		expect(JUDGEMENT_NOTES).toMatchObject({
			word: expect.stringContaining("单词判定"),
			definition: expect.stringContaining("AI 批改"),
			chinese: expect.stringContaining("AI 批改"),
		});
		expect(CONTENT_MODE_LABELS).toEqual({
			word: "单词",
			definition: "释义",
			chinese: "中文词",
		});
	});
});
