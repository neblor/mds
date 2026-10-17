/**
 * 短句 service 单测：缓存命中/失效、超长收紧重试、缺失不缓存、写后复读。
 * 这些是「短句要短」这条硬约束的最后一环——不合格的句子绝不能进缓存或进默写。
 */
import { describe, expect, it, vi } from "vitest";
import { getShortSentences, type SentenceCacheFile } from "./sentence-service";

function memoryStorage(initial?: SentenceCacheFile) {
	const state: { file: SentenceCacheFile | undefined } = { file: initial };
	return {
		state,
		storage: {
			readSentences: () => state.file,
			writeSentences: (value: unknown) => {
				state.file = value as SentenceCacheFile;
			},
		},
	};
}

function chat(payload: unknown) {
	return new Response(
		JSON.stringify({
			choices: [{ finish_reason: "stop", message: { content: JSON.stringify(payload) } }],
		}),
		{ status: 200, headers: { "content-type": "application/json" } },
	);
}

const baseOptions = {
	baseUrl: "https://api.example.com/v1",
	apiKey: "sk-test",
	model: "gpt-4o-mini",
	contentLevel: "junior" as const,
};

const TOO_LONG = "we go to the park every single day after school with our friends";

describe("getShortSentences 缓存", () => {
	it("全部命中缓存时不发请求", async () => {
		const { storage } = memoryStorage({
			model: "gpt-4o-mini",
			contentLevel: "junior",
			sentences: { apple: "a red apple", go: "we go home" },
		});
		const fetchImpl = vi.fn();
		const result = await getShortSentences({
			...baseOptions,
			words: ["apple", "go"],
			storage,
			fetchImpl,
		});
		expect(fetchImpl).not.toHaveBeenCalled();
		expect(result.sentences).toEqual({ apple: "a red apple", go: "we go home" });
		expect(result.cachedCount).toBe(2);
		expect(result.missing).toEqual([]);
	});

	it("只请求未命中的词，并把新结果合并写回", async () => {
		const { state, storage } = memoryStorage({
			model: "gpt-4o-mini",
			contentLevel: "junior",
			sentences: { apple: "a red apple" },
		});
		const fetchImpl = vi.fn(async () =>
			chat({ sentences: [{ word: "go", sentence: "we go home" }] }),
		);
		const result = await getShortSentences({
			...baseOptions,
			words: ["apple", "go"],
			storage,
			fetchImpl,
		});
		expect(result.sentences).toEqual({ apple: "a red apple", go: "we go home" });
		expect(result.cachedCount).toBe(1);
		const body = JSON.parse(
			String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body),
		);
		expect(JSON.parse(body.messages[1].content as string)).toEqual(["go"]);
		expect(state.file?.sentences).toEqual({
			apple: "a red apple",
			go: "we go home",
		});
	});

	it("模型变了整体失效重取", async () => {
		const { storage } = memoryStorage({
			model: "old-model",
			contentLevel: "junior",
			sentences: { apple: "a red apple" },
		});
		const fetchImpl = vi.fn(async () =>
			chat({ sentences: [{ word: "apple", sentence: "an apple pie" }] }),
		);
		const result = await getShortSentences({
			...baseOptions,
			words: ["apple"],
			storage,
			fetchImpl,
		});
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(result.sentences.apple).toBe("an apple pie");
	});

	it("生成级别变了整体失效（难度口径不同）", async () => {
		const { storage } = memoryStorage({
			model: "gpt-4o-mini",
			contentLevel: "primary",
			sentences: { apple: "an apple" },
		});
		const fetchImpl = vi.fn(async () =>
			chat({ sentences: [{ word: "apple", sentence: "a ripe apple" }] }),
		);
		const result = await getShortSentences({
			...baseOptions,
			words: ["apple"],
			storage,
			fetchImpl,
			contentLevel: "college",
		});
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(result.sentences.apple).toBe("a ripe apple");
	});
});

