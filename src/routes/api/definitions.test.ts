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
		if (existsSync(testPaths.definitionsFile)) unlinkSync(testPaths.definitionsFile);
	});

	afterEach(() => {
		if (existsSync(testPaths.definitionsFile)) unlinkSync(testPaths.definitionsFile);
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
