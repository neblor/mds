import { describe, expect, it, vi } from "vitest";
import {
	CHINESE_SYSTEM_PROMPT,
	buildDefinitionSystemPrompt,
	fetchEnglishDefinitions,
	fetchChineseWords,
	fetchAnswerGrades,
	parseDefinitionAiResponse,
} from "./definition-provider";
import { CONTENT_LEVEL_PROMPTS } from "./content-level";

const words20 = [
	"apple",
	"banana",
	"calendar",
	"diamond",
	"elephant",
	"festival",
	"garden",
	"holiday",
	"island",
	"jacket",
	"kitchen",
	"library",
	"mountain",
	"notebook",
	"ocean",
	"pencil",
	"question",
	"rainbow",
	"sunshine",
	"teacher",
];

function completion(
	definitions: Record<string, string>,
	finishReason = "stop",
) {
	return new Response(
		JSON.stringify({
			choices: [
				{
					finish_reason: finishReason,
					message: { content: JSON.stringify({ definitions }) },
				},
			],
			usage: {
				prompt_tokens: 50,
				completion_tokens: 300,
				total_tokens: 350,
			},
		}),
		{ status: 200, headers: { "content-type": "application/json" } },
	);
}

describe("buildDefinitionSystemPrompt", () => {
	it("释义句按生成级别描述词汇与句法难度", () => {
		expect(buildDefinitionSystemPrompt("primary")).toContain(
			CONTENT_LEVEL_PROMPTS.primary,
		);
		expect(buildDefinitionSystemPrompt("college")).toContain(
			CONTENT_LEVEL_PROMPTS.college,
		);
	});

	it("释义与中文词提示词都不使用「儿童」这类主观定位", () => {
		for (const prompt of [
			buildDefinitionSystemPrompt("primary"),
			buildDefinitionSystemPrompt("college"),
			CHINESE_SYSTEM_PROMPT,
		]) {
			expect(prompt.toLowerCase()).not.toContain("kid");
			expect(prompt.toLowerCase()).not.toContain("child");
		}
	});

	it("中文词提示词只保留客观要求与护栏", () => {
		expect(CHINESE_SYSTEM_PROMPT).toContain("STRICT JSON");
		expect(CHINESE_SYSTEM_PROMPT).toContain("no pinyin");
		expect(CHINESE_SYSTEM_PROMPT).toContain("exactly once");
	});
});

