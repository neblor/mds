import { createRoot } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlayOptions } from "./api";

const mocks = vi.hoisted(() => ({
	playWithIntervals: vi.fn(),
	invalidateCacheFile: vi.fn(),
}));

vi.mock("./api", () => ({
	audioUrl: (name: string) => `/api/audio?name=${encodeURIComponent(name)}`,
	playWithIntervals: mocks.playWithIntervals,
	invalidateCacheFile: mocks.invalidateCacheFile,
}));

import { createResultAudioPlayer, type ResultAudioPlayer } from "./result-audio";

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

function mountPlayer(
	canPlay?: () => boolean,
): { player: ResultAudioPlayer; dispose: () => void } {
	let dispose = () => {};
	const player = createRoot((d) => {
		dispose = d;
		return createResultAudioPlayer(canPlay);
	});
	return { player, dispose };
}

describe("createResultAudioPlayer", () => {
	let plays: ReturnType<typeof deferred<string>>[];

	beforeEach(() => {
		plays = [];
		mocks.playWithIntervals.mockImplementation((opts: PlayOptions) => {
			const d = deferred<string>();
			plays.push(d);
			return d.promise;
		});
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("只播一遍且无间隔，播放状态同步到 playingName", async () => {
		const { player, dispose } = mountPlayer();
		expect(player.playingName()).toBeNull();

		player.play("apple.mp3");
		const opts = mocks.playWithIntervals.mock.calls[0][0] as PlayOptions;
		expect(opts).toMatchObject({
			items: [{ url: "/api/audio?name=apple.mp3" }],
			gapsMs: [0],
		});

		opts.onAudioState(true);
		expect(player.playingName()).toBe("apple.mp3");

		opts.onAudioState(false);
		expect(player.playingName()).toBeNull();

		plays[0].resolve("completed");
		await Promise.resolve();
		expect(player.playingName()).toBeNull();
		dispose();
	});

	it("canPlay 拒绝时或空名字不发起播放", () => {
		const { player, dispose } = mountPlayer(() => false);
		player.play("apple.mp3");
		expect(mocks.playWithIntervals).not.toHaveBeenCalled();
		player.play("");
		expect(mocks.playWithIntervals).not.toHaveBeenCalled();
		dispose();
	});

	it("新播放会中止旧播放（同一时间只播一个）", () => {
		const { player, dispose } = mountPlayer();
		player.play("apple.mp3");
		player.play("banana.mp3");
		const first = mocks.playWithIntervals.mock.calls[0][0] as PlayOptions;
		const second = mocks.playWithIntervals.mock.calls[1][0] as PlayOptions;
		expect((first.signal as AbortSignal).aborted).toBe(true);
		expect((second.signal as AbortSignal).aborted).toBe(false);

		// 旧任务的迟到回调不得污染新任务的播放状态
		first.onAudioState(true);
		expect(player.playingName()).toBeNull();
		dispose();
	});

	it("播放失败淘汰缓存；stop 中止并清状态", () => {
		const { player, dispose } = mountPlayer();
		player.play("apple.mp3");
		const opts = mocks.playWithIntervals.mock.calls[0][0] as PlayOptions;
		opts.onAudioState(true);
		opts.onPlaybackFailure?.("media-error");
		expect(mocks.invalidateCacheFile).toHaveBeenCalledWith("apple.mp3");

		player.stop();
		expect(opts.signal.aborted).toBe(true);
		expect(player.playingName()).toBeNull();
		dispose();
	});

	it("dispose（onCleanup）中止进行中的播放", () => {
		const { player, dispose } = mountPlayer();
		player.play("apple.mp3");
		const opts = mocks.playWithIntervals.mock.calls[0][0] as PlayOptions;
		opts.onAudioState(true);
		dispose();
		expect(opts.signal.aborted).toBe(true);
	});
});
