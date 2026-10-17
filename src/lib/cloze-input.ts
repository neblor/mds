/**
 * 组句轮的键盘选择状态机（纯逻辑，可单测）
 *
 * 交互口径（.design/mds.md「Phase 2 界面的补充交互规则」27 屏）：
 * - ←→：在当前空上移动候选词光标
 * - 1–9：直接把第 n 个候选填进当前空
 * - Enter：把光标所指候选填进当前空
 * - 鼠标点击候选词：与 Enter 同路（填入当前空并自动前进到下一个未填空）
 * - Tab / ↑↓：换到上一个 / 下一个空
 * - Backspace：当前空已填则清空；未填则退回上一个空并清空
 * - 选完之后的「全部空填完自动提交」由调用方判定，这里只负责状态与选择
 */
export interface ClozeInputState {
	/** 当前空在 blanks 数组里的下标 */
	active: number;
	/** 候选词光标 */
	cursor: number;
}

export interface ClozeInputContext {
	blankCount: number;
	candidates: string[];
	/** 每个空当前已选的词（与 blanks 同序） */
	filled: (string | undefined)[];
}

export type ClozeInputEvent =
	| { type: "cursor"; delta: number }
	| { type: "blank"; delta: number }
	| { type: "focus"; index: number }
	| { type: "digit"; value: number }
	/** 直接选第 index 个候选（鼠标点击候选词，与 Enter 同一套填入+跳格逻辑） */
	| { type: "pick"; index: number }
	| { type: "enter" }
	| { type: "backspace" };

export interface ClozeInputResult {
	state: ClozeInputState;
	/** 本次要写入的选择（无则 null） */
	choose: { blank: number; word: string } | null;
	/** 本次要清空的空下标（无则 null） */
	clear: number | null;
}

export function initialClozeInput(): ClozeInputState {
	return { active: 0, cursor: 0 };
}

/** 从 from 之后找下一个未填的空；找不到则回到最前面找；全填完返回 null */
export function nextEmptyBlank(
	filled: (string | undefined)[],
	from: number,
): number | null {
	for (let i = from + 1; i < filled.length; i++) {
		if (filled[i] === undefined) return i;
	}
	for (let i = 0; i <= from && i < filled.length; i++) {
		if (filled[i] === undefined) return i;
	}
	return null;
}

export function stepClozeInput(
	state: ClozeInputState,
	event: ClozeInputEvent,
	ctx: ClozeInputContext,
): ClozeInputResult {
	const clampActive = (index: number) =>
		Math.max(0, Math.min(Math.max(0, ctx.blankCount - 1), index));
	const clampCursor = (index: number) =>
		Math.max(0, Math.min(Math.max(0, ctx.candidates.length - 1), index));
	const wait = (next: ClozeInputState): ClozeInputResult => ({
		state: next,
		choose: null,
		clear: null,
	});

	switch (event.type) {
		case "cursor":
			return wait({ ...state, cursor: clampCursor(state.cursor + event.delta) });
		case "blank":
			return wait({ ...state, active: clampActive(state.active + event.delta) });
		case "focus":
			return wait({ ...state, active: clampActive(event.index) });
		case "digit": {
			// 只支持 1–9 快选（候选最多 24，其余靠 ←→ + 回车）
			if (event.value < 1 || event.value > 9) return wait(state);
			return pickCandidate(state, event.value - 1, ctx);
		}
		case "pick":
			return pickCandidate(state, event.index, ctx);
		case "enter": {
			const word = ctx.candidates[state.cursor];
			if (word === undefined) return wait(state);
			return chooseWith(state, state.cursor, word, ctx);
		}
		case "backspace": {
			if (ctx.filled[state.active] !== undefined) {
				return { state, choose: null, clear: state.active };
			}
			const previous = state.active - 1;
			if (previous < 0) return { state, choose: null, clear: null };
			return { state: { ...state, active: previous }, choose: null, clear: previous };
		}
	}
}

/** 鼠标点击/数字快选：把第 index 个候选填进当前空；下标非法时不动 */
function pickCandidate(
	state: ClozeInputState,
	index: number,
	ctx: ClozeInputContext,
): ClozeInputResult {
	const word = ctx.candidates[index];
	if (word === undefined) {
		return { state, choose: null, clear: null };
	}
	return chooseWith(state, index, word, ctx);
}

/** 填入后把活动空推进到下一个未填的空（当前轮全填完则原地不动，由调用方自动提交） */
function chooseWith(
	state: ClozeInputState,
	cursor: number,
	word: string,
	ctx: ClozeInputContext,
): ClozeInputResult {
	const filled = ctx.filled.map((value, index) =>
		index === state.active ? word : value,
	);
	const next = nextEmptyBlank(filled, state.active);
	return {
		state: { active: next ?? state.active, cursor },
		choose: { blank: state.active, word },
		clear: null,
	};
}