describe("fetchEnglishDefinitions", () => {
	it("单次请求并完整处理、对齐 20 个单词", async () => {
		const definitions = Object.fromEntries(
			words20.map((word) => [word, `${word} is explained in simple English.`]),
		);
		const fetchMock = vi.fn().mockResolvedValue(completion(definitions));
		const result = await fetchEnglishDefinitions({
			words: words20,
			baseUrl: "https://example.test/v1/",
			apiKey: "secret",
			model: "flash-model",
			fetchImpl: fetchMock,
		});

		expect(result.definitions).toEqual(definitions);
		expect(result.missing).toEqual([]);
		expect(result.warning).toBeUndefined();
		expect(result.diagnostics).toMatchObject({
			requestedCount: 20,
			returnedCount: 20,
			finishReason: "stop",
			fallbackUsed: false,
			usage: { completionTokens: 300 },
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const requestBody = JSON.parse(
			String(fetchMock.mock.calls[0][1]?.body),
		) as { max_tokens: number; messages: { content: string }[] };
		expect(requestBody.max_tokens).toBe(4096);
		expect(JSON.parse(requestBody.messages[1].content)).toEqual(words20);
	});

	it("扩展参数被拒绝时降级并发出诊断事件", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(new Response("unsupported", { status: 400 }))
			.mockResolvedValueOnce(completion({ apple: "A fruit." }));
		const onDiagnostic = vi.fn();
		const result = await fetchEnglishDefinitions({
			words: ["apple"],
			baseUrl: "https://example.test/v1",
			apiKey: "secret",
			model: "flash-model",
			fetchImpl: fetchMock,
			onDiagnostic,
		});

		expect(result.diagnostics.fallbackUsed).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(onDiagnostic).toHaveBeenCalledWith(
			expect.objectContaining({ event: "compatibility-fallback" }),
		);
		const fallbackBody = JSON.parse(
			String(fetchMock.mock.calls[1][1]?.body),
		) as Record<string, unknown>;
		expect(fallbackBody).toHaveProperty("reasoning_effort", "none");
		expect(fallbackBody).not.toHaveProperty("response_format");
	});

	it("输出长度截断与缺词会返回可观测警告", async () => {
		const onDiagnostic = vi.fn();
		const result = await fetchEnglishDefinitions({
			words: ["apple", "banana"],
			baseUrl: "https://example.test/v1",
			apiKey: "secret",
			model: "flash-model",
			fetchImpl: vi
				.fn()
				.mockResolvedValue(completion({ apple: "A fruit." }, "length")),
			onDiagnostic,
		});

		expect(result.missing).toEqual(["banana"]);
		expect(result.warning).toContain("1/2");
		expect(result.warning).toContain("截断");
		expect(onDiagnostic).toHaveBeenCalledWith(
			expect.objectContaining({ event: "response-incomplete" }),
		);
	});
});

describe("parseDefinitionAiResponse", () => {
	it("合并多个内容块中的释义，而不是遇到第一个局部 JSON 就返回", async () => {
		const response = new Response(
			JSON.stringify({
				choices: [
					{
						message: {
							content: [
								{ text: '{"definitions":{"apple":"A fruit."}}' },
								{ text: '{"definitions":{"banana":"A yellow fruit."}}' },
							],
						},
					},
				],
			}),
			{ status: 200 },
		);
		expect((await parseDefinitionAiResponse(response)).definitions).toEqual({
			apple: "A fruit.",
			banana: "A yellow fruit.",
		});
	});
});

describe("fetchChineseWords", () => {
	function completion(words: Record<string, string>) {
		return new Response(
			JSON.stringify({
				choices: [
					{
						finish_reason: "stop",
						message: { content: JSON.stringify({ words }) },
					},
				],
			}),
			{ status: 200, headers: { "content-type": "application/json" } },
		);
	}

	it("按 words 键解析并对齐中文词，请求体使用中文词提示词", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			completion({ apple: "苹果", hello: "你好" }),
		);
		const result = await fetchChineseWords({
			words: ["apple", "hello"],
			baseUrl: "https://example.test/v1",
			apiKey: "secret",
			model: "flash-model",
			fetchImpl: fetchMock,
		});

		expect(result.words).toEqual({ apple: "苹果", hello: "你好" });
		expect(result.missing).toEqual([]);
		const requestBody = JSON.parse(
			String(fetchMock.mock.calls[0][1]?.body),
		) as { messages: { content: string }[] };
		expect(requestBody.messages[0].content).toContain("Chinese");
		expect(JSON.parse(requestBody.messages[1].content)).toEqual([
			"apple",
			"hello",
		]);
	});

	it("全部返回非汉字内容（英文/拼音）时按空结果抛错（服务层转为警告继续）", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			completion({ apple: "ping guo", hello: "Hello" }),
		);
		await expect(
			fetchChineseWords({
				words: ["apple", "hello"],
				baseUrl: "https://example.test/v1",
				apiKey: "secret",
				model: "flash-model",
				fetchImpl: fetchMock,
			}),
		).rejects.toMatchObject({
			code: "empty",
			message: "AI 未返回任何有效中文词，请重试",
		});
	});

	it("部分非汉字内容被过滤，只保留有效中文词", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			completion({ apple: "苹果", hello: "Hello" }),
		);
		const result = await fetchChineseWords({
			words: ["apple", "hello"],
			baseUrl: "https://example.test/v1",
			apiKey: "secret",
			model: "flash-model",
			fetchImpl: fetchMock,
		});

		expect(result.words).toEqual({ apple: "苹果" });
		expect(result.missing).toEqual(["hello"]);
		expect(result.warning).toContain("1/2");
	});

	it("部分返回时缺失词可观测，不丢已取得的中文词", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			completion({ apple: "苹果" }),
		);
		const result = await fetchChineseWords({
			words: ["apple", "banana"],
			baseUrl: "https://example.test/v1",
			apiKey: "secret",
			model: "flash-model",
			fetchImpl: fetchMock,
		});

		expect(result.words).toEqual({ apple: "苹果" });
		expect(result.missing).toEqual(["banana"]);
		expect(result.warning).toContain("1/2");
	});

	it("AI 返回数组形式 {word,value} 也能解析", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					choices: [
						{
							message: {
								content: JSON.stringify({
									words: [
										{ word: "apple", value: "苹果" },
										{ word: "hello", value: "你好" },
									],
								}),
							},
						},
					],
				}),
				{ status: 200 },
			),
		);
		const result = await fetchChineseWords({
			words: ["apple", "hello"],
			baseUrl: "https://example.test/v1",
			apiKey: "secret",
			model: "flash-model",
			fetchImpl: fetchMock,
		});
		expect(result.words).toEqual({ apple: "苹果", hello: "你好" });
	});
});

