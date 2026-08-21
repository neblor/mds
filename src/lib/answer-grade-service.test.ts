import { describe, expect, it, vi } from "vitest";
import { gradeAnswers } from "./answer-grade-service";

const items20 = Array.from({ length: 20 }, (_, index) => ({
	word: `word-${index + 1}`,
	expected: `中文${index + 1}`,
	answer: index % 2 === 0 ? `中文${index + 1}` : "错的",
}));

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
		{ status: 200 },
	);
}

describe("gradeAnswers", () => {
	it("20 个作答一次请求全部批改并完整对齐", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			completion({
				results: items20.map((item) => ({
					word: item.word,
					correct: item.answer === item.expected,
				})),
			}),
		);
		const result = await gradeAnswers({
			kind: "chinese",
			items: items20,
			baseUrl: "https://example.test/v1",
			apiKey: "secret",
			model: "flash-model",
			fetchImpl: fetchMock,
		});

		expect(result.grades).toHaveLength(20);
		expect(result.grades.filter((g) => g.correct)).toHaveLength(10);
		expect(result.missing).toBeUndefined();
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("响应不可解析时降级为空结果 + 全部缺失 + 警告（不抛错）", async () => {
		const result = await gradeAnswers({
			kind: "chinese",
			items: items20.slice(0, 2),
			baseUrl: "https://example.test/v1",
			apiKey: "secret",
			model: "flash-model",
			fetchImpl: vi
				.fn()
				.mockResolvedValue(
					completion({ results: [{ word: "x", correct: "maybe" }] }),
				),
		});
		expect(result.grades).toEqual([]);
		expect(result.missing).toEqual(["word-1", "word-2"]);
		expect(result.warning).toContain("批改");
	});

	it("网络错误直接抛出（由调用方降级本地判定）", async () => {
		await expect(
			gradeAnswers({
				kind: "chinese",
				items: items20.slice(0, 1),
				baseUrl: "https://example.test/v1",
				apiKey: "secret",
				model: "flash-model",
				fetchImpl: vi.fn().mockRejectedValue(new Error("down")),
			}),
		).rejects.toThrow("无法连接 AI 服务");
	});

	it("部分缺失时返回 warning 与缺失列表", async () => {
		const result = await gradeAnswers({
			kind: "chinese",
			items: items20.slice(0, 2),
			baseUrl: "https://example.test/v1",
			apiKey: "secret",
			model: "flash-model",
			fetchImpl: vi.fn().mockResolvedValue(
				completion({
					results: [{ word: "word-1", correct: true }],
				}),
			),
		});
		expect(result.grades).toEqual([{ word: "word-1", correct: true }]);
		expect(result.missing).toEqual(["word-2"]);
		expect(result.warning).toContain("1/2");
	});
});

describe("gradeAnswers definition 口径", () => {
	it("释义作答按 definition kind 请求并完整对齐", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			completion({
				results: [
					{ word: "apple", correct: true },
					{ word: "hello", correct: false },
				],
			}),
		);
		const result = await gradeAnswers({
			kind: "definition",
			items: [
				{ word: "apple", expected: "A round fruit.", answer: "round fruit" },
				{ word: "hello", expected: "A greeting.", answer: "nope" },
			],
			baseUrl: "https://example.test/v1",
			apiKey: "secret",
			model: "flash-model",
			fetchImpl: fetchMock,
		});
		expect(result.grades).toHaveLength(2);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
			messages: { content: string }[];
		};
		expect(body.messages[0].content).toContain("same core meaning");
	});
});
