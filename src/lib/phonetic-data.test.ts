import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	normalizeStressPlacement,
	phoneticDisplay,
	phoneticToString,
} from "./phonetic-parse";
import { IPA_SYMBOLS, IPA_TOKEN_SET } from "./phonetic-symbols";

const dictPath = fileURLToPath(
	new URL("../../public/ipa/en-gb.v1.json", import.meta.url),
);
const dict = JSON.parse(readFileSync(dictPath, "utf8")) as {
	version: number;
	source: {
		name: string;
		version: string;
		license: string;
		url: string;
	};
	symbols: string[];
	words: Record<string, string[][]>;
};

describe("内置音标词典（public/ipa/en-gb.v1.json）", () => {
	it("schema/版本/许可/符号表正确", () => {
		expect(dict.version).toBe(1);
		expect(dict.source.name).toBe("Britfone");
		expect(dict.source.version).toBe("3.0.1");
		expect(dict.source.license).toBe("MIT");
		expect(dict.source.url).toContain("JoseLlarena/Britfone");
		expect(dict.symbols).toEqual([...IPA_SYMBOLS]);
		expect(dict.symbols).toHaveLength(47);
	});

	it("每个读音都是合法、已归位、可去重的 token 序列", () => {
		let variants = 0;
		for (const [word, list] of Object.entries(dict.words)) {
			expect(word).toMatch(/^[a-z][a-z'’-]*$/);
			expect(list.length).toBeGreaterThan(0);
			expect(list.length).toBeLessThanOrEqual(3);
			const seen = new Set<string>();
			for (const tokens of list) {
				variants += 1;
				expect(tokens.length).toBeGreaterThan(0);
				expect(tokens.every((token) => IPA_TOKEN_SET.has(token))).toBe(true);
				expect(normalizeStressPlacement(tokens)).toEqual(tokens);
				const key = phoneticToString(tokens);
				expect(seen.has(key)).toBe(false);
				seen.add(key);
			}
		}
		expect(variants).toBeGreaterThan(15000);
	}, 20_000);

	it("样本词的重音归位与展示正确", () => {
		const display = (word: string) =>
			dict.words[word].map((tokens) => phoneticDisplay(tokens));

		expect(display("apple")).toEqual(["/ˈæpəl/"]);
		expect(display("water")).toEqual(["/ˈwɔːtə/"]);
		expect(display("important")).toEqual(["/ɪmˈpɔːtənt/"]);
		expect(display("study")).toEqual(["/ˈstʌdi/"]);
		expect(display("computer")).toEqual(["/kəmˈpjuːtə/"]);
		expect(display("expensive")).toEqual(["/ɪkˈspensɪv/"]);
		expect(display("instruct")).toEqual(["/ɪnˈstrʌkt/"]);
		expect(display("photograph")).toEqual(["/ˈfəʊtəˌɡrɑːf/"]);
		expect(display("happy")).toEqual(["/ˈhæpi/"]);
		expect(display("the")).toContain("/ðə/");
		expect(display("the")).toContain("/ˈðiː/");
	});

	it("PET 单条词覆盖率 ≥ 90%", () => {
		const bankPath = fileURLToPath(
			new URL("../../public/banks/pet.json", import.meta.url),
		);
		const bank = JSON.parse(readFileSync(bankPath, "utf8")) as {
			entries: { word: string }[];
		};
		const single = bank.entries.filter((entry) =>
			/^[a-zA-Z][a-zA-Z'’-]*$/.test(entry.word.trim()),
		);
		const hit = single.filter((entry) =>
			Object.hasOwn(dict.words, entry.word.trim().toLowerCase()),
		).length;
		expect(single.length).toBeGreaterThan(3000);
		expect(hit / single.length).toBeGreaterThanOrEqual(0.9);
	});

	it("文件体积可控", () => {
		const size = readFileSync(dictPath).byteLength;
		expect(size).toBeLessThan(2 * 1024 * 1024);
	});
});
