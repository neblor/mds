/**
 * 默写流程编排（客户端 hook）
 * 纯逻辑状态机在 dictation-engine.ts（可直接单测）；本文件只做适配：
 * 事件入口 → runStep（防重入）→ 执行动作（中止音频/推进轮次）→ 同步 SolidJS 信号
 */
import { createMemo, createSignal, onCleanup, onMount } from "solid-js";
import {
	loadSettings,
	saveSettings,
	isAiConfigured,
	type AppSettings,
} from "./settings";
import {
	countdownDuration,
	speechIntervals,
	repeatCount,
	scaleTime,
	type SpeedLevel,
} from "./timing";
import { isStrictMatch } from "./match";
import {
	requestTtsAll,
	requestDefinitions,
	audioUrl,
	playWithIntervals,
	invalidateCacheFile,
	type TtsItem,
} from "./api";
import { shuffle, type DictationMode } from "./state";
import {
	stepEngine,
	type EngineEvent,
	type EngineState,
} from "./dictation-engine";

export type Phase = "idle" | "preparing" | "ready" | "dictating" | "results";

export interface DictRound {
	word: string;
	audioName: string;
	definition?: string;
	repeatCount: number;
	/** 计数轨时长（进度条），已含档位×倍率 */
	countdownSec: number;
	/** 播音间隔（秒，已含档位×倍率） */
	gapSec: number[];
	answer?: string;
	answerDef?: string;
}

interface PrepData {
	words: string[];
	nameMap: Map<string, string>;
	defs: Record<string, string>;
}

export interface ResultRow {
	word: string;
	definition?: string;
	answer?: string;
	answerDef?: string;
	correct?: boolean;
}

interface BuildRoundsOptions {
	words: string[];
	data: PrepData;
	level: SpeedLevel;
	withDef: boolean;
	multiplier: number;
}

function buildRounds(opts: BuildRoundsOptions): DictRound[] {
	const { words, data, level, withDef, multiplier } = opts;
	return words.map((w) => {
		// 只取自有属性，避免 constructor 等词键命中原型
		const def = Object.hasOwn(data.defs, w) ? data.defs[w] : undefined;
		const count = repeatCount(w, withDef);
		return {
			word: w,
			audioName: data.nameMap.get(w) ?? "",
			definition: def,
			repeatCount: count,
			countdownSec: countdownDuration({
				word: w,
				level,
				withDefinition: withDef,
				definitionText: def,
				multiplier,
			}),
			// 播音间隔按比例缩放（音频本身不动，只调间隔）
			gapSec: speechIntervals(w, count).map((g) =>
				scaleTime(g, level, multiplier),
			),
		};
	});
}

