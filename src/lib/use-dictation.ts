/**
 * 默写流程编排（客户端 hook）
 * 纯逻辑状态机在 dictation-engine.ts（可直接单测）；本文件只做适配：
 * 事件入口 → runStep（防重入）→ 执行动作（中止音频/推进轮次）→ 同步 SolidJS 信号
 */
import { createSignal, onCleanup, onMount } from "solid-js";
import { debounce } from "es-toolkit/function";
import {
	loadSettings,
	saveSettings,
	isAiConfigured,
	type AppSettings,
} from "./settings";
import {
	countdownDuration,
	clozeDuration,
	speechIntervals,
	repeatCount,
	sentenceCountdownDuration,
	sentenceSpeechIntervals,
	SENTENCE_REPEATS,
	scaleTime,
	type SpeedLevel,
} from "./timing";
import {
	requestTtsAll,
	requestDefinitions,
	requestChineseWords,
	requestClozeQuestions,
	requestSentences,
	requestAnswerGrades,
	audioUrl,
	playWithIntervals,
	invalidateCacheFile,
	type TtsItem,
	type GradeItem,
	type PlayItem,
} from "./api";
import {
	shuffle,
	resolveStoredContentMode,
	type DictationMode,
	type ContentMode,
} from "./state";
import {
	CLOZE_MAX_CANDIDATES,
	type ClozeItem,
} from "./cloze-parse";
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
import { createResultAudioPlayer } from "./result-audio";
import { appendHistory, buildHistoryEntry } from "./history-storage";

export type Phase =
	| "idle"
	| "preparing"
	| "ready"
	| "dictating"
	| "grading"
	| "results";

export interface WordRound {
	kind: "word";
	word: string;
	audioName: string;
	definition?: string;
	/** 中文词模式：AI 抓取的常用中文对应词 */
	chineseWord?: string;
	/**
	 * 短句模式的作答形态：
	 * - "sentence"：播报「词 1 遍 + 整句 2 遍」，作答整句
	 * - "word"：普通单词轮（短句场次里 AI 没给出合格短句的词会降级成这个）
	 */
	variant: "word" | "sentence";
	/** 短句模式的标准整句（variant=sentence 时必有） */
	sentence?: string;
	/** 短句模式的整句音频名（variant=sentence 时必有） */
	sentenceAudioName?: string;
	/** 目标词自己的音频（短句轮不再播它；保留给诊断与降级场景） */
	availableWordAudioName?: string;
	/** 播报序列的标签（如 ["单词","整句 1","整句 2"]），供状态行显示 */
	playLabels?: string[];
	repeatCount: number;
	/** 计数轨时长（进度条），已含档位×倍率 */
	countdownSec: number;
	/** 播音间隔（秒，已含档位×倍率） */
	gapSec: number[];
	answer?: string;
	answerDef?: string;
}

/** 组句轮里的单个空：标准答案 + 用户所选的词 */
export interface ClozeBlankState {
	index: number;
	answer: string;
	/** 赛博作答：用户选的词（未选为 undefined） */
	chosen?: string;
}

/**
 * 组句轮（一题 = 一段短文 + 若干个空；句数/空数由出题方给，不再固定 2–3 句 + 2–4 空）
 * - 组句轮**不播语音**（它是「选」不是「听」），所以 repeatCount = 0、gapSec = []
 * - 音频只为答案词生成，仅用于结果页的发音按钮
 */
export interface ClozeRound {
	kind: "cloze";
	sentences: string[];
	blanks: ClozeBlankState[];
	/** 答案词 → 音频文件名（TTS 失败时为空表） */
	audioNames: Record<string, string>;
	repeatCount: number;
	countdownSec: number;
	gapSec: number[];
}

export type DictRound = WordRound | ClozeRound;

interface PrepData {
	words: string[];
	nameMap: Map<string, string>;
	defs: Record<string, string>;
	chinese: Record<string, string>;
	/** 短句模式：目标词 → 短句 */
	sentences: Record<string, string>;
	/** 短句模式：短句文本 → 音频文件名（与单词语音分开，均按文本哈希缓存） */
	sentenceAudio: Map<string, string>;
}

