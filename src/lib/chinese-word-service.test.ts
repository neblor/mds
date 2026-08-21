import { describe, expect, it, vi } from "vitest";
import { getChineseWords } from "./chinese-word-service";

const words20 = Array.from({ length: 20 }, (_, index) => `word-${index + 1}`);

function responseFor(words: string[]) {
	return new Response(
		JSON.stringify({
			choices: [
				{
					finish_reason: "stop",
					message: {
						content: JSON.stringify({
							words: Object.fromEntries(
								words.map((word, index) => [
									word,
									`中文${index + 1}`,
								]),
							),
						}),
					},
				},
			],
		}),
		{ status: 200 },
	);
}

describe("getChineseWords", () => {
	it("20 个中文词全部通过业务校验、写入独立缓存并复读成功", async () => {
		let cache: unknown;
		const storage = {
			readChineseWords: () => cache,
			writeChineseWords: (value: unknown) => {
				cache = structuredClone(value);
			},
		};
		const result = await getChineseWords({
			words: words20,
			baseUrl: "https://example.test/v1",
			apiKey: "secret",
			model: "flash-model",
			storage,
			fetchImpl: vi.fn().mockResolvedValue(responseFor(words20)),
		});

		expect(Object.keys(result.words)).toHaveLength(20);
		expect(result.missing).toBeUndefined();
		expect(result.warning).toBeUndefined();
		expect(cache).toEqual({
			model: "flash-model",
			words: result.words,
		});
	});

	it("缓存命中时不再请求第三方", async () => {
		let cache: unknown = {
			model: "flash-model",
			words: { apple: "苹果" },
		};
		const fetchMock = vi.fn();
		const result = await getChineseWords({
			words: ["apple"],
			baseUrl: "https://example.test/v1",
			apiKey: "secret",
			model: "flash-model",
			storage: {
				readChineseWords: () => cache,
				writeChineseWords: (value: unknown) => {
					cache = value;
				},
			},
			fetchImpl: fetchMock,
		});

		expect(result.words).toEqual({ apple: "苹果" });
		expect(result.cachedCount).toBe(1);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("模型不同视为缓存失效，重新请求", async () => {
		let cache: unknown = {
			model: "other-model",
			words: { apple: "苹果" },
		};
		const fetchMock = vi.fn().mockResolvedValue(responseFor(["apple"]));
		const result = await getChineseWords({
			words: ["apple"],
			baseUrl: "https://example.test/v1",
			apiKey: "secret",
			model: "flash-model",
			storage: {
				readChineseWords: () => cache,
				writeChineseWords: (value: unknown) => {
					cache = value;
				},
			},
			fetchImpl: fetchMock,
		});

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(result.cachedCount).toBe(0);
		expect(result.words).toEqual({ apple: "中文1" });
	});

	it("缓存写入异常不丢远端结果，并记录明确日志", async () => {
		const logger = { write: vi.fn() };
		const result = await getChineseWords({
			words: ["apple"],
			baseUrl: "https://example.test/v1",
			apiKey: "secret",
			model: "flash-model",
			storage: {
				readChineseWords: () => undefined,
				writeChineseWords: () => {
					throw new Error("disk full");
				},
			},
			logger,
			fetchImpl: vi.fn().mockResolvedValue(responseFor(["apple"])),
		});

		expect(result.words).toEqual({ apple: "中文1" });
		expect(result.warning).toContain("缓存失败");
		expect(logger.write).toHaveBeenCalledWith(
			expect.objectContaining({ event: "cache-write-failed" }),
		);
	});

	it("AI 只返回部分中文词时带着已取得的继续，缺失词不写负缓存", async () => {
		let cache: unknown;
		const storage = {
			readChineseWords: () => cache,
			writeChineseWords: (value: unknown) => {
				cache = structuredClone(value);
			},
		};
		const result = await getChineseWords({
			words: ["apple", "banana"],
			baseUrl: "https://example.test/v1",
			apiKey: "secret",
			model: "flash-model",
			storage,
			fetchImpl: vi.fn().mockResolvedValue(responseFor(["apple"])),
		});

		expect(result.words).toEqual({ apple: "中文1" });
		expect(result.missing).toEqual(["banana"]);
		expect(result.warning).toContain("1/2");
		const cached = cache as { words: Record<string, string> };
		expect(Object.hasOwn(cached.words, "banana")).toBe(false);
	});
});
