import { createRoot } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type {
	PlaybackFailure,
	PlayOptions,
	PlayOutcome,
	TtsItem,
} from "./api";

const mocks = vi.hoisted(() => ({
	requestTtsAll: vi.fn(),
	requestDefinitions: vi.fn(),
	requestChineseWords: vi.fn(),
	requestClozeQuestions: vi.fn(),
	requestAnswerGrades: vi.fn(),
	playWithIntervals: vi.fn(),
	invalidateCacheFile: vi.fn(),
}));

vi.mock("./api", () => ({
	audioUrl: (name: string) => `/api/audio?name=${encodeURIComponent(name)}`,
	requestTtsAll: mocks.requestTtsAll,
	requestDefinitions: mocks.requestDefinitions,
	requestChineseWords: mocks.requestChineseWords,
	requestClozeQuestions: mocks.requestClozeQuestions,
	requestAnswerGrades: mocks.requestAnswerGrades,
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
import { HISTORY_STORAGE_KEY, type HistoryEntry } from "./history-storage";

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
		mocks.requestChineseWords.mockResolvedValue({});
		mocks.requestAnswerGrades.mockResolvedValue({ grades: [] });
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

	it("replaceWords 覆盖词表：trim、丢空、去重并持久化（再次默写回填/恢复暂存通道）", async () => {
		mounted = mountDictation();
		const d = mounted.dictation;
		d.addWord("old");
		d.replaceWords([" apple ", "", "apple", "banana", "  "]);
		expect(d.words()).toEqual(["apple", "banana"]);
		// 覆盖后原词不再存在，恢复通道复用同一入口
		d.replaceWords(["old"]);
		expect(d.words()).toEqual(["old"]);
		d.replaceWords([]);
		expect(d.words()).toEqual([]);
	});

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
		d.changeContentMode("definition");
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
		// 释义模式答完先进入 AI 批改，再出结果
		expect(d.phase()).toBe("grading");
		expect(mocks.requestAnswerGrades).toHaveBeenCalledWith(
			"definition",
			[{ word: "apple", expected: "A round fruit.", answer: "A round fruit." }],
			expect.anything(),
			expect.any(AbortSignal),
		);
		await flushAsyncWork();
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
		d.changeContentMode("definition");
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
		await flushAsyncWork();

		expect(d.remaining()).toBe(0);
		expect(d.speechDone()).toBe(true);
		expect(d.rounds()[0]).toMatchObject({ answer: "", answerDef: "" });
		expect(d.step()).toBe("done");
		expect(d.phase()).toBe("results");
	});

	/* ---------- 默写历史记录（落地结算页即记录，判定烘入；书写也记录） ---------- */

	const historyWrites = (): HistoryEntry[][] => {
		const setItem = localStorage.setItem as unknown as Mock;
		return setItem.mock.calls
			.filter(([key]) => key === HISTORY_STORAGE_KEY)
			.map(([, value]) => JSON.parse(value as string) as HistoryEntry[]);
	};

	it("赛博单词模式跑完记录历史，判定与汇总烘入条目", async () => {
		mounted = mountDictation();
		const d = mounted.dictation;
		d.addWord("apple");
		d.startDictation("cyber");
		await flushAsyncWork();
		d.go();

		audioStateCbs[0](true);
		audioStateCbs[0](false);
		d.setWordInput("apple");
		d.submitWord();
		expect(d.phase()).toBe("results");

		const writes = historyWrites();
		expect(writes).toHaveLength(1);
		const [entry] = writes[0];
		expect(entry.mode).toBe("cyber");
		expect(entry.contentMode).toBe("word");
		expect(entry.wordCount).toBe(1);
		expect(entry.correctCount).toBe(1);
		expect(entry.gradeNote).toBeNull();
		expect(entry.rows[0]).toMatchObject({ word: "apple", audioName: "apple.mp3" });
		expect(entry.rows[0].fields[0]).toMatchObject({
			kind: "word",
			correct: true,
			userValue: "apple",
		});
	});

	it("释义模式 AI 批改结果与降级说明随历史烘入", async () => {
		mocks.requestAnswerGrades.mockResolvedValue({
			grades: [{ word: "apple", correct: true, note: "意思相同" }],
		});
		mounted = mountDictation();
		const d = mounted.dictation;
		d.changeSettings({
			...d.settings(),
			aiBaseUrl: "https://example.test/v1",
			aiApiKey: "test-key",
		});
		d.changeContentMode("definition");
		d.addWord("apple");
		d.startDictation("cyber");
		await flushAsyncWork();
		d.go();

		audioStateCbs[0](true);
		audioStateCbs[0](false);
		d.setWordInput("apple");
		d.submitWord();
		d.setDefInput("fruit that is round");
		d.submitDef();
		expect(d.phase()).toBe("grading");
		await flushAsyncWork();
		expect(d.phase()).toBe("results");

		const [entry] = historyWrites()[0];
		expect(entry.contentMode).toBe("definition");
		// AI 判定覆盖本地匹配（改述本地不算对，AI 算对），并带备注
		expect(entry.rows[0].fields[1]).toMatchObject({
			kind: "definition",
			correct: true,
			note: "意思相同",
		});
		expect(entry.gradeNote).toBeNull();
	});

	it("中止 AI 批改降级本地匹配，历史记录降级说明与本地判定", async () => {
		mounted = mountDictation();
		const d = mounted.dictation;
		d.changeSettings({
			...d.settings(),
			aiBaseUrl: "https://example.test/v1",
			aiApiKey: "test-key",
		});
		d.changeContentMode("definition");
		d.addWord("apple");
		d.startDictation("cyber");
		await flushAsyncWork();
		d.go();

		audioStateCbs[0](true);
		audioStateCbs[0](false);
		d.setWordInput("apple");
		d.submitWord();
		d.setDefInput("A round fruit.");
		d.submitDef();
		expect(d.phase()).toBe("grading");
		d.abortGrading();
		expect(d.phase()).toBe("results");

		const [entry] = historyWrites()[0];
		expect(entry.gradeNote).toBe("已中止 AI 批改，改用本地匹配判定");
		// 本地归一化匹配判对
		expect(entry.rows[0].fields[1]).toMatchObject({
			kind: "definition",
			correct: true,
		});
	});

	it("书写模式同样记录历史：mode=writing、无判定字段、不评分", async () => {
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

		const writes = historyWrites();
		expect(writes).toHaveLength(1);
		const [entry] = writes[0];
		expect(entry.mode).toBe("writing");
		expect(entry.wordCount).toBe(1);
		// 书写模式无批改：单词模式 fields 为空，correctCount 为 0
		expect(entry.rows[0].word).toBe("apple");
		expect(entry.rows[0].fields.every((f) => !f.graded)).toBe(true);
		expect(entry.correctCount).toBe(0);
		expect(entry.gradeNote).toBeNull();
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
		mocks.requestChineseWords.mockResolvedValue({});
		mocks.requestAnswerGrades.mockResolvedValue({ grades: [] });
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
		mocks.requestChineseWords.mockResolvedValue({});
		mocks.requestAnswerGrades.mockResolvedValue({ grades: [] });
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
		expect(rr.map((r) => (r.kind === "word" ? r.answer : undefined))).toEqual([
			"word0",
			"word1",
			"word2",
		]);
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

describe("useDictation 中文词模式", () => {
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
		mocks.requestChineseWords.mockResolvedValue({
			apple: "苹果",
			hello: "你好",
		});
		mocks.requestAnswerGrades.mockResolvedValue({ grades: [] });
		playDeferreds = [];
		audioStateCbs = [];
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

	it("准备阶段请求中文词，轮次携带中文词且按两段时长计算倒计时", async () => {
		mounted = mountDictation();
		const d = mounted.dictation;
		d.changeSettings({
			...d.settings(),
			aiBaseUrl: "https://example.test/v1",
			aiApiKey: "test-key",
		});
		d.changeContentMode("chinese");
		d.addWord("hello");
		d.startDictation("cyber");
		await flushAsyncWork();

		expect(mocks.requestChineseWords).toHaveBeenCalledWith(
			["hello"],
			expect.objectContaining({ aiBaseUrl: "https://example.test/v1" }),
			expect.any(AbortSignal),
		);
		expect(mocks.requestDefinitions).not.toHaveBeenCalled();
		expect(d.phase()).toBe("ready");
		const round = d.rounds()[0];
		expect(round.kind === "word" ? round.chineseWord : undefined).toBe("你好");
		// 单词段 (2+0.3×5)×2 = 7.0 + 中文段 2+1.5×2 = 5.0 → 12.0
		expect(round.countdownSec).toBe(12);
	});

	it("中文词模式赛博：两段式输入，进入批改并依 AI 结果判定", async () => {
		mounted = mountDictation();
		const d = mounted.dictation;
		d.changeSettings({
			...d.settings(),
			aiBaseUrl: "https://example.test/v1",
			aiApiKey: "test-key",
		});
		d.changeContentMode("chinese");
		d.addWord("hello");
		d.startDictation("cyber");
		await flushAsyncWork();
		d.go();

		expect(d.step()).toBe("word");
		audioStateCbs[0](true);
		d.setWordInput("hello");
		d.submitWord();
		expect(d.step()).toBe("def");
		expect(d.phase()).toBe("dictating");
		d.setDefInput("你好！");
		d.submitDef();
		// 播完 → 最后一轮 finish → 先进入 grading（mock 立即 resolve 时批改瞬态）
		audioStateCbs[0](false);
		expect(d.phase()).toBe("grading");
		await flushAsyncWork();
		expect(d.phase()).toBe("results");
		expect(mocks.requestAnswerGrades).toHaveBeenCalledWith(
			"chinese",
			[
				{
					word: "hello",
					expected: "你好",
					answer: "你好！",
				},
			],
			expect.objectContaining({ aiBaseUrl: "https://example.test/v1" }),
			expect.any(AbortSignal),
		);
		await flushAsyncWork();
		expect(d.phase()).toBe("results");
		const fields = d.resultRows()[0].fields;
		expect(fields[0]).toMatchObject({
			kind: "word",
			userValue: "hello",
			correct: true,
		});
		expect(fields[1]).toMatchObject({
			kind: "chinese",
			userValue: "你好！",
			correct: true,
		});
	});

	it("中文词模式赛博：AI 判定覆盖本地匹配（同义词算对/判错）", async () => {
		mounted = mountDictation();
		const d = mounted.dictation;
		d.changeSettings({
			...d.settings(),
			aiBaseUrl: "https://example.test/v1",
			aiApiKey: "test-key",
		});
		d.changeContentMode("chinese");
		d.addWord("hello");
		d.startDictation("cyber");
		await flushAsyncWork();
		d.go();

		// 作答与标准不同，但 AI 认为同义词算对
		mocks.requestAnswerGrades.mockResolvedValueOnce({
			grades: [{ word: "hello", correct: true, note: "同义词" }],
		});
		audioStateCbs[0](true);
		d.setWordInput("hello");
		d.submitWord();
		d.setDefInput("哈喽");
		d.submitDef();
		audioStateCbs[0](false);
		await flushAsyncWork();
		await flushAsyncWork();
		expect(d.phase()).toBe("results");
		expect(d.resultRows()[0].fields[1]).toMatchObject({
			correct: true,
			note: "同义词",
		});

		// AI 判错 → 覆盖本地匹配的正确结论
		mounted.dispose();
		mounted = mountDictation();
		const d2 = mounted.dictation;
		d2.changeSettings({
			...d2.settings(),
			aiBaseUrl: "https://example.test/v1",
			aiApiKey: "test-key",
		});
		d2.changeContentMode("chinese");
		d2.addWord("hello");
		d2.startDictation("cyber");
		await flushAsyncWork();
		d2.go();
		mocks.requestAnswerGrades.mockResolvedValueOnce({
			grades: [{ word: "hello", correct: false, note: "字写错了" }],
		});
		audioStateCbs[1](true);
		d2.setWordInput("hello");
		d2.submitWord();
		d2.setDefInput("你好");
		d2.submitDef();
		audioStateCbs[1](false);
		await flushAsyncWork();
		await flushAsyncWork();
		expect(d2.resultRows()[0].fields[1]).toMatchObject({
			correct: false,
			note: "字写错了",
		});
	});

	it("中文词模式赛博：AI 批改失败降级本地判定并提示", async () => {
		mounted = mountDictation();
		const d = mounted.dictation;
		d.changeSettings({
			...d.settings(),
			aiBaseUrl: "https://example.test/v1",
			aiApiKey: "test-key",
		});
		d.changeContentMode("chinese");
		d.addWord("hello");
		d.startDictation("cyber");
		await flushAsyncWork();
		d.go();

		mocks.requestAnswerGrades.mockRejectedValueOnce(
			new Error("network down"),
		);
		audioStateCbs[0](true);
		d.setWordInput("hello");
		d.submitWord();
		d.setDefInput("你好");
		d.submitDef();
		audioStateCbs[0](false);
		await flushAsyncWork();
		await flushAsyncWork();
		expect(d.phase()).toBe("results");
		expect(d.gradeNote()).toContain("本地匹配");
		expect(d.resultRows()[0].fields[1].correct).toBe(true);
	});

	it("中文词模式赛博：中止批改直接进结果并降级本地判定", async () => {
		mounted = mountDictation();
		const d = mounted.dictation;
		d.changeSettings({
			...d.settings(),
			aiBaseUrl: "https://example.test/v1",
			aiApiKey: "test-key",
		});
		d.changeContentMode("chinese");
		d.addWord("hello");
		d.startDictation("cyber");
		await flushAsyncWork();
		d.go();

		let resolveGrade!: (v: { grades: { word: string; correct: boolean }[] }) => void;
		mocks.requestAnswerGrades.mockReturnValueOnce(
			new Promise((r) => {
				resolveGrade = r;
			}),
		);
		audioStateCbs[0](true);
		d.setWordInput("hello");
		d.submitWord();
		d.setDefInput("你好");
		d.submitDef();
		audioStateCbs[0](false);
		await flushAsyncWork();
		expect(d.phase()).toBe("grading");

		d.abortGrading();
		expect(d.phase()).toBe("results");
		expect(d.gradeNote()).toContain("中止");
		expect(d.resultRows()[0].fields[1].correct).toBe(true);
		// 迟到的批改结果不得再覆盖状态
		resolveGrade({ grades: [{ word: "hello", correct: false }] });
		await flushAsyncWork();
		expect(d.resultRows()[0].fields[1].correct).toBe(true);
	});

	it("单词模式不会进入批改阶段", async () => {
		mounted = mountDictation();
		const d = mounted.dictation;
		d.addWord("hello");
		d.startDictation("cyber");
		await flushAsyncWork();
		d.go();
		audioStateCbs[0](true);
		d.setWordInput("hello");
		d.submitWord();
		audioStateCbs[0](false);
		await flushAsyncWork();
		expect(d.phase()).toBe("results");
		expect(mocks.requestAnswerGrades).not.toHaveBeenCalled();
	});

	it("中文词模式未配置 AI 时阻止开始并提示", async () => {
		mounted = mountDictation();
		const d = mounted.dictation;
		d.changeContentMode("chinese");
		d.addWord("hello");
		d.startDictation("writing");
		expect(d.phase()).toBe("idle");
		expect(d.error()).toContain("AI");
	});

	it("中文词模式书写：结果页只展示参考中文词，不批改", async () => {
		mounted = mountDictation();
		const d = mounted.dictation;
		d.changeSettings({
			...d.settings(),
			aiBaseUrl: "https://example.test/v1",
			aiApiKey: "test-key",
		});
		d.changeContentMode("chinese");
		d.addWord("hello");
		d.startDictation("writing");
		await flushAsyncWork();
		d.go();
		playDeferreds[0].resolve("completed");
		await flushAsyncWork();
		// 中文模式倒计时 = 单词段 7.0 + 中文段 5.0 = 12s
		await vi.advanceTimersByTimeAsync(20_000);
		expect(d.phase()).toBe("results");
		expect(mocks.requestAnswerGrades).not.toHaveBeenCalled();
		const field = d.resultRows()[0].fields[0];
		expect(field).toMatchObject({ kind: "chinese", expected: "你好" });
		expect(field.graded).toBe(false);
	});
});

describe("useDictation 组句（cloze）", () => {
	let mounted: { dictation: Dictation; dispose: () => void } | undefined;

	/** 两道题、共 4 个空：apple / give up / umbrella / happy */
	const CLOZE_ITEMS = [
		{
			id: 1,
			sentences: [
				"I like to eat ##1 after lunch.",
				"Never ##2 when it is hard.",
			],
			blanks: [
				{ index: 1, answer: "apple" },
				{ index: 2, answer: "give up" },
			],
			usedWords: ["apple", "give up"],
		},
		{
			id: 2,
			sentences: [
				"She took an ##1 because it will rain.",
				"We are ##2 today.",
			],
			blanks: [
				{ index: 1, answer: "umbrella" },
				{ index: 2, answer: "happy" },
			],
			usedWords: ["umbrella", "happy"],
		},
	];

	const WORDS = ["apple", "give up", "umbrella", "happy", "orange", "banana"];

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
					name: `${word.replace(/\s+/g, "_")}.mp3`,
					cached: true,
				}));
			},
		);
		mocks.requestDefinitions.mockResolvedValue({});
		mocks.requestChineseWords.mockResolvedValue({});
		mocks.requestClozeQuestions.mockResolvedValue(CLOZE_ITEMS);
		mocks.requestAnswerGrades.mockResolvedValue({ grades: [] });
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

	async function prepareCloze(words: string[] = WORDS) {
		mounted = mountDictation();
		const d = mounted.dictation;
		d.changeSettings({
			...d.settings(),
			aiBaseUrl: "https://example.test/v1",
			aiApiKey: "test-key",
		});
		d.changeContentMode("cloze");
		for (const word of words) d.addWord(word);
		d.startDictation("cyber");
		await flushAsyncWork();
		return d;
	}

	it("准备：一次出题 + 只为答案词合成音频", async () => {
		const d = await prepareCloze();
		expect(d.phase()).toBe("ready");
		expect(mocks.requestClozeQuestions).toHaveBeenCalledTimes(1);
		const candidates = mocks.requestClozeQuestions.mock.calls[0][0] as {
			word: string;
		}[];
		expect(candidates.map((entry) => entry.word)).toEqual(WORDS);
		// TTS 只为答案词（不含干扰词 orange / banana）
		const ttsWords = mocks.requestTtsAll.mock.calls[0][0] as string[];
		expect(ttsWords).toEqual(["apple", "give up", "umbrella", "happy"]);
		expect(d.clozeCandidates()).toEqual(WORDS);
		expect(d.rounds()).toHaveLength(2);
		for (const round of d.rounds()) {
			expect(round.kind).toBe("cloze");
			expect(round.repeatCount).toBe(0);
			expect(round.gapSec).toEqual([]);
			expect(round.countdownSec).toBeGreaterThan(0);
		}
	});

	it("候选池只取前 24 个词，其余留给下一场", async () => {
		const words = Array.from({ length: 30 }, (_, index) => `word${index}`);
		mocks.requestClozeQuestions.mockResolvedValueOnce([
			{
				id: 1,
				sentences: ["Use ##1 now.", "Use ##2 here."],
				blanks: [
					{ index: 1, answer: "word0" },
					{ index: 2, answer: "word1" },
				],
				usedWords: ["word0", "word1"],
			},
		]);
		const d = await prepareCloze(words);
		expect(d.phase()).toBe("ready");
		const candidates = mocks.requestClozeQuestions.mock.calls[0][0] as {
			word: string;
		}[];
		expect(candidates).toHaveLength(24);
		expect(candidates[0].word).toBe("word0");
		expect(candidates.at(-1)?.word).toBe("word23");
	});

	it("组句只允许赛博：传 writing 也强制 cyber", async () => {
		mounted = mountDictation();
		const d = mounted.dictation;
		d.changeSettings({
			...d.settings(),
			aiBaseUrl: "https://example.test/v1",
			aiApiKey: "test-key",
		});
		d.changeContentMode("cloze");
		d.addWord("apple");
		d.startDictation("writing");
		await flushAsyncWork();
		expect(d.mode()).toBe("cyber");
		expect(d.phase()).toBe("ready");
	});

	it("组句轮不播语音：直接进作答，选完所有空自动提交并推进", async () => {
		const d = await prepareCloze();
		d.go();
		expect(d.phase()).toBe("dictating");
		expect(d.speechDone()).toBe(true);
		expect(mocks.playWithIntervals).not.toHaveBeenCalled();
		// 第 1 题：填第 1 个空不推进，填满后立即进第 2 题（不等倒计时）
		d.chooseClozeWord(1, "apple");
		expect(d.currentIndex()).toBe(0);
		expect(d.phase()).toBe("dictating");
		d.chooseClozeWord(2, "give up");
		expect(d.currentIndex()).toBe(1);
		// 第 2 题：故意填错一个，进结果页
		d.chooseClozeWord(1, "banana");
		d.chooseClozeWord(2, "happy");
		expect(d.phase()).toBe("results");
		const rows = d.resultRows();
		expect(rows).toHaveLength(4);
		expect(rows[0]).toMatchObject({
			word: "apple",
			audioName: "apple.mp3",
			context: "I like to eat apple after lunch.",
		});
		expect(rows[2]).toMatchObject({ word: "umbrella" });
		expect(rows.map((row) => row.fields[0].correct)).toEqual([
			true,
			true,
			false,
			true,
		]);
	});

	it("倒计时结束未选完：未选的空按空提交并进入下一轮", async () => {
		const d = await prepareCloze();
		d.go();
		d.chooseClozeWord(1, "apple");
		const duration = d.currentRound()?.countdownSec ?? 0;
		await vi.advanceTimersByTimeAsync(duration * 1000 + 300);
		expect(d.currentIndex()).toBe(1);
		const first = d.rounds()[0];
		expect(first.kind === "cloze" && first.blanks[1].chosen).toBe("");
		expect(first.kind === "cloze" && first.blanks[0].chosen).toBe("apple");
	});

	it("清空已选并重新选择不重复提交", async () => {
		const d = await prepareCloze();
		d.go();
		d.chooseClozeWord(1, "apple");
		d.clearClozeWord(1);
		expect(d.currentIndex()).toBe(0);
		d.chooseClozeWord(1, "apple");
		d.chooseClozeWord(2, "give up");
		expect(d.currentIndex()).toBe(1);
	});

	it("出题失败：准备态报「AI 当前不可用」，不降级不重试", async () => {
		mocks.requestClozeQuestions.mockRejectedValueOnce(
			new Error("生成的题目不符合要求：第 1 题的答案「made-up」不在候选词里"),
		);
		const d = await prepareCloze();
		expect(d.phase()).toBe("preparing");
		expect(d.prepError()).toContain("AI 当前不可用");
		expect(d.prepError()).toContain("不符合要求");
		expect(mocks.requestClozeQuestions).toHaveBeenCalledTimes(1);
		expect(mocks.requestTtsAll).not.toHaveBeenCalled();
	});

	it("语音失败降级：本场照常进行，结果页发音置灰并给提示", async () => {
		mocks.requestTtsAll.mockRejectedValueOnce(new Error("tts down"));
		const d = await prepareCloze();
		expect(d.phase()).toBe("ready");
		expect(d.resultNote()).toContain("语音生成失败");
		d.go();
		d.chooseClozeWord(1, "apple");
		d.chooseClozeWord(2, "give up");
		d.chooseClozeWord(1, "umbrella");
		d.chooseClozeWord(2, "happy");
		expect(d.phase()).toBe("results");
		expect(d.resultRows().every((row) => row.audioName === "")).toBe(true);
	});

	it("结果落地历史：contentMode=cloze，句子上下文烘入条目", async () => {
		const d = await prepareCloze();
		d.go();
		d.chooseClozeWord(1, "apple");
		d.chooseClozeWord(2, "give up");
		d.chooseClozeWord(1, "umbrella");
		d.chooseClozeWord(2, "happy");
		const setItem = localStorage.setItem as unknown as Mock;
		const writes = setItem.mock.calls.filter(
			([key]) => key === HISTORY_STORAGE_KEY,
		);
		expect(writes.length).toBeGreaterThan(0);
		const entries = JSON.parse(String(writes.at(-1)?.[1])) as HistoryEntry[];
		expect(entries[0].contentMode).toBe("cloze");
		expect(entries[0].rows[0].context).toContain("after lunch");
	});
});
