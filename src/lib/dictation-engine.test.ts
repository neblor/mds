/**
 * dictation-engine 单元测试：双轨制推进的全部时序组合
 * 覆盖：书写/赛博各事件组合、间隔区立即推进、发声等待、空格跳、最后一轮 finish
 */
import { describe, expect, it } from "vitest";
import { stepEngine, type EngineState } from "./dictation-engine";

const base = (over: Partial<EngineState> = {}): EngineState => ({
	mode: "writing",
	total: 3,
	currentIndex: 0,
	speechDone: false,
	countdownDone: false,
	sounding: false,
	inputDone: false,
	...over,
});

describe("stepEngine · 书写模式（双轨制）", () => {
	it("语音未完 → wait", () => {
		const { action } = stepEngine(base({ countdownDone: true }), {
			type: "countdown-end",
		});
		expect(action).toEqual({ type: "wait" });
	});

	it("倒计时未完 → wait", () => {
		const { action } = stepEngine(base({ speechDone: true }), {
			type: "audio-state",
			playing: false,
		});
		expect(action).toEqual({ type: "wait" });
	});

	it("双轨都完成 → advance 到下一轮", () => {
		const { action } = stepEngine(
			base({ speechDone: true, countdownDone: true }),
			{ type: "countdown-end" },
		);
		expect(action).toEqual({ type: "advance", nextIndex: 1 });
	});

	it("最后一轮双轨完成 → finish", () => {
		const { action } = stepEngine(
			base({ currentIndex: 2, speechDone: true, countdownDone: true }),
			{ type: "countdown-end" },
		);
		expect(action).toEqual({ type: "finish" });
	});

	it("空格：未发声 → advance（人工跳轮）", () => {
		const { action } = stepEngine(base(), { type: "space-skip" });
		expect(action).toEqual({ type: "advance", nextIndex: 1 });
	});

	it("空格：正在发声 → wait（不得中断播报）", () => {
		const { action } = stepEngine(base({ sounding: true }), {
			type: "space-skip",
		});
		expect(action).toEqual({ type: "wait" });
	});

	it("空格：赛博模式 → wait（赛博走输入流程）", () => {
		const { action } = stepEngine(base({ mode: "cyber", inputDone: true }), {
			type: "space-skip",
		});
		expect(action).toEqual({ type: "wait" });
	});

	it("空格：最后一轮 → finish", () => {
		const { action } = stepEngine(base({ currentIndex: 2 }), {
			type: "space-skip",
		});
		expect(action).toEqual({ type: "finish" });
	});
});

describe("stepEngine · 赛博模式", () => {
	it("输入未完成 → wait（语音状态无关）", () => {
		for (const ev of [
			{ type: "audio-state", playing: false },
			{ type: "countdown-end" },
		] as const) {
			const { action } = stepEngine(
				base({ mode: "cyber", speechDone: true, countdownDone: true }),
				ev,
			);
			expect(action).toEqual({ type: "wait" });
		}
	});

	it("输入完成 + 语音未发声（间隔区）→ 立即推进，不等语音轨", () => {
		const { action } = stepEngine(
			base({ mode: "cyber", inputDone: true, countdownDone: false }),
			{ type: "submit" },
		);
		expect(action).toEqual({ type: "advance", nextIndex: 1 });
	});

	it("输入完成 + 正在发声 → wait（等当前遍播完）", () => {
		const { action } = stepEngine(
			base({ mode: "cyber", inputDone: true, sounding: true }),
			{ type: "submit" },
		);
		expect(action).toEqual({ type: "wait" });
	});

	it("输入完成 + 发声结束（进入间隔）→ 立即推进", () => {
		const { action } = stepEngine(
			base({ mode: "cyber", inputDone: true, sounding: true }),
			{ type: "audio-state", playing: false },
		);
		expect(action).toEqual({ type: "advance", nextIndex: 1 });
	});

	it("输入完成 + 语音已自然走完 → 推进（忽略倒计时）", () => {
		const { action } = stepEngine(
			base({ mode: "cyber", inputDone: true, speechDone: true }),
			{ type: "countdown-end" },
		);
		expect(action).toEqual({ type: "advance", nextIndex: 1 });
	});

	it("输入完成 + 语音已完 + 最后一轮 → finish", () => {
		const { action } = stepEngine(
			base({
				mode: "cyber",
				currentIndex: 2,
				inputDone: true,
				speechDone: true,
			}),
			{ type: "submit" },
		);
		expect(action).toEqual({ type: "finish" });
	});

	it("最后一轮在播报间隔区提交 → 立即 finish，不等待 speech-end", () => {
		const { action } = stepEngine(
			base({
				mode: "cyber",
				currentIndex: 2,
				inputDone: true,
				speechDone: false,
				sounding: false,
			}),
			{ type: "submit" },
		);
		expect(action).toEqual({ type: "finish" });
	});

	it("重入场景：发声结束事件后 speechDone 仍 false → 返回 advance（仅一次）", () => {
		// 模拟：audio-state(false) 触发 advance 后调用方中止音频，
		// 中止清理再次回调 audio-state(false)——此时 inputDone 仍 true、sounding false
		const s1 = base({ mode: "cyber", inputDone: true });
		const r1 = stepEngine(s1, { type: "audio-state", playing: false });
		expect(r1.action).toEqual({ type: "advance", nextIndex: 1 });
		// 调用方执行 advance 后进入新轮：inputDone 重置 → 重入事件 wait
		const s2: EngineState = {
			...r1.state,
			currentIndex: 1,
			speechDone: false,
			countdownDone: false,
			inputDone: false,
		};
		const r2 = stepEngine(s2, { type: "audio-state", playing: false });
		expect(r2.action).toEqual({ type: "wait" });
	});
});

describe("stepEngine · 状态更新", () => {
	it("audio-state 更新 sounding", () => {
		const { state } = stepEngine(base(), {
			type: "audio-state",
			playing: true,
		});
		expect(state.sounding).toBe(true);
	});

	it("countdown-end 更新 countdownDone", () => {
		const { state } = stepEngine(base(), { type: "countdown-end" });
		expect(state.countdownDone).toBe(true);
	});

	it("事件不修改原状态（不可变快照）", () => {
		const s = base();
		stepEngine(s, { type: "countdown-end" });
		expect(s.countdownDone).toBe(false);
	});
});