describe("getShortSentences 超长重试", () => {
	it("第一次超长 → 收紧重试后合格 → 用短的进缓存", async () => {
		const { state, storage } = memoryStorage();
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(chat({ sentences: [{ word: "go", sentence: TOO_LONG }] }))
			.mockResolvedValueOnce(chat({ sentences: [{ word: "go", sentence: "we go home" }] }));
		const result = await getShortSentences({
			...baseOptions,
			words: ["go"],
			storage,
			fetchImpl,
		});
		expect(fetchImpl).toHaveBeenCalledTimes(2);
		expect(result.sentences).toEqual({ go: "we go home" });
		expect(result.missing).toEqual([]);
		expect(state.file?.sentences).toEqual({ go: "we go home" });
		// 第二次请求要带 strict 提示与上一版句子
		const retryBody = JSON.parse(
			String((fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1].body),
		);
		expect(retryBody.messages[0].content).toContain("at most 5 words");
		expect(retryBody.messages[1].content).toContain("previous_too_long");
	});

	it("重试仍超长 → 进 missing（调用方降级为单词轮），且不写缓存", async () => {
		const { state, storage } = memoryStorage();
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(chat({ sentences: [{ word: "go", sentence: TOO_LONG }] }))
			.mockResolvedValueOnce(chat({ sentences: [{ word: "go", sentence: TOO_LONG }] }));
		const result = await getShortSentences({
			...baseOptions,
			words: ["go"],
			storage,
			fetchImpl,
		});
		expect(result.sentences).toEqual({});
		expect(result.missing).toEqual(["go"]);
		expect(result.warning).toContain("降级为单词默写");
		expect(state.file).toBeUndefined();
	});

	it("只重试被判不合格的词，不含已合格的词", async () => {
		const { storage } = memoryStorage();
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(
				chat({
					sentences: [
						{ word: "apple", sentence: "a red apple" },
						{ word: "go", sentence: TOO_LONG },
					],
				}),
			)
			.mockResolvedValueOnce(chat({ sentences: [{ word: "go", sentence: "go home" }] }));
		const result = await getShortSentences({
			...baseOptions,
			words: ["apple", "go"],
			storage,
			fetchImpl,
		});
		const retryBody = JSON.parse(
			String((fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1].body),
		);
		const retryWords = JSON.parse(retryBody.messages[1].content as string).map(
			(item: { word: string }) => item.word,
		);
		expect(retryWords).toEqual(["go"]);
		expect(result.sentences).toEqual({ apple: "a red apple", go: "go home" });
	});

	it("没有超长项时不发第二次请求", async () => {
		const { storage } = memoryStorage();
		const fetchImpl = vi.fn(async () =>
			chat({ sentences: [{ word: "apple", sentence: "a red apple" }] }),
		);
		await getShortSentences({
			...baseOptions,
			words: ["apple"],
			storage,
			fetchImpl,
		});
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});
});

describe("getShortSentences 写入与失败", () => {
	it("写后复读不一致时报诊断日志，但不影响本次返回", async () => {
		const logger = { write: vi.fn() };
		const storage = {
			readSentences: () => undefined,
			// 写入静默丢弃 → 复读必然不一致
			writeSentences: () => {},
		};
		const fetchImpl = vi.fn(async () =>
			chat({ sentences: [{ word: "apple", sentence: "a red apple" }] }),
		);
		const result = await getShortSentences({
			...baseOptions,
			words: ["apple"],
			storage,
			logger,
			fetchImpl,
		});
		expect(result.sentences.apple).toBe("a red apple");
		expect(logger.write).toHaveBeenCalledWith(
			expect.objectContaining({ event: "sentence-cache-write-failed" }),
		);
	});

	it("缺失项不写负缓存：下次仍会重新请求", async () => {
		const { state, storage } = memoryStorage();
		const fetchImpl = vi.fn(async () =>
			chat({ sentences: [{ word: "apple", sentence: "a red apple" }] }),
		);
		await getShortSentences({ ...baseOptions, words: ["apple", "banana"], storage, fetchImpl });
		expect(state.file?.sentences).toEqual({ apple: "a red apple" });
		expect(
			Object.hasOwn(state.file?.sentences as Record<string, string>, "banana"),
		).toBe(false);
	});

	it("缓存文件损坏时当未命中", async () => {
		const storage = {
			readSentences: () => "not-an-object",
			writeSentences: vi.fn(),
		};
		const fetchImpl = vi.fn(async () =>
			chat({ sentences: [{ word: "apple", sentence: "a red apple" }] }),
		);
		const result = await getShortSentences({
			...baseOptions,
			words: ["apple"],
			storage,
			fetchImpl,
		});
		expect(result.sentences.apple).toBe("a red apple");
	});
});
