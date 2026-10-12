import { describe, expect, it } from "vitest";
import {
	MAX_BANK_ENTRIES,
	csvRecords,
	ecdictRowToEntry,
	mergeEntries,
	normalizeEntry,
	normalizeWord,
	parseBankFile,
	parseCsv,
	parseEntries,
	parseImportedText,
	parseManifest,
	removeWords,
	wordKey,
} from "./bank-parse";
import { isValidBankId, isEditableSource } from "./bank-types";

describe("normalizeWord", () => {
	it("去首尾空白并折叠内部空白", () => {
		expect(normalizeWord("  give   up  ")).toBe("give up");
		expect(normalizeWord("apple\t\n")).toBe("apple");
	});

	it("拒绝空串、非字符串、超长与控制字符", () => {
		expect(normalizeWord("")).toBeNull();
		expect(normalizeWord("   ")).toBeNull();
		expect(normalizeWord(42)).toBeNull();
		expect(normalizeWord(null)).toBeNull();
		expect(normalizeWord("a".repeat(81))).toBeNull();
		expect(normalizeWord("bad\u0000word")).toBeNull();
		expect(normalizeWord("bad\u007fword")).toBeNull();
	});

	it("保留大小写与连字符等正常字符", () => {
		expect(normalizeWord("New York")).toBe("New York");
		expect(normalizeWord("well-known")).toBe("well-known");
	});

	it("wordKey 大小写与空白不敏感", () => {
		expect(wordKey("Give  Up")).toBe(wordKey("give up"));
		expect(wordKey(" Apple ")).toBe("apple");
	});
});

describe("normalizeEntry", () => {
	it("字符串形式只带 word", () => {
		expect(normalizeEntry("apple")).toEqual({ word: "apple" });
		expect(normalizeEntry("  ")).toBeNull();
	});

	it("兼容 word/name/w 与 definition/d/trans 等常见字段名", () => {
		expect(normalizeEntry({ name: "banana", trans: "a fruit" })).toEqual({
			word: "banana",
			definition: "a fruit",
		});
		expect(normalizeEntry({ w: "pear", d: "a fruit" })).toEqual({
			word: "pear",
			definition: "a fruit",
		});
	});

	it("归一 lose ends：translation / phonetic / usphone / frq / tags", () => {
		expect(
			normalizeEntry({
				word: "apple",
				translation: " 苹果 ",
				usphone: "'æpl",
				frequency: "1200",
				tag: "CET4 gk cet4",
			}),
		).toEqual({
			word: "apple",
			translation: "苹果",
			phonetic: "'æpl",
			frq: 1200,
			tags: ["cet4", "gk"],
		});
	});

	it("frq 为 0 / 负数 / 非数字时视为未知（undefined）", () => {
		expect(normalizeEntry({ word: "a", frq: 0 })?.frq).toBeUndefined();
		expect(normalizeEntry({ word: "a", frq: -5 })?.frq).toBeUndefined();
		expect(normalizeEntry({ word: "a", frq: "abc" })?.frq).toBeUndefined();
	});

	it("释义超长时截断而不是丢弃", () => {
		const entry = normalizeEntry({ word: "a", definition: "x".repeat(500) });
		expect(entry?.definition).toHaveLength(400);
	});

	it("标签个数与长度都受限，且去重", () => {
		const entry = normalizeEntry({
			word: "a",
			tags: ["t1", "t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8", "t9"],
		});
		expect(entry?.tags).toHaveLength(8);
		expect(normalizeEntry({ word: "a", tags: ["x".repeat(20)] })?.tags).toBeUndefined();
	});

	it("缺词或词非法时整条丢弃", () => {
		expect(normalizeEntry({ definition: "no word" })).toBeNull();
		expect(normalizeEntry(123)).toBeNull();
		expect(normalizeEntry(null)).toBeNull();
	});
});

