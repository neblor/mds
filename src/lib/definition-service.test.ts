import { describe, expect, it, vi } from "vitest";
import { getEnglishDefinitions } from "./definition-service";

const words20 = Array.from({ length: 20 }, (_, index) => `word-${index + 1}`);

function responseFor(words: string[]) {
	return new Response(
		JSON.stringify({
			choices: [
				{
					finish_reason: "stop",
					message: {
						content: JSON.stringify({
							definitions: Object.fromEntries(
								words.map((word) => [word, `Definition for ${word}.`]),
							),
						}),
					},
				},
			],
		}),
		{ status: 200 },
	);
}

describe("getEnglishDefinitions", () => {
	it("20 个释义全部通过业务校验、写入缓存并复读成功", async () => {
		let cache: unknown;
		const storage = {
			readDefinitions: () => cache,
			writeDefinitions: (value: unknown) => {
				cache = structuredClone(value);
			},
		};
		const result = await getEnglishDefinitions({
			words: words20,
			baseUrl: "https://example.test/v1",
			apiKey: "secret",
			model: "flash-model",
			storage,
			fetchImpl: vi.fn().mockResolvedValue(responseFor(words20)),
		});

		expect(Object.keys(result.definitions)).toHaveLength(20);
		expect(result.missing).toBeUndefined();
		expect(result.warning).toBeUndefined();
		expect(cache).toEqual({
			model: "flash-model",
			defs: result.definitions,
		});
	});

	it("缓存写入异常不丢远端结果，并记录明确日志", async () => {
		const logger = { write: vi.fn() };
		const result = await getEnglishDefinitions({
			words: ["apple"],
			baseUrl: "https://example.test/v1",
			apiKey: "secret",
			model: "flash-model",
			storage: {
				readDefinitions: () => undefined,
				writeDefinitions: () => {
					throw new Error("disk full");
				},
			},
			logger,
			fetchImpl: vi.fn().mockResolvedValue(responseFor(["apple"])),
		});

		expect(result.definitions).toEqual({ apple: "Definition for apple." });
		expect(result.warning).toContain("缓存失败");
		expect(logger.write).toHaveBeenCalledWith(
			expect.objectContaining({ event: "cache-write-failed" }),
		);
	});
});
