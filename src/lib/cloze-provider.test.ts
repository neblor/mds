import { describe, expect, it, vi } from "vitest";
import { DefinitionProviderError } from "./definition-provider";
import {
	CLOZE_SYSTEM_PROMPT,
	buildClozeUserPrompt,
	fetchClozeItems,
	parseClozeResponse,
	type ClozeCandidate,
} from "./cloze-provider";

const CANDIDATES: ClozeCandidate[] = [
	{ word: "apple", definition: "a round fruit" },
	{ word: "orange" },
	{ word: "knowledge", definition: "what you know" },
	{ word: "practice", definition: "doing something often" },
];

/** 一道合法题（2 句 2 空，答案都在候选池里） */
function itemsPayload() {
	return {
		items: [
			{
				id: 1,
				sentences: ["I like to eat ##1 after lunch.", "She bought an ##2."],
				blanks: [
					{ index: 1, answer: "apple" },
					{ index: 2, answer: "orange" },
				],
				usedWords: ["apple", "orange"],
			},
		],
	};
}

function chatResponse(content: unknown, init: { status?: number } = {}) {
	return new Response(
		JSON.stringify({ choices: [{ message: { content } }] }),
		{
			status: init.status ?? 200,
			headers: { "content-type": "application/json" },
		},
	);
}

function fetchReturning(response: Response) {
	return vi.fn().mockResolvedValue(response) as unknown as typeof fetch;
}

function fetchOptions(extra: Partial<Parameters<typeof fetchClozeItems>[0]> = {}) {
	return {
		candidates: CANDIDATES,
		baseUrl: "https://example.test/v1/",
		apiKey: "secret",
		model: "test-model",
		...extra,
	};
}

async function failureOf(run: () => Promise<unknown>): Promise<DefinitionProviderError> {
	try {
		await run();
	} catch (error) {
		expect(error).toBeInstanceOf(DefinitionProviderError);
		return error as DefinitionProviderError;
	}
	throw new Error("期望抛错，但没有");
}

describe("buildClozeUserPrompt", () => {
	it("带上候选词与可选释义，缺释义时不带 definition 字段", () => {
		const payload = JSON.parse(buildClozeUserPrompt(CANDIDATES)) as unknown[];
		expect(payload).toEqual([
			{ word: "apple", definition: "a round fruit" },
			{ word: "orange" },
			{ word: "knowledge", definition: "what you know" },
			{ word: "practice", definition: "doing something often" },
		]);
	});
});

describe("CLOZE_SYSTEM_PROMPT", () => {
	it("写清 JSON 形状、空编号、答案来自候选池与不泄露未挖空词", () => {
		expect(CLOZE_SYSTEM_PROMPT).toContain("STRICT JSON");
		expect(CLOZE_SYSTEM_PROMPT).toContain("##1");
		expect(CLOZE_SYSTEM_PROMPT).toContain("use ONLY the candidate words");
		expect(CLOZE_SYSTEM_PROMPT).toContain("must NOT appear anywhere");
		expect(CLOZE_SYSTEM_PROMPT).toContain("3 to 6");
	});
});

describe("parseClozeResponse", () => {
	it("解析合法 JSON 内容", async () => {
		const items = await parseClozeResponse(
			chatResponse(JSON.stringify(itemsPayload())),
			CANDIDATES.map((candidate) => candidate.word),
		);
		expect(items).toHaveLength(1);
		expect(items[0].blanks.map((blank) => blank.answer)).toEqual([
			"apple",
			"orange",
		]);
	});

	it("支持 ```json 代码块与 think 块", async () => {
		const items = await parseClozeResponse(
			chatResponse(
				`<think>let me plan</think>\n\`\`\`json\n${JSON.stringify(itemsPayload())}\n\`\`\``,
			),
			CANDIDATES.map((candidate) => candidate.word),
		);
		expect(items).toHaveLength(1);
	});

	it("契约不过时把原因写进错误消息", async () => {
		const broken = {
			items: [
				{
					sentences: ["I like ##1.", "Second ##2."],
					blanks: [
						{ index: 1, answer: "made-up-word" },
						{ index: 2, answer: "orange" },
					],
					usedWords: ["made-up-word", "orange"],
				},
			],
		};
		const error = await failureOf(() =>
			parseClozeResponse(
				chatResponse(JSON.stringify(broken)),
				CANDIDATES.map((candidate) => candidate.word),
			),
		);
		expect(error.code).toBe("invalid-response");
		expect(error.message).toContain("不符合要求");
		expect(error.message).toContain("不在候选词里");
	});

	it("没有 JSON 时给出「未返回 JSON 格式」", async () => {
		const error = await failureOf(() =>
			parseClozeResponse(
				chatResponse("I cannot do that."),
				CANDIDATES.map((candidate) => candidate.word),
			),
		);
		expect(error.code).toBe("invalid-response");
		expect(error.message).toContain("未返回 JSON 格式");
	});

	it("跳过前置说明 JSON，继续找真正可用的题目 JSON", async () => {
		const items = await parseClozeResponse(
			chatResponse(
				`{"note":"planning"}\n${JSON.stringify(itemsPayload())}`,
			),
			CANDIDATES.map((candidate) => candidate.word),
		);
		expect(items).toHaveLength(1);
	});
});

