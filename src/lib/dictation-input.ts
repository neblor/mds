import type { ContentMode } from "./state";

export interface TimedOutRoundInput {
	answer?: string;
	answerDef?: string;
}

/**
 * 赛博模式倒计时结束时一次性封口本轮输入。
 * 未提交的字段必须写成字符串（允许为空），避免停留在待输入状态。
 * 释义/中文词模式需要两步（英文单词 + 释义/中文词）；单词模式只有一步。
 */
export function timedOutInputPatch(options: {
	round: TimedOutRoundInput;
	contentMode: ContentMode;
	wordInput: string;
	definitionInput: string;
}): TimedOutRoundInput {
	const patch: TimedOutRoundInput = {};
	if (options.round.answer === undefined) {
		patch.answer = options.wordInput.trim();
	}
	if (
		(options.contentMode === "definition" ||
			options.contentMode === "chinese") &&
		options.round.answerDef === undefined
	) {
		patch.answerDef = options.definitionInput.trim();
	}
	return patch;
}
