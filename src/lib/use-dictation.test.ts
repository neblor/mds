import { createRoot } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	PlaybackFailure,
	PlayOptions,
	PlayOutcome,
	TtsItem,
} from "./api";

const mocks = vi.hoisted(() => ({
	requestTtsAll: vi.fn(),
	requestDefinitions: vi.fn(),
	playWithIntervals: vi.fn(),
	invalidateCacheFile: vi.fn(),
}));

vi.mock("./api", () => ({
	audioUrl: (name: string) => `/api/audio?name=${encodeURIComponent(name)}`,
	requestTtsAll: mocks.requestTtsAll,
	requestDefinitions: mocks.requestDefinitions,
	playWithIntervals: mocks.playWithIntervals,
	invalidateCacheFile: mocks.invalidateCacheFile,
}));

vi.mock("./state", async (importOriginal) => {
	const original = await importOriginal<typeof import("./state")>();
	return {
		...original,
		shuffle: <T>(list: T[]) => [...list],
	};
});

import { useDictation } from "./use-dictation";

type Dictation = ReturnType<typeof useDictation>;

function createDeferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

function mountDictation(): { dictation: Dictation; dispose: () => void } {
	let dispose = () => {};
	const dictation = createRoot((rootDispose) => {
		dispose = rootDispose;
		return useDictation();
	});
	return { dictation, dispose };
}

async function flushAsyncWork() {
	await Promise.resolve();
	await Promise.resolve();
}

