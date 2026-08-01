import { isStrictMatch } from "./match";

/**
 * 默写流程状态机（纯逻辑，可单测）
 *
 * 阶段：idle(词库) → preparing(准备) → ready(Let's Go) → dictating(逐轮) → results(结果) → idle
 * 跳转解耦：每轮有 countdownDone / speechDone 两个标记，两者都完成才允许进入下一轮。
 */

export type Phase = "idle" | "preparing" | "ready" | "dictating" | "results";
export type DictationMode = "writing" | "cyber";

export interface Round {
	word: string;
	definition?: string;
	repeatCount: number;
	/** 计算好的每轮时长（秒，已含倍率调整） */
	durationSec: number;
	countdownDone: boolean;
	speechDone: boolean;
	/** 赛博模式输入 */
	answer?: string;
	answerDef?: string;
}

export interface DictationState {
	phase: Phase;
	mode: DictationMode;
	withDefinition: boolean;
	words: string[];
	rounds: Round[];
	currentIndex: number;
}

export function shuffle<T>(list: T[]): T[] {
	const a = [...list];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

export function createState(
	words: string[],
	mode: DictationMode,
	withDefinition: boolean,
	shuffleFn: (list: string[]) => string[] = shuffle,
): DictationState {
	const shuffled = shuffleFn(words);
	return {
		phase: "idle",
		mode,
		withDefinition,
		words: shuffled,
		rounds: [],
		currentIndex: 0,
	};
}

/** 两个标记都完成才可跳转（防御未定义轮） */
export function canAdvance(round: Round): boolean {
	return !!round.countdownDone && !!round.speechDone;
}

export function isLastRound(state: DictationState): boolean {
	return state.currentIndex >= state.rounds.length - 1;
}

export function isAllCorrect(state: DictationState): boolean {
	return (
		state.mode === "cyber" &&
		state.rounds.length > 0 &&
		state.rounds.every(
			(r) => r.answer !== undefined && isStrictMatch(r.answer, r.word),
		)
	);
}
