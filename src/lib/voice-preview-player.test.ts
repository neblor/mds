import { createRoot, createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlayOutcome } from "./api";
import {
	createVoicePreviewPlayer,
	type VoicePreviewDriver,
	type VoicePreviewPlayer,
} from "./voice-preview-player";

const SENTENCE = "May the force be with you.";
const VOICE = "en-US-AvaNeural";

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

const flush = async () => {
	await Promise.resolve();
	await Promise.resolve();
};

function mount(
	overrides: Partial<VoicePreviewDriver> = {},
	pickSentence: (previous: string | null) => string = () => SENTENCE,
) {
	const synthesis = deferred<string>();
	const playback = deferred<PlayOutcome>();
	const driver: VoicePreviewDriver = {
		synthesize: vi.fn(() => synthesis.promise),
		play: vi.fn(() => playback.promise),
		invalidate: vi.fn(),
		...overrides,
	};
	let player!: VoicePreviewPlayer;
	let setVoice!: (voice: string) => string;
	const dispose = createRoot((rootDispose) => {
		const [voice, updateVoice] = createSignal(VOICE);
		setVoice = updateVoice;
		player = createVoicePreviewPlayer(voice, driver, pickSentence);
		return rootDispose;
	});
	disposers.push(dispose);
	return { player, setVoice, driver, synthesis, playback };
}

const disposers: (() => void)[] = [];
afterEach(() => {
	while (disposers.length) disposers.pop()?.();
	vi.clearAllMocks();
});

describe("createVoicePreviewPlayer 生产编排", () => {
	it("用当前音色合成并播放；完成后回空闲", async () => {
		const { player, driver, synthesis, playback } = mount();
		player.toggle();
		expect(player.phase()).toBe("synthesizing");
		expect(player.sentence()).toBe(SENTENCE);
		expect(driver.synthesize).toHaveBeenCalledWith(
			SENTENCE,
			VOICE,
			expect.any(AbortSignal),
		);

		// 合成中重复点击不得启动第二个请求
		player.toggle();
		expect(driver.synthesize).toHaveBeenCalledTimes(1);

		synthesis.resolve("preview.mp3");
		await flush();
		expect(player.phase()).toBe("playing");
		expect(driver.play).toHaveBeenCalledWith(
			"preview.mp3",
			expect.any(AbortSignal),
		);

		playback.resolve("completed");
		await flush();
		expect(player.phase()).toBe("idle");
		expect(player.sentence()).toBeNull();
		expect(player.error()).toBe("");
	});

	it("播放中点击停止：中止播放并清状态，迟到完成不污染状态", async () => {
		const { player, driver, synthesis, playback } = mount();
		player.toggle();
		synthesis.resolve("preview.mp3");
		await flush();
		expect(player.phase()).toBe("playing");

		const signal = vi.mocked(driver.play).mock.calls[0]![1];
		player.toggle();
		expect(signal.aborted).toBe(true);
		expect(player.phase()).toBe("idle");
		expect(player.sentence()).toBeNull();

		playback.resolve("completed");
		await flush();
		expect(player.phase()).toBe("idle");
		expect(driver.invalidate).not.toHaveBeenCalled();
	});

	it("合成中停止：中止请求；即使请求迟到成功也不再播放", async () => {
		const { player, driver, synthesis } = mount();
		player.toggle();
		const signal = vi.mocked(driver.synthesize).mock.calls[0]![2];
		player.stop();
		expect(signal.aborted).toBe(true);
		expect(player.phase()).toBe("idle");

		synthesis.resolve("late.mp3");
		await flush();
		expect(driver.play).not.toHaveBeenCalled();
		expect(player.phase()).toBe("idle");
	});

	it("换音色会中止在途合成，不自动开播", async () => {
		const { player, setVoice, driver, synthesis } = mount();
		player.toggle();
		const signal = vi.mocked(driver.synthesize).mock.calls[0]![2];
		player.voiceChanged("en-GB-SoniaNeural");
		setVoice("en-GB-SoniaNeural");
		await flush();
		expect(signal.aborted).toBe(true);
		expect(player.phase()).toBe("idle");
		expect(driver.synthesize).toHaveBeenCalledTimes(1);

		synthesis.resolve("late.mp3");
		await flush();
		expect(driver.play).not.toHaveBeenCalled();

		// 用户再次主动试听时才使用新音色
		player.toggle();
		expect(driver.synthesize).toHaveBeenLastCalledWith(
			SENTENCE,
			"en-GB-SoniaNeural",
			expect.any(AbortSignal),
		);
		player.stop();
	});

	it("换音色会中止当前播放，不自动用新音色再播", async () => {
		const { player, setVoice, driver, synthesis } = mount();
		player.toggle();
		synthesis.resolve("preview.mp3");
		await flush();
		const signal = vi.mocked(driver.play).mock.calls[0]![1];
		player.voiceChanged("en-US-ChristopherNeural");
		setVoice("en-US-ChristopherNeural");
		await flush();
		expect(signal.aborted).toBe(true);
		expect(player.phase()).toBe("idle");
		expect(driver.synthesize).toHaveBeenCalledTimes(1);
		expect(driver.play).toHaveBeenCalledTimes(1);
	});

	it("合成失败进入错误态；下一次点击可以重试", async () => {
		const driver: Partial<VoicePreviewDriver> = {
			synthesize: vi
				.fn()
				.mockRejectedValueOnce(new Error("network"))
				.mockResolvedValueOnce("retry.mp3"),
		};
		const { player } = mount(driver);
		player.toggle();
		await flush();
		expect(player.phase()).toBe("error");
		expect(player.error()).toBe("试听失败：语音服务暂时不可用，请再试一次");

		player.toggle();
		await flush();
		expect(player.phase()).toBe("playing");
		player.stop();
	});

	it("服务没有返回音频名时进入错误态，不发起播放", async () => {
		const { player, driver } = mount({ synthesize: vi.fn().mockResolvedValue("") });
		player.toggle();
		await flush();
		expect(player.phase()).toBe("error");
		expect(driver.play).not.toHaveBeenCalled();
	});

	it.each(["media-error", "play-rejected"] as const)(
		"播放结果 %s：淘汰缓存并显示可重试错误",
		async (outcome) => {
			const { player, driver, synthesis, playback } = mount();
			player.toggle();
			synthesis.resolve("broken.mp3");
			await flush();
			playback.resolve(outcome);
			await flush();
			expect(driver.invalidate).toHaveBeenCalledWith("broken.mp3");
			expect(player.phase()).toBe("error");
			expect(player.error()).not.toBe("");
		},
	);

	it("卸载时中止在途任务", () => {
		const { player, driver } = mount();
		player.toggle();
		const signal = vi.mocked(driver.synthesize).mock.calls[0]![2];
		disposers.pop()?.();
		expect(signal.aborted).toBe(true);
	});

	it("每次选取都带上上一句，保证跨停止/失败后也不连续重复", async () => {
		const pick = vi
			.fn()
			.mockReturnValueOnce("first")
			.mockReturnValueOnce("second");
		const { player } = mount({}, pick);
		player.toggle();
		player.stop();
		await flush();
		player.toggle();
		expect(pick).toHaveBeenNthCalledWith(1, null);
		expect(pick).toHaveBeenNthCalledWith(2, "first");
		player.stop();
	});
});
