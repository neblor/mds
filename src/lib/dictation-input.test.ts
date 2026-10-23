import { describe, expect, it } from "vitest";
import { timedOutInputPatch } from "./dictation-input";

describe("cyber dictation timed-out input", () => {
	it("释义模式未操作时同时提交空单词和空释义", () => {
		expect(
			timedOutInputPatch({
				round: {},
				contentMode: "definition",
				wordInput: "",
				definitionInput: "",
			}),
		).toEqual({ answer: "", answerDef: "" });
	});

	it("保留已提交字段并提交当前未完成输入", () => {
		expect(
			timedOutInputPatch({
				round: { answer: "apple" },
				contentMode: "definition",
				wordInput: "ignored",
				definitionInput: "  partial definition  ",
			}),
		).toEqual({ answerDef: "partial definition" });
	});

	it("单词模式只提交单词", () => {
		expect(
			timedOutInputPatch({
				round: {},
				contentMode: "word",
				wordInput: "  app  ",
				definitionInput: "unused",
			}),
		).toEqual({ answer: "app" });
	});

	it("音标模式只提交音素串（提前/超时同口径）", () => {
		expect(
			timedOutInputPatch({
				round: {},
				contentMode: "phonetic",
				wordInput: "  ˈ æ p  ",
				definitionInput: "unused",
			}),
		).toEqual({ answer: "ˈ æ p" });
	});

	it("中文词模式两步封口：单词 + 中文词都提交", () => {
		expect(
			timedOutInputPatch({
				round: {},
				contentMode: "chinese",
				wordInput: "  hello ",
				definitionInput: " 你好 ",
			}),
		).toEqual({ answer: "hello", answerDef: "你好" });
	});

	it("中文词模式保留已提交字段并提交未完成输入", () => {
		expect(
			timedOutInputPatch({
				round: { answer: "hello" },
				contentMode: "chinese",
				wordInput: "ignored",
				definitionInput: " 你好 ",
			}),
		).toEqual({ answerDef: "你好" });
	});
});
