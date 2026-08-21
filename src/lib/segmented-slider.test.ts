import { describe, expect, it } from "vitest";
import { indexAtPointer } from "./segmented-slider";

const RECT = { rectLeft: 100, rectWidth: 300, optionCount: 3 };

describe("indexAtPointer", () => {
	it("按相对位置取整到选项槽位", () => {
		expect(indexAtPointer({ ...RECT, clientX: 100 })).toBe(0);
		expect(indexAtPointer({ ...RECT, clientX: 150 })).toBe(0);
		expect(indexAtPointer({ ...RECT, clientX: 200 })).toBe(1);
		expect(indexAtPointer({ ...RECT, clientX: 250 })).toBe(1);
		expect(indexAtPointer({ ...RECT, clientX: 300 })).toBe(2);
		expect(indexAtPointer({ ...RECT, clientX: 399 })).toBe(2);
	});

	it("轨道外左侧 clamp 到 0，右侧 clamp 到最后一个", () => {
		expect(indexAtPointer({ ...RECT, clientX: 0 })).toBe(0);
		expect(indexAtPointer({ ...RECT, clientX: 99 })).toBe(0);
		expect(indexAtPointer({ ...RECT, clientX: 400 })).toBe(2);
		expect(indexAtPointer({ ...RECT, clientX: 10000 })).toBe(2);
	});

	it("边界值：槽位分界点归属右槽", () => {
		// 300px / 3 = 100px 每槽；x=200 恰为第 1 槽末尾（比例 1/3 → floor(1)=1）
		expect(indexAtPointer({ ...RECT, clientX: 199 })).toBe(0);
		expect(indexAtPointer({ ...RECT, clientX: 200 })).toBe(1);
	});

	it("防御：零/负宽度或零选项 → 0", () => {
		expect(indexAtPointer({ clientX: 0, rectLeft: 0, rectWidth: 0, optionCount: 3 })).toBe(0);
		expect(indexAtPointer({ clientX: 0, rectLeft: 0, rectWidth: -10, optionCount: 3 })).toBe(0);
		expect(indexAtPointer({ clientX: 0, rectLeft: 0, rectWidth: 100, optionCount: 0 })).toBe(0);
	});

	it("两个选项与一个选项", () => {
		expect(indexAtPointer({ clientX: 110, rectLeft: 100, rectWidth: 200, optionCount: 2 })).toBe(0);
		expect(indexAtPointer({ clientX: 250, rectLeft: 100, rectWidth: 200, optionCount: 2 })).toBe(1);
		expect(indexAtPointer({ clientX: 0, rectLeft: 0, rectWidth: 500, optionCount: 1 })).toBe(0);
	});
});
