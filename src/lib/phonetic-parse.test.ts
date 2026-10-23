import { describe, expect, it } from "vitest";
import {
	normalizeSourceToken,
	normalizeStressPlacement,
	parsePhoneticVariant,
	parsePhoneticVariants,
	phoneticDisplay,
	phoneticToString,
	tokenizeIpa,
	tokensFromString,
	type PhoneticAnswer,
} from "./phonetic-parse";

describe("tokenizeIpa", () => {
	it("切分单词音标（含重音/长音/双元音/塞擦音）", () => {
		expect(tokenizeIpa("ˈæpəl")).toEqual(["ˈ", "æ", "p", "ə", "l"]);
		expect(tokenizeIpa("/ˈæpəl/")).toEqual(["ˈ", "æ", "p", "ə", "l"]);
		expect(tokenizeIpa("w ˈɔː t ə")).toEqual(["w", "ˈ", "ɔː", "t", "ə"]);
		expect(tokenizeIpa("stˈʌdi")).toEqual(["s", "t", "ˈ", "ʌ", "d", "i"]);
		expect(tokenizeIpa("ˈtʃɜːtʃ")).toEqual(["ˈ", "tʃ", "ɜː", "tʃ"]);
		expect(tokenizeIpa("ˈdʒæm")).toEqual(["ˈ", "dʒ", "æ", "m"]);
		expect(tokenizeIpa("ˈeɪ")).toEqual(["ˈ", "eɪ"]);
		expect(tokenizeIpa("ˈaɪ")).toEqual(["ˈ", "aɪ"]);
		expect(tokenizeIpa("ˈɔɪ")).toEqual(["ˈ", "ɔɪ"]);
		expect(tokenizeIpa("ˈəʊ")).toEqual(["ˈ", "əʊ"]);
		expect(tokenizeIpa("ˈaʊ")).toEqual(["ˈ", "aʊ"]);
		expect(tokenizeIpa("ˈɪə")).toEqual(["ˈ", "ɪə"]);
		expect(tokenizeIpa("ˈeə")).toEqual(["ˈ", "eə"]);
		expect(tokenizeIpa("ˈʊə")).toEqual(["ˈ", "ʊə"]);
	});

	it("清洗常见非标准写法", () => {
		expect(tokenizeIpa("ˈhæpi")).toEqual(["ˈ", "h", "æ", "p", "i"]);
		expect(tokenizeIpa("ɹˈɛd")).toEqual(["r", "ˈ", "e", "d"]);
		expect(tokenizeIpa("ˈwɔ:tә")).toEqual(["ˈ", "w", "ɔː", "t", "ə"]);
		expect(tokenizeIpa("ˈoʊ")).toEqual(["ˈ", "əʊ"]);
		expect(tokenizeIpa("ˈɚ")).toEqual(["ˈ", "ə"]);
		expect(tokenizeIpa("ˈɝ")).toEqual(["ˈ", "ɜː"]);
		expect(tokenizeIpa("ˈɑ")).toEqual(["ˈ", "ɑː"]);
		expect(tokenizeIpa("ˈɜ")).toEqual(["ˈ", "ɜː"]);
		expect(tokenizeIpa("ˈu")).toEqual(["ˈ", "uː"]);
		expect(tokenizeIpa("ˈiə")).toEqual(["ˈ", "ɪə"]);
		expect(tokenizeIpa("ˈuə")).toEqual(["ˈ", "ʊə"]);
		expect(tokenizeIpa("ˈɡeɪm")).toEqual(["ˈ", "ɡ", "eɪ", "m"]);
		expect(tokenizeIpa("ˈg eɪ m")).toEqual(["ˈ", "ɡ", "eɪ", "m"]);
	});

	it("无法识别的符号/空串返回 null（不静默丢符号）", () => {
		expect(tokenizeIpa("")).toBeNull();
		expect(tokenizeIpa("x")).toBeNull();
		expect(tokenizeIpa("ˈæx")).toBeNull();
		expect(tokenizeIpa("a")).toBeNull(); // 图表里的 a 只用于合成双元音
		expect(tokenizeIpa("ɔ")).toBeNull(); // 图表用 ɔː / ɒ
		expect(tokenizeIpa("ˈæ(ə)")).toEqual(["ˈ", "æ"]);
	});
});

describe("normalizeStressPlacement", () => {
	it("把 Britfone 的元音前重音移到音节首前", () => {
		expect(normalizeStressPlacement(["w", "ˈ", "ɔː", "t", "ə"])).toEqual([
			"ˈ",
			"w",
			"ɔː",
			"t",
			"ə",
		]);
		expect(
			normalizeStressPlacement(["ɪ", "m", "p", "ˈ", "ɔː", "t", "ə", "n", "t"]),
		).toEqual(["ɪ", "m", "ˈ", "p", "ɔː", "t", "ə", "n", "t"]);
		expect(
			normalizeStressPlacement(["s", "t", "ˈ", "ʌ", "d", "i"]),
		).toEqual(["ˈ", "s", "t", "ʌ", "d", "i"]);
		expect(
			normalizeStressPlacement(["k", "ə", "m", "p", "j", "ˈ", "uː", "t", "ə"]),
		).toEqual(["k", "ə", "m", "ˈ", "p", "j", "uː", "t", "ə"]);
		expect(
			normalizeStressPlacement([
				"f",
				"ˈ",
				"əʊ",
				"t",
				"ə",
				"ɡ",
				"r",
				"ˌ",
				"ɑː",
				"f",
			]),
		).toEqual(["ˈ", "f", "əʊ", "t", "ə", "ˌ", "ɡ", "r", "ɑː", "f"]);
		expect(
			normalizeStressPlacement(["ð", "ˈ", "iː"]),
		).toEqual(["ˈ", "ð", "iː"]);
		expect(
			normalizeStressPlacement(["ɪ", "n", "s", "t", "r", "ˈ", "ʌ", "k", "t"]),
		).toEqual(["ɪ", "n", "ˈ", "s", "t", "r", "ʌ", "k", "t"]);
		expect(
			normalizeStressPlacement(["ˈ", "s", "t", "r", "ʌ", "k"]),
		).toEqual(["ˈ", "s", "t", "r", "ʌ", "k"]);
	});

	it("已经归位/无重音时保持不变", () => {
		expect(normalizeStressPlacement(["ˈ", "æ", "p", "ə", "l"])).toEqual([
			"ˈ",
			"æ",
			"p",
			"ə",
			"l",
		]);
		expect(normalizeStressPlacement(["æ", "p", "ə", "l"])).toEqual([
			"æ",
			"p",
			"ə",
			"l",
		]);
	});

	it("重音后没有元音/未知 token → null", () => {
		expect(normalizeStressPlacement(["ʌ", "ˈ"])).toBeNull();
		expect(normalizeStressPlacement(["x", "ˈ", "æ"])).toBeNull();
		expect(normalizeStressPlacement(["ˈ"])).toBeNull();
	});
});

