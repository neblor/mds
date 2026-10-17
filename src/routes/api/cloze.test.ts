import { afterEach, describe, expect, it, vi } from "vitest";
import {
	CONTENT_LEVEL_PROMPTS,
	DEFAULT_CONTENT_LEVEL,
} from "~/lib/content-level";
import { MAX_CLOZE_CANDIDATES, POST, extractCandidates } from "./cloze";

const VALID_ITEMS = {
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

function eventFor(body: unknown) {
	return {
		request: new Request("http://localhost/api/cloze", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		}),
		params: {},
	};
}

function configured(candidates: unknown) {
	return eventFor({
		candidates,
		baseUrl: "https://example.test/v1",
		apiKey: "test-key",
		model: "test-model",
	});
}

function chatResponse(content: unknown, status = 200) {
	return new Response(
		JSON.stringify({ choices: [{ message: { content } }] }),
		{ status, headers: { "content-type": "application/json" } },
	);
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("extractCandidates", () => {
	it("优先用 candidates，带释义、按小写折叠去重、丢弃垃圾项", () => {
		expect(
			extractCandidates({
				candidates: [
					{ word: " apple ", definition: " a round fruit " },
					{ word: "Apple" },
					{ word: "orange" },
					{ word: 42 },
					null,
					{ definition: "no word" },
				],
			}),
		).toEqual([
			{ word: "apple", definition: "a round fruit" },
			{ word: "orange" },
		]);
	});

	it("没有 candidates 时退化为 words", () => {
		expect(extractCandidates({ words: ["apple", "Apple", "orange"] })).toEqual([
			{ word: "apple" },
			{ word: "orange" },
		]);
	});

	it("candidates 全为空时也能退化为 words", () => {
		expect(
			extractCandidates({ candidates: [{}, null], words: ["apple"] }),
		).toEqual([{ word: "apple" }]);
	});
});

describe("POST /api/cloze", () => {
	it("候选为空拒绝", async () => {
		await expect(POST(configured([]))).rejects.toMatchObject({ status: 400 });
		await expect(
			POST(
				eventFor({
					candidates: [{ word: "apple" }],
					baseUrl: "https://example.test/v1",
					apiKey: "",
				}),
			),
		).rejects.toMatchObject({ status: 400, statusText: "no-config" });
	});

	it("成功时返回题目，只请求一次，且提示词里带候选词", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(chatResponse(JSON.stringify(VALID_ITEMS)));
		vi.stubGlobal("fetch", fetchMock);

		const result = await POST(
			configured([
				{ word: "apple", definition: "a round fruit" },
				{ word: "orange" },
			]),
		);
		expect(result).toMatchObject({ items: VALID_ITEMS.items });
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const body = JSON.parse(
			String((fetchMock.mock.calls[0][1] as RequestInit).body),
		) as { messages: { content: string }[] };
		expect(JSON.parse(body.messages[1].content)).toEqual([
			{ word: "apple", definition: "a round fruit" },
			{ word: "orange" },
		]);
	});

	it("body.contentLevel 进入 system prompt；非法值回落初中", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(chatResponse(JSON.stringify(VALID_ITEMS)));
		vi.stubGlobal("fetch", fetchMock);

		await POST(
			eventFor({
				candidates: [{ word: "apple" }],
				baseUrl: "https://example.test/v1",
				apiKey: "test-key",
				model: "test-model",
				contentLevel: "college",
			}),
		);
		const body = JSON.parse(
			String((fetchMock.mock.calls[0][1] as RequestInit).body),
		) as { messages: { content: string }[] };
		expect(body.messages[0].content).toContain(
			CONTENT_LEVEL_PROMPTS.college,
		);

		const fallbackFetch = vi
			.fn()
			.mockResolvedValue(chatResponse(JSON.stringify(VALID_ITEMS)));
		vi.stubGlobal("fetch", fallbackFetch);
		await POST(
			eventFor({
				candidates: [{ word: "apple" }],
				baseUrl: "https://example.test/v1",
				apiKey: "test-key",
				model: "test-model",
				contentLevel: "高学",
			}),
		);
		const fallbackBody = JSON.parse(
			String((fallbackFetch.mock.calls[0][1] as RequestInit).body),
		) as { messages: { content: string }[] };
		expect(fallbackBody.messages[0].content).toContain(
			CONTENT_LEVEL_PROMPTS[DEFAULT_CONTENT_LEVEL],
		);
	});

	it("候选超过上限时只把前 24 个交给 AI", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(chatResponse(JSON.stringify(VALID_ITEMS)));
		vi.stubGlobal("fetch", fetchMock);
		const many = Array.from({ length: 30 }, (_, i) => ({ word: `word${i}` }));

		await POST(configured(many));
		const body = JSON.parse(
			String((fetchMock.mock.calls[0][1] as RequestInit).body),
		) as { messages: { content: string }[] };
		const sent = JSON.parse(body.messages[1].content) as { word: string }[];
		expect(sent).toHaveLength(MAX_CLOZE_CANDIDATES);
		expect(sent[0]).toEqual({ word: "word0" });
		expect(sent.at(-1)).toEqual({ word: "word23" });
	});

	it("契约不过时返回 invalid-response（不降级、不重试）", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			chatResponse(
				JSON.stringify({
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
				}),
			),
		);
		vi.stubGlobal("fetch", fetchMock);

		const result = await POST(
			configured([{ word: "apple" }, { word: "orange" }]),
		);
		expect(result).toMatchObject({ error: "invalid-response" });
		expect(result).toHaveProperty("message", expect.stringContaining("不符合要求"));
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("AI 服务 HTTP 错误映射为 http 错误", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(new Response("nope", { status: 500 })),
		);
		const result = await POST(
			configured([{ word: "apple" }, { word: "orange" }]),
		);
		expect(result).toMatchObject({ error: "http" });
	});
});