describe("useDictation 生产流程编排", () => {
	let playDeferreds: ReturnType<typeof createDeferred<PlayOutcome>>[];
	let audioStateCbs: ((playing: boolean) => void)[];
	let playbackFailureCbs: ((failure: PlaybackFailure) => void)[];
	let mounted: { dictation: Dictation; dispose: () => void } | undefined;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal("window", {
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		});
		vi.stubGlobal("localStorage", {
			getItem: vi.fn().mockReturnValue(null),
			setItem: vi.fn(),
		});
		playDeferreds = [];
		audioStateCbs = [];
		playbackFailureCbs = [];
		mocks.requestTtsAll.mockImplementation(
			async (
				words: string[],
				_voice: string,
				_signal: AbortSignal,
				onProgress: (done: number, total: number) => void,
			): Promise<TtsItem[]> => {
				onProgress(words.length, words.length);
				return words.map((word) => ({
					word,
					name: `${word}.mp3`,
					cached: true,
				}));
			},
		);
		mocks.requestDefinitions.mockResolvedValue({
			apple: "A round fruit.",
			banana: "A long yellow fruit.",
		});
		mocks.playWithIntervals.mockImplementation((opts: PlayOptions) => {
			const deferred = createDeferred<PlayOutcome>();
			playDeferreds.push(deferred);
			opts.onPlay(0);
			audioStateCbs.push(opts.onAudioState);
			if (opts.onPlaybackFailure)
				playbackFailureCbs.push(opts.onPlaybackFailure);
			return deferred.promise;
		});
	});

	afterEach(() => {
		mounted?.dispose();
		mounted = undefined;
		vi.useRealTimers();
		vi.unstubAllGlobals();
		vi.clearAllMocks();
	});

	async function prepare(words: string[], mode: "writing" | "cyber") {
		mounted = mountDictation();
		const d = mounted.dictation;
		for (const word of words) d.addWord(word);
		d.startDictation(mode);
		await flushAsyncWork();
		expect(d.phase()).toBe("ready");
		d.go();
		expect(d.phase()).toBe("dictating");
		return d;
	}

	it("赛博输入完成且正在发声 → 等当前遍播完（进入间隔）才跳", async () => {
		const d = await prepare(["apple"], "cyber");
		audioStateCbs[0](true); // 开始发声
		await flushAsyncWork();

		d.setWordInput("apple");
		d.submitWord();
		expect(d.remaining()).toBeGreaterThan(0);
		expect(d.phase()).toBe("dictating"); // 发声期间不跳

		audioStateCbs[0](false); // 当前遍播完进入间隔
		await flushAsyncWork();
		expect(d.phase()).toBe("results");
		expect(d.rounds()[0]).toMatchObject({ answer: "apple" });
	});

	it("推进时中止音频触发 onAudioState(false) 重入 → 只推进一次（防音频串播）", async () => {
		// 模拟真实 playWithIntervals：abort 时同步触发 onAudioState(false)（stop 清理）
		mocks.playWithIntervals.mockImplementation((opts: PlayOptions) => {
			const deferred = createDeferred<PlayOutcome>();
			playDeferreds.push(deferred);
			opts.onPlay(0);
			audioStateCbs.push(opts.onAudioState);
			opts.signal.addEventListener("abort", () => opts.onAudioState(false));
			return deferred.promise;
		});
		const d = await prepare(["apple", "banana"], "cyber");
		audioStateCbs[0](true); // 发声
		d.setWordInput("apple");
		d.submitWord();
		audioStateCbs[0](false); // 间隔区 → 推进；推进时 abort 触发重入
		await flushAsyncWork();
		expect(d.phase()).toBe("dictating");
		expect(d.currentIndex()).toBe(1);
		// 恰好只开了第 2 轮（没有因重入重复 startRound → 无第二个音频实例）
		expect(mocks.playWithIntervals).toHaveBeenCalledTimes(2);
		// 第 2 轮音频实例正常接管
		audioStateCbs[1](true);
		expect(d.sounding()).toBe(true);
		// 第 1 轮的延迟清理回调此时才到达，不得把第 2 轮的 sounding 改回 false
		audioStateCbs[0](false);
		expect(d.sounding()).toBe(true);
	});

	it("赛博快速结束叠加媒体错误：先淘汰缓存，再立即进入结果页", async () => {
		const d = await prepare(["apple"], "cyber");
		audioStateCbs[0](true);
		d.setWordInput("apple");
		d.submitWord();
		expect(d.phase()).toBe("dictating");

		// 真实 api.ts 的顺序：先报告失败，再报告停止发声；后者会触发快速 finish
		playbackFailureCbs[0]("media-error");
		audioStateCbs[0](false);
		expect(mocks.invalidateCacheFile).toHaveBeenCalledWith("apple.mp3");
		expect(d.phase()).toBe("results");

		// 迟到 outcome 已失效，但缓存淘汰早已启动
		playDeferreds[0].resolve("media-error");
		await flushAsyncWork();
		expect(mocks.invalidateCacheFile).toHaveBeenCalledTimes(1);
		expect(d.phase()).toBe("results");
	});

	it("赛博输入完成且语音在间隔区（未发声）→ 立即跳，不等剩余播报", async () => {
		const d = await prepare(["apple"], "cyber");
		audioStateCbs[0](true); // 发声
		audioStateCbs[0](false); // 播完进入间隔
		await flushAsyncWork();

		d.setWordInput("apple");
		d.submitWord();
		await flushAsyncWork();
		expect(d.phase()).toBe("results");
		// 余下播报已被中止（round 的播放已清理）
		expect(d.rounds()[0]).toMatchObject({ answer: "apple" });
	});

	it("书写模式自动推进仍需语音和倒计时都结束", async () => {
		const d = await prepare(["apple"], "writing");
		playDeferreds[0].resolve("completed");
		await flushAsyncWork();
		expect(d.speechDone()).toBe(true);
		expect(d.phase()).toBe("dictating");

		await vi.advanceTimersByTimeAsync(10_000);
		expect(d.phase()).toBe("results");
	});

	it("书写模式在未发声时按空格可人工跳到下一轮", async () => {
		const d = await prepare(["apple", "banana"], "writing");
		const preventDefault = vi.fn();

		d.onRootKeyDown({
			key: " ",
			code: "Space",
			preventDefault,
		} as unknown as KeyboardEvent);

		expect(preventDefault).toHaveBeenCalledOnce();
		expect(d.currentIndex()).toBe(1);
		expect(d.phase()).toBe("dictating");
		expect(mocks.playWithIntervals).toHaveBeenCalledTimes(2);
	});

	it("设置在停止输入 1.5 秒后保存，关闭面板会立即提交待保存内容", async () => {
		mounted = mountDictation();
		const d = mounted.dictation;
		const setItem = vi.mocked(localStorage.setItem);

		d.changeSettings({
			...d.settings(),
			aiBaseUrl: "https://example.test/v1",
		});
		d.changeSettings({
			...d.settings(),
			aiApiKey: "test-key",
		});

		expect(d.settings().aiApiKey).toBe("test-key");
		expect(setItem).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1_499);
		expect(setItem).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(setItem).toHaveBeenCalledOnce();
		expect(setItem).toHaveBeenLastCalledWith(
			"mds.settings.v1",
			JSON.stringify(d.settings()),
		);

		d.changeSettings({ ...d.settings(), aiModel: "custom-model" });
		d.setSettingsOpen(true);
		d.closeSettings();
		expect(d.settingsOpen()).toBe(false);
		expect(setItem).toHaveBeenCalledTimes(2);
		expect(setItem).toHaveBeenLastCalledWith(
			"mds.settings.v1",
			JSON.stringify(d.settings()),
		);
	});

	it("单个与批量修改都会立即持久化", () => {
		mounted = mountDictation();
		const d = mounted.dictation;
		d.addWords(["apple", "give up"]);

		d.addWords(["banana", "apple", " orange "]);
		d.addWord("  kiwi  ");
		d.addWord("   ");
		expect(d.words()).toEqual([
			"apple",
			"give up",
			"banana",
			"orange",
			"kiwi",
		]);
		expect(localStorage.setItem).toHaveBeenLastCalledWith(
			"mds.words.v1",
			JSON.stringify(["apple", "give up", "banana", "orange", "kiwi"]),
		);

		d.removeWord("give up");
		expect(d.words()).toEqual(["apple", "banana", "orange", "kiwi"]);
		d.clearWords();
		expect(d.words()).toEqual([]);
		expect(localStorage.setItem).toHaveBeenLastCalledWith(
			"mds.words.v1",
			"[]",
		);
	});

	it("释义赛博模式必须完成单词和释义两步才可快速推进", async () => {
		mounted = mountDictation();
		const d = mounted.dictation;
		d.changeSettings({
			...d.settings(),
			aiBaseUrl: "https://example.test/v1",
			aiApiKey: "test-key",
		});
		d.changeWithDefinition(true);
		d.addWord("apple");
		d.startDictation("cyber");
		await flushAsyncWork();
		d.go();

		d.setWordInput("apple");
		d.submitWord();
		playDeferreds[0].resolve("completed");
		await flushAsyncWork();
		expect(d.step()).toBe("def");
		expect(d.phase()).toBe("dictating");

		d.setDefInput("A round fruit.");
		d.submitDef();
		expect(d.phase()).toBe("results");
		// 同一次输入框 Enter 冒泡到 window 时，不能关闭刚出现的结果页
		d.onRootKeyDown({
			key: "Enter",
			code: "Enter",
			target: { tagName: "INPUT", isContentEditable: false },
			preventDefault: vi.fn(),
		} as unknown as KeyboardEvent);
		expect(d.phase()).toBe("results");
		expect(d.rounds()[0]).toMatchObject({
			answer: "apple",
			answerDef: "A round fruit.",
		});
	});

	it("释义赛博模式无操作超时会提交两个空输入并继续", async () => {
		mounted = mountDictation();
		const d = mounted.dictation;
		d.changeSettings({
			...d.settings(),
			aiBaseUrl: "https://example.test/v1",
			aiApiKey: "test-key",
		});
		d.changeWithDefinition(true);
		d.addWord("apple");
		d.startDictation("cyber");
		await flushAsyncWork();
		d.go();

		// 语音轨先结束；倒计时到点后应一次性封口单词和释义输入并进入结果页。
		playDeferreds[0].resolve("completed");
		await flushAsyncWork();
		expect(d.phase()).toBe("dictating");
		expect(d.step()).toBe("word");

		await vi.advanceTimersByTimeAsync(
			Math.ceil(d.rounds()[0].countdownSec * 1_000) + 100,
		);

		expect(d.remaining()).toBe(0);
		expect(d.speechDone()).toBe(true);
		expect(d.rounds()[0]).toMatchObject({ answer: "", answerDef: "" });
		expect(d.step()).toBe("done");
		expect(d.phase()).toBe("results");
	});
});