describe("fetchClozeItems", () => {
	it("一次请求出整场题：发送系统提示词 + 候选词，返回题目与诊断", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(chatResponse(JSON.stringify(itemsPayload())));
		const result = await fetchClozeItems(
			fetchOptions({
				fetchImpl: fetchMock as unknown as typeof fetch,
			}),
		);

		expect(result.items).toHaveLength(1);
		expect(result.diagnostics).toMatchObject({
			requestedCount: 4,
			returnedCount: 1,
			fallbackUsed: false,
			endpoint: "https://example.test/v1/chat/completions",
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://example.test/v1/chat/completions");
		const body = JSON.parse(String(init.body)) as {
			model: string;
			messages: { role: string; content: string }[];
			response_format?: { type: string };
		};
		expect(body.model).toBe("test-model");
		expect(body.messages[0].content).toBe(CLOZE_SYSTEM_PROMPT);
		expect(JSON.parse(body.messages[1].content)).toEqual([
			{ word: "apple", definition: "a round fruit" },
			{ word: "orange" },
			{ word: "knowledge", definition: "what you know" },
			{ word: "practice", definition: "doing something often" },
		]);
		expect(body.response_format).toEqual({ type: "json_object" });
	});

	it("扩展参数被拒时降级重试（只发生一次降级 + 记录诊断）", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(new Response("bad", { status: 422 }))
			.mockResolvedValueOnce(new Response("bad", { status: 422 }))
			.mockResolvedValueOnce(chatResponse(JSON.stringify(itemsPayload())));
		const onDiagnostic = vi.fn();
		const result = await fetchClozeItems(
			fetchOptions({
				fetchImpl: fetchMock as unknown as typeof fetch,
				onDiagnostic,
			}),
		);
		expect(result.items).toHaveLength(1);
		expect(result.diagnostics.fallbackUsed).toBe(true);
		expect(onDiagnostic).toHaveBeenCalledWith(
			expect.objectContaining({ event: "compatibility-fallback" }),
		);
	});

	it("HTTP 错误映射为 http 错误", async () => {
		const error = await failureOf(() =>
			fetchClozeItems(
				fetchOptions({
					fetchImpl: fetchReturning(
						new Response("model is not found", { status: 404 }),
					),
				}),
			),
		);
		expect(error.code).toBe("http");
		expect(error.status).toBe(404);
		expect(error.message).toContain("404");
	});

	it("网络错误映射为 network", async () => {
		const error = await failureOf(() =>
			fetchClozeItems(
				fetchOptions({
					fetchImpl: vi
						.fn()
						.mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch,
				}),
			),
		);
		expect(error.code).toBe("network");
	});

	it("超时映射为 timeout", async () => {
		const error = await failureOf(() =>
			fetchClozeItems(
				fetchOptions({
					fetchImpl: vi
						.fn()
						.mockRejectedValue(
							new DOMException("timed out", "TimeoutError"),
						) as unknown as typeof fetch,
				}),
			),
		);
		expect(error.code).toBe("timeout");
		expect(error.message).toContain("超时");
	});

	it("中止映射为 aborted", async () => {
		const controller = new AbortController();
		controller.abort();
		const error = await failureOf(() =>
			fetchClozeItems(
				fetchOptions({
					signal: controller.signal,
					fetchImpl: vi.fn().mockImplementation((_url, init) => {
						const signal = (init as RequestInit).signal as AbortSignal;
						expect(signal.aborted).toBe(true);
						return Promise.reject(new DOMException("aborted", "AbortError"));
					}) as unknown as typeof fetch,
				}),
			),
		);
		expect(error.code).toBe("aborted");
	});

	it("候选词为空直接拒绝", async () => {
		const error = await failureOf(() =>
			fetchClozeItems(fetchOptions({ candidates: [{ word: "   " }] })),
		);
		expect(error.code).toBe("empty");
	});

	it("契约不过时不重试、不降级，原样抛出", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			chatResponse(
				JSON.stringify({
					items: [
						{
							sentences: ["I like ##1.", "Second ##2."],
							blanks: [
								{ index: 1, answer: "apple" },
								{ index: 2, answer: "apple" },
							],
							usedWords: ["orange"],
						},
					],
				}),
			),
		);
		const onDiagnostic = vi.fn();
		const error = await failureOf(() =>
			fetchClozeItems(
				fetchOptions({
					fetchImpl: fetchMock as unknown as typeof fetch,
					onDiagnostic,
				}),
			),
		);
		expect(error.code).toBe("invalid-response");
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(onDiagnostic).toHaveBeenCalledWith(
			expect.objectContaining({ event: "response-invalid" }),
		);
	});
});
