import { isStrictMatch } from "./match";

/**
 * 默写流程状态机（纯逻辑，可单测）
 *
 * 阶段：idle(词库) → preparing(准备) → ready(Let's Go) → dictating(逐轮) → results(结果) → idle
 * 跳转解耦：每轮有 countdownDone / speechDone 两个标记，两者都完成才允许进入下一轮。
 */

export type Phase = "idle" | "preparing" | "ready" | "dictating" | "results";
export type DictationMode = "writing" | "cyber";

/**
 * 默写内容模式（决定每轮作答与批改对象）：
 * - word：只默单词，批改单词
 * - definition：默单词 + 英文释义，批改单词，释义只对照不批改
 * - chinese：默中文对应词，批改中文词（准备阶段由 AI 抓取）
 * - sentence：短句（准备阶段为每个词生成一个短句，播报与作答对象是整句，判定核心是目标词）
 * - phonetic：音标（看单词拼音标，点选音素，判定音频序列）
 * - cloze：范例组句（准备阶段由 AI 一次出整场题，每空选词作答）
 */
export type ContentMode =
	| "word"
	| "definition"
	| "chinese"
	| "sentence"
	| "phonetic"
	| "cloze";

/** 内容模式白名单：持久化恢复与历史条目校验共用一份，避免各处各写一份而漏项 */
export const CONTENT_MODES: readonly ContentMode[] = [
	"word",
	"definition",
	"chinese",
	"sentence",
	"phonetic",
	"cloze",
];

export function isContentMode(value: unknown): value is ContentMode {
	return (
		typeof value === "string" &&
		(CONTENT_MODES as readonly string[]).includes(value)
	);
}

/**
 * 解析持久化的内容模式：新键优先，缺失/非法时兼容旧版释义开关。
 *
 * 历史 bug：恢复白名单漏了 "cloze"，于是选了「组句」的用户重启后会静默掉回「单词」。
 * 返回 null 表示没有可恢复的持久化值，调用方保持默认。
 */
export function resolveStoredContentMode(
	saved: string | null,
	legacyWithDefinition: string | null,
): ContentMode | null {
	if (isContentMode(saved)) return saved;
	if (legacyWithDefinition === "1") return "definition";
	if (legacyWithDefinition === "0") return "word";
	return null;
}

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