describe("useDictation 准备任务竞态（token 隔离）", () => {
	let mounted: { dictation: Dictation; dispose: () => void } | undefined;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal("window", {
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		});
		vi.stubGlobal("localStorage", {
			getItem: vi.fn().mockReturnValue(null),
			setItem: vi.fn(),
		});
		mocks.requestTtsAll.mockImplementation(
			async (
				words: string[],
				_voice: string,
				_signal: AbortSignal,
				onProgress: (done: number, total: number) => void,
			): Promise<TtsItem[]> => {
				onProgress(words.length, words.length);
				return words.map((word) => ({
					word,
					name: `${word}.mp3`,
					cached: true,
				}));
			},
		);
		mocks.requestDefinitions.mockResolvedValue({});
		mocks.playWithIntervals.mockImplementation((opts: PlayOptions) => {
			opts.onPlay(0);
			return Promise.resolve("completed" as const);
		});
	});

	afterEach(() => {
		mounted?.dispose();
		mounted = undefined;
		vi.useRealTimers();
		vi.unstubAllGlobals();
		vi.clearAllMocks();
	});

	it("中止后重新准备：旧任务的迟到结果不得覆盖新状态", async () => {
		// 第一次准备：requestTtsAll 挂起（模拟慢）
		let firstResolve!: (v: TtsItem[]) => void;
		mocks.requestTtsAll.mockImplementationOnce(
			() =>
				new Promise<TtsItem[]>((r) => {
					firstResolve = r;
				}),
		);

		mounted = mountDictation();
		const d = mounted.dictation;
		d.addWord("apple");
		d.startDictation("writing");
		await flushAsyncWork();
		expect(d.phase()).toBe("preparing");

		// 用户中止 → 立即重新开始（第二次准备正常完成）
		d.abortPreparation();
		expect(d.phase()).toBe("idle");
		d.startDictation("writing");
		await flushAsyncWork();
		expect(d.phase()).toBe("ready");

		// 旧任务此刻才返回（迟到结果）→ token 隔离，不得覆盖 ready / 不得清空 rounds
		firstResolve([{ word: "apple", name: "apple.mp3", cached: true }]);
		await flushAsyncWork();
		expect(d.phase()).toBe("ready");
		expect(d.rounds().length).toBe(1);
	});

	it("中止后的旧任务出错也不显示错误提示（不打扰新一轮）", async () => {
		let firstReject!: (e: Error) => void;
		mocks.requestTtsAll.mockImplementationOnce(
			() =>
				new Promise<TtsItem[]>((_, rj) => {
					firstReject = rj;
				}),
		);

		mounted = mountDictation();
		const d = mounted.dictation;
		d.addWord("apple");
		d.startDictation("writing");
		await flushAsyncWork();
		d.abortPreparation();
		d.startDictation("writing");
		await flushAsyncWork();
		expect(d.phase()).toBe("ready");

		// 旧任务以错误收尾（如网络异常迟到）→ 不得 setPrepError 干扰新一轮
		firstReject(new Error("late network error"));
		await flushAsyncWork();
		expect(d.phase()).toBe("ready");
		expect(d.prepError()).toBeNull();
	});
});

