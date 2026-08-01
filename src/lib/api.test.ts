/**
 * api.ts 单元测试：核心覆盖 playWithIntervals（双轨制播音轨）
 * 回归点：正常走完必须 resolve(true)，否则 speechDone 永不置位 → 默写卡死
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	playWithIntervals,
	requestDefinitions,
	type PlaybackFailure,
} from "./api";
import { DEFAULT_SETTINGS } from "./settings";

class MockAudio {
	src = "";
	onended: (() => void) | null = null;
	onerror: (() => void) | null = null;
	paused = true;
	play() {
		this.paused = false;
		// 模拟自然播放结束：下一微任务触发 onended
		return new Promise<void>((resolve) => {
			queueMicrotask(() => {
				this.paused = true;
				this.onended?.();
				resolve();
			});
		});
	}
	pause() {
		this.paused = true;
	}
	load() {}
	removeAttribute() {}
}

const flush = () => Promise.resolve();

describe("playWithIntervals", () => {
	let plays: number[];
	let audioStates: boolean[];
	let failures: PlaybackFailure[];
	let abort: AbortController;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal("Audio", MockAudio);
		plays = [];
		audioStates = [];
		failures = [];
		abort = new AbortController();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	const run = (count: number, gapsMs: number[]) =>
		playWithIntervals({
			url: "/word-cache/test.mp3",
			count,
			gapsMs,
			signal: abort.signal,
			onPlay: (i) => plays.push(i),
			onAudioState: (v) => audioStates.push(v),
			onPlaybackFailure: (failure) => failures.push(failure),
		});

	it("正常走完 resolve(true)，逐遍播放并执行间隔（关键回归）", async () => {
		const p = run(2, [2000, 3000]);
		await flush(); // 第 1 遍结束 → sleep(2000)
		expect(plays).toEqual([0]);
		await vi.advanceTimersByTimeAsync(2000);
		await flush(); // 第 2 遍结束 → sleep(3000)
		expect(plays).toEqual([0, 1]);
		await vi.advanceTimersByTimeAsync(3000);
		expect(await p).toBe("completed");
		// 每遍发声状态 true→false，最后清理一次 false
		expect(audioStates.filter(Boolean).length).toBe(2);
	});

	it("3 遍时按 3 个间隔依次等待", async () => {
		const p = run(3, [2000, 4700, 2700]);
		await flush();
		await vi.advanceTimersByTimeAsync(2000);
		await flush();
		expect(plays).toEqual([0, 1]);
		await vi.advanceTimersByTimeAsync(4700);
		await flush();
		expect(plays).toEqual([0, 1, 2]);
		await vi.advanceTimersByTimeAsync(2700);
		expect(await p).toBe("completed");
	});

	it("中途中止 resolve(false)，不再播报后续遍", async () => {
		const p = run(3, [2000, 4700, 2700]);
		await flush(); // 第 1 遍后进入间隔
		abort.abort();
		await vi.advanceTimersByTimeAsync(2000); // 间隔走完 → 检测到 stopped
		expect(await p).toBe("aborted");
		expect(plays).toEqual([0]);
	});

	it("gapsMs 缺省按 0 处理（不卡死）", async () => {
		const p = run(2, []);
		await flush();
		await vi.runAllTimersAsync(); // 触发 sleep(0) 等全部剩余定时器
		expect(await p).toBe("completed");
		expect(plays).toEqual([0, 1]);
	});

	it("count=0 立即完成 resolve(true)", async () => {
		const p = run(0, []);
		expect(await p).toBe("completed");
	});

	it("媒体解码错误 → media-error，仍结束播放流程", async () => {
		class ErrorAudio extends MockAudio {
			override play() {
				this.paused = false;
				return new Promise<void>((resolve) => {
					queueMicrotask(() => {
						this.paused = true;
						this.onerror?.();
						resolve();
					});
				});
			}
		}
		vi.stubGlobal("Audio", ErrorAudio);
		const p = run(1, [0]);
		await flush();
		await vi.runAllTimersAsync();
		expect(await p).toBe("media-error");
		expect(plays).toEqual([0]);
		expect(failures).toEqual(["media-error"]);
	});

	it("NotAllowedError（自动播放策略）不算媒体错误 → completed", async () => {
		class PolicyAudio extends MockAudio {
			override play() {
				return Promise.reject(new DOMException("blocked", "NotAllowedError"));
			}
		}
		vi.stubGlobal("Audio", PolicyAudio);
		const p = run(1, [0]);
		await flush();
		await vi.runAllTimersAsync();
		expect(await p).toBe("completed");
		expect(failures).toEqual([]);
	});

	it("play() 非策略拒绝 → play-rejected，仍结束播放流程", async () => {
		class RejectAudio extends MockAudio {
			override play() {
				return Promise.reject(new Error("interrupted"));
			}
		}
		vi.stubGlobal("Audio", RejectAudio);
		const p = run(1, [0]);
		await flush();
		await vi.runAllTimersAsync();
		expect(await p).toBe("play-rejected");
		expect(plays).toEqual([0]);
		expect(failures).toEqual(["play-rejected"]);
	});

	it("浏览器拒绝 play 时仍结束播放流程，避免当前轮永久卡住", async () => {
		class RejectAudio extends MockAudio {
			override play() {
				return Promise.reject(new DOMException("blocked", "NotAllowedError"));
			}
		}
		vi.stubGlobal("Audio", RejectAudio);
		const p = run(1, [0]);
		await flush();
		await vi.runAllTimersAsync();
		expect(await p).toBe("completed");
		expect(plays).toEqual([0]);
	});
});

describe("requestDefinitions", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("接受部分释义响应，不把远程缺项升级成整场失败", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					definitions: { apple: "A round fruit." },
					missing: ["banana"],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		);
		vi.stubGlobal("fetch", fetchMock);

		const result = await requestDefinitions(
			["apple", "banana"],
			{
				...DEFAULT_SETTINGS,
				aiBaseUrl: "https://example.test/v1",
				aiApiKey: "test-key",
			},
			new AbortController().signal,
		);

		expect(result).toEqual({ apple: "A round fruit." });
	});
});
