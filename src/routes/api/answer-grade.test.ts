import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./answer-grade";

function eventFor(
	items: unknown[],
	kind = "chinese",
	extra: Record<string, unknown> = {},
) {
	return {
		request: new Request("http://localhost/api/answer-grade", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				kind,
				items,
				baseUrl: "https://example.test/v1",
				apiKey: "test-key",
				model: "test-model",
				...extra,
			}),
		}),
		params: {},
	};
}

function aiContentResponse(content: unknown) {
	return new Response(
		JSON.stringify({
			choices: [{ message: { content } }],
		}),
		{ status: 200, headers: { "content-type": "application/json" } },
	);
}

describe("POST /api/answer-grade", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("批改全部作答并返回结构化结果", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			aiContentResponse(
				JSON.stringify({
					results: [
						{ word: "hello", correct: true, note: "完全正确" },
						{ word: "apple", correct: false, note: "词义不对" },
					],
				}),
			),
		);
		vi.stubGlobal("fetch", fetchMock);

		const result = await POST(
			eventFor([
				{ word: "hello", expected: "你好", answer: "你好" },
				{ word: "apple", expected: "苹果", answer: "香蕉" },
			]),
		);
		expect(result).toMatchObject({
			grades: [
				{ word: "hello", correct: true, note: "完全正确" },
				{ word: "apple", correct: false, note: "词义不对" },
			],
		});
		const body = JSON.parse(
			String(fetchMock.mock.calls[0][1]?.body),
		) as { messages: { content: string }[] };
		// kind 决定系统提示词口径（中文词：翻译可接受）
		expect(body.messages[0].content).toContain("translation");
		expect(JSON.parse(body.messages[1].content)).toEqual([
			{ word: "hello", expected: "你好", answer: "你好" },
			{ word: "apple", expected: "苹果", answer: "香蕉" },
		]);
	});

	it("空 items 拒绝", async () => {
		await expect(POST(eventFor([]))).rejects.toMatchObject({ status: 400 });
		await expect(
			POST(eventFor([{ word: "hello", answer: "" }])),
		).rejects.toMatchObject({ status: 400 });
	});

	it("未配置 AI 时拒绝（no-config）", async () => {
		await expect(
			POST(
				eventFor(
					[{ word: "hello", answer: "你好" }],
					"chinese",
					{ baseUrl: "", apiKey: "" },
				),
			),
		).rejects.toMatchObject({ status: 400, statusText: "no-config" });
	});

	it("AI 返回不可解析内容时降级为空结果 + 警告（不 500）", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(aiContentResponse("I cannot grade.")),
		);
		const result = await POST(
			eventFor([{ word: "hello", answer: "你好" }]),
		);
		expect(result).toMatchObject({
			grades: [],
			missing: ["hello"],
			warning: expect.stringContaining("批改"),
		});
	});

	it("网络错误映射为可读错误信息", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockRejectedValue(new TypeError("fetch failed")),
		);
		const result = await POST(
			eventFor([{ word: "hello", answer: "你好" }]),
		);
		expect(result).toMatchObject({
			error: "network",
			message: expect.stringContaining("AI"),
		});
	});

	it("definition 口径透传 kind 并批改释义作答", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			aiContentResponse(
				JSON.stringify({
					results: [{ word: "apple", correct: true, note: "意思相同" }],
				}),
			),
		);
		vi.stubGlobal("fetch", fetchMock);
		const result = await POST(
			eventFor(
				[{ word: "apple", expected: "A round fruit.", answer: "round fruit" }],
				"definition",
			),
		);
		expect(result).toMatchObject({
			grades: [{ word: "apple", correct: true, note: "意思相同" }],
		});
		const body = JSON.parse(
			String(fetchMock.mock.calls[0][1]?.body),
		) as { messages: { content: string }[] };
		expect(body.messages[0].content).toContain("same core meaning");
	});

	it("非法 kind 拒绝", async () => {
		await expect(
			POST(
				eventFor([{ word: "hello", answer: "你好" }], "unknown" as never),
			),
		).rejects.toMatchObject({ status: 400 });
	});
});
