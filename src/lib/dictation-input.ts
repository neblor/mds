import type { RoundAsk } from "./mixed-mode";

export interface TimedOutRoundInput {
	answer?: string;
	answerDef?: string;
}

/**
 * 赛博模式倒计时结束时一次性封口本轮输入。
 * 未提交的字段必须写成字符串（允许为空），避免停留在待输入状态。
 *
 * 封哪几格由**本轮的作答形态**决定（混合场次逐轮不同，不能再按场次模式猜）：
 * - `word` / `sentence`：只封单词格（整句也走这一格）
 * - `word+second`：两段式，单词 + 第二步都封
 * - `second`：只封第二步（第 2 次出现的释义/中文词轮不写单词）
 */
export function timedOutInputPatch(options: {
	round: TimedOutRoundInput;
	ask: RoundAsk;
	wordInput: string;
	definitionInput: string;
}): TimedOutRoundInput {
	const patch: TimedOutRoundInput = {};
	const wantsWord =
		options.ask === "word" ||
		options.ask === "word+second" ||
		options.ask === "sentence";
	if (wantsWord && options.round.answer === undefined) {
		patch.answer = options.wordInput.trim();
	}
	const wantsSecond =
		options.ask === "word+second" || options.ask === "second";
	if (wantsSecond && options.round.answerDef === undefined) {
		patch.answerDef = options.definitionInput.trim();
	}
	return patch;
}
