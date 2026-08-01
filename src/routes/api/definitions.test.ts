import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, unlinkSync } from "node:fs";

const testPaths = vi.hoisted(() => ({
	rootDir: "/tmp/mds-definitions-route-test",
	definitionsFile: "/tmp/mds-definitions-route-test/definitions.json",
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
	return aiContentResponse(JSON.stringify({ definitions }));
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

	it("全部释义含中文时继续流程、不写负缓存", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(
				aiResponse([{ word: "apple", definition: "一种红色的圆形水果" }]),
			);
		vi.stubGlobal("fetch", fetchMock);

		const result = await POST(eventFor(["apple"]));
		expect(result).toMatchObject({
			definitions: {},
			missing: ["apple"],
			warning: "AI 未返回任何有效释义，请重试",
		});
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

describe("POST /api/definitions OpenAI 兼容响应解析", () => {
	beforeEach(() => {
		if (existsSync(testPaths.definitionsFile))
			unlinkSync(testPaths.definitionsFile);
	});

	afterEach(() => {
		if (existsSync(testPaths.definitionsFile))
			unlinkSync(testPaths.definitionsFile);
		vi.unstubAllGlobals();
	});

	it("支持客户端供应商返回的 content parts 和 Markdown JSON 代码块", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				aiContentResponse([
					{
						type: "text",
						text: '```json\n{"definitions":[{"word":"apple","definition":"A round fruit."}]}\n```',
					},
				]),
			),
		);

		const result = await POST(eventFor(["example", "apple"]));
		expect(result).toMatchObject({
			definitions: { apple: "A round fruit." },
			missing: ["example"],
		});
		expect(
			JSON.parse(readFileSync(testPaths.definitionsFile, "utf8")),
		).toMatchObject({ defs: { apple: "A round fruit." } });
	});

	it("跳过前置说明 JSON，继续查找最终释义 JSON", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				aiContentResponse(
					'analysis {"example":true}\n```json\n{"definitions":{"apple":"A round fruit."}}\n```',
				),
			),
		);

		const result = await POST(eventFor(["example", "apple"]));
		expect(result).toMatchObject({
			definitions: { apple: "A round fruit." },
			missing: ["example"],
		});
	});

	it("没有 JSON 时带警告继续，且下次仍重新请求", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(aiContentResponse("I could not create the definitions."));
		vi.stubGlobal("fetch", fetchMock);

		const first = await POST(eventFor(["apple"]));
		const second = await POST(eventFor(["apple"]));
		expect(first).toMatchObject({
			definitions: {},
			missing: ["apple"],
			warning: "AI 未返回 JSON 格式的释义",
		});
		expect(second).toMatchObject({ missing: ["apple"] });
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(existsSync(testPaths.definitionsFile)).toBe(false);
	});
});
