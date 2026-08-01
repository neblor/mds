/**
 * 默写流程编排（客户端 hook）
 * 从 index.tsx 拆出：双轨制（播音轨+计数轨）、赛博输入、结果计算、键盘流
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
	type TtsItem,
} from "./api";
import { shuffle, type DictationMode } from "./state";

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
		const def = data.defs[w];
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
	const [withDefinition, setWithDefinition] = createSignal(false);
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
	let lastPrep: PrepData | null = null;

	// 默写轮次
	const [rounds, setRounds] = createSignal<DictRound[]>([]);
	const [currentIndex, setCurrentIndex] = createSignal(0);
	const [remaining, setRemaining] = createSignal(0);
	const [countdownDone, setCountdownDone] = createSignal(false);
	const [speechDone, setSpeechDone] = createSignal(false);
	const [repeatIndex, setRepeatIndex] = createSignal(-1);
	const [sounding, setSounding] = createSignal(false);

	// 赛博输入（上提为受控值）
	const [wordInput, setWordInput] = createSignal("");
	const [defInput, setDefInput] = createSignal("");

	let timerId: ReturnType<typeof setInterval> | null = null;
	let audioAbort: AbortController | null = null;
	let roundSeq = 0;

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
		void runPreparation(
			ws,
			withDefinition(),
			settings().voice,
			prepAbort.signal,
		);
	};

	const runPreparation = async (
		ws: string[],
		withDef: boolean,
		voice: string,
		signal: AbortSignal,
	) => {
		const shuffled = shuffle(ws);
		try {
			const ttsPromise = requestTtsAll(
				shuffled,
				voice,
				signal,
				(done, total) => {
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
			if (signal.aborted) {
				setPhase("idle");
				return;
			}
			const msg = err instanceof Error ? err.message : String(err);
			setPrepError(msg);
		}
	};

	const abortPreparation = () => {
		prepAbort?.abort();
		prepAbort = null;
		setRounds([]);
		setPhase("idle");
	};

	/* ---------- 逐轮（双轨制） ---------- */
	const go = () => {
		setCurrentIndex(0);
		setPhase("dictating");
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

	const checkAdvance = (seq: number) => {
		if (seq !== roundSeq) return;
		// 播音轨必须走完（双轨制基础）
		if (!speechDone()) return;
		// 赛博：输入已完成 → 立即跳（进度条可忽略）；未完成 → 等计数轨结束自动提交
		if (mode() === "cyber") {
			if (!inputDone()) return;
		} else if (!countdownDone()) {
			return;
		}
		commitCurrentInputs(currentIndex());
		clearRoundRuntime();
		if (currentIndex() >= rounds().length - 1) {
			setPhase("results");
		} else {
			startRound(currentIndex() + 1);
		}
	};

	const startRound = (i: number) => {
		clearRoundRuntime();
		roundSeq++;
		const seq = roundSeq;
		const r = rounds()[i];
		setCurrentIndex(i);
		setCountdownDone(false);
		setSpeechDone(false);
		setRepeatIndex(-1);
		setSounding(false);
		setWordInput("");
		setDefInput("");

		// —— 计数轨：进度条（与音频无关）——
		const durMs = r.countdownSec * 1000;
		const startedAt = Date.now();
		setRemaining(r.countdownSec);
		timerId = setInterval(() => {
			const rem = Math.max(0, durMs - (Date.now() - startedAt)) / 1000;
			setRemaining(rem);
			if (rem <= 0) {
				if (timerId !== null) {
					clearInterval(timerId);
					timerId = null;
				}
				setCountdownDone(true);
				// 赛博：计数轨结束而输入未完 → 立即自动提交
				if (mode() === "cyber" && !inputDone()) commitCurrentInputs(i);
				checkAdvance(seq);
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
			onPlay: (i2) => setRepeatIndex(i2),
			onAudioState: (playing) => setSounding(playing),
		}).then((completed) => {
			if (seq !== roundSeq) return;
			if (completed) {
				setSpeechDone(true);
				checkAdvance(seq);
			}
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
		checkAdvance(roundSeq);
	};
	const submitDef = () => {
		if (step() !== "def") return;
		patchRound(currentIndex(), { answerDef: defInput().trim() });
		setDefInput("");
		checkAdvance(roundSeq);
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
				e.preventDefault();
				closeResults();
			}
		}
		if (e.code === "Space") {
			if (phase() === "dictating" && mode() === "writing" && !sounding()) {
				e.preventDefault();
				// 非赛博 + 音频不在发声：直接跳到下一轮（忽略计数轨）
				clearRoundRuntime();
				if (currentIndex() >= rounds().length - 1) {
					setPhase("results");
				} else {
					startRound(currentIndex() + 1);
				}
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
		setWithDefinition,
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