describe("useDictation 完整流程衔接（结果页）", () => {
	let playDeferreds: ReturnType<typeof createDeferred<PlayOutcome>>[];
	let audioStateCbs: ((playing: boolean) => void)[];
	let mounted: { dictation: Dictation; dispose: () => void } | undefined;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal("window", {
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		});
		vi.stubGlobal("localStorage", {
			getItem: vi.fn().mockReturnValue(null),
			setItem: vi.fn(),
		});
		playDeferreds = [];
		audioStateCbs = [];
		mocks.requestTtsAll.mockImplementation(
			async (
				words: string[],
				_voice: string,
				_signal: AbortSignal,
				onProgress: (done: number, total: number) => void,
			): Promise<TtsItem[]> => {
				onProgress(words.length, words.length);
				return words.map((word) => ({
					word,
					name: `${word}.mp3`,
					cached: true,
				}));
			},
		);
		mocks.requestDefinitions.mockResolvedValue({});
		mocks.playWithIntervals.mockImplementation((opts: PlayOptions) => {
			const deferred = createDeferred<PlayOutcome>();
			playDeferreds.push(deferred);
			opts.onPlay(0);
			audioStateCbs.push(opts.onAudioState);
			return deferred.promise;
		});
	});

	afterEach(() => {
		mounted?.dispose();
		mounted = undefined;
		vi.useRealTimers();
		vi.unstubAllGlobals();
		vi.clearAllMocks();
	});

	it("赛博无释义：逐轮间隔区提交 → 最后一轮直接进 results（不经过 idle）", async () => {
		mounted = mountDictation();
		const d = mounted.dictation;
		for (const w of ["apple", "banana", "orange"]) d.addWord(w);
		d.startDictation("cyber");
		await flushAsyncWork();
		d.go();
		expect(d.phase()).toBe("dictating");

		for (let i = 0; i < 3; i++) {
			if (i > 0) expect(d.rounds()).toHaveLength(3);
			audioStateCbs[i](true); // 发声
			d.setWordInput(`word${i}`);
			d.submitWord();
			expect(d.phase()).toBe("dictating");
			audioStateCbs[i](false); // 间隔 → 推进
			await flushAsyncWork();
			if (d.rounds().length !== 3)
				throw new Error(
					`第${i}轮后 rounds=${d.rounds().length} phase=${d.phase()}`,
				);
		}
		// 最后一轮推进后：直接 results，且过程从未出现 idle
		expect(d.phase()).toBe("results");
		expect(d.currentIndex()).toBe(2);
		const rr = d.rounds();
		expect(rr).toHaveLength(3);
		expect(rr.map((r) => r.answer)).toEqual(["word0", "word1", "word2"]);
	});

	it("最后一轮输入框 Enter 提交后立即留在 results，旧播音回调不得改页", async () => {
		mounted = mountDictation();
		const d = mounted.dictation;
		d.addWord("apple");
		d.startDictation("cyber");
		await flushAsyncWork();
		d.go();

		// 已播完当前遍、正处于播音间隔：提交应立刻结束整场
		audioStateCbs[0](true);
		audioStateCbs[0](false);
		d.setWordInput("apple");
		d.submitWord();
		expect(d.phase()).toBe("results");

		// 模拟提交用的同一个 Enter 继续冒泡到 window
		const preventDefault = vi.fn();
		d.onRootKeyDown({
			key: "Enter",
			code: "Enter",
			target: { tagName: "INPUT", isContentEditable: false },
			preventDefault,
		} as unknown as KeyboardEvent);
		expect(preventDefault).not.toHaveBeenCalled();
		expect(d.phase()).toBe("results");

		// 即使旧 play Promise 之后才完成，也已因 roundSeq 失效，不能再改变页面
		playDeferreds[0].resolve("completed");
		await flushAsyncWork();
		await vi.runAllTimersAsync();
		expect(d.phase()).toBe("results");
	});

	it("结果行保留音频名，试听只播一遍，失败淘汰缓存且关闭页面会中止", async () => {
		mounted = mountDictation();
		const d = mounted.dictation;
		d.addWord("apple");
		d.startDictation("cyber");
		await flushAsyncWork();
		d.go();

		// 当前轮进入间隔后提交，立即到结果页。
		audioStateCbs[0](true);
		audioStateCbs[0](false);
		d.setWordInput("apple");
		d.submitWord();
		expect(d.phase()).toBe("results");
		expect(d.resultRows()[0]).toMatchObject({
			word: "apple",
			audioName: "apple.mp3",
		});

		d.playResultAudio("apple.mp3");
		const preview = mocks.playWithIntervals.mock.calls[1][0] as PlayOptions;
		expect(preview).toMatchObject({
			url: "/api/audio?name=apple.mp3",
			count: 1,
			gapsMs: [0],
		});
		preview.onAudioState(true);
		expect(d.resultAudioName()).toBe("apple.mp3");
		preview.onPlaybackFailure?.("media-error");
		expect(mocks.invalidateCacheFile).toHaveBeenCalledWith("apple.mp3");

		// 发音按钮取得焦点时按 Enter 应播放按钮本身，不能被全局快捷键关闭结果页。
		d.onRootKeyDown({
			key: "Enter",
			code: "Enter",
			target: { tagName: "BUTTON", isContentEditable: false },
			preventDefault: vi.fn(),
		} as unknown as KeyboardEvent);
		expect(d.phase()).toBe("results");

		const preventDefault = vi.fn();
		d.onRootKeyDown({
			key: "Escape",
			code: "Escape",
			target: { tagName: "BUTTON", isContentEditable: false },
			preventDefault,
		} as unknown as KeyboardEvent);
		expect(preventDefault).toHaveBeenCalledOnce();
		expect(preview.signal.aborted).toBe(true);
		expect(d.resultAudioName()).toBeNull();
		expect(d.phase()).toBe("idle");
	});

	it("书写模式最后一轮空格跳过后立即进入并留在 results", async () => {
		mounted = mountDictation();
		const d = mounted.dictation;
		d.addWord("apple");
		d.startDictation("writing");
		await flushAsyncWork();
		d.go();

		d.onRootKeyDown({
			key: " ",
			code: "Space",
			preventDefault: vi.fn(),
		} as unknown as KeyboardEvent);
		expect(d.phase()).toBe("results");

		playDeferreds[0].resolve("completed");
		await flushAsyncWork();
		await vi.runAllTimersAsync();
		expect(d.phase()).toBe("results");
	});

	it("书写模式：双轨完成后最后一轮直接进 results", async () => {
		mounted = mountDictation();
		const d = mounted.dictation;
		for (const w of ["apple", "banana"]) d.addWord(w);
		d.startDictation("writing");
		await flushAsyncWork();
		d.go();

		// 第 1 轮：语音完 + 倒计时完 → 推进
		playDeferreds[0].resolve("completed");
		await flushAsyncWork();
		await vi.advanceTimersByTimeAsync(10_000);
		expect(d.currentIndex()).toBe(1);
		expect(d.phase()).toBe("dictating");

		// 第 2 轮（最后一轮）：语音完 + 倒计时完 → results
		playDeferreds[1].resolve("completed");
		await flushAsyncWork();
		await vi.advanceTimersByTimeAsync(10_000);
		expect(d.phase()).toBe("results");
	});
});
