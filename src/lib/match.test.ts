import { describe, it, expect } from "vitest";
import {
	isStrictMatch,
	isChineseMatch,
	isDefinitionMatch,
	isSentenceMatch,
	normalizeSentence,
	normalizeChinese,
	normalizeDefinition,
	isAllCorrect,
} from "./match";

describe("isStrictMatch", () => {
	it("完全一致算对", () => {
		expect(isStrictMatch("apple", "apple")).toBe(true);
		expect(isStrictMatch("give up", "give up")).toBe(true);
	});
	it("大小写不同算错", () => {
		expect(isStrictMatch("Hello", "hello")).toBe(false);
		expect(isStrictMatch("Umbrella", "umbrella")).toBe(false);
	});
	it("标点不同算错", () => {
		expect(isStrictMatch("don't", "dont")).toBe(false);
		expect(isStrictMatch("hello!", "hello")).toBe(false);
	});
	it("中间空格不同算错", () => {
		expect(isStrictMatch("giveup", "give up")).toBe(false);
		expect(isStrictMatch("give  up", "give up")).toBe(false);
	});
	it("首尾空白容忍（输入卫生）", () => {
		expect(isStrictMatch("  apple ", "apple")).toBe(true);
	});
});

describe("isDefinitionMatch", () => {
	it("大小写/标点/空白差异容忍（本地兜底口径）", () => {
		expect(
			isDefinitionMatch("A round fruit.", "a round fruit"),
		).toBe(true);
		expect(
			isDefinitionMatch("A  round   fruit!", "a round fruit"),
		).toBe(true);
		expect(
			isDefinitionMatch("It is a big, red fruit.", "it is a big red fruit"),
		).toBe(true);
	});
	it("措辞不同不算对（改述交给 AI，本地兜底从严是预期行为）", () => {
		expect(
			isDefinitionMatch("a red fruit that is round", "a round fruit"),
		).toBe(false);
	});
	it("空/空白算错", () => {
		expect(isDefinitionMatch("", "a round fruit")).toBe(false);
		expect(isDefinitionMatch("  ", "a round fruit")).toBe(false);
	});
	it("归一化只处理大小写、英文标点与空白", () => {
		expect(normalizeDefinition("Hello, World! It's fine.")).toBe(
			"hello world it s fine",
		);
	});
});

describe("normalizeSentence（短句归一化）", () => {
	it("小写 + 去标点 + 压空白 + 去首尾空白", () => {
		expect(normalizeSentence("  She  EATS an apple.  ")).toBe("she eats an apple");
		expect(normalizeSentence("Hello,   world!")).toBe("hello world");
		expect(normalizeSentence("Don't stop!")).toBe("dont stop");
	});

	it("全角标点/中文标点也去掉，字母保留", () => {
		// 标点是直接删掉、不补空格（按崔总给的规则）：紧邻标点的两个词会连在一起
		expect(normalizeSentence("Apple，banana。")).toBe("applebanana");
		expect(normalizeSentence("Apple, banana.")).toBe("apple banana");
	});

	it("只有标点时归一为空串", () => {
		expect(normalizeSentence("!!!")).toBe("");
	});
});

describe("isSentenceMatch（整句默写口径）", () => {
	const expected = "She eats an apple.";

	it("完全一致算对", () => {
		expect(isSentenceMatch("She eats an apple.", expected)).toBe(true);
	});

	it("忽略大小写", () => {
		expect(isSentenceMatch("SHE EATS AN APPLE.", expected)).toBe(true);
		expect(isSentenceMatch("she eats an apple.", expected)).toBe(true);
	});

	it("忽略标点", () => {
		expect(isSentenceMatch("She eats an apple", expected)).toBe(true);
		expect(isSentenceMatch("She eats an apple!!!", expected)).toBe(true);
		expect(isSentenceMatch("She, eats an apple", expected)).toBe(true);
	});

	it("空格多少不影响（压成单个空格后比较）", () => {
		expect(isSentenceMatch("She  eats   an apple.", expected)).toBe(true);
		expect(isSentenceMatch("  She eats an apple.  ", expected)).toBe(true);
	});

	it("词序/词形/漏词仍然算错（只放宽大小写与标点空格）", () => {
		expect(isSentenceMatch("eats She an apple", expected)).toBe(false);
		expect(isSentenceMatch("She eats apples", expected)).toBe(false);
		expect(isSentenceMatch("She eats apple", expected)).toBe(false);
		expect(isSentenceMatch("She eats an apple pie", expected)).toBe(false);
	});

	it("空作答算错（归一后为空，与整句不等）", () => {
		expect(isSentenceMatch("", expected)).toBe(false);
		expect(isSentenceMatch("   ", expected)).toBe(false);
		expect(isSentenceMatch("!!!", expected)).toBe(false);
	});
});

