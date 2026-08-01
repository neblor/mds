/**
 * 默写轮次推进状态机（纯逻辑，无 UI/无定时器依赖，可直接单元测试）
 *
 * 双轨制：语音轨（speechDone：自然播完）与计数轨（countdownDone：倒计时结束）
 * 相互独立；推进规则：
 * - writing：speechDone && countdownDone 才推进；space-skip 事件可在未发声时人工跳
 * - cyber：输入完成（inputDone）后——语音未发声（播报间隔区）立即推进（中止余下播报）；
 *   正在发声等当前遍播完；语音已完直接推进（不等倒计时）
 * - 最后一轮返回 finish
 *
 * 事件入口由调用方驱动（提交、音频状态回调、倒计时结束、空格），
 * 状态为不可变快照，动作返回后由调用方执行（advance 前自行中止音频）。
 */

export type DictationMode = "writing" | "cyber";

export interface EngineState {
	mode: DictationMode;
	total: number;
	currentIndex: number;
	/** 语音轨：本轮播报（含间隔）是否自然走完 */
	speechDone: boolean;
	/** 计数轨：本轮倒计时是否结束 */
	countdownDone: boolean;
	/** 音频是否正在发声（间隔区为 false） */
	sounding: boolean;
	/** 赛博：本轮全部输入（单词/释义）是否完成 */
	inputDone: boolean;
}

export type EngineEvent =
	/** 赛博提交输入后（调用方需先更新 inputDone） */
	| { type: "submit" }
	/** 音频发声状态变化（开始/结束/中止清理） */
	| { type: "audio-state"; playing: boolean }
	/** 语音轨自然走完（playWithIntervals 完成） */
	| { type: "speech-end" }
	/** 倒计时结束 */
	| { type: "countdown-end" }
	/** 书写模式人工空格跳轮 */
	| { type: "space-skip" };

export type EngineAction =
	| { type: "wait" }
	/** 推进到 nextIndex（调用方执行前须中止当前轮音频与计时） */
	| { type: "advance"; nextIndex: number }
	/** 全部轮次完成（调用方同样须清理） */
	| { type: "finish" };

export function stepEngine(
	state: EngineState,
	event: EngineEvent,
): { state: EngineState; action: EngineAction } {
	const next: EngineState = { ...state };
	switch (event.type) {
		case "submit":
			// inputDone 由调用方在事件前更新到 state
			break;
		case "audio-state":
			next.sounding = event.playing;
			break;
		case "speech-end":
			next.speechDone = true;
			break;
		case "countdown-end":
			next.countdownDone = true;
			break;
		case "space-skip": {
			// 仅书写模式、且音频未发声时可人工跳
			if (next.mode !== "writing" || next.sounding) {
				return { state: next, action: { type: "wait" } };
			}
			return {
				state: next,
				action:
					next.currentIndex + 1 >= next.total
						? { type: "finish" }
						: { type: "advance", nextIndex: next.currentIndex + 1 },
			};
		}
	}

	let action: EngineAction;
	if (next.mode === "cyber") {
		if (!next.inputDone) {
			action = { type: "wait" };
		} else if (!next.speechDone && !next.sounding) {
			// 输入完成 + 语音未发声（播报间隔区）→ 立即推进（调用方中止余下播报）
			action =
				next.currentIndex + 1 >= next.total
					? { type: "finish" }
					: { type: "advance", nextIndex: next.currentIndex + 1 };
		} else if (!next.speechDone) {
			// 正在发声：等当前遍播完（audio-state false 事件会再次触发判定）
			action = { type: "wait" };
		} else {
			// 语音已完 + 输入已完 → 推进（忽略尚未结束的倒计时）
			action =
				next.currentIndex + 1 >= next.total
					? { type: "finish" }
					: { type: "advance", nextIndex: next.currentIndex + 1 };
		}
	} else {
		// 书写模式：双轨都完成才推进
		if (!next.speechDone || !next.countdownDone) {
			action = { type: "wait" };
		} else {
			action =
				next.currentIndex + 1 >= next.total
					? { type: "finish" }
					: { type: "advance", nextIndex: next.currentIndex + 1 };
		}
	}
	return { state: next, action };
}
