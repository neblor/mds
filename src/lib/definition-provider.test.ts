import { describe, expect, it, vi } from "vitest";
import {
	fetchEnglishDefinitions,
	parseDefinitionAiResponse,
} from "./definition-provider";

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
