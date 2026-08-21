/**
 * 对错判断（纯逻辑，可单测）
 *
 * - 单词：用户确认严格匹配 —— trim 首尾空白后，大小写/标点/中间空格完全一致才算对。
 * - 中文词：忽略空白与中文标点后一致即算对（如 "你好！" ≈ "你好"）。
 * 仅赛博模式（有用户输入）才做判断；释义不批改。
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

export function isAllCorrect(results: { correct: boolean }[]): boolean {
	return results.length > 0 && results.every((r) => r.correct);
}