interface BuildRoundsOptions {
	words: string[];
	data: PrepData;
	level: SpeedLevel;
	contentMode: ContentMode;
	multiplier: number;
}

function buildRounds(opts: BuildRoundsOptions): WordRound[] {
	const { words, data, level, contentMode, multiplier } = opts;
	return words.map((w) => {
		// 只取自有属性，避免 constructor 等词键命中原型
		const def = Object.hasOwn(data.defs, w) ? data.defs[w] : undefined;
		const chineseWord = Object.hasOwn(data.chinese, w)
			? data.chinese[w]
			: undefined;
		const sentence = Object.hasOwn(data.sentences, w)
			? data.sentences[w]
			: undefined;
		const sentenceAudioName = sentence
			? data.sentenceAudio.get(sentence)
			: undefined;
		const audioName = data.nameMap.get(w) ?? "";

		// 短句轮：先念目标词 1 遍，再念整句 2 遍（崔总 2026-10-17 定）。
		// 没有合格短句/没有整句语音的词降级为普通单词轮，绝不整场报废。
		if (contentMode === "sentence" && sentence && sentenceAudioName) {
			// 只念整句 3 遍：用户听到第一个音就开始写，先念单词没有意义（崔总 2026-10-17）
			return {
				kind: "word" as const,
				word: w,
				// 结果页的发音按钮播整句（这一轮默的就是整句）
				audioName: sentenceAudioName,
				availableWordAudioName: audioName,
				variant: "sentence" as const,
				sentence,
				sentenceAudioName,
				playLabels: ["整句 1", "整句 2", "整句 3"],
				repeatCount: SENTENCE_REPEATS,
				countdownSec: sentenceCountdownDuration({ sentence, level, multiplier }),
				gapSec: sentenceSpeechIntervals({ sentence, level, multiplier }),
			};
		}

		const withDef = contentMode === "definition";
		const count = repeatCount(w, withDef);
		return {
			kind: "word" as const,
			word: w,
			audioName,
			variant: "word" as const,
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

/**
 * 一轮的播放序列：
 * - 单词轮 = 同一音频重复 repeatCount 遍
 * - 短句轮 = 目标词 1 遍 + 整句 2 遍（各自标签，失败可按项淘汰缓存）
 */
export function playItemsOf(r: WordRound): PlayItem[] {
	if (r.variant === "sentence" && r.sentenceAudioName) {
		// 只播整句，共 3 遍（不先念单词）
		return Array.from({ length: SENTENCE_REPEATS }, (_, index) => ({
			url: audioUrl(r.sentenceAudioName as string),
			label: `整句 ${index + 1}`,
		}));
	}
	return Array.from({ length: Math.max(1, r.repeatCount) }, () => ({
		url: audioUrl(r.audioName),
	}));
}

/** 从 /api/audio?name=… 里取回缓存文件名（播放失败时按项淘汰缓存） */
function cacheNameFromUrl(url: string): string | null {
	try {
		const name = new URL(url, "http://localhost").searchParams.get("name");
		return name && name.trim() ? name : null;
	} catch {
		return null;
	}
}

/** 组句题 → 轮次（题序打乱；每轮时长 = 句长基准 + 每空选择用时） */
function buildClozeRounds(opts: {
	items: ClozeItem[];
	audioNames: Record<string, string>;
	level: SpeedLevel;
	multiplier: number;
}): ClozeRound[] {
	return shuffle(opts.items).map((item) => ({
		kind: "cloze" as const,
		sentences: item.sentences,
		blanks: item.blanks.map((blank) => ({
			index: blank.index,
			answer: blank.answer,
		})),
		audioNames: opts.audioNames,
		repeatCount: 0,
		countdownSec: clozeDuration({
			sentences: item.sentences,
			blankCount: item.blanks.length,
			level: opts.level,
			multiplier: opts.multiplier,
		}),
		gapSec: [],
	}));
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
	/** 当前阶段无法给出确定进度（单次 AI 请求）时为 true，进度条改为流动动画 */
	const [prepIndeterminate, setPrepIndeterminate] = createSignal(false);
	const [prepStatus, setPrepStatus] = createSignal("");
	const [prepError, setPrepError] = createSignal<string | null>(null);
	let prepAbort: AbortController | null = null;
	/** 准备任务递增序号：只有当前 token 的任务允许写状态（隔离陈旧任务的竞态） */
	let prepSeq = 0;
	let lastPrep: PrepData | null = null;

	// 默写轮次
	const [rounds, setRounds] = createSignal<DictRound[]>([]);
	const [currentIndex, setCurrentIndex] = createSignal(0);
	/** 每一轮的实际耗时（ms，按轮次索引；供复习日志的 elapsedMs 使用） */
	const [roundElapsed, setRoundElapsed] = createSignal<number[]>([]);
	let roundStartedAt = 0;
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
	let roundSeq = 0;
	// 结果发音试听（结算页限定 results 阶段）
	const resultAudio = createResultAudioPlayer(() => phase() === "results");

	// —— AI 批改（中文词赛博模式）——
	let gradeAbort: AbortController | null = null;
	/** 批改任务递增序号：只有当前 token 的任务允许写状态 */
	let gradeSeq = 0;
	/** AI 批改结果：word → 判定 */
	let lastGrades: Record<string, GradeOverride> | null = null;
	/** 批改来源说明（失败/中止降级时展示给用户） */
	const [gradeNote, setGradeNote] = createSignal<string | null>(null);

	// —— 组句（范例组句）——
	/** 本场候选池（≤24，题序打乱后展示用；每轮相同） */
	const [clozeCandidates, setClozeCandidates] = createSignal<string[]>([]);
	/** 组句结算页附加提示（如语音生成失败降级），其余模式为 null */
	const [resultNote, setResultNote] = createSignal<string | null>(null);

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
		// 短句模式不做 AI 批改（归一化比较就够），因此不进 grading 阶段、结果立刻可见
		if (
			mode() === "cyber" &&
			(contentMode() === "chinese" || contentMode() === "definition")
		) {
			setPhase("grading");
			void runGrading();
		} else {
			enterResults();
		}
	};

	/**
	 * 落地结果页的唯一收口：判定（含 AI 批改覆盖/降级）落定后烘入历史记录
	 * （书写与赛博都记录；书写条目无批改字段，回看仅作对照），再切换阶段。
	 */
	const enterResults = () => {
		appendHistory(
			buildHistoryEntry({
				rows: buildResultRows(rounds(), mode(), contentMode(), lastGrades ?? undefined),
				mode: mode(),
				contentMode: contentMode(),
				finishedAt: Date.now(),
				gradeNote: mode() === "cyber" ? gradeNote() : null,
			}),
		);
		setPhase("results");
	};

	/* ---------- AI 批改（一次请求批改本场全部第二步作答） ---------- */
	const runGrading = async () => {
		const kind = contentMode() === "chinese" ? "chinese" : "definition";
		// 只批改两段式内容模式的第二步作答（短句模式走归一化比较，不请求 AI）
		const items: GradeItem[] = rounds()
			.filter((r): r is WordRound => r.kind === "word")
			.filter((r) => r.answerDef !== undefined)
			.map((r) => ({
				word: r.word,
				expected:
					kind === "chinese" ? (r.chineseWord ?? "") : (r.definition ?? ""),
				answer: r.answerDef ?? "",
			}));
		// 防御：没有可批改的作答（理论不会发生）直接进结果
		if (items.length === 0) {
			enterResults();
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
		} catch {
			if (!alive()) return;
			lastGrades = null;
			setGradeNote("AI 批改失败，已改用本地匹配判定");
		} finally {
			if (alive()) enterResults();
		}
	};

	/** 中止批改：降级本地判定并直接进入结果页 */
	const abortGrading = () => {
		gradeSeq++;
		gradeAbort?.abort();
		gradeAbort = null;
		lastGrades = null;
		setGradeNote("已中止 AI 批改，改用本地匹配判定");
		enterResults();
	};
	onCleanup(() => gradeAbort?.abort());

	const recordRoundElapsed = (index: number) => {
		const elapsed = roundStartedAt > 0 ? Date.now() - roundStartedAt : 0;
		roundStartedAt = 0;
		setRoundElapsed((previous) => {
			const next = [...previous];
			next[index] = Math.max(0, elapsed);
			return next;
		});
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
			// 本轮到此结束：先记下实际耗时（结算写回复习计划时要用）
			recordRoundElapsed(engine.currentIndex);
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
	onCleanup(() => resultAudio.stop());

	const patchRound = (i: number, patch: Partial<WordRound>) =>
		setRounds((prev) =>
			prev.map((r, idx) =>
				idx === i && r.kind === "word" ? { ...r, ...patch } : r,
			),
		);

	/** 组句轮：按空编号更新所选的词（未选传 undefined 即清空） */
	const patchClozeBlank = (
		i: number,
		blankIndex: number,
		chosen: string | undefined,
	) =>
		setRounds((prev) =>
			prev.map((r, idx) =>
				idx === i && r.kind === "cloze"
					? {
							...r,
							blanks: r.blanks.map((blank) =>
								blank.index === blankIndex ? { ...blank, chosen } : blank,
							),
						}
					: r,
			),
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
	/** 整体替换词表（再次默写回填/恢复暂存用）：trim、丢空、去重后覆盖并持久化 */
	const replaceWords = (incoming: string[]) => {
		setError(null);
		const next: string[] = [];
		for (const word of incoming) {
			const normalized = word.trim();
			if (normalized && !next.includes(normalized)) next.push(normalized);
		}
		updateWords(() => next);
	};
	const removeWord = (w: string) =>
		updateWords((prev) => prev.filter((x) => x !== w));
	const clearWords = () => {
		updateWords(() => []);
		setPhase("idle");
	};

	/* ---------- 准备 ---------- */
	const startDictation = (
		m: DictationMode,
		wordsOverride?: string[],
		definitions?: Record<string, string>,
	) => {
		// 词表模式会用「今日队列」覆盖本次词表；录入模式仍然用手敲的那张表
		const ws = wordsOverride && wordsOverride.length > 0 ? wordsOverride : words();
		if (ws.length === 0) {
			setError("先添加一些单词再开始吧");
			return;
		}
		setError(null);
		// 新一场默写：清掉上一场的批改与提示状态（防止同词命中旧判定）
		gradeSeq++;
		gradeAbort?.abort();
		gradeAbort = null;
		lastGrades = null;
		setGradeNote(null);
		setResultNote(null);
		setRoundElapsed([]);
		const content = contentMode();
		if (content !== "word" && !isAiConfigured(settings())) {
			setError(
				content === "cloze"
					? "组句模式需要先配置 AI 服务（右上角设置里填写）"
					: content === "sentence"
						? "短句模式需要先配置 AI 服务（右上角设置里填写）"
						: "释义/中文词模式需要先配置 AI 服务（右上角设置里填写）",
			);
			return;
		}
		// 组句只能赛博作答（选词必须在屏幕上完成）
		setMode(content === "cloze" ? "cyber" : m);
		setPhase("preparing");
		setPrepError(null);
		setPrepProgress(0);
		setPrepIndeterminate(false);
		setPrepStatus(
			content === "cloze"
				? "正在出题…"
				: content === "sentence"
					? "正在生成短句…"
					: "正在生成语音…",
		);
		prepAbort = new AbortController();
		const seq = ++prepSeq;
		void runPreparation(
			ws,
			content,
			settings().voice,
			prepAbort.signal,
			seq,
			definitions ?? {},
		);
	};

	/**
	 * 组句准备：一次 AI 出题（服务端已按契约校验）→ 只为答案词合成 TTS。
	 * 候选池取本场词表前 24 个（超出部分留给下一场），题序打乱后建轮次。
	 */
	const prepareCloze = async (
		ws: string[],
		voice: string,
		definitions: Record<string, string>,
		signal: AbortSignal,
		alive: () => boolean,
	) => {
		const pool = ws.slice(0, CLOZE_MAX_CANDIDATES);
		setClozeCandidates(shuffle(pool));
		setPrepProgress(0);
		// 出题是单次请求，没有中间进度：用不确定态动画而不是把 0% 冻在屏幕上
		setPrepIndeterminate(true);
		setPrepStatus("正在出题…（一次性生成整场题目）");
		const items = await requestClozeQuestions(
			pool.map((word) => {
				const definition = definitions[word]?.trim();
				return definition ? { word, definition } : { word };
			}),
			settings(),
			signal,
		);
		if (!alive()) return;
		setPrepIndeterminate(false);
		const answerWords = [
			...new Set(items.flatMap((item) => item.blanks.map((blank) => blank.answer))),
		];
		const audioNames = await prepareClozeAudio(answerWords, voice, signal, alive);
		if (!alive()) return;
		lastPrep = {
			words: pool,
			nameMap: new Map(),
			defs: {},
			chinese: {},
			sentences: {},
			sentenceAudio: new Map(),
		};
		setRounds(
			buildClozeRounds({
				items,
				audioNames,
				level: speed(),
				multiplier: settings().multiplier,
			}),
		);
		setPhase("ready");
	};

	/**
	 * 组句的音频只服务结果页发音按钮；TTS 失败不阻塞本场（降级为空表 + 提示）。
	 * 中止则原样抛出，由调用方按旧任务丢弃。
	 */
	const prepareClozeAudio = async (
		words: string[],
		voice: string,
		signal: AbortSignal,
		alive: () => boolean,
	): Promise<Record<string, string>> => {
		if (words.length === 0) return {};
		try {
			const items = await requestTtsAll(words, voice, signal, (done, total) => {
				if (!alive()) return;
				setPrepProgress(done / total);
				setPrepStatus(`正在生成语音 ${done}/${total}`);
			});
			return Object.fromEntries(items.map((item) => [item.word, item.name]));
		} catch (err) {
			if (signal.aborted) throw err;
			setResultNote("语音生成失败：结果页的发音按钮不可用");
			return {};
		}
	};

	/**
	 * 短句准备：一次 AI 生句 → 目标词与整句的语音（两轨并行，合并成一条进度）。
	 *
	 * 与组句的分工：句子是「每词一句」，所以必须先拿到句子才知道要合成什么文本，
	 * 不能像释义那样与 TTS 并行。整段做成两阶段进度：
	 *   阶段 1「生成短句」单次请求 → 不确定态动画（实测慢模型可达 10–30s）
	 *   阶段 2「生成语音」多批请求 → 真实 x/y 进度（目标词 + 整句都算在内）
	 *
	 * AI 整体不可用或个别词没拿到合格短句，都**不中止本场**：
	 * 这些词降级为普通单词轮（崔总 2026-10-17 决策 3）。
	 */
	const prepareSentence = async (
		ws: string[],
		voice: string,
		signal: AbortSignal,
		alive: () => boolean,
	) => {
		const shuffled = shuffle(ws);
		setPrepProgress(0);
		setPrepIndeterminate(true);
		setPrepStatus("正在生成短句…（每个词一句，短句优先）");
		let sentences: Record<string, string> = {};
		let degraded = 0;
		try {
			const result = await requestSentences(shuffled, settings(), signal);
			sentences = result.sentences;
			degraded = result.missing.length;
		} catch (err) {
			if (signal.aborted) throw err;
			// 网络/配置/额度级失败：整场降级为单词默写，而不是让用户白等一场
			degraded = shuffled.length;
			sentences = {};
			setResultNote("短句生成失败：本场降级为单词默写");
		}
		if (!alive()) return;

		const sentenceTexts = [
			...new Set(
				shuffled
					.map((word) => (Object.hasOwn(sentences, word) ? sentences[word] : ""))
					.filter((text) => text.trim().length > 0),
			),
		];
		// 只合成「要念的东西」：整句轮只需要整句音频（不再播目标词），
		// 降级轮才需要目标词音频 —— 比全量合成少一半请求。
		const degradedWords = shuffled.filter(
			(word) => !Object.hasOwn(sentences, word),
		);
		const total = sentenceTexts.length + degradedWords.length;
		let sentenceDone = 0;
		let wordDone = 0;
		const reportProgress = () => {
			const done = sentenceDone + wordDone;
			setPrepProgress(total > 0 ? done / total : 1);
			setPrepStatus(`正在生成语音 ${Math.min(done, total)}/${total}`);
		};
		setPrepIndeterminate(false);
		setPrepProgress(0);
		reportProgress();

		// 整句与降级词两轨并行（各自按 4 条一批），进度按合并计数上报
		const [sentenceItems, wordItems] = await Promise.all([
			requestTtsAll(sentenceTexts, voice, signal, (done) => {
				if (!alive()) return;
				sentenceDone = done;
				reportProgress();
			}),
			requestTtsAll(degradedWords, voice, signal, (done) => {
				if (!alive()) return;
				wordDone = done;
				reportProgress();
			}),
		]);
		if (!alive()) return;

		lastPrep = {
			words: shuffled,
			nameMap: new Map(wordItems.map((item) => [item.word, item.name])),
			defs: {},
			chinese: {},
			sentences,
			sentenceAudio: new Map(
				sentenceItems.map((item) => [item.word, item.name]),
			),
		};
		if (degraded > 0) {
			setResultNote(
				`${degraded} 个词没有合格短句（超过 8 词或缺词），已降级为单词默写`,
			);
		}
		setRounds(
			buildRounds({
				words: shuffled,
				data: lastPrep,
				level: speed(),
				contentMode: "sentence",
				multiplier: settings().multiplier,
			}),
		);
		setPhase("ready");
	};

	const runPreparation = async (
		ws: string[],
		content: ContentMode,
		voice: string,
		signal: AbortSignal,
		seq: number,
		definitions: Record<string, string>,
	) => {
		// 陈旧任务（被更新的准备/中止取代）不得再写任何状态
		const alive = () => seq === prepSeq && !signal.aborted;
		const aiStatus =
			content === "definition"
				? " · 正在获取释义…"
				: content === "chinese"
					? " · 正在获取中文词…"
					: "";
		try {
			if (content === "cloze") {
				await prepareCloze(ws, voice, definitions, signal, alive);
				return;
			}
			if (content === "sentence") {
				await prepareSentence(ws, voice, signal, alive);
				return;
			}
			const shuffled = shuffle(ws);
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
			// 语音与 AI 并行：语音跑满 100% 后若 AI 还没回来，进度条切成不确定态，
			// 避免出现「100% 却还在等」的误导（实测释义轮会干等十几秒）。
			let ttsFinished = false;
			let aiFinished = false;
			const syncStage = () => {
				if (!alive()) return;
				setPrepIndeterminate(ttsFinished && !aiFinished);
			};
			// 这两个 .then 只为切进度态：必须吞掉拒绝，否则会额外造出未处理的 Promise
			// （真实拒绝由下面的 await 统一处理，陈旧任务的拒绝也要静默）
			const markFinished = (which: "tts" | "ai") => () => {
				if (which === "tts") ttsFinished = true;
				else aiFinished = true;
				syncStage();
			};
			void ttsPromise.then(markFinished("tts"), markFinished("tts"));
			void aiPromise.then(markFinished("ai"), markFinished("ai"));
			const [items, aiPairs] = await Promise.all([ttsPromise, aiPromise]);
			if (!alive()) return;
			setPrepIndeterminate(false);

			const nameMap = new Map<string, string>(
				items.map((i: TtsItem) => [i.word, i.name]),
			);
			lastPrep = {
				words: shuffled,
				nameMap,
				defs: content === "definition" ? aiPairs : {},
				chinese: content === "chinese" ? aiPairs : {},
				sentences: {},
				sentenceAudio: new Map(),
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
			setPrepError(content === "cloze" ? `AI 当前不可用：${msg}` : msg);
		}
	};

	const abortPreparation = () => {
		// 先递增 token 再中止：旧任务的任何异步回调都立即失效
		prepSeq++;
		setPrepIndeterminate(false);
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
		if (!r) return false;
		if (r.kind === "cloze") {
			// 组句：所有空都选完才算输入完成
			return r.blanks.every((blank) => blank.chosen !== undefined);
		}
		if (r.answer === undefined) return false;
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
		if (mode() !== "cyber" || !r) return;
		if (r.kind === "cloze") {
			// 倒计时结束：未选完的空按空字符串提交（与单词/释义轮同口径）
			for (const blank of r.blanks) {
				if (blank.chosen === undefined) patchClozeBlank(i, blank.index, "");
			}
			return;
		}
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
		roundStartedAt = Date.now();
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
		// 组句轮不播语音：直接标记语音轨完成（此时 inputDone 还是 false，状态机会等作答）
		if (r.kind === "cloze") {
			runStep({ type: "speech-end" });
			return;
		}
		audioAbort = new AbortController();
		const signal = audioAbort.signal;
		void playWithIntervals({
			items: playItemsOf(r),
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
			onPlaybackFailure: (_failure, failedUrl) => {
				if (seq !== roundSeq) return;
				// 按出错的那一条淘汰缓存：短句轮里单词与整句是两个不同的文件
				const name = failedUrl
					? cacheNameFromUrl(failedUrl)
					: r.audioName;
				if (name) void invalidateCacheFile(name);
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
		if (!r || r.kind === "cloze") return "none";
		if (r.answer === undefined) return "word";
		if (
			(contentMode() === "definition" || contentMode() === "chinese") &&
			r.answerDef === undefined
		) {
			return "def";
		}
		return "done";
	};

	/**
	 * 组句轮选词：填入某个空；全部空填完立即自动提交（不等倒计时）。
	 * 状态机判定由 runStep 负责，这里只改数据。
	 */
	const chooseClozeWord = (blankIndex: number, word: string) => {
		if (mode() !== "cyber" || contentMode() !== "cloze") return;
		const i = currentIndex();
		const r = rounds()[i];
		if (!r || r.kind !== "cloze") return;
		patchClozeBlank(i, blankIndex, word);
		const filled = r.blanks.every(
			(blank) => blank.index === blankIndex || blank.chosen !== undefined,
		);
		refreshInputDone();
		if (filled) runStep({ type: "submit" });
	};

	/** 组句轮清除某个空的所选词（Backspace） */
	const clearClozeWord = (blankIndex: number) => {
		if (mode() !== "cyber" || contentMode() !== "cloze") return;
		patchClozeBlank(currentIndex(), blankIndex, undefined);
		refreshInputDone();
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

	const closeResults = () => {
		resultAudio.stop();
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

	// 当前轮直接由 rounds 派生（与 resultRows 同理：memo 在非追踪上下文里会读不到新值）
	const currentRound = (): DictRound | undefined =>
		rounds()[currentIndex()];

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
			const restored = resolveStoredContentMode(
				localStorage.getItem(CONTENT_MODE_KEY),
				localStorage.getItem(LEGACY_DEFINITION_KEY),
			);
			if (restored) setContentMode(restored);
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
		prepIndeterminate,
		prepStatus,
		prepError,
		rounds,
		currentIndex,
		remaining,
		repeatIndex,
		sounding,
		speechDone,
		roundElapsed,
		wordInput,
		defInput,
		currentRound,
		clozeCandidates,
		resultNote,
		resultRows,
		resultAudioName: resultAudio.playingName,
		gradeNote,
		addWord,
		addWords,
		replaceWords,
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
		chooseClozeWord,
		clearClozeWord,
		closeResults,
		playResultAudio: resultAudio.play,
		changeSettings,
		closeSettings,
		setSettingsOpen,
		onRootKeyDown,
		setWordInput,
		setDefInput,
	};
}
