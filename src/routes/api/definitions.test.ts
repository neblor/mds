import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, unlinkSync } from "node:fs";

const testPaths = vi.hoisted(() => ({
	definitionsFile: "/tmp/mds-definitions-route-test.json",
}));

vi.mock("~/lib/word-cache", () => ({
	definitionsFile: testPaths.definitionsFile,
}));

import { POST } from "./definitions";

function eventFor(words: string[]) {
	return {
		request: new Request("http://localhost/api/definitions", {
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

function aiResponse(definitions: { word: string; definition: string }[]) {
	return new Response(
		JSON.stringify({
			choices: [
				{
					message: {
						content: JSON.stringify({ definitions }),
					},
				},
			],
		}),
		{ status: 200, headers: { "content-type": "application/json" } },
	);
}

describe("POST /api/definitions 部分释义缓存策略", () => {
	beforeEach(() => {
		if (existsSync(testPaths.definitionsFile))
			unlinkSync(testPaths.definitionsFile);
	});

	afterEach(() => {
		if (existsSync(testPaths.definitionsFile))
			unlinkSync(testPaths.definitionsFile);
		vi.unstubAllGlobals();
	});

	it("只缓存已取得的释义，缺失项下次仍会重新请求", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				aiResponse([{ word: "apple", definition: "A round fruit." }]),
			)
			.mockResolvedValueOnce(
				aiResponse([{ word: "banana", definition: "A long yellow fruit." }]),
			);
		vi.stubGlobal("fetch", fetchMock);

		const first = await POST(eventFor(["apple", "banana"]));
		expect(first).toMatchObject({
			definitions: { apple: "A round fruit." },
			missing: ["banana"],
		});
		const firstCache = JSON.parse(
			readFileSync(testPaths.definitionsFile, "utf8"),
		) as { defs: Record<string, string> };
		expect(firstCache.defs).toEqual({ apple: "A round fruit." });
		expect(Object.hasOwn(firstCache.defs, "banana")).toBe(false);

		const second = await POST(eventFor(["apple", "banana"]));
		expect(second).toMatchObject({
			definitions: {
				apple: "A round fruit.",
				banana: "A long yellow fruit.",
			},
			cachedCount: 1,
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);

		const secondRequest = JSON.parse(
			String(fetchMock.mock.calls[1][1]?.body),
		) as { messages: { content: string }[] };
		expect(JSON.parse(secondRequest.messages[1].content)).toEqual(["banana"]);
	});
});

describe("POST /api/definitions 原型属性与键过滤", () => {
	beforeEach(() => {
		if (existsSync(testPaths.definitionsFile))
			unlinkSync(testPaths.definitionsFile);
	});

	afterEach(() => {
		if (existsSync(testPaths.definitionsFile))
			unlinkSync(testPaths.definitionsFile);
		vi.unstubAllGlobals();
	});

	it("constructor 等原型键不会误判为已有释义（空缓存也重新请求）", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(
				aiResponse([
					{ word: "constructor", definition: "A special function in JS." },
				]),
			);
		vi.stubGlobal("fetch", fetchMock);

		const result = await POST(eventFor(["constructor", "toString"]));
		expect(result).toMatchObject({
			definitions: { constructor: "A special function in JS." },
			missing: ["toString"],
		});
		const cache = JSON.parse(
			readFileSync(testPaths.definitionsFile, "utf8"),
		) as { defs: Record<string, string> };
		// 写入的是自有属性而非原型污染
		expect(Object.hasOwn(cache.defs, "constructor")).toBe(true);
		expect(cache.defs.constructor).toBe("A special function in JS.");
		// toString 未返回 → 不缓存、也不产生负缓存
		expect(Object.hasOwn(cache.defs, "toString")).toBe(false);
	});

	it("AI 乱编的键（不在请求词集合）不进入缓存", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			aiResponse([
				{ word: "apple", definition: "A round fruit." },
				{ word: "made-up-word", definition: "AI invented this." },
			]),
		);
		vi.stubGlobal("fetch", fetchMock);

		const result = await POST(eventFor(["apple"]));
		expect(result.definitions).toEqual({ apple: "A round fruit." });
		const cache = JSON.parse(
			readFileSync(testPaths.definitionsFile, "utf8"),
		) as { defs: Record<string, string> };
		expect(cache.defs).toEqual({ apple: "A round fruit." });
	});

	it("全部释义含中文 → 无有效释义（empty 错误），不写缓存", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(
				aiResponse([{ word: "apple", definition: "一种红色的圆形水果" }]),
			);
		vi.stubGlobal("fetch", fetchMock);

		const result = await POST(eventFor(["apple"]));
		expect(result).toMatchObject({ error: "empty" });
		expect(existsSync(testPaths.definitionsFile)).toBe(false);
	});

	it("部分释义含中文 → 中文条不入缓存，该词视为缺失", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			aiResponse([
				{ word: "apple", definition: "一种红色的圆形水果" },
				{ word: "banana", definition: "A long yellow fruit." },
			]),
		);
		vi.stubGlobal("fetch", fetchMock);

		const result = await POST(eventFor(["apple", "banana"]));
		expect(result).toMatchObject({
			definitions: { banana: "A long yellow fruit." },
			missing: ["apple"],
		});
		const cache = JSON.parse(
			readFileSync(testPaths.definitionsFile, "utf8"),
		) as { defs: Record<string, string> };
		expect(cache.defs).toEqual({ banana: "A long yellow fruit." });
	});
});