export function useDictation() {
	const [words, setWords] = createSignal<string[]>([]);
	const [speed, setSpeed] = createSignal<SpeedLevel>("normal");
	const [settings, setSettings] = createSignal<AppSettings>(loadSettings());
	const [settingsOpen, setSettingsOpen] = createSignal(false);
	const [phase, setPhase] = createSignal<Phase>("idle");
	const [mode, setMode] = createSignal<DictationMode>("writing");
	const [error, setError] = createSignal<string | null>(null);

	// 准备阶段
	const [prepProgress, setPrepProgress] = createSignal(0);
	const [prepStatus, setPrepStatus] = createSignal("");
	const [prepError, setPrepError] = createSignal<string | null>(null);
	let prepAbort: AbortController | null = null;
	/** 准备任务递增序号：只有当前 token 的任务允许写状态（隔离陈旧任务的竞态） */
	let prepSeq = 0;
	let lastPrep: PrepData | null = null;

	// 默写轮次
	const [rounds, setRounds] = createSignal<DictRound[]>([]);
	const [currentIndex, setCurrentIndex] = createSignal(0);
	const [remaining, setRemaining] = createSignal(0);
	const [, setCountdownDone] = createSignal(false);
	const [speechDone, setSpeechDone] = createSignal(false);
	const [repeatIndex, setRepeatIndex] = createSignal(-1);
	const [sounding, setSounding] = createSignal(false);

	// 释义开关持久化（刷新后保持值+视觉一致；浏览器表单恢复不再污染视觉）
	const DEFINITION_KEY = "mds.withDefinition.v1";
	const [withDefinition, setWithDefinition] = createSignal(false);
	const changeWithDefinition = (v: boolean) => {
		setWithDefinition(v);
		try {
			localStorage.setItem(DEFINITION_KEY, v ? "1" : "0");
		} catch {
			// 存储失败静默
		}
	};

	// 赛博输入（上提为受控值）
	const [wordInput, setWordInput] = createSignal("");
	const [defInput, setDefInput] = createSignal("");

	let timerId: ReturnType<typeof setInterval> | null = null;
	let audioAbort: AbortController | null = null;
	let roundSeq = 0;

	// —— 推进状态机（纯逻辑，见 dictation-engine.ts）——
	/** 引擎状态（普通对象；SolidJS 信号仅用于 UI 渲染同步） */
	let engine: EngineState = {
		mode: "writing",
		total: 0,
		currentIndex: 0,
		speechDone: false,
		countdownDone: false,
		sounding: false,
		inputDone: false,
	};
	/** 事件处理防重入：advance 中止音频时 abort→stop→onAudioState(false) 的嵌套回调会被忽略 */
	let stepping = false;

	const syncEngineSignals = () => {
		setSounding(engine.sounding);
		setSpeechDone(engine.speechDone);
		setCountdownDone(engine.countdownDone);
	};

	/**
	 * 全部轮次的唯一结束出口：先让当前轮的异步回调失效，再清理运行时并立即展示结果。
	 * 这样无论由提交、空格还是双轨自然完成触发，都不会等待播音间隔收尾。
	 */
	const finishDictation = () => {
		roundSeq++;
		clearRoundRuntime();
		setPhase("results");
	};

	/**
	 * 事件入口：状态机判定 → 执行动作（中止当前轮运行时/推进轮次）。
	 * 所有异步回调（音频状态、倒计时、提交）都经由这里，重入被忽略。
	 */
	const runStep = (event: EngineEvent) => {
		if (stepping || phase() !== "dictating") return;
		stepping = true;
		try {
			const { state, action } = stepEngine(engine, event);
			engine = state;
			syncEngineSignals();
			if (action.type === "wait") return;
			if (action.type === "finish") {
				finishDictation();
				return;
			}
			// startRound 会先清理当前轮运行时，再使旧回调失效并启动下一轮
			startRound(action.nextIndex);
		} finally {
			stepping = false;
		}
	};

	const clearRoundRuntime = () => {
		if (timerId !== null) {
			clearInterval(timerId);
			timerId = null;
		}
		audioAbort?.abort();
		audioAbort = null;
		setSounding(false);
	};
	onCleanup(clearRoundRuntime);

	const patchRound = (i: number, patch: Partial<DictRound>) =>
		setRounds((prev) =>
			prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)),
		);

	/* ---------- 词库 ---------- */
	const addWord = (w: string) => {
		setError(null);
		setWords((prev) => (prev.includes(w) ? prev : [...prev, w]));
	};
	const removeWord = (w: string) =>
		setWords((prev) => prev.filter((x) => x !== w));
	const clearWords = () => {
		setWords([]);
		setPhase("idle");
	};

	/* ---------- 准备 ---------- */
	const startDictation = (m: DictationMode) => {
		const ws = words();
		if (ws.length === 0) {
			setError("先添加一些单词再开始吧");
			return;
		}
		setError(null);
		if (withDefinition() && !isAiConfigured(settings())) {
			setError("释义模式需要先配置 AI 服务（右上角设置里填写）");
			return;
		}
		setMode(m);
		setPhase("preparing");
		setPrepError(null);
		setPrepProgress(0);
		setPrepStatus("正在生成语音…");
		prepAbort = new AbortController();
		const seq = ++prepSeq;
		void runPreparation(
			ws,
			withDefinition(),
			settings().voice,
			prepAbort.signal,
			seq,
		);
	};

	const runPreparation = async (
		ws: string[],
		withDef: boolean,
		voice: string,
		signal: AbortSignal,
		seq: number,
	) => {
		const shuffled = shuffle(ws);
		// 陈旧任务（被更新的准备/中止取代）不得再写任何状态
		const alive = () => seq === prepSeq && !signal.aborted;
		try {
			const ttsPromise = requestTtsAll(
				shuffled,
				voice,
				signal,
				(done, total) => {
					if (!alive()) return;
					setPrepProgress(done / total);
					setPrepStatus(
						`正在生成语音 ${done}/${total}${withDef ? " · 正在获取释义…" : ""}`,
					);
				},
			);
			const defsPromise = withDef
				? requestDefinitions(shuffled, settings(), signal)
				: Promise.resolve<Record<string, string>>({});
			const [items, defs] = await Promise.all([ttsPromise, defsPromise]);
			if (!alive()) return;

			const nameMap = new Map<string, string>(
				items.map((i: TtsItem) => [i.word, i.name]),
			);
			lastPrep = { words: shuffled, nameMap, defs };
			setRounds(
				buildRounds({
					words: shuffled,
					data: lastPrep,
					level: speed(),
					withDef,
					multiplier: settings().multiplier,
				}),
			);
			setPhase("ready");
		} catch (err) {
			if (!alive()) return;
			const msg = err instanceof Error ? err.message : String(err);
			setPrepError(msg);
		}
	};

	const abortPreparation = () => {
		// 先递增 token 再中止：旧任务的任何异步回调都立即失效
		prepSeq++;
		prepAbort?.abort();
		prepAbort = null;
		setRounds([]);
		setPhase("idle");
	};

	/* ---------- 逐轮（双轨制，状态机驱动） ---------- */
	const go = () => {
		setCurrentIndex(0);
		setPhase("dictating");
		engine = {
			...engine,
			mode: mode(),
			total: rounds().length,
			currentIndex: 0,
			speechDone: false,
			countdownDone: false,
			sounding: false,
			inputDone: false,
		};
		syncEngineSignals();
		startRound(0);
	};

	const inputDone = () => {
		if (mode() !== "cyber") return true;
		const r = rounds()[currentIndex()];
		if (r?.answer === undefined) return false;
		if (withDefinition() && r.answerDef === undefined) return false;
		return true;
	};

	const commitCurrentInputs = (i: number) => {
		const r = rounds()[i];
		if (mode() !== "cyber") return;
		const patch: Partial<DictRound> = {};
		if (r.answer === undefined) patch.answer = wordInput().trim();
		if (
			withDefinition() &&
			r.answer !== undefined &&
			r.answerDef === undefined
		) {
			patch.answerDef = defInput().trim();
		}
		if (Object.keys(patch).length > 0) patchRound(i, patch);
	};

	/** 从当前轮数据刷新引擎的 inputDone（提交后调用） */
	const refreshInputDone = () => {
		engine = { ...engine, inputDone: inputDone() };
	};

	const startRound = (i: number) => {
		clearRoundRuntime();
		roundSeq++;
		const seq = roundSeq;
		const r = rounds()[i];
		setCurrentIndex(i);
		engine = {
			...engine,
			currentIndex: i,
			speechDone: false,
			countdownDone: false,
			sounding: false,
			inputDone: false,
		};
		syncEngineSignals();
		setRepeatIndex(-1);
		setWordInput("");
		setDefInput("");

		// —— 计数轨：进度条（与音频无关）——
		const durMs = r.countdownSec * 1000;
		const startedAt = Date.now();
		setRemaining(r.countdownSec);
			timerId = setInterval(() => {
				if (seq !== roundSeq || phase() !== "dictating") return;
				const rem = Math.max(0, durMs - (Date.now() - startedAt)) / 1000;
			setRemaining(rem);
			if (rem <= 0) {
				if (timerId !== null) {
					clearInterval(timerId);
					timerId = null;
				}
				// 赛博：计数轨结束而输入未完 → 立即自动提交
				if (mode() === "cyber" && !inputDone()) {
					commitCurrentInputs(i);
					refreshInputDone();
				}
				runStep({ type: "countdown-end" });
			}
		}, 100);

		// —— 播音轨：自然播报 + 每遍间隔（不干涉音频）——
		audioAbort = new AbortController();
		const signal = audioAbort.signal;
		void playWithIntervals({
			url: audioUrl(r.audioName),
			count: r.repeatCount,
			gapsMs: r.gapSec.map((g) => g * 1000),
			signal,
			onPlay: (i2) => {
				if (seq !== roundSeq || phase() !== "dictating") return;
				setRepeatIndex(i2);
			},
			onAudioState: (playing) => {
				if (seq !== roundSeq || phase() !== "dictating") return;
				runStep({ type: "audio-state", playing });
			},
			// 错误必须在 onAudioState(false) 触发快速推进前启动缓存淘汰；
			// 否则 finish/advance 会使 seq 失效，迟到的 outcome 无法再处理坏缓存。
			onPlaybackFailure: () => {
				if (seq !== roundSeq) return;
				void invalidateCacheFile(r.audioName);
			},
		}).then((outcome) => {
			if (seq !== roundSeq) return;
			if (outcome === "aborted") return;
			runStep({ type: "speech-end" });
		});
	};

	/* ---------- 赛博输入 ---------- */
	const step = (): "word" | "def" | "done" | "none" => {
		if (mode() !== "cyber") return "none";
		const r = rounds()[currentIndex()];
		if (r?.answer === undefined) return "word";
		if (withDefinition() && r.answerDef === undefined) return "def";
		return "done";
	};
	const submitWord = () => {
		if (step() !== "word") return;
		patchRound(currentIndex(), { answer: wordInput().trim() });
		setWordInput("");
		refreshInputDone();
		runStep({ type: "submit" });
	};
	const submitDef = () => {
		if (step() !== "def") return;
		patchRound(currentIndex(), { answerDef: defInput().trim() });
		setDefInput("");
		refreshInputDone();
		runStep({ type: "submit" });
	};

	/* ---------- 结果 ---------- */
	const resultRows = createMemo<ResultRow[]>(() =>
		rounds().map((r) => ({
			word: r.word,
			definition: r.definition,
			answer: r.answer,
			answerDef: r.answerDef,
			correct:
				mode() === "cyber" ? isStrictMatch(r.answer ?? "", r.word) : undefined,
		})),
	);

	const closeResults = () => {
		setPhase("idle");
	};

	const changeSettings = (s: AppSettings) => {
		setSettings(s);
		saveSettings(s);
	};

	const currentRound = createMemo(() => rounds()[currentIndex()]);

	/* ---------- 键盘流 ---------- */
	/** 键盘流：结果页回车关闭；书写模式音频未发声时空格直接跳下一轮 */
	const onRootKeyDown = (e: KeyboardEvent) => {
		if (e.key === "Enter") {
			if (phase() === "results") {
				// 最后一个输入框的提交事件会在 phase 切到 results 后继续冒泡到 window；
				// 不能让同一次 Enter 立即关闭刚出现的结果页。
				const target = e.target as HTMLElement | null;
				if (
					target?.tagName === "INPUT" ||
					target?.tagName === "TEXTAREA" ||
					target?.isContentEditable
				) {
					return;
				}
				e.preventDefault();
				closeResults();
			}
		}
		if (e.code === "Space") {
			if (phase() === "dictating" && mode() === "writing" && !sounding()) {
				e.preventDefault();
				// 非赛博 + 音频不在发声：状态机判定（忽略计数轨）直接跳到下一轮
				runStep({ type: "space-skip" });
			}
		}
		if (e.key === "Escape") {
			if (settingsOpen()) setSettingsOpen(false);
			else if (phase() === "results") closeResults();
			else if (phase() === "ready") setPhase("idle");
			else if (phase() === "preparing") abortPreparation();
		}
	};

	// 绑定到 window：div 级 onKeyDown 在焦点不在其子树时收不到事件（书写模式无输入框），
	// 任何焦点位置都能捕获键盘流（各分支已按 phase/mode 限定，不会误触发输入）
	onMount(() => {
		window.addEventListener("keydown", onRootKeyDown);
		onCleanup(() => window.removeEventListener("keydown", onRootKeyDown));
		// 恢复释义开关的持久化值（SSR 阶段信号无 localStorage，必须在客户端恢复）
		try {
			const saved = localStorage.getItem(DEFINITION_KEY);
			if (saved === "1" || saved === "0") setWithDefinition(saved === "1");
		} catch {
			// localStorage 不可用（隐私模式等）时忽略，保持默认关闭
		}
	});

	return {
		words,
		speed,
		withDefinition,
		settings,
		settingsOpen,
		phase,
		mode,
		error,
		prepProgress,
		prepStatus,
		prepError,
		rounds,
		currentIndex,
		remaining,
		repeatIndex,
		sounding,
		speechDone,
		wordInput,
		defInput,
		currentRound,
		resultRows,
		addWord,
		removeWord,
		clearWords,
		setSpeed,
		changeWithDefinition,
		startDictation,
		abortPreparation,
		go,
		step,
		submitWord,
		submitDef,
		closeResults,
		changeSettings,
		setSettingsOpen,
		onRootKeyDown,
		setWordInput,
		setDefInput,
	};
}