describe("isAllCorrect", () => {
	it("全对", () => {
		expect(isAllCorrect([{ correct: true }, { correct: true }])).toBe(true);
	});
	it("有空列表不算全对", () => {
		expect(isAllCorrect([])).toBe(false);
	});
	it("有错不算全对", () => {
		expect(isAllCorrect([{ correct: true }, { correct: false }])).toBe(false);
	});
});

describe("isChineseMatch", () => {
	it("完全一致算对", () => {
		expect(isChineseMatch("你好", "你好")).toBe(true);
		expect(isChineseMatch("放弃", "放弃")).toBe(true);
	});
	it("忽略中文标点", () => {
		expect(isChineseMatch("你好！", "你好")).toBe(true);
		expect(isChineseMatch("你好，", "你好")).toBe(true);
		expect(isChineseMatch("苹果。", "苹果")).toBe(true);
		expect(isChineseMatch("「你好」", "你好")).toBe(true);
	});
	it("忽略空白与全角空格", () => {
		expect(isChineseMatch(" 你好 ", "你好")).toBe(true);
		expect(isChineseMatch("你 好", "你好")).toBe(true);
		expect(isChineseMatch("\u3000你好\u3000", "你好")).toBe(true);
	});
	it("词不同算错", () => {
		expect(isChineseMatch("您好", "你好")).toBe(false);
		expect(isChineseMatch("再见", "你好")).toBe(false);
	});
	it("空输入算错（标准非空时）", () => {
		expect(isChineseMatch("", "你好")).toBe(false);
		expect(isChineseMatch("   ", "你好")).toBe(false);
		expect(isChineseMatch("", "")).toBe(true);
	});
	it("归一化只去除空白与中文标点，保留其他字符", () => {
		expect(normalizeChinese("ABC，你好 ！")).toBe("ABC你好");
		expect(normalizeChinese("a-b")).toBe("a-b");
	});
});

describe("match 边界用例", () => {
	it("全空白输入 vs 单词 → 错", () => {
		expect(isStrictMatch("   ", "apple")).toBe(false);
		expect(isStrictMatch("", "apple")).toBe(false);
	});
	it("expected 为空串", () => {
		expect(isStrictMatch("", "")).toBe(true);
		expect(isStrictMatch("a", "")).toBe(false);
	});
	it("换行/制表符 trim 后匹配", () => {
		expect(isStrictMatch("apple\n", "apple")).toBe(true);
		expect(isStrictMatch("\tapple", "apple")).toBe(true);
	});
	it("全角字符不归一（严格）", () => {
		expect(isStrictMatch("ａｐｐｌｅ", "apple")).toBe(false);
	});
	it("大小写混写", () => {
		expect(isStrictMatch("Apple", "apple")).toBe(false);
		expect(isStrictMatch("APPLE", "apple")).toBe(false);
	});
	it("内部多空格", () => {
		expect(isStrictMatch("give  up", "give up")).toBe(false);
	});
	it("isAllCorrect 空数组/全 undefined/混合", () => {
		expect(isAllCorrect([])).toBe(false);
		expect(
			isAllCorrect([
				{ correct: true },
				{ correct: undefined as unknown as boolean },
			]),
		).toBe(false);
		expect(isAllCorrect([{ correct: true }, { correct: false }])).toBe(false);
		expect(isAllCorrect([{ correct: true }, { correct: true }])).toBe(true);
	});
});
