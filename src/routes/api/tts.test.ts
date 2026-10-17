import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";

const testState = vi.hoisted(() => ({
	cacheDir: "/tmp/mds-tts-route-test",
	synthesize: vi.fn(),
	log: vi.fn(),
}));

vi.mock("~/lib/cache-storage", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("~/lib/cache-storage")>();
	return {
		...actual,
		runtimeCache: actual.createRuntimeCacheStorage({
			mode: "web",
			rootDir: testState.cacheDir,
		}),
	};
});

vi.mock("~/lib/runtime-logger", () => ({
	runtimeDiagnosticLogger: { write: testState.log },
}));

vi.mock("~/lib/edge-tts-client", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("~/lib/edge-tts-client")>();
	return {
		...actual,
		edgeTts: { synthesize: testState.synthesize },
	};
});

import { EdgeTtsError } from "~/lib/edge-tts-client";
import { POST } from "./tts";

function eventFor(word: string, signal?: AbortSignal) {
	return {
		request: new Request("http://localhost/api/tts", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				words: [word],
				voice: "en-US-AvaNeural",
			}),
			signal,
		}),
		params: {},
	};
}

describe("POST /api/tts 并发缓存写入", () => {
	beforeEach(() => {
		rmSync(testState.cacheDir, { recursive: true, force: true });
		mkdirSync(testState.cacheDir, { recursive: true });
		testState.synthesize.mockReset();
		testState.log.mockReset();
		testState.synthesize.mockResolvedValue({
			// 有效的最小 ID3 开头；两个并发请求会在同一微任务阶段恢复
			audio: new Uint8Array([0x49, 0x44, 0x33, 0, 0, 0]),
			endpoint: "api.msedgeservices.com",
			fallback: false,
			elapsedMs: 5,
		});
	});

	afterEach(() => {
		rmSync(testState.cacheDir, { recursive: true, force: true });
	});

	it("两个请求同时合成同一单词时都成功，且不残留临时文件", async () => {
		const [first, second] = await Promise.all([
			POST(eventFor("apple")),
			POST(eventFor("apple")),
		]);

		expect(first.items[0].name).toBe(second.items[0].name);
		const files = readdirSync(testState.cacheDir);
		expect(files).toEqual([first.items[0].name]);
		expect(files.some((name) => name.startsWith(".tmp-audio-"))).toBe(false);
		expect(existsSync(`${testState.cacheDir}/${first.items[0].name}`)).toBe(true);
	});

	it("合成期间请求被中止时不得返回不存在的音频名", async () => {
		let finishSynthesis:
			| ((value: {
					audio: Uint8Array;
					endpoint: string;
					fallback: boolean;
					elapsedMs: number;
			  }) => void)
			| undefined;
		testState.synthesize.mockReturnValue(
			new Promise((resolve) => {
				finishSynthesis = resolve;
			}),
		);
		const abort = new AbortController();
		const pending = POST(eventFor("aborted", abort.signal));
		abort.abort();
		finishSynthesis?.({
			audio: new Uint8Array([0x49, 0x44, 0x33, 0, 0, 0]),
			endpoint: "api.msedgeservices.com",
			fallback: false,
			elapsedMs: 5,
		});
		await expect(pending).rejects.toMatchObject({ status: 499 });
		expect(readdirSync(testState.cacheDir)).toEqual([]);
	});

	it("端点回退时按降级记诊断日志，但结果照常成功", async () => {
		testState.synthesize.mockResolvedValue({
			audio: new Uint8Array([0x49, 0x44, 0x33, 0, 0, 0]),
			endpoint: "speech.platform.bing.com",
			fallback: true,
			elapsedMs: 42,
		});
		const result = await POST(eventFor("fallback"));
		expect(result.items[0].cached).toBe(false);
		expect(testState.log).toHaveBeenCalledWith(
			expect.objectContaining({
				event: "tts.endpoint-fallback",
				level: "warning",
			}),
		);
	});

	it("合成失败：返回 502 并记错误日志，不写坏缓存", async () => {
		testState.synthesize.mockRejectedValue(
			new EdgeTtsError("connect", "Edge 语音合成失败：端点都不可用", {
				attempts: ["api.msedgeservices.com: 403", "speech.platform.bing.com: 403"],
			}),
		);
		await expect(POST(eventFor("broken"))).rejects.toMatchObject({
			status: 502,
		});
		expect(testState.log).toHaveBeenCalledWith(
			expect.objectContaining({ event: "tts.synth-failed", level: "error" }),
		);
		expect(readdirSync(testState.cacheDir)).toEqual([]);
	});

	it("音频字节非法（无 mp3 头）时按 502 拒绝，不落缓存", async () => {
		testState.synthesize.mockResolvedValue({
			audio: new Uint8Array([0x00, 0x01, 0x02]),
			endpoint: "api.msedgeservices.com",
			fallback: false,
			elapsedMs: 5,
		});
		await expect(POST(eventFor("badbytes"))).rejects.toMatchObject({
			status: 502,
		});
		expect(readdirSync(testState.cacheDir)).toEqual([]);
	});
});
