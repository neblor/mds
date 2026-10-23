import { describe, expect, it } from "vitest";
import {
	bestVariantIndex,
	diffPhonetic,
	matchVariant,
	normalizeForGrading,
	tokenDistance,
} from "./phonetic-match";

describe("normalizeForGrading", () => {
	it("重音归位 + 去掉次重音", () => {
		expect(normalizeForGrading(["w", "ˈ", "ɔː", "t", "ə"])).toEqual([
			"ˈ",
			"w",
			"ɔː",
			"t",
			"ə",
		]);
		expect(
			normalizeForGrading([
				"ˈ",
				"f",
				"əʊ",
				"t",
				"ə",
				"ˌ",
				"ɡ",
				"r",
				"ɑː",
				"f",
			]),
		).toEqual(["ˈ", "f", "əʊ", "t", "ə", "ɡ", "r", "ɑː", "f"]);
	});

	it("非法输入返回 null", () => {
		expect(normalizeForGrading(["x"])).toBeNull();
		expect(normalizeForGrading(["ʌ", "ˈ"])).toBeNull();
	});
});

describe("matchVariant", () => {
	it("精确匹配 + 元音前/音节首前重音等价", () => {
		const variant = ["ˈ", "w", "ɔː", "t", "ə"];
		expect(matchVariant(["ˈ", "w", "ɔː", "t", "ə"], [variant])).toBe(0);
		expect(matchVariant(["w", "ˈ", "ɔː", "t", "ə"], [variant])).toBe(0);
	});

	it("次重音忽略、主重音严格", () => {
		const variant = ["ˈ", "f", "əʊ", "t", "ə", "ˌ", "ɡ", "r", "ɑː", "f"];
		expect(
			matchVariant(["ˈ", "f", "əʊ", "t", "ə", "ɡ", "r", "ɑː", "f"], [
				variant,
			]),
		).toBe(0);
		expect(
			matchVariant(["f", "əʊ", "t", "ə", "ɡ", "r", "ɑː", "f"], [variant]),
		).toBe(-1);
	});

	it("音素错/多读音/不宽容 i 系列", () => {
		const variant = ["ˈ", "æ", "p", "ə", "l"];
		expect(matchVariant(["ˈ", "æ", "b", "ə", "l"], [variant])).toBe(-1);
		expect(
			matchVariant(["ˈ", "iː", "p", "ə", "l"], [
				["ˈ", "ɪ", "p", "ə", "l"],
				["ˈ", "iː", "p", "ə", "l"],
			]),
		).toBe(1);
		expect(matchVariant(["ˈ", "i", "p", "ə", "l"], [variant])).toBe(-1);
		expect(matchVariant(["ˈ", "iː", "p", "ə", "l"], [variant])).toBe(-1);
		expect(matchVariant(["ˈ", "ɪ", "p", "ə", "l"], [variant])).toBe(-1);
	});
});

describe("tokenDistance / bestVariantIndex", () => {
	it("编辑距离", () => {
		expect(tokenDistance(["a", "b"], ["a", "b"])).toBe(0);
		expect(tokenDistance(["a", "b"], ["a", "c"])).toBe(1);
		expect(tokenDistance(["a", "b"], ["a", "b", "c"])).toBe(1);
		expect(tokenDistance(["a", "b", "c"], ["a", "c"])).toBe(1);
		expect(tokenDistance([], ["a"])).toBe(1);
	});

	it("选最接近的变体", () => {
		const user = ["ˈ", "w", "ɔː", "t", "ə"];
		expect(bestVariantIndex(user, [["ˈ", "w", "ɔː", "t", "ə"]])).toBe(0);
		expect(
			bestVariantIndex(user, [
				["ˈ", "w", "ɒ", "t", "ə"],
				["ˈ", "w", "ɔː", "t", "ə"],
			]),
		).toBe(1);
		expect(bestVariantIndex(["x"], [["ˈ", "æ"]])).toBe(-1);
	});
});

describe("diffPhonetic", () => {
	it("全对", () => {
		expect(diffPhonetic(["ˈ", "æ", "p"], ["ˈ", "æ", "p"])).toEqual([
			{ token: "ˈ", status: "ok" },
			{ token: "æ", status: "ok" },
			{ token: "p", status: "ok" },
		]);
	});

	it("替换/缺失/多余", () => {
		expect(diffPhonetic(["ˈ", "æ", "p"], ["ˈ", "æ", "b"])).toEqual([
			{ token: "ˈ", status: "ok" },
			{ token: "æ", status: "ok" },
			{ token: "b", status: "wrong" },
		]);
		expect(diffPhonetic(["ˈ", "æ", "p", "ə", "l"], ["ˈ", "æ", "p"])).toEqual([
			{ token: "ˈ", status: "ok" },
			{ token: "æ", status: "ok" },
			{ token: "p", status: "ok" },
			{ token: "ə", status: "missing" },
			{ token: "l", status: "missing" },
		]);
		expect(diffPhonetic(["ˈ", "æ", "p"], ["ˈ", "æ", "p", "i"])).toEqual([
			{ token: "ˈ", status: "ok" },
			{ token: "æ", status: "ok" },
			{ token: "p", status: "ok" },
			{ token: "i", status: "extra" },
		]);
	});

	it("空序列", () => {
		expect(diffPhonetic([], [])).toEqual([]);
		expect(diffPhonetic([], ["æ"])).toEqual([{ token: "æ", status: "extra" }]);
		expect(diffPhonetic(["æ"], [])).toEqual([
			{ token: "æ", status: "missing" },
		]);
	});
});
