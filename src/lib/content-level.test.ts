/**
 * 生成级别（content-level）单元测试：
 * 级别枚举与中文标签、默认值、提示词用的客观级别描述、宽容解析。
 */
import { describe, expect, it } from "vitest";
import {
	CONTENT_LEVELS,
	CONTENT_LEVEL_OPTIONS,
	CONTENT_LEVEL_PROMPTS,
	DEFAULT_CONTENT_LEVEL,
	isContentLevel,
	parseContentLevel,
} from "./content-level";

describe("CONTENT_LEVEL_OPTIONS", () => {
	it("覆盖全部级别，且默认级别是初中", () => {
		expect(DEFAULT_CONTENT_LEVEL).toBe("junior");
		expect(CONTENT_LEVEL_OPTIONS.map((option) => option.value)).toEqual([
			...CONTENT_LEVELS,
		]);
		expect(
			CONTENT_LEVEL_OPTIONS.find((option) => option.value === DEFAULT_CONTENT_LEVEL)
				?.label,
		).toBe("初中");
		expect(CONTENT_LEVEL_OPTIONS.map((option) => option.label)).toEqual([
			"小学",
			"初中",
			"高中",
			"大学",
		]);
	});
});

describe("CONTENT_LEVEL_PROMPTS", () => {
	it("每个级别都有描述词汇与句法的客观文本，不含主观定位", () => {
		for (const level of CONTENT_LEVELS) {
			const text = CONTENT_LEVEL_PROMPTS[level];
			expect(text.length).toBeGreaterThan(20);
			expect(text.toLowerCase()).not.toContain("kid");
			expect(text.toLowerCase()).not.toContain("child");
			expect(text.toLowerCase()).not.toContain("for children");
		}
	});

	it("级别越高，描述里点名更高阶的语法/词汇参照", () => {
		expect(CONTENT_LEVEL_PROMPTS.primary).toContain("primary-school");
		expect(CONTENT_LEVEL_PROMPTS.junior).toContain("junior-high");
		expect(CONTENT_LEVEL_PROMPTS.senior).toContain("senior-high");
		expect(CONTENT_LEVEL_PROMPTS.college).toContain("CET-4");
	});
});

describe("parseContentLevel", () => {
	it("合法值原样返回", () => {
		for (const level of CONTENT_LEVELS) {
			expect(parseContentLevel(level)).toBe(level);
			expect(isContentLevel(level)).toBe(true);
		}
	});

	it("未知/缺失/类型不对一律回落默认级别（含设置迁移）", () => {
		for (const value of [
			undefined,
			null,
			"",
			"PRIMARY",
			"kids",
			"高学",
			3,
			true,
			{},
			["junior"],
		]) {
			expect(parseContentLevel(value)).toBe(DEFAULT_CONTENT_LEVEL);
			expect(isContentLevel(value)).toBe(false);
		}
	});
});