describe("parsePhoneticVariant / 变体", () => {
	it("解析并归位词典/读音", () => {
		expect(
			parsePhoneticVariant("ˈæpəl", { source: "dict" }),
		).toEqual(["ˈ", "æ", "p", "ə", "l"]);
		expect(parsePhoneticVariant("stˈʌdi", { source: "dict" })).toEqual([
			"ˈ",
			"s",
			"t",
			"ʌ",
			"d",
			"i",
		]);
		expect(parsePhoneticVariant("ˈhæpi", { source: "ai" })).toEqual([
			"ˈ",
			"h",
			"æ",
			"p",
			"i",
		]);
		expect(parsePhoneticVariant("ˈhæpiː", { source: "ai" })).toEqual([
			"ˈ",
			"h",
			"æ",
			"p",
			"iː",
		]);
	});

	it("AI 最多一个主重音；词典允许罕见双主重音", () => {
		expect(parsePhoneticVariant("ˈˈæ", { source: "ai" })).toBeNull();
		expect(parsePhoneticVariant("ˈˈæ", { source: "dict" })).not.toBeNull();
	});

	it("非法输入返回 null", () => {
		expect(parsePhoneticVariant("", { source: "ai" })).toBeNull();
		expect(parsePhoneticVariant("ˈ", { source: "ai" })).toBeNull();
		expect(parsePhoneticVariant("ˈx", { source: "ai" })).toBeNull();
		expect(parsePhoneticVariant("ˈæ", { source: "ai" })).not.toBeNull();
	});

	it("变体去重并限制数量", () => {
		const variants = parsePhoneticVariants(
			["ˈæpəl", "ˈ æ p ə l", "ˈeɪpəl", "ˈiːpəl", "ˈuːpəl"],
			"dict",
		);
		expect(variants).toHaveLength(3);
		expect(variants[0]).toEqual(["ˈ", "æ", "p", "ə", "l"]);
		expect(variants[1]).toEqual(["ˈ", "eɪ", "p", "ə", "l"]);
	});
});

describe("存储/展示", () => {
	it("token 字符串可往返", () => {
		const tokens = ["ˈ", "æ", "p", "ə", "l"];
		expect(phoneticToString(tokens)).toBe("ˈ æ p ə l");
		expect(tokensFromString(phoneticToString(tokens))).toEqual(tokens);
		expect(tokensFromString("")).toEqual([]);
	});

	it("展示形态是 /.../ 无空格", () => {
		expect(phoneticDisplay(["ˈ", "æ", "p", "ə", "l"])).toBe("/ˈæpəl/");
		expect(phoneticDisplay([])).toBe("//");
	});

	it("PhoneticAnswer 形状", () => {
		const answer: PhoneticAnswer = {
			canonical: ["ˈ", "æ", "p", "ə", "l"],
			variants: [["ˈ", "æ", "p", "ə", "l"]],
			source: "dict",
		};
		expect(answer.canonical.join("")).toBe("ˈæpəl");
	});
});

describe("normalizeSourceToken（Britfone 源 token）", () => {
	it("归一化源写法", () => {
		expect(normalizeSourceToken("ˈeɪ")).toEqual(["ˈ", "eɪ"]);
		expect(normalizeSourceToken("ˌəʊ")).toEqual(["ˌ", "əʊ"]);
		expect(normalizeSourceToken("ɹ")).toEqual(["r"]);
		expect(normalizeSourceToken("ɛə")).toEqual(["eə"]);
		expect(normalizeSourceToken("ɐ")).toEqual(["ʌ"]);
		expect(normalizeSourceToken("g")).toEqual(["ɡ"]);
		expect(normalizeSourceToken("i")).toEqual(["i"]);
		expect(normalizeSourceToken("iː")).toEqual(["iː"]);
		expect(normalizeSourceToken("ɔː")).toEqual(["ɔː"]);
		expect(normalizeSourceToken("ˈiː")).toEqual(["ˈ", "iː"]);
	});

	it("一个源 token 必须恰好一个音素", () => {
		expect(normalizeSourceToken("a")).toBeNull();
		expect(normalizeSourceToken("ˈ")).toBeNull();
		expect(normalizeSourceToken("")).toBeNull();
		expect(normalizeSourceToken("eɪ ə")).toBeNull();
	});
});
