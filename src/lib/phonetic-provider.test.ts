import { describe, expect, it, vi } from "vitest";
import { DefinitionProviderError } from "./definition-provider";
import { fetchPhonetics } from "./phonetic-provider";
import { phoneticToString } from "./phonetic-parse";

const words = ["apple", "water"];

function response(content: unknown, finishReason = "stop") {
	return new Response(
		JSON.stringify({
			choices: [
				{
					finish_reason: finishReason,
					message: {
						content:
							typeof content === "string" ? content : JSON.stringify(content),
					},
				},
			],
			usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
		}),
		{ status: 200, headers: { "content-type": "application/json" } },
	);
}

function options(fetchImpl: typeof fetch) {
	return {
		words,
		baseUrl: "https://ai.example/v1",
		apiKey: "secret-key",
		model: "test-model",
		fetchImpl,
	};
}

describe("fetchPhonetics", () => {
	it("解析 token 数组与字符串，重音归位，按请求词对齐", async () => {
		const fetchMock = vi.fn(async () =>
			response({
				phonetics: {
					apple: [["ˈ", "æ", "p", "ə", "l"]],
					water: "ˈwɔːtə",
				},
			}),
		);
		const diagnostics: unknown[] = [];
		const result = await fetchPhonetics({
			...options(fetchMock as unknown as typeof fetch),
			onDiagnostic: (event) => diagnostics.push(event),
		});

		expect(result.missing).toEqual([]);
		expect(phoneticToString(result.phonetics.apple?.[0] ?? [])).toBe(
			"ˈ æ p ə l",
		);
		expect(phoneticToString(result.phonetics.water?.[0] ?? [])).toBe(
			"ˈ w ɔː t ə",
		);
		expect(result.diagnostics.returnedCount).toBe(2);
		expect(result.diagnostics.usage?.totalTokens).toBe(30);
		expect(diagnostics).toEqual([]);

		// 请求体使用音标提示词与用户词表
		const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(call[0]).toBe("https://ai.example/v1/chat/completions");
		const body = JSON.parse(String(call[1].body)) as {
			messages: { role: string; content: string }[];
		};
		expect(body.messages[0]?.content).toContain("British English");
		expect(body.messages[1]?.content).toBe(JSON.stringify(words));
	});

	it("坏 token / 不确定词被丢弃并计入 missing", async () => {
		const fetchMock = vi.fn(async () =>
			response({
				phonetics: {
					apple: [["ˈ", "æ", "p", "ə", "l"]],
					water: [["x"]],
				},
			}),
		);
		const result = await fetchPhonetics(
			options(fetchMock as unknown as typeof fetch),
		);
		expect(Object.keys(result.phonetics)).toEqual(["apple"]);
		expect(result.missing).toEqual(["water"]);
		expect(result.warning).toContain("1/2");
	});

	it("无 JSON / 空音标抛 provider 错误；截断写入 warning", async () => {
		const noJson = vi.fn(async () => response("not json at all"));
		await expect(
			fetchPhonetics(options(noJson as unknown as typeof fetch)),
		).rejects.toBeInstanceOf(DefinitionProviderError);

		const empty = vi.fn(async () => response({ phonetics: {} }));
		await expect(
			fetchPhonetics(options(empty as unknown as typeof fetch)),
		).rejects.toMatchObject({ code: "empty" });

		const truncated = vi.fn(async () =>
			response(
				{ phonetics: { apple: [["ˈ", "æ", "p", "ə", "l"]] } },
				"length",
			),
		);
		const result = await fetchPhonetics(
			options(truncated as unknown as typeof fetch),
		);
		expect(result.warning).toContain("截断");
	});

	it("HTTP 错误映射为 http，且错误信息不含 Key", async () => {
		const fetchMock = vi.fn(
			async () => new Response("bad key", { status: 401 }),
		);
		const error = await fetchPhonetics(
			options(fetchMock as unknown as typeof fetch),
		).catch((err: unknown) => err);
		expect(error).toBeInstanceOf(DefinitionProviderError);
		expect((error as DefinitionProviderError).code).toBe("http");
		expect((error as Error).message).not.toContain("secret-key");
	});
});
