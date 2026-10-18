/**
 * POST /api/sentence-cache —「更新短句」的缓存失效入口
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const testCacheDir = vi.hoisted(() => "/tmp/mds-sentence-cache-test");

vi.mock("~/lib/cache-storage", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("~/lib/cache-storage")>();
	return {
		...actual,
		runtimeCache: actual.createRuntimeCacheStorage({
			mode: "web",
			rootDir: testCacheDir,
		}),
	};
});

import { createRuntimeCacheStorage } from "~/lib/cache-storage";
import { POST } from "./sentence-cache";

function eventFor(body: unknown) {
	return {
		request: new Request("http://localhost/api/sentence-cache", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		}),
		params: {},
	};
}

describe("POST /api/sentence-cache", () => {
	beforeEach(() => {
		mkdirSync(testCacheDir, { recursive: true });
		createRuntimeCacheStorage({ mode: "web", rootDir: testCacheDir }).writeSentences(
			{
				model: "gpt-4o-mini",
				contentLevel: "primary",
				sentences: {
					apple: "a red apple",
					banana: "a yellow banana",
					cherry: "a sweet cherry",
				},
			},
		);
	});

	afterEach(() => rmSync(testCacheDir, { recursive: true, force: true }));

	it("只清队列里的词，其余词与 model/level 保留", async () => {
		const res = await POST(eventFor({ words: ["apple", "banana"] }));
		expect(res).toEqual({ removed: 2 });
		const file = JSON.parse(
			readFileSync(join(testCacheDir, "sentences.json"), "utf8"),
		) as { model: string; contentLevel: string; sentences: Record<string, string> };
		expect(file.model).toBe("gpt-4o-mini");
		expect(file.contentLevel).toBe("primary");
		expect(file.sentences).toEqual({ cherry: "a sweet cherry" });
	});

	it("大小写不敏感：队列词大小写不同也能清到", async () => {
		const res = await POST(eventFor({ words: ["APPLE", "Cherry"] }));
		expect(res).toEqual({ removed: 2 });
		const file = JSON.parse(
			readFileSync(join(testCacheDir, "sentences.json"), "utf8"),
		) as { sentences: Record<string, string> };
		expect(Object.keys(file.sentences)).toEqual(["banana"]);
	});

	it("重复词与空项不会重复计数", async () => {
		const res = await POST(eventFor({ words: ["apple", "apple", "  "] }));
		expect(res).toEqual({ removed: 1 });
	});

	it("没有对应缓存（词不在缓存里）→ removed=0，不是错误", async () => {
		expect(await POST(eventFor({ words: ["dragonfruit"] }))).toEqual({
			removed: 0,
		});
		expect(existsSync(join(testCacheDir, "sentences.json"))).toBe(true);
	});

	it("words 缺失或全空 → 400，缓存不动", async () => {
		for (const body of [{}, { words: [] }, { words: [1, null] }]) {
			try {
				await POST(eventFor(body));
				expect.unreachable("应抛 400");
			} catch (e) {
				expect((e as { status?: number }).status).toBe(400);
			}
		}
		const file = JSON.parse(
			readFileSync(join(testCacheDir, "sentences.json"), "utf8"),
		) as { sentences: Record<string, string> };
		expect(Object.keys(file.sentences).sort()).toEqual([
			"apple",
			"banana",
			"cherry",
		]);
	});
});
