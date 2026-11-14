import { describe, expect, it } from "vitest";
import { timedOutInputPatch } from "./dictation-input";

describe("cyber dictation timed-out input", () => {
	it("两段式未操作时同时提交空单词和空释义", () => {
		expect(
			timedOutInputPatch({
				round: {},
				ask: "word+second",
				wordInput: "",
				definitionInput: "",
			}),
		).toEqual({ answer: "", answerDef: "" });
	});

	it("保留已提交字段并提交当前未完成输入", () => {
		expect(
			timedOutInputPatch({
				round: { answer: "apple" },
				ask: "word+second",
				wordInput: "ignored",
				definitionInput: "  partial definition  ",
			}),
		).toEqual({ answerDef: "partial definition" });
	});

	it("单词轮只提交单词", () => {
		expect(
			timedOutInputPatch({
				round: {},
				ask: "word",
				wordInput: "  app  ",
				definitionInput: "unused",
			}),
		).toEqual({ answer: "app" });
	});

	it("整句轮只提交整句（走同一个输入格）", () => {
		expect(
			timedOutInputPatch({
				round: {},
				ask: "sentence",
				wordInput: "  A happy smile.  ",
				definitionInput: "unused",
			}),
		).toEqual({ answer: "A happy smile." });
	});

	it("单步轮只封第二步：不写单词（混合第 2 次出现的释义/中文词轮）", () => {
		expect(
			timedOutInputPatch({
				round: {},
				ask: "second",
				wordInput: "ignored",
				definitionInput: "  stop trying  ",
			}),
		).toEqual({ answerDef: "stop trying" });
	});

	it("单步轮已提交第二步时不再重复封口", () => {
		expect(
			timedOutInputPatch({
				round: { answerDef: "stop trying" },
				ask: "second",
				wordInput: "ignored",
				definitionInput: "ignored",
			}),
		).toEqual({});
	});

	it("中文词两段式：单词 + 中文词都提交", () => {
		expect(
			timedOutInputPatch({
				round: {},
				ask: "word+second",
				wordInput: "  hello ",
				definitionInput: " 你好 ",
			}),
		).toEqual({ answer: "hello", answerDef: "你好" });
	});

	it("中文词两段式：保留已提交的单词", () => {
		expect(
			timedOutInputPatch({
				round: { answer: "hello" },
				ask: "word+second",
				wordInput: "ignored",
				definitionInput: " 你好 ",
			}),
		).toEqual({ answerDef: "你好" });
	});
});
