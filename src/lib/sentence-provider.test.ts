/**
 * 短句 provider 单测：崔总的核心约束是「句子要短」，
 * 因此长度硬上限、允许片段、屈折变化匹配、超长重试都要逐条锁住。
 */
import { describe, expect, it, vi } from "vitest";
import {
	SENTENCE_MAX_WORDS,
	SENTENCE_RETRY_MAX_WORDS,
	buildSentenceSystemPrompt,
	containsWordForm,
	fetchShortSentences,
	inflectedForms,
	isAsciiEnglish,
	normalizeSentence,
	sentenceWordCount,
	validateSentence,
} from "./sentence-provider";

/** 造一个 Chat Completions 响应 */
function chatResponse(payload: unknown, init: { status?: number; finish?: string } = {}) {
	return new Response(
		JSON.stringify({
			choices: [
				{
					finish_reason: init.finish ?? "stop",
					message: {
						content: typeof payload === "string" ? payload : JSON.stringify(payload),
					},
				},
			],
			usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
		}),
		{ status: init.status ?? 200, headers: { "content-type": "application/json" } },
	);
}

const baseOptions = {
	words: ["apple", "go"],
	baseUrl: "https://api.example.com/v1",
	apiKey: "sk-test",
	model: "gpt-4o-mini",
	contentLevel: "junior" as const,
};

describe("sentenceWordCount", () => {
	it("按词计，连字符与撇号算同一个词", () => {
		expect(sentenceWordCount("a bright sunny morning")).toBe(4);
		expect(sentenceWordCount("don't touch the well-known book")).toBe(5);
		expect(sentenceWordCount("")).toBe(0);
	});
});

describe("isAsciiEnglish", () => {
	it("接受普通英文与常见排版引号/破折号", () => {
		expect(isAsciiEnglish("a bright morning")).toBe(true);
		expect(isAsciiEnglish("it’s a well-drawn map")).toBe(true);
	});

	it("拒绝中文、全角标点、纯符号", () => {
		expect(isAsciiEnglish("一个明亮的早晨")).toBe(false);
		expect(isAsciiEnglish("apple，banana")).toBe(false);
		expect(isAsciiEnglish("123 456")).toBe(false);
	});
});

describe("containsWordForm（允许屈折变化）", () => {
	it("原形命中", () => {
		expect(containsWordForm("I ate an apple", "apple")).toBe(true);
	});

	it("复数/过去式/进行时/比较级都能命中", () => {
		expect(containsWordForm("two apples on the table", "apple")).toBe(true);
		expect(containsWordForm("she went home", "go")).toBe(true);
		expect(containsWordForm("they are running fast", "run")).toBe(true);
		expect(containsWordForm("a brighter room", "bright")).toBe(true);
		expect(containsWordForm("he studies every night", "study")).toBe(true);
		expect(containsWordForm("I like making cakes", "make")).toBe(true);
	});

	it("大小写不敏感", () => {
		expect(containsWordForm("Apple pie", "apple")).toBe(true);
	});

	it("只命中整词，不做子串误判", () => {
		expect(containsWordForm("the pineapple is sweet", "apple")).toBe(false);
		expect(containsWordForm("a class of students", "as")).toBe(false);
	});

	it("inflectedForms 不产生重复项", () => {
		const forms = inflectedForms("cat");
		expect(new Set(forms).size).toBe(forms.length);
		expect(forms).toContain("cats");
	});
});

describe("normalizeSentence", () => {
	it("去引号、压空白、去首尾空白", () => {
		expect(normalizeSentence('  "a  bright   morning" ')).toBe("a bright morning");
	});
});

describe("validateSentence", () => {
	it("片段（不是完整句子）同样合格", () => {
		const verdict = validateSentence("morning", "a bright sunny morning");
		expect(verdict).toEqual({ ok: true, sentence: "a bright sunny morning" });
	});

	it("超过硬上限 8 词判 too-long", () => {
		const tooLong = "the boy who lives next door plays football every single weekend";
		expect(sentenceWordCount(tooLong)).toBeGreaterThan(SENTENCE_MAX_WORDS);
		const verdict = validateSentence("boy", tooLong);
		expect(verdict.ok).toBe(false);
		if (!verdict.ok) expect(verdict.rejection.reason).toBe("too-long");
	});

	it("刚好 8 词算合格（边界）", () => {
		const sentence = "one two three four five six seven eight";
		expect(sentenceWordCount(sentence)).toBe(8);
		// 让句子包含目标词 one
		expect(validateSentence("one", sentence).ok).toBe(true);
	});

	it("不含目标词判 missing-word", () => {
		const verdict = validateSentence("apple", "a bright morning");
		expect(verdict.ok).toBe(false);
		if (!verdict.ok) expect(verdict.rejection.reason).toBe("missing-word");
	});

	it("中文/空串判 not-english / empty", () => {
		const chinese = validateSentence("apple", "一个苹果");
		expect(chinese.ok).toBe(false);
		if (!chinese.ok) expect(chinese.rejection.reason).toBe("not-english");
		const empty = validateSentence("apple", "   ");
		expect(empty.ok).toBe(false);
		if (!empty.ok) expect(empty.rejection.reason).toBe("empty");
	});
});

