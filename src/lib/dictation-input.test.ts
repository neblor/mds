import { describe, expect, it } from "vitest";
import { timedOutInputPatch } from "./dictation-input";

describe("cyber dictation timed-out input", () => {
	it("释义模式未操作时同时提交空单词和空释义", () => {
		expect(
			timedOutInputPatch({
				round: {},
				withDefinition: true,
				wordInput: "",
				definitionInput: "",
			}),
		).toEqual({ answer: "", answerDef: "" });
	});

	it("保留已提交字段并提交当前未完成输入", () => {
		expect(
			timedOutInputPatch({
				round: { answer: "apple" },
				withDefinition: true,
				wordInput: "ignored",
				definitionInput: "  partial definition  ",
			}),
		).toEqual({ answerDef: "partial definition" });
	});

	it("非释义模式只提交单词", () => {
		expect(
			timedOutInputPatch({
				round: {},
				withDefinition: false,
				wordInput: "  app  ",
				definitionInput: "unused",
			}),
		).toEqual({ answer: "app" });
	});
});
