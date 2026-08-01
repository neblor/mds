/**
 * 单词对错判断（纯逻辑，可单测）
 *
 * 用户确认：严格匹配 —— trim 首尾空白后，大小写/标点/中间空格完全一致才算对。
 * 仅赛博模式（有用户输入）才做判断；释义不批改。
 */

export function isStrictMatch(answer: string, expected: string): boolean {
	return answer.trim() === expected.trim();
}

export function isAllCorrect(results: { correct: boolean }[]): boolean {
	return results.length > 0 && results.every((r) => r.correct);
}
