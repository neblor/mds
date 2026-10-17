import { describe, expect, it } from "vitest";
import {
	initialClozeInput,
	nextEmptyBlank,
	stepClozeInput,
	type ClozeInputContext,
	type ClozeInputState,
} from "./cloze-input";

const CANDIDATES = ["apple", "banana", "give up", "happy", "orange"];

function ctx(filled: (string | undefined)[] = [], blankCount = filled.length): ClozeInputContext {
	return { blankCount, candidates: CANDIDATES, filled };
}

function run(
	state: ClozeInputState,
	events: Parameters<typeof stepClozeInput>[1][],
	context: ClozeInputContext,
) {
	let current = state;
	const results = events.map((event) => {
		const result = stepClozeInput(current, event, context);
		current = result.state;
		return result;
	});
	return { state: current, results };
}

describe("nextEmptyBlank", () => {
	it("优先往后找，再回到前面找，全填完返回 null", () => {
		expect(nextEmptyBlank([undefined, undefined, undefined], 0)).toBe(1);
		expect(nextEmptyBlank([undefined, undefined, undefined], 2)).toBe(0);
		expect(nextEmptyBlank(["a", undefined, "c"], 2)).toBe(1);
		expect(nextEmptyBlank(["a", "b"], 0)).toBeNull();
		expect(nextEmptyBlank([], 0)).toBeNull();
	});
});

describe("stepClozeInput 光标与换空", () => {
	it("←→ 移动候选光标并夹在候选范围内", () => {
		const { state, results } = run(initialClozeInput(), [
			{ type: "cursor", delta: 1 },
			{ type: "cursor", delta: 1 },
			{ type: "cursor", delta: -1 },
			{ type: "cursor", delta: -5 },
			{ type: "cursor", delta: 99 },
		], ctx([undefined, undefined]));
		expect(results.map((r) => r.choose)).toEqual([
			null, null, null, null, null,
		]);
		expect(state.cursor).toBe(CANDIDATES.length - 1);
	});

	it("↑↓/Tab 换空并夹在空范围内", () => {
		const { state, results } = run(
			initialClozeInput(),
			[
				{ type: "blank", delta: 1 },
				{ type: "blank", delta: 1 },
				{ type: "blank", delta: -1 },
				{ type: "blank", delta: -9 },
				{ type: "focus", index: 2 },
			],
			ctx([undefined, undefined, undefined]),
		);
		expect(results.every((r) => r.choose === null && r.clear === null)).toBe(true);
		expect(state.active).toBe(2);
	});

	it("空白轮（0 个空）不崩", () => {
		const { state } = run(initialClozeInput(), [
			{ type: "blank", delta: 1 },
			{ type: "enter" },
			{ type: "backspace" },
		], ctx([], 0));
		expect(state).toEqual({ active: 0, cursor: 0 });
	});
});

describe("stepClozeInput 选词", () => {
	it("Enter 填入光标所指候选，并推进到下一个空", () => {
		const { state, results } = run(
			initialClozeInput(),
			[{ type: "cursor", delta: 2 }, { type: "enter" }],
			ctx([undefined, undefined, undefined]),
		);
		expect(results[1].choose).toEqual({ blank: 0, word: "give up" });
		expect(state).toMatchObject({ active: 1, cursor: 2 });
	});

	it("鼠标点击候选（pick）：与回车同路，填入当前空并推进到下一个未填空", () => {
		const { results, state } = run(
			initialClozeInput(),
			[{ type: "pick", index: 3 }],
			ctx([undefined, undefined, undefined]),
		);
		expect(results[0].choose).toEqual({ blank: 0, word: "happy" });
		expect(state).toMatchObject({ active: 1, cursor: 3 });
	});

	it("点击已填空槽改选：覆写该空后继续推进；下标越界时不动", () => {
		const { results, state } = run(
			initialClozeInput(),
			[
				{ type: "focus", index: 1 },
				{ type: "pick", index: 4 },
			],
			ctx([undefined, "apple", undefined]),
		);
		expect(results[1].choose).toEqual({ blank: 1, word: "orange" });
		expect(state.active).toBe(2);

		// 改选的是最后一个空、前面还有空 → 绕回去继续填
		const wrap = run(
			initialClozeInput(),
			[
				{ type: "focus", index: 2 },
				{ type: "pick", index: 1 },
			],
			ctx(["apple", undefined, "banana"]),
		);
		expect(wrap.results[1].choose).toEqual({ blank: 2, word: "banana" });
		expect(wrap.state.active).toBe(1);

		const outOfRange = run(
			initialClozeInput(),
			[{ type: "pick", index: 99 }],
			ctx([undefined]),
		);
		expect(outOfRange.results[0]).toMatchObject({ choose: null, clear: null });
		expect(outOfRange.state).toEqual(initialClozeInput());
	});

	it("1–9 快选：数字对应候选下标", () => {
		const { results, state } = run(
			initialClozeInput(),
			[{ type: "digit", value: 4 }],
			ctx([undefined, undefined]),
		);
		expect(results[0].choose).toEqual({ blank: 0, word: "happy" });
		expect(state.cursor).toBe(3);
	});

	it("数字超出候选数量或超出 1–9 时忽略", () => {
		const nine = run(
			initialClozeInput(),
			[{ type: "digit", value: 9 }],
			ctx([undefined]),
		);
		expect(nine.results[0].choose).toBeNull();
		const zero = run(
			initialClozeInput(),
			[{ type: "digit", value: 0 }],
			ctx([undefined]),
		);
		expect(zero.results[0].choose).toBeNull();
	});

	it("填空顺序打乱时，推进到最近的下一个未填空", () => {
		// 先填第 3 个空（focus 2），再回车 → 回到最前面未填的 0
		const { state } = run(
			initialClozeInput(),
			[
				{ type: "focus", index: 2 },
				{ type: "enter" },
			],
			ctx([undefined, undefined, undefined]),
		);
		expect(state.active).toBe(0);
	});

	it("全部空填完后活动空停在原地（由调用方自动提交）", () => {
		let state = initialClozeInput();
		const filled: (string | undefined)[] = [undefined, undefined];
		for (const value of [1, 2]) {
			const result = stepClozeInput(
				state,
				{ type: "digit", value },
				{ ...ctx(filled), candidates: CANDIDATES },
			);
			state = result.state;
			if (result.choose) filled[result.choose.blank] = result.choose.word;
		}
		expect(filled).toEqual(["apple", "banana"]);
		expect(state.active).toBe(1);
	});
});

describe("stepClozeInput 退格", () => {
	it("当前空已填则清空当前空", () => {
		const result = stepClozeInput(
			{ active: 1, cursor: 0 },
			{ type: "backspace" },
			ctx([undefined, "apple"], 2),
		);
		expect(result).toMatchObject({ clear: 1, choose: null });
		expect(result.state.active).toBe(1);
	});

	it("当前空未填则退回上一个空并清空", () => {
		const result = stepClozeInput(
			{ active: 2, cursor: 0 },
			{ type: "backspace" },
			ctx(["apple", "banana", undefined], 3),
		);
		expect(result).toMatchObject({ clear: 1, choose: null });
		expect(result.state.active).toBe(1);
	});

	it("第一个空未填时退格无动作", () => {
		const result = stepClozeInput(
			{ active: 0, cursor: 3 },
			{ type: "backspace" },
			ctx([undefined, "apple"], 2),
		);
		expect(result).toMatchObject({ clear: null, choose: null });
		expect(result.state.active).toBe(0);
	});
});
