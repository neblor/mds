import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, unlinkSync } from "node:fs";

const testPaths = vi.hoisted(() => ({
	rootDir: "/tmp/mds-chinese-words-route-test",
	chineseFile: "/tmp/mds-chinese-words-route-test/chinese-words.json",
}));

vi.mock("~/lib/cache-storage", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("~/lib/cache-storage")>();
	return {
		...actual,
		runtimeCache: actual.createRuntimeCacheStorage({
			mode: "web",
			rootDir: testPaths.rootDir,
		}),
	};
});

import { POST } from "./chinese-words";

function eventFor(words: string[]) {
	return {
		request: new Request("http://localhost/api/chinese-words", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				words,
				baseUrl: "https://example.test/v1",
				apiKey: "test-key",
				model: "test-model",
			}),
		}),
		params: {},
	};
}

function aiResponse(words: { word: string; value: string }[]) {
	return aiContentResponse(JSON.stringify({ words }));
}

function aiContentResponse(content: unknown) {
	return new Response(
		JSON.stringify({
			choices: [
				{
					message: {
						content,
					},
				},
			],
		}),
		{ status: 200, headers: { "content-type": "application/json" } },
	);
}

describe("POST /api/chinese-words 部分缓存策略", () => {
	beforeEach(() => {
		if (existsSync(testPaths.chineseFile)) unlinkSync(testPaths.chineseFile);
	});

	afterEach(() => {
		if (existsSync(testPaths.chineseFile)) unlinkSync(testPaths.chineseFile);
		vi.unstubAllGlobals();
	});

	it("只缓存已取得的中文词，缺失项下次仍会重新请求", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(aiResponse([{ word: "apple", value: "苹果" }]))
			.mockResolvedValueOnce(aiResponse([{ word: "banana", value: "香蕉" }]));
		vi.stubGlobal("fetch", fetchMock);

		const first = await POST(eventFor(["apple", "banana"]));
		expect(first).toMatchObject({
			words: { apple: "苹果" },
			missing: ["banana"],
		});
		const firstCache = JSON.parse(
			readFileSync(testPaths.chineseFile, "utf8"),
		) as { words: Record<string, string> };
		expect(firstCache.words).toEqual({ apple: "苹果" });
		expect(Object.hasOwn(firstCache.words, "banana")).toBe(false);

		const second = await POST(eventFor(["apple", "banana"]));
		expect(second).toMatchObject({
			words: { apple: "苹果", banana: "香蕉" },
			cachedCount: 1,
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
		const secondRequest = JSON.parse(
			String(fetchMock.mock.calls[1][1]?.body),
		) as { messages: { content: string }[] };
		expect(JSON.parse(secondRequest.messages[1].content)).toEqual(["banana"]);
	});

	it("20 个单词的完整响应全部写入实际文件缓存", async () => {
		const words = Array.from({ length: 20 }, (_, index) => `word-${index + 1}`);
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				aiResponse(
					words.map((word, index) => ({
						word,
						value: `中文${index + 1}`,
					})),
				),
			),
		);

		const result = await POST(eventFor(words));
		expect(Object.keys(result.words)).toHaveLength(20);
		expect(result.missing).toBeUndefined();
		const cache = JSON.parse(
			readFileSync(testPaths.chineseFile, "utf8"),
		) as { words: Record<string, string> };
		expect(Object.keys(cache.words)).toHaveLength(20);
		for (const word of words) expect(cache.words[word]).toBeTruthy();
	});

	it("AI 返回非汉字内容（英文/拼音）视为无效，不缓存、不产生负缓存", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			aiResponse([
				{ word: "apple", value: "ping guo" },
				{ word: "hello", value: "Hello" },
			]),
		);
		vi.stubGlobal("fetch", fetchMock);

		const result = await POST(eventFor(["apple", "hello"]));
		expect(result).toMatchObject({
			words: {},
			missing: ["apple", "hello"],
			warning: "AI 未返回任何有效中文词，请重试",
		});
		expect(existsSync(testPaths.chineseFile)).toBe(false);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("AI 乱编的键与原型键不进入缓存", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			aiResponse([
				{ word: "apple", value: "苹果" },
				{ word: "made-up-word", value: "编造" },
				{ word: "constructor", value: "构造" },
			]),
		);
		vi.stubGlobal("fetch", fetchMock);

		const result = await POST(eventFor(["apple"]));
		expect(result.words).toEqual({ apple: "苹果" });
		const cache = JSON.parse(
			readFileSync(testPaths.chineseFile, "utf8"),
		) as { words: Record<string, string> };
		expect(Object.keys(cache.words)).toEqual(["apple"]);
	});

	it("AI 返回的 JSON 放在 Markdown 代码块中也能解析", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				aiContentResponse(
					'```json\n{"words":{"apple":"苹果","banana":"香蕉"}}\n```',
				),
			),
		);

		const result = await POST(eventFor(["apple", "banana"]));
		expect(result).toMatchObject({
			words: { apple: "苹果", banana: "香蕉" },
		});
	});

	it("没有 JSON 时带警告继续，且下次仍重新请求", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(aiContentResponse("I could not translate."));
		vi.stubGlobal("fetch", fetchMock);

		const first = await POST(eventFor(["apple"]));
		const second = await POST(eventFor(["apple"]));
		expect(first).toMatchObject({
			words: {},
			missing: ["apple"],
			warning: "AI 未返回 JSON 格式的中文词",
		});
		expect(second).toMatchObject({ missing: ["apple"] });
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(existsSync(testPaths.chineseFile)).toBe(false);
	});
});
