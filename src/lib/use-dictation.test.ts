import { createRoot } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlayOptions, TtsItem } from "./api";

const mocks = vi.hoisted(() => ({
	requestTtsAll: vi.fn(),
	requestDefinitions: vi.fn(),
	playWithIntervals: vi.fn(),
}));

vi.mock("./api", () => ({
	audioUrl: (name: string) => `/word-cache/${encodeURIComponent(name)}`,
	requestTtsAll: mocks.requestTtsAll,
	requestDefinitions: mocks.requestDefinitions,
	playWithIntervals: mocks.playWithIntervals,
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
	let playDeferreds: ReturnType<typeof createDeferred<boolean>>[];
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
			const deferred = createDeferred<boolean>();
			playDeferreds.push(deferred);
			opts.onPlay(0);
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

	it("赛博模式完成输入后，语音结束即可跳过剩余倒计时", async () => {
		const d = await prepare(["apple"], "cyber");
		d.setWordInput("apple");
		d.submitWord();
		expect(d.remaining()).toBeGreaterThan(0);
		expect(d.phase()).toBe("dictating");

		playDeferreds[0].resolve(true);
		await flushAsyncWork();

		expect(d.phase()).toBe("results");
		expect(d.rounds()[0]).toMatchObject({ answer: "apple" });
	});

	it("书写模式自动推进仍需语音和倒计时都结束", async () => {
		const d = await prepare(["apple"], "writing");
		playDeferreds[0].resolve(true);
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

	it("释义赛博模式必须完成单词和释义两步才可快速推进", async () => {
		mounted = mountDictation();
		const d = mounted.dictation;
		d.changeSettings({
			...d.settings(),
			aiBaseUrl: "https://example.test/v1",
			aiApiKey: "test-key",
		});
		d.setWithDefinition(true);
		d.addWord("apple");
		d.startDictation("cyber");
		await flushAsyncWork();
		d.go();

		d.setWordInput("apple");
		d.submitWord();
		playDeferreds[0].resolve(true);
		await flushAsyncWork();
		expect(d.step()).toBe("def");
		expect(d.phase()).toBe("dictating");

		d.setDefInput("A round fruit.");
		d.submitDef();
		expect(d.phase()).toBe("results");
		expect(d.rounds()[0]).toMatchObject({
			answer: "apple",
			answerDef: "A round fruit.",
		});
	});
});
