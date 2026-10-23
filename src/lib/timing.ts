/**
 * 默写时间计算（纯逻辑，可单测）
 *
 * 双轨制：
 * - 播音轨：自然播报 + 每遍后的间隔（学生思考/作答时间），播完即 speechDone，完全不干涉音频
 * - 计数轨：进度条时长 = 单词段 + 释义段（如有），与音频无关，倒计时结束即 countdownDone
 * 最终所有时间 × 三档速率（快0.85/中1/慢1.3）× 倍率调整，round 至 0.1s
 */

export type SpeedLevel = "fast" | "normal" | "slow";

export const SPEED_RATE: Record<SpeedLevel, number> = {
	fast: 0.85,
	normal: 1.0,
	slow: 1.3,
};

/** 思考时间（秒） */
export const THINK_SECONDS = 2;
/** 字长时间（每字母，秒）：按字长计算的书写用时 */
export const LETTER_SECONDS = 0.3;
/** 释义段思考时间（秒） */
export const DEF_THINK_SECONDS = 5;
/** 释义段每字母时间（秒） */
export const DEF_LETTER_SECONDS = 0.4;
/** 中文词每字符书写时间：原字母系数的 5 倍（写汉字比写字母慢得多） */
export const CHINESE_CHAR_SECONDS = 5 * LETTER_SECONDS;

/** 组句轮：看题基准时间（秒） */
export const CLOZE_BASE_SECONDS = 3;
/** 组句轮：每字符阅读时间（秒） */
export const CLOZE_CHAR_SECONDS = 0.09;
/** 组句轮：每个空的选择用时（秒） */
export const CLOZE_BLANK_SECONDS = 3;

/** 单词字母数（字母数字，至少 1） */
export function wordLength(word: string): number {
	const n = (word.trim().match(/[a-zA-Z0-9]/g) ?? []).length;
	return Math.max(1, n);
}

/**
 * 中文词字符数（UTF-8 语义：每个汉字/字符记 1 个字符，忽略空白；至少 1）。
 * 例："你好" → 2，"图书馆" → 3，"你好！" → 3
 */
export function chineseLength(text: string): number {
	const n = [...text.trim()].filter((c) => !/\s/u.test(c)).length;
	return Math.max(1, n);
}

/** 释义文本字母数（至少 1） */
export function definitionLength(def: string): number {
	const n = (def.trim().match(/[a-zA-Z0-9]/g) ?? []).length;
	return Math.max(1, n);
}

/** 播报遍数：释义模式 3 遍；非释义 <6 字母 2 遍、≥6 字母 3 遍 */
export function repeatCount(word: string, withDefinition: boolean): number {
	if (withDefinition) return 3;
	return wordLength(word) < 6 ? 2 : 3;
}

/**
 * 每遍播报后的基础间隔（秒）：
 * - 第 1 遍后：只思考（学生可能等第 2 遍）
 * - 第 2 遍后：思考 + 字长
 * - 第 3 遍（若有）后：只字长（思考已在前两遍完成）
 * 例：transform（9 字母，3 遍）→ [2, 4.7, 2.7]
 */
export function speechIntervals(word: string, count: number): number[] {
	const L = wordLength(word);
	const intervals: number[] = [];
	for (let i = 0; i < count; i++) {
		let v: number;
		if (i === 0) v = THINK_SECONDS;
		else if (i === count - 1 && count === 3) v = LETTER_SECONDS * L;
		else v = THINK_SECONDS + LETTER_SECONDS * L;
		intervals.push(Math.round(v * 10) / 10);
	}
	return intervals;
}

/** 应用三档速率 × 倍率调整，round 至 0.1s */
export function scaleTime(
	v: number,
	level: SpeedLevel,
	multiplier = 1,
): number {
	return Math.round(v * SPEED_RATE[level] * multiplier * 10) / 10;
}

/**
 * 组句轮计数轨时长（秒）：看题基准 + 每字符阅读 + 每空选择，× 三档速率 × 倍率调整。
 * 占位符 `##n` 是标记不是内容，计数时先去掉。
 * 例：3 句共 120 字符、3 个空、中档 ×1.0 → 3 + 10.8 + 9 = 22.8s
 */
