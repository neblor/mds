export interface TimedOutRoundInput {
	answer?: string;
	answerDef?: string;
}

/**
 * 赛博模式倒计时结束时一次性封口本轮输入。
 * 未提交的字段必须写成字符串（允许为空），避免停留在待输入状态。
 */
export function timedOutInputPatch(options: {
	round: TimedOutRoundInput;
	withDefinition: boolean;
	wordInput: string;
	definitionInput: string;
}): TimedOutRoundInput {
	const patch: TimedOutRoundInput = {};
	if (options.round.answer === undefined) {
		patch.answer = options.wordInput.trim();
	}
	if (options.withDefinition && options.round.answerDef === undefined) {
		patch.answerDef = options.definitionInput.trim();
	}
	return patch;
}
