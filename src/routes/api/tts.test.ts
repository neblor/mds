import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";

const testState = vi.hoisted(() => ({
	cacheDir: "/tmp/mds-tts-route-test",
}));

vi.mock("~/lib/word-cache", () => ({
	cacheDir: testState.cacheDir,
	VOICE: "en-US-AvaNeural",
}));

vi.mock("edge-tts-universal", () => ({
	EdgeTTS: class {
		async synthesize() {
			// 有效的最小 ID3 开头；两个并发请求会在同一微任务阶段恢复
			return {
				audio: new Blob([new Uint8Array([0x49, 0x44, 0x33, 0, 0, 0])]),
			};
		}
	},
}));

import { POST } from "./tts";

function eventFor(word: string) {
	return {
		request: new Request("http://localhost/api/tts", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				words: [word],
				voice: "en-US-AvaNeural",
			}),
		}),
		params: {},
	};
}

describe("POST /api/tts 并发缓存写入", () => {
	beforeEach(() => {
		rmSync(testState.cacheDir, { recursive: true, force: true });
		mkdirSync(testState.cacheDir, { recursive: true });
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
		expect(files.some((name) => name.startsWith(".tmp-"))).toBe(false);
		expect(existsSync(`${testState.cacheDir}/${first.items[0].name}`)).toBe(true);
	});
});