export function clozeDuration(opts: {
	sentences: string[];
	blankCount: number;
	level: SpeedLevel;
	multiplier?: number;
}): number {
	const text = opts.sentences.join(" ").replace(/##\d+/g, " ");
	const chars = [...text].filter((char) => !/\s/u.test(char)).length;
	const total =
		CLOZE_BASE_SECONDS +
		CLOZE_CHAR_SECONDS * chars +
		CLOZE_BLANK_SECONDS * Math.max(0, Math.floor(opts.blankCount));
	return scaleTime(total, opts.level, opts.multiplier ?? 1);
}

/**
 * 计数轨时长（秒，进度条）：与音频无关
 * - 单词段：(思考2 + 0.3×字母数) × 播报遍数
 * - 释义段（如有）：思考5 + 0.4×释义字母数
 * - 中文词段（chineseText 提供时）：第二步作答段，思考2 + 1.5×字符数（每字 5×字母系数）
 * 例：transform（9 字母，3 遍）→ (2+0.3×9)×3 = 14.1s
 */
export function countdownDuration(opts: {
	word: string;
	level: SpeedLevel;
	withDefinition: boolean;
	definitionText?: string;
	/** 中文词模式提供时，追加第二步中文作答段时长 */
	chineseText?: string;
	multiplier?: number;
}): number {
	const {
		word,
		level,
		withDefinition,
		definitionText = "",
		chineseText,
		multiplier = 1,
	} = opts;
	const wordSeg =
		(THINK_SECONDS + LETTER_SECONDS * wordLength(word)) *
		repeatCount(word, withDefinition);
	let total = wordSeg;
	if (withDefinition) {
		total +=
			DEF_THINK_SECONDS + DEF_LETTER_SECONDS * definitionLength(definitionText);
	}
	if (chineseText?.trim()) {
		total += THINK_SECONDS + CHINESE_CHAR_SECONDS * chineseLength(chineseText);
	}
	return scaleTime(total, level, multiplier);
}

/* ---------- 短句模式（sentence） ---------- */

/**
 * 短句模式的播报与计时口径（崔总 2026-10-17 定，属基础计算方式，不是调系数）：
 * - **只念整句，念 3 遍**，不再先念单词——用户听到第一个音就开始写了，念单词没有用；
 * - 整句比单词长得多，每遍后的思考时间、每字符书写时间都要按整句重设；
 * - 字符数**含空格与标点**（整句匹配也要求这些一致，写的时候同样要落笔）。
 * 三档速率（SPEED_RATE）与设置里的倍率调整仍然照乘——那是全局缩放，与本口径相互独立。
 */
export const SENTENCE_REPEATS = 3;
/** 每遍播报后的思考时间（整句需要回忆句子结构、核对已写部分） */
export const SENTENCE_THINK_SECONDS = 4;
/** 每个字符（含空格与标点）的书写时间 */
export const SENTENCE_CHAR_SECONDS = 0.45;

/** 整句字符数：含空格与标点（至少 1） */
export function sentenceCharCount(sentence: string): number {
	return Math.max(1, [...sentence.trim()].length);
}

/**
 * 短句轮每遍播报后的间隔（秒），共 3 项，顺序即播报顺序。
 * 沿用单词模式「前几遍思考、最后一遍只书写」的分配方式：
 * [思考, 思考+书写, 书写]
 */
export function sentenceSpeechIntervals(opts: {
	sentence: string;
	level: SpeedLevel;
	multiplier?: number;
}): number[] {
	const { sentence, level, multiplier = 1 } = opts;
	const write = SENTENCE_CHAR_SECONDS * sentenceCharCount(sentence);
	const raw = [SENTENCE_THINK_SECONDS, SENTENCE_THINK_SECONDS + write, write];
	return raw.map((gap) => scaleTime(gap, level, multiplier));
}

/**
 * 短句轮计数轨时长（秒）：整句 3 遍 ×（每遍思考 + 按整句字符数估的书写时间）。
 * 与单词/释义/中文词同一套双重缩放（三档速率 × 倍率调整），但基础公式是短句专用的：
 * 不再叠加「目标词段」，每遍的思考与书写单价都按整句重设。
 *
 * 与音频时长无关：双轨制保证「倒计时结束但语音没放完」时继续等语音。
 */
export function sentenceCountdownDuration(opts: {
	sentence: string;
	level: SpeedLevel;
	multiplier?: number;
}): number {
	const { sentence, level, multiplier = 1 } = opts;
	const perRepeat =
		SENTENCE_THINK_SECONDS + SENTENCE_CHAR_SECONDS * sentenceCharCount(sentence);
	return scaleTime(perRepeat * SENTENCE_REPEATS, level, multiplier);
}

/* ---------- 音标模式（phonetic） ---------- */

/**
 * 音标轮计时口径（崔总 2026-10-23 确认）：
 * - 用户看到单词、听 2–3 遍发音，然后点选音素；
 * - 倒计时 = 「思考 + 每音素点击时间」× 档位×倍率 + 播报间隔 + 每遍音频余量；
 * - 倒计时必须覆盖音频，否则赛博的「倒计时到就自动提交」会抢在音频播完前。
 * - 次重音不参与判定，也不计入每音素点击时间；主重音计入。
 */
export const IPA_THINK_SECONDS = 3;
export const IPA_TOKEN_SECONDS = 0.8;
/** 每遍音频本身的估算余量（音频时长不受倍率影响，故不乘倍率） */
export const IPA_AUDIO_TAIL_SECONDS = 1.2;

export function phoneticCountdownDuration(opts: {
	/** canonical token（含 ˈ/ˌ） */
	tokens: string[];
	/** 已乘过档位×倍率的播报间隔 */
	gapSec: number[];
	repeatCount: number;
	level: SpeedLevel;
	multiplier?: number;
}): number {
	const graded = opts.tokens.filter((token) => token !== "ˌ").length;
	const thinkAndClick = scaleTime(
		IPA_THINK_SECONDS + IPA_TOKEN_SECONDS * graded,
		opts.level,
		opts.multiplier ?? 1,
	);
	const audioAllowance =
		opts.gapSec.reduce((sum, gap) => sum + gap, 0) +
		opts.repeatCount * IPA_AUDIO_TAIL_SECONDS;
	return Math.round((thinkAndClick + audioAllowance) * 10) / 10;
}