describe("parseEntries", () => {
	it("数组输入：去重保留首次写法，坏记录计数", () => {
		const result = parseEntries([
			"apple",
			{ word: "Apple" },
			{ word: "banana" },
			null,
			42,
			"",
			"apple",
		]);
		expect(result.entries).toEqual([{ word: "apple" }, { word: "banana" }]);
		expect(result.duplicated).toBe(2);
		expect(result.invalid).toBe(3);
	});

	it("容忍 { entries: {...} } 映射形式", () => {
		const result = parseEntries({
			entries: { apple: "a fruit", banana: { definition: "a fruit" } },
		});
		expect(result.entries).toEqual([
			{ word: "apple", definition: "a fruit" },
			{ word: "banana", definition: "a fruit" },
		]);
	});

	it("形状不认识时返回空数组而不是抛错", () => {
		expect(parseEntries(null).entries).toEqual([]);
		expect(parseEntries(42).entries).toEqual([]);
		expect(parseEntries({}).entries).toEqual([]);
	});

	it("超出上限时截断", () => {
		const many = Array.from({ length: MAX_BANK_ENTRIES + 10 }, (_, i) => `w${i}`);
		expect(parseEntries(many).entries).toHaveLength(MAX_BANK_ENTRIES);
	});
});

describe("mergeEntries / removeWords", () => {
	it("大小写不敏感去重，保留已有条目顺序，新词追加", () => {
		const result = mergeEntries(
			[{ word: "Apple" }],
			[{ word: "apple" }, { word: "banana" }],
		);
		expect(result.entries).toEqual([{ word: "Apple" }, { word: "banana" }]);
		expect(result.added).toBe(1);
		expect(result.duplicated).toBe(1);
	});

	it("达到上限后计入 overflow 而不是静默丢弃", () => {
		const result = mergeEntries([{ word: "a" }], [{ word: "b" }], 1);
		expect(result.added).toBe(0);
		expect(result.overflow).toBe(1);
	});

	it("removeWords 大小写不敏感并给出删除数", () => {
		const result = removeWords(
			[{ word: "Apple" }, { word: "banana" }],
			["apple", "not-there"],
		);
		expect(result.entries).toEqual([{ word: "banana" }]);
		expect(result.removed).toBe(1);
	});
});

describe("parseImportedText", () => {
	it("每行一条，支持 word / word,释义 / word<Tab>释义", () => {
		const result = parseImportedText(
			"apple\nbanana,a yellow fruit\npear\ta green fruit\n\n  \n",
		);
		expect(result.entries).toEqual([
			{ word: "apple" },
			{ word: "banana", definition: "a yellow fruit" },
			{ word: "pear", definition: "a green fruit" },
		]);
	});

	it("同一批内去重；非字符串输入返回空", () => {
		expect(parseImportedText("apple\nApple").duplicated).toBe(1);
		expect(parseImportedText(undefined).entries).toEqual([]);
	});

	it("逗号后为空时视为只有单词", () => {
		expect(parseImportedText("apple,").entries).toEqual([{ word: "apple" }]);
	});
});

describe("parseBankFile", () => {
	it("归一合法词库", () => {
		const bank = parseBankFile(
			{
				id: "cet4",
				name: "CET-4",
				source: "builtin",
				version: 2,
				entries: ["apple"],
				createdAt: 100,
				updatedAt: 200,
				note: "来自 ECDICT",
			},
			"fallback",
		);
		expect(bank).toEqual({
			id: "cet4",
			name: "CET-4",
			source: "builtin",
			version: 2,
			entries: [{ word: "apple" }],
			createdAt: 100,
			updatedAt: 200,
			note: "来自 ECDICT",
		});
	});

	it("缺 id 时用调用方给的 fallback；来源不认识时按 custom", () => {
		const bank = parseBankFile({ name: "我的词", words: ["a"] }, "custom-1");
		expect(bank?.id).toBe("custom-1");
		expect(bank?.source).toBe("custom");
		expect(bank?.name).toBe("我的词");
	});

	it("id 与 fallback 都不合法时返回 null", () => {
		expect(parseBankFile({ name: "x" }, "../evil")).toBeNull();
		expect(parseBankFile(null, "cet4")).toBeNull();
	});

	it("version / 时间戳异常时回落到安全值", () => {
		const bank = parseBankFile(
			{ id: "b1", version: -3, createdAt: Number.NaN, updatedAt: "x" },
			"b1",
		);
		expect(bank?.version).toBe(1);
		expect(bank?.createdAt).toBe(0);
		expect(bank?.updatedAt).toBe(0);
	});
});