describe("fetchAnswerGrades", () => {
	const items = [
		{ word: "hello", expected: "你好", answer: "你好" },
		{ word: "apple", expected: "苹果", answer: "哈喽" },
	];

	function completion(results: unknown) {
		return new Response(
			JSON.stringify({
				choices: [
					{
						finish_reason: "stop",
						message: { content: JSON.stringify(results) },
					},
				],
			}),
			{ status: 200, headers: { "content-type": "application/json" } },
		);
	}

	it("按 results 数组解析并对齐全部作答，请求体包含作答与标准词", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			completion({
				results: [
					{ word: "hello", correct: true, note: "完全正确" },
					{ word: "apple", correct: false, note: "词义不对" },
				],
			}),
		);
		const result = await fetchAnswerGrades({
			kind: "chinese",
			items,
			baseUrl: "https://example.test/v1",
			apiKey: "secret",
			model: "flash-model",
			fetchImpl: fetchMock,
		});

		expect(result.grades).toEqual([
			{ word: "hello", correct: true, note: "完全正确" },
			{ word: "apple", correct: false, note: "词义不对" },
		]);
		expect(result.missing).toEqual([]);
		const requestBody = JSON.parse(
			String(fetchMock.mock.calls[0][1]?.body),
		) as { messages: { content: string }[] };
		expect(requestBody.messages[0].content).toContain("grader");
		expect(JSON.parse(requestBody.messages[1].content)).toEqual(items);
		// 关 thinking：扩展请求带 reasoning_effort none
		expect(requestBody).toHaveProperty("reasoning_effort", "none");
		expect(requestBody).toHaveProperty("response_format", {
			type: "json_object",
		});
	});

	it("兼容 words 映射形状（含对象与布尔值）", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			completion({
				words: {
					hello: true,
					apple: { correct: false, note: "写错了" },
				},
			}),
		);
		const result = await fetchAnswerGrades({
			kind: "chinese",
			items,
			baseUrl: "https://example.test/v1",
			apiKey: "secret",
			model: "flash-model",
			fetchImpl: fetchMock,
		});
		expect(result.grades).toEqual([
			{ word: "hello", correct: true },
			{ word: "apple", correct: false, note: "写错了" },
		]);
	});

	it("字符串/数字 correct 值归一化", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			completion({
				results: [
					{ word: "hello", correct: "yes" },
					{ word: "apple", correct: 0 },
				],
			}),
		);
		const result = await fetchAnswerGrades({
			kind: "chinese",
			items,
			baseUrl: "https://example.test/v1",
			apiKey: "secret",
			model: "flash-model",
			fetchImpl: fetchMock,
		});
		expect(result.grades).toEqual([
			{ word: "hello", correct: true },
			{ word: "apple", correct: false },
		]);
	});

	it("部分返回时缺失词可观测且不丢已取得结果", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			completion({ results: [{ word: "hello", correct: true }] }),
		);
		const result = await fetchAnswerGrades({
			kind: "chinese",
			items,
			baseUrl: "https://example.test/v1",
			apiKey: "secret",
			model: "flash-model",
			fetchImpl: fetchMock,
		});
		expect(result.grades).toEqual([{ word: "hello", correct: true }]);
		expect(result.missing).toEqual(["apple"]);
		expect(result.warning).toContain("1/2");
	});

	it("扩展参数被拒绝时降级且仍可批改", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(new Response("unsupported", { status: 400 }))
			.mockResolvedValueOnce(
				completion({ results: [{ word: "hello", correct: true }] }),
			);
		const onDiagnostic = vi.fn();
		const result = await fetchAnswerGrades({
			kind: "chinese",
			items: [items[0]],
			baseUrl: "https://example.test/v1",
			apiKey: "secret",
			model: "flash-model",
			fetchImpl: fetchMock,
			onDiagnostic,
		});
		expect(result.grades).toEqual([{ word: "hello", correct: true }]);
		expect(result.diagnostics.fallbackUsed).toBe(true);
		expect(onDiagnostic).toHaveBeenCalledWith(
			expect.objectContaining({ event: "compatibility-fallback" }),
		);
		const fallbackBody = JSON.parse(
			String(fetchMock.mock.calls[1][1]?.body),
		) as Record<string, unknown>;
		expect(fallbackBody).toHaveProperty("reasoning_effort", "none");
		expect(fallbackBody).not.toHaveProperty("response_format");
	});

	it("没有可解析结果时抛空结果错误（服务层转降级）", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(
				completion({ results: [{ word: "hello", correct: "maybe" }] }),
			);
		await expect(
			fetchAnswerGrades({
				kind: "chinese",
				items,
				baseUrl: "https://example.test/v1",
				apiKey: "secret",
				model: "flash-model",
				fetchImpl: fetchMock,
			}),
		).rejects.toMatchObject({ code: "empty" });
	});

	it("definition 口径：判定英文释义是否同义，请求体含 kind 对应提示词", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			completion({
				results: [
					{ word: "apple", correct: true, note: "意思相同" },
					{ word: "hello", correct: false, note: "词义不符" },
				],
			}),
		);
		const result = await fetchAnswerGrades({
			kind: "definition",
			items: [
				{ word: "apple", expected: "A round fruit.", answer: "fruit that is round" },
				{ word: "hello", expected: "A greeting word.", answer: "a fruit" },
			],
			baseUrl: "https://example.test/v1",
			apiKey: "secret",
			model: "flash-model",
			fetchImpl: fetchMock,
		});
		expect(result.grades).toEqual([
			{ word: "apple", correct: true, note: "意思相同" },
			{ word: "hello", correct: false, note: "词义不符" },
		]);
		const requestBody = JSON.parse(
			String(fetchMock.mock.calls[0][1]?.body),
		) as { messages: { content: string }[] };
		// 释义口径的提示词强调“同义改述可接受”
		expect(requestBody.messages[0].content).toContain("same core meaning");
		expect(requestBody.messages[0].content).toContain("paraphrases");
		expect(JSON.parse(requestBody.messages[1].content)).toEqual([
			{ word: "apple", expected: "A round fruit.", answer: "fruit that is round" },
			{ word: "hello", expected: "A greeting word.", answer: "a fruit" },
		]);
	});
});
