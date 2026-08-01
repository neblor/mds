/**
 * POST /api/cache-invalidate — 白名单校验 + 文件删除
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const testCacheDir = vi.hoisted(() => "/tmp/mds-cache-invalidate-test");

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

import { POST } from "./cache-invalidate";

function eventFor(body: unknown) {
	return {
		request: new Request("http://localhost/api/cache-invalidate", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		}),
		params: {},
	};
}

describe("POST /api/cache-invalidate", () => {
	beforeEach(() => {
		mkdirSync(testCacheDir, { recursive: true });
		writeFileSync(join(testCacheDir, "bad_en-us-avaneural_123abc.mp3"), "bad");
	});

	afterEach(() => {
		const f = join(testCacheDir, "bad_en-us-avaneural_123abc.mp3");
		if (existsSync(f)) unlinkSync(f);
	});

	it("合法文件名 → 删除对应文件", async () => {
		const res = await POST(
			eventFor({ name: "bad_en-us-avaneural_123abc.mp3" }),
		);
		expect(res).toEqual({ ok: true });
		expect(
			existsSync(join(testCacheDir, "bad_en-us-avaneural_123abc.mp3")),
		).toBe(false);
	});

	it("非法文件名（路径穿越）→ 400，不删除任何文件", async () => {
		const evil = join(testCacheDir, "bad_en-us-avaneural_123abc.mp3");
		try {
			await POST(eventFor({ name: "../../etc/passwd" }));
			expect.unreachable("应抛 400");
		} catch (e) {
			expect((e as { status?: number }).status).toBe(400);
		}
		expect(existsSync(evil)).toBe(true);
	});

	it("文件名不存在 → 幂等返回 ok", async () => {
		const res = await POST(eventFor({ name: "nonexistent_000000.mp3" }));
		expect(res).toEqual({ ok: true });
	});

	it("缺少 name → 400", async () => {
		try {
			await POST(eventFor({}));
			expect.unreachable("应抛 400");
		} catch (e) {
			expect((e as { status?: number }).status).toBe(400);
		}
	});
});