describe("parseManifest", () => {
	it("归一合法清单并丢弃坏条目", () => {
		const banks = parseManifest({
			version: 1,
			banks: [
				{ id: "cet4", name: "CET-4", count: 3846, version: 1, url: "./cet4.json", bundled: true },
				{ id: "BAD ID", name: "x", url: "./x.json" },
				{ id: "nourl", name: "x" },
				null,
			],
		});
		expect(banks).toEqual([
			{
				id: "cet4",
				name: "CET-4",
				count: 3846,
				version: 1,
				url: "./cet4.json",
				bundled: true,
			},
		]);
	});

	it("也接受裸数组；形状不对返回 null", () => {
		expect(parseManifest([{ id: "a1", url: "u" }])).toHaveLength(1);
		expect(parseManifest(null)).toBeNull();
		expect(parseManifest({ nope: 1 })).toBeNull();
	});
});

describe("parseCsv", () => {
	it("支持引号包裹、字段内逗号与换行、转义引号", () => {
		const rows = parseCsv(
			'word,definition\nalpha,"a, b"\nbeta,"line1\nline2"\ngamma,"say ""hi"""\n',
		);
		expect(rows).toEqual([
			["word", "definition"],
			["alpha", "a, b"],
			["beta", "line1\nline2"],
			["gamma", 'say "hi"'],
		]);
	});

	it("CRLF 与行尾空字段都处理正确", () => {
		expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
			["a", "b"],
			["1", "2"],
		]);
		expect(parseCsv("a,")).toEqual([["a", ""]]);
	});

	it("csvRecords 首行为表头，列数不足补空串，全空行跳过", () => {
		const { header, records } = csvRecords(
			parseCsv("word,definition,frq\nalpha,a fruit\n\nbeta\n"),
		);
		expect(header).toEqual(["word", "definition", "frq"]);
		expect(records).toEqual([
			{ word: "alpha", definition: "a fruit", frq: "" },
			{ word: "beta", definition: "", frq: "" },
		]);
	});

	it("空输入返回空", () => {
		expect(parseCsv("")).toEqual([]);
		expect(csvRecords([])).toEqual({ header: [], records: [] });
	});
});

describe("ecdictRowToEntry", () => {
	it("取第一行释义，frq 缺失时回落到 bnc", () => {
		const entry = ecdictRowToEntry({
			word: "apple",
			phonetic: "'æpl",
			definition: "a round fruit\nsecond line",
			translation: "苹果\nn. 苹果",
			tag: "zk gk",
			frq: "0",
			bnc: "1234",
		});
		expect(entry).toEqual({
			word: "apple",
			definition: "a round fruit",
			translation: "苹果",
			phonetic: "'æpl",
			frq: 1234,
			tags: ["zk", "gk"],
		});
	});

	it("没有词时返回 null", () => {
		expect(ecdictRowToEntry({ definition: "x" })).toBeNull();
	});
});

describe("bank-types 判定", () => {
	it("id 规则", () => {
		expect(isValidBankId("cet4")).toBe(true);
		expect(isValidBankId("custom-abc123")).toBe(true);
		expect(isValidBankId("a")).toBe(false);
		expect(isValidBankId("../evil")).toBe(false);
		expect(isValidBankId("A1")).toBe(false);
		expect(isValidBankId("a".repeat(41))).toBe(false);
	});

	it("只有自建词表可编辑", () => {
		expect(isEditableSource("custom")).toBe(true);
		expect(isEditableSource("builtin")).toBe(false);
		expect(isEditableSource("remote")).toBe(false);
	});
});