describe("buildSentenceSystemPrompt", () => {
	it("把「短」写成硬要求，并显式允许片段", () => {
		const prompt = buildSentenceSystemPrompt("junior");
		expect(prompt).toContain(`NEVER more than ${SENTENCE_MAX_WORDS} words`);
		expect(prompt).toContain("phrase or fragment");
		expect(prompt).toContain("does NOT have to be a complete sentence");
	});

	it("带上生成级别的客观描述", () => {
		expect(buildSentenceSystemPrompt("primary")).toContain("primary-school English");
		expect(buildSentenceSystemPrompt("college")).toContain("CET-4 and CET-6");
	});

	it("收紧重试时把上限压到 5 词", () => {
		const strict = buildSentenceSystemPrompt("junior", { strict: true });
		expect(strict).toContain(`at most ${SENTENCE_RETRY_MAX_WORDS} words`);
	});
});

describe("fetchShortSentences", () => {
	it("解析合格短句，按词对齐，保留诊断信息", async () => {
		const fetchImpl = vi.fn(async () =>
			chatResponse({
				sentences: [
					{ word: "apple", sentence: "a red apple" },
					{ word: "go", sentence: "we go home" },
				],
			}),
		);
		const result = await fetchShortSentences({ ...baseOptions, fetchImpl });
		expect(result.sentences).toEqual({ apple: "a red apple", go: "we go home" });
		expect(result.missing).toEqual([]);
		expect(result.rejected).toEqual([]);
		expect(result.diagnostics.returnedCount).toBe(2);
		expect(result.diagnostics.usage?.totalTokens).toBe(30);
	});

	it("超长句子被拒并进 rejected，同时进 missing（由 service 触发收紧重试）", async () => {
		const fetchImpl = vi.fn(async () =>
			chatResponse({
				sentences: [
					{ word: "apple", sentence: "a red apple" },
					{
						word: "go",
						sentence: "we go to the park every single day after school with friends",
					},
				],
			}),
		);
		const result = await fetchShortSentences({ ...baseOptions, fetchImpl });
		expect(result.sentences).toEqual({ apple: "a red apple" });
		expect(result.missing).toEqual(["go"]);
		expect(result.rejected[0]?.reason).toBe("too-long");
		expect(result.warning).toContain("1/2");
	});

	it("模型返回非请求词/重复词时忽略，不污染结果", async () => {
		const fetchImpl = vi.fn(async () =>
			chatResponse({
				sentences: [
					{ word: "banana", sentence: "a yellow banana" },
					{ word: "apple", sentence: "a red apple" },
					{ word: "apple", sentence: "another apple here" },
				],
			}),
		);
		const result = await fetchShortSentences({ ...baseOptions, fetchImpl });
		expect(Object.keys(result.sentences)).toEqual(["apple"]);
		expect(result.sentences.apple).toBe("a red apple");
	});

	it("支持嵌套/包裹形态（items / results / 纯数组）", async () => {
		for (const payload of [
			{ items: [{ word: "apple", sentence: "a red apple" }] },
			{ results: [{ word: "apple", sentence: "a red apple" }] },
			[{ word: "apple", sentence: "a red apple" }],
		]) {
			const fetchImpl = vi.fn(async () => chatResponse(payload));
			const result = await fetchShortSentences({
				...baseOptions,
				words: ["apple"],
				fetchImpl,
			});
			expect(result.sentences.apple).toBe("a red apple");
		}
	});

	it("响应里没有可识别条目时抛 invalid-response", async () => {
		const fetchImpl = vi.fn(async () => chatResponse({ nothing: true }));
		await expect(
			fetchShortSentences({ ...baseOptions, fetchImpl }),
		).rejects.toMatchObject({ code: "invalid-response" });
	});

	it("HTTP 错误抛出带状态码的错误", async () => {
		const fetchImpl = vi.fn(async () => new Response("boom", { status: 500 }));
		await expect(
			fetchShortSentences({ ...baseOptions, fetchImpl }),
		).rejects.toMatchObject({ code: "http", status: 500 });
	});

	it("截断响应（finish_reason=length）给出警告", async () => {
		const fetchImpl = vi.fn(async () =>
			chatResponse(
				{ sentences: [{ word: "apple", sentence: "a red apple" }] },
				{ finish: "length" },
			),
		);
		const result = await fetchShortSentences({ ...baseOptions, fetchImpl });
		expect(result.warning).toContain("截断");
	});

	it("收紧重试把上一版超长句带给模型，并要求 ≤5 词", async () => {
		const fetchImpl = vi.fn(async () =>
			chatResponse({ sentences: [{ word: "go", sentence: "we go home" }] }),
		);
		await fetchShortSentences({
			...baseOptions,
			words: ["go"],
			strict: true,
			previous: { go: "we go to the park every day after school" },
			fetchImpl,
		});
		const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
		const body = JSON.parse(String(init.body));
		expect(body.messages[0].content).toContain("at most 5 words");
		expect(body.messages[1].content).toContain("previous_too_long");
	});
});
