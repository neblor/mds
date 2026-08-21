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
