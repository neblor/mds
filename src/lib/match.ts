/**
 * 对错判断（纯逻辑，可单测）
 *
 * - 单词：用户确认严格匹配 —— trim 首尾空白后，大小写/标点/中间空格完全一致才算对。
 * - 短句：归一化（小写 + 去标点 + 压空白）后全等即算对（崔总 2026-10-17）。
 * - 释义：赛博模式下由 AI 批改；本文件仅提供 AI 失败时的本地兜底（宽松归一后一致）。
 * 仅赛博模式（有用户输入）才做判断。
 */

export function isStrictMatch(answer: string, expected: string): boolean {
	return answer.trim() === expected.trim();
}

/**
 * 短句归一化（整句默写口径，崔总 2026-10-17 定）：
 * 小写 → 去掉所有标点 → 去掉首尾空白 → 中间连续空白压成单个空格。
 * 这样只比「实际写了哪些词、词序对不对」，大小写/标点/空格多少都不影响。
 * （例："She eats an apple." 与 "she  EATS an apple" 归一后都是 "she eats an apple"）
 */
export function normalizeSentence(text: string): string {
	return text
		.toLowerCase()
		// 去掉所有标点/符号，只留字母、数字与空白（Unicode 口径，全角标点一并去掉）
		.replace(/[^\p{L}\p{N}\s]/gu, "")
		.trim()
		.replace(/\s+/g, " ");
}

/** 短句匹配：归一化后全等（不做 AI 批改，也不逐字报差异） */
export function isSentenceMatch(answer: string, expected: string): boolean {
	return normalizeSentence(answer) === normalizeSentence(expected);
}

/** 中文标点与常见全角符号：归一化时整体去掉（含全角空格） */
const CJK_PUNCTUATION =
	/[\s\u3000，。！？；：、""''「」『』（）《》〈〉【】〔〕…·—–－]/gu;

/** 归一化中文作答：去空白（含全角空格）与中文标点 */
export function normalizeChinese(text: string): string {
	return text.replace(CJK_PUNCTUATION, "");
}

/** 中文词匹配：归一化后完全一致（大小写无意义，直接比较） */
export function isChineseMatch(answer: string, expected: string): boolean {
	return normalizeChinese(answer) === normalizeChinese(expected);
}

/** 英文标点：释义本地兜底归一化时去掉 */
const ENGLISH_PUNCTUATION = /[.,!?;:'"()[\]{}\-—]/g;

/** 释义本地兜底归一化：小写 + 去标点 + 压缩空白（改述判定交给 AI，这只是失败兜底） */
export function normalizeDefinition(text: string): string {
	return text
		.toLowerCase()
		.replace(ENGLISH_PUNCTUATION, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/** 释义本地兜底匹配：归一化后完全一致（AI 批改失败时的降级口径，要求高是预期行为） */
export function isDefinitionMatch(answer: string, expected: string): boolean {
	return normalizeDefinition(answer) === normalizeDefinition(expected);
}

export function isAllCorrect(results: { correct: boolean }[]): boolean {
	return results.length > 0 && results.every((r) => r.correct);
}
