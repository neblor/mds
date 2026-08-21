/**
 * 默写流程编排（客户端 hook）
 * 纯逻辑状态机在 dictation-engine.ts（可直接单测）；本文件只做适配：
 * 事件入口 → runStep（防重入）→ 执行动作（中止音频/推进轮次）→ 同步 SolidJS 信号
 */
import { createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { debounce } from "es-toolkit/function";
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
import {
	requestTtsAll,
	requestDefinitions,
	requestChineseWords,
	requestAnswerGrades,
	audioUrl,
	playWithIntervals,
	invalidateCacheFile,
	type TtsItem,
	type GradeItem,
} from "./api";
import { shuffle, type DictationMode, type ContentMode } from "./state";
import {
	stepEngine,
	type EngineEvent,
	type EngineState,
} from "./dictation-engine";
import { loadWords, saveWords } from "./word-storage";
import { timedOutInputPatch } from "./dictation-input";
import {
	buildResultRows,
	type ResultRow,
	type GradeOverride,
} from "./results";

export type Phase =
	| "idle"
	| "preparing"
	| "ready"
	| "dictating"
	| "grading"
	| "results";

export interface DictRound {
	word: string;
	audioName: string;
	definition?: string;
	/** 中文词模式：AI 抓取的常用中文对应词 */
	chineseWord?: string;
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
	chinese: Record<string, string>;
}

interface BuildRoundsOptions {
	words: string[];
	data: PrepData;
	level: SpeedLevel;
	contentMode: ContentMode;
	multiplier: number;
}

function buildRounds(opts: BuildRoundsOptions): DictRound[] {
	const { words, data, level, contentMode, multiplier } = opts;
	return words.map((w) => {
		// 只取自有属性，避免 constructor 等词键命中原型
		const def = Object.hasOwn(data.defs, w) ? data.defs[w] : undefined;
		const chineseWord = Object.hasOwn(data.chinese, w)
			? data.chinese[w]
			: undefined;
		const withDef = contentMode === "definition";
		const count = repeatCount(w, withDef);
		return {
			word: w,
			audioName: data.nameMap.get(w) ?? "",
			definition: def,
			chineseWord,
			repeatCount: count,
			countdownSec: countdownDuration({
				word: w,
				level,
				withDefinition: withDef,
				definitionText: def,
				chineseText: contentMode === "chinese" ? chineseWord : undefined,
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
	// SSR 与客户端水合必须从相同的空状态开始；持久化词库在 onMount 后恢复，
	// 否则已有 localStorage 时会造成服务端空列表与客户端列表不一致。
	const [words, setWords] = createSignal<string[]>([]);
	const [speed, setSpeed] = createSignal<SpeedLevel>("normal");
	const [settings, setSettings] = createSignal<AppSettings>(loadSettings());
	const [settingsOpen, setSettingsOpen] = createSignal(false);
	const saveSettingsDebounced = debounce(saveSettings, 1_500);
	const flushPendingSettings = () => saveSettingsDebounced.flush();
	onCleanup(flushPendingSettings);
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

	// 默写内容模式持久化（刷新后保持值+视觉一致；浏览器表单恢复不再污染视觉）
	// 兼容旧版释义开关：mds.withDefinition.v1 的 "1"/"0" 映射到 definition/word
	const CONTENT_MODE_KEY = "mds.contentMode.v1";
	const LEGACY_DEFINITION_KEY = "mds.withDefinition.v1";
	const [contentMode, setContentMode] = createSignal<ContentMode>("word");
	const changeContentMode = (m: ContentMode) => {
		setContentMode(m);
		try {
			localStorage.setItem(CONTENT_MODE_KEY, m);
		} catch {
			// 存储失败静默
		}
	};

	// 赛博输入（上提为受控值）
	const [wordInput, setWordInput] = createSignal("");
	const [defInput, setDefInput] = createSignal("");

	let timerId: ReturnType<typeof setInterval> | null = null;
	let audioAbort: AbortController | null = null;
	let resultAudioAbort: AbortController | null = null;
	let roundSeq = 0;
	const [resultAudioName, setResultAudioName] = createSignal<string | null>(null);

	// —— AI 批改（中文词赛博模式）——
	let gradeAbort: AbortController | null = null;
	/** 批改任务递增序号：只有当前 token 的任务允许写状态 */
	let gradeSeq = 0;
	/** AI 批改结果：word → 判定 */
	let lastGrades: Record<string, GradeOverride> | null = null;
	/** 批改来源说明（失败/中止降级时展示给用户） */
	const [gradeNote, setGradeNote] = createSignal<string | null>(null);

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
	 * 全部轮次的唯一结束出口：先让当前轮的异步回调失效，再清理运行时。
	 * 两段式内容模式（释义/中文词）的赛博默写先进入 grading（AI 批改）再展示结果；
	 * 其余模式直接展示结果。
	 */
	const finishDictation = () => {
		roundSeq++;
		clearRoundRuntime();
		if (
			mode() === "cyber" &&
			(contentMode() === "chinese" || contentMode() === "definition")
		) {
			setPhase("grading");
			void runGrading();
		} else {
			setPhase("results");
		}
	};

	/* ---------- AI 批改（一次请求批改本场全部第二步作答） ---------- */
	const runGrading = async () => {
		const kind = contentMode() === "chinese" ? "chinese" : "definition";
		const items: GradeItem[] = rounds()
			.filter((r) => r.answerDef !== undefined)
			.map((r) => ({
				word: r.word,
				expected:
					kind === "chinese" ? (r.chineseWord ?? "") : (r.definition ?? ""),
				answer: r.answerDef ?? "",
			}));
		// 防御：没有可批改的作答（理论不会发生）直接进结果
		if (items.length === 0) {
			setPhase("results");
			return;
		}
		const seq = ++gradeSeq;
		gradeAbort = new AbortController();
		const alive = () => seq === gradeSeq;
		try {
			const res = await requestAnswerGrades(
				kind,
				items,
				settings(),
				gradeAbort.signal,
			);
			if (!alive()) return;
			const map: Record<string, GradeOverride> = {};
			for (const g of res.grades) {
				map[g.word] = { correct: g.correct, ...(g.note ? { note: g.note } : {}) };
			}
			lastGrades = map;
			setGradeNote(
				res.warning ? `AI 批改完成，部分题目降级为本地判定（${res.warning}）` : null,
			);
		} catch (err) {
			if (!alive()) return;
			lastGrades = null;
			setGradeNote("AI 批改失败，已改用本地匹配判定");
		} finally {
			if (alive()) setPhase("results");
		}
	};

	/** 中止批改：降级本地判定并直接进入结果页 */
	const abortGrading = () => {
		gradeSeq++;
		gradeAbort?.abort();
		gradeAbort = null;
		lastGrades = null;
		setGradeNote("已中止 AI 批改，改用本地匹配判定");
		setPhase("results");
	};
	onCleanup(() => gradeAbort?.abort());

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
	const stopResultAudio = () => {
		resultAudioAbort?.abort();
		resultAudioAbort = null;
		setResultAudioName(null);
	};
	onCleanup(stopResultAudio);

	const patchRound = (i: number, patch: Partial<DictRound>) =>
		setRounds((prev) =>
			prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)),
		);

	/* ---------- 词库 ---------- */
	const updateWords = (updater: (previous: string[]) => string[]) =>
		setWords((previous) => {
			const next = updater(previous);
			saveWords(next);
			return next;
		});
	const addWord = (w: string) => {
		setError(null);
		const normalized = w.trim();
		if (!normalized) return;
		updateWords((prev) =>
			prev.includes(normalized) ? prev : [...prev, normalized],
		);
	};
	const addWords = (incoming: string[]) => {
		setError(null);
		updateWords((previous) => {
			const next = [...previous];
			for (const word of incoming) {
				const normalized = word.trim();
				if (normalized && !next.includes(normalized)) next.push(normalized);
			}
			return next;
		});
	};
	const removeWord = (w: string) =>
		updateWords((prev) => prev.filter((x) => x !== w));
	const clearWords = () => {
		updateWords(() => []);
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
		// 新一场默写：清掉上一场的批改状态（防止同词命中旧判定）
		gradeSeq++;
		gradeAbort?.abort();
		gradeAbort = null;
		lastGrades = null;
		setGradeNote(null);
		if (contentMode() !== "word" && !isAiConfigured(settings())) {
			setError("释义/中文词模式需要先配置 AI 服务（右上角设置里填写）");
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
			contentMode(),
			settings().voice,
			prepAbort.signal,
			seq,
		);
	};

	const runPreparation = async (
		ws: string[],
		content: ContentMode,
		voice: string,
		signal: AbortSignal,
		seq: number,
	) => {
		const shuffled = shuffle(ws);
		// 陈旧任务（被更新的准备/中止取代）不得再写任何状态
		const alive = () => seq === prepSeq && !signal.aborted;
		const aiStatus =
			content === "definition"
				? " · 正在获取释义…"
				: content === "chinese"
					? " · 正在获取中文词…"
					: "";
		try {
			const ttsPromise = requestTtsAll(
				shuffled,
				voice,
				signal,
				(done, total) => {
					if (!alive()) return;
					setPrepProgress(done / total);
					setPrepStatus(`正在生成语音 ${done}/${total}${aiStatus}`);
				},
			);
			const aiPromise =
				content === "definition"
					? requestDefinitions(shuffled, settings(), signal)
					: content === "chinese"
						? requestChineseWords(shuffled, settings(), signal)
						: Promise.resolve<Record<string, string>>({});
			const [items, aiPairs] = await Promise.all([ttsPromise, aiPromise]);
			if (!alive()) return;

			const nameMap = new Map<string, string>(
				items.map((i: TtsItem) => [i.word, i.name]),
			);
			lastPrep = {
				words: shuffled,
				nameMap,
				defs: content === "definition" ? aiPairs : {},
				chinese: content === "chinese" ? aiPairs : {},
			};
			setRounds(
				buildRounds({
					words: shuffled,
					data: lastPrep,
					level: speed(),
					contentMode: content,
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
		if (
			(contentMode() === "definition" || contentMode() === "chinese") &&
			r.answerDef === undefined
		) {
			return false;
		}
		return true;
	};

	const commitCurrentInputs = (i: number) => {
		const r = rounds()[i];
		if (mode() !== "cyber") return;
		const patch = timedOutInputPatch({
			round: r,
			contentMode: contentMode(),
			wordInput: wordInput(),
			definitionInput: defInput(),
		});
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
		if (
			(contentMode() === "definition" || contentMode() === "chinese") &&
			r.answerDef === undefined
		) {
			return "def";
		}
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
	// 结果行仅在结果页读取，直接由当前 rounds 派生，避免服务端渲染环境的惰性 memo 固化初值。
	const resultRows = (): ResultRow[] =>
		buildResultRows(rounds(), mode(), contentMode(), lastGrades ?? undefined);

	const playResultAudio = (name: string) => {
		if (phase() !== "results" || !name) return;
		stopResultAudio();
		const controller = new AbortController();
		resultAudioAbort = controller;
		void playWithIntervals({
			url: audioUrl(name),
			count: 1,
			gapsMs: [0],
			signal: controller.signal,
			onPlay: () => {},
			onAudioState: (playing) => {
				if (resultAudioAbort !== controller) return;
				setResultAudioName(playing ? name : null);
			},
			onPlaybackFailure: () => {
				if (resultAudioAbort !== controller) return;
				void invalidateCacheFile(name);
			},
		}).then(() => {
			if (resultAudioAbort !== controller) return;
			resultAudioAbort = null;
			setResultAudioName(null);
		});
	};

	const closeResults = () => {
		stopResultAudio();
		setPhase("idle");
	};

	const changeSettings = (s: AppSettings) => {
		setSettings(s);
		saveSettingsDebounced(s);
	};

	const closeSettings = () => {
		flushPendingSettings();
		setSettingsOpen(false);
	};

	const currentRound = createMemo(() => rounds()[currentIndex()]);

	/* ---------- 键盘流 ---------- */
	/** 键盘流：结果页回车/Escape 关闭；书写模式音频未发声时空格直接跳下一轮 */
	const onRootKeyDown = (e: KeyboardEvent) => {
		if (e.key === "Enter") {
			if (phase() === "results") {
				// 最后一个输入框的提交事件会在 phase 切到 results 后继续冒泡到 window；
				// 不能让同一次 Enter 立即关闭刚出现的结果页。
				const target = e.target as HTMLElement | null;
					if (
						target?.tagName === "INPUT" ||
						target?.tagName === "TEXTAREA" ||
						target?.tagName === "BUTTON" ||
						target?.tagName === "A" ||
						target?.tagName === "SELECT" ||
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
			if (settingsOpen()) closeSettings();
			else if (phase() === "results") {
				e.preventDefault();
				closeResults();
			}
			else if (phase() === "grading") {
				e.preventDefault();
				abortGrading();
			}
			else if (phase() === "ready") setPhase("idle");
			else if (phase() === "preparing") abortPreparation();
		}
	};

	// 绑定到 window：div 级 onKeyDown 在焦点不在其子树时收不到事件（书写模式无输入框），
	// 任何焦点位置都能捕获键盘流（各分支已按 phase/mode 限定，不会误触发输入）
	onMount(() => {
		window.addEventListener("keydown", onRootKeyDown);
		window.addEventListener("pagehide", flushPendingSettings);
		onCleanup(() => {
			window.removeEventListener("keydown", onRootKeyDown);
			window.removeEventListener("pagehide", flushPendingSettings);
		});
		// 恢复内容模式的持久化值（SSR 阶段信号无 localStorage，必须在客户端恢复）
		try {
			setWords(loadWords());
			const savedMode = localStorage.getItem(CONTENT_MODE_KEY);
			if (
				savedMode === "word" ||
				savedMode === "definition" ||
				savedMode === "chinese"
			) {
				setContentMode(savedMode);
			} else {
				// 兼容旧版释义开关
				const legacy = localStorage.getItem(LEGACY_DEFINITION_KEY);
				if (legacy === "1" || legacy === "0") {
					setContentMode(legacy === "1" ? "definition" : "word");
				}
			}
		} catch {
			// localStorage 不可用（隐私模式等）时忽略，保持默认单词模式
		}
	});

	return {
		words,
		speed,
		contentMode,
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
		resultAudioName,
		gradeNote,
		addWord,
		addWords,
		removeWord,
		clearWords,
		setSpeed,
		changeContentMode,
		startDictation,
		abortPreparation,
		abortGrading,
		go,
		step,
		submitWord,
		submitDef,
		closeResults,
		playResultAudio,
		changeSettings,
		closeSettings,
		setSettingsOpen,
		onRootKeyDown,
		setWordInput,
		setDefInput,
	};
}
