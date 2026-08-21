/**
 * 对错判断（纯逻辑，可单测）
 *
 * - 单词：用户确认严格匹配 —— trim 首尾空白后，大小写/标点/中间空格完全一致才算对。
 * - 中文词：忽略空白与中文标点后一致即算对（如 "你好！" ≈ "你好"）。
 * - 释义：赛博模式下由 AI 批改；本文件仅提供 AI 失败时的本地兜底（宽松归一后一致）。
 * 仅赛博模式（有用户输入）才做判断。
 */

export function isStrictMatch(answer: string, expected: string): boolean {
	return answer.trim() === expected.trim();
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
