import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { BankEntry } from "./bank-types";
import {
	BUILTIN_BANK_SPECS,
	buildBank,
	buildManifest,
	parseWordListFile,
	selectSpecEntries,
	specMatchesEntry,
} from "./bank-build";

function entry(word: string, frq?: number, tags?: string[]): BankEntry {
	const item: BankEntry = { word };
	if (frq !== undefined) item.frq = frq;
	if (tags) item.tags = tags;
	return item;
}

describe("specMatchesEntry", () => {
	it("tag 类词库按标签命中", () => {
		const spec = { id: "cet4", name: "CET-4", note: "", tags: ["cet4"] };
		expect(specMatchesEntry(spec, entry("apple", 100, ["cet4", "gk"]))).toBe(true);
		expect(specMatchesEntry(spec, entry("apple", 100, ["gk"]))).toBe(false);
		expect(specMatchesEntry(spec, entry("apple", 100))).toBe(false);
	});

	it("词频类词库要求有有效词频", () => {
		const spec = { id: "core", name: "core", note: "", topByFrq: 100 };
		expect(specMatchesEntry(spec, entry("apple", 50))).toBe(true);
		expect(specMatchesEntry(spec, entry("apple"))).toBe(false);
	});

	it("词表类词库只看是否在词表里（大小写与空白无关）", () => {
		const spec = {
			id: "pet",
			name: "PET",
			note: "",
			words: new Set(["apple", "swimming costume"]),
		};
		expect(specMatchesEntry(spec, entry("Apple", 100, ["cet4"]))).toBe(true);
		expect(specMatchesEntry(spec, entry("  swimming   costume "))).toBe(true);
		expect(specMatchesEntry(spec, entry("orange", 1, ["cet4"]))).toBe(false);
	});
});

describe("selectSpecEntries", () => {
	it("tag 类：按词频升序（高频在前），无词频的排在后面且保持原有顺序", () => {
		const entries = [
			entry("no-frq-1", undefined, ["cet4"]),
			entry("rare", 9000, ["cet4"]),
			entry("common", 100, ["cet4"]),
			entry("no-frq-2", undefined, ["cet4"]),
			entry("other", 1, ["gk"]),
		];
		const picked = selectSpecEntries(
			{ id: "cet4", name: "CET-4", note: "", tags: ["cet4"] },
			entries,
		);
		expect(picked.map((item) => item.word)).toEqual([
			"common",
			"rare",
			"no-frq-1",
			"no-frq-2",
		]);
	});

	it("词频类：取前 N 个高频词", () => {
		const entries = [entry("c", 300), entry("a", 100), entry("b", 200), entry("d", 400)];
		const picked = selectSpecEntries(
			{ id: "core", name: "core", note: "", topByFrq: 2 },
			entries,
		);
		expect(picked.map((item) => item.word)).toEqual(["a", "b"]);
	});

	it("没有命中时返回空数组（脚本会据此跳过并告警）", () => {
		expect(
			selectSpecEntries({ id: "x", name: "x", note: "", tags: ["nope"] }, [entry("a", 1)]),
		).toEqual([]);
	});
});

describe("buildBank / buildManifest", () => {
	it("词库形状与运行时 WordBank 同构", () => {
		const bank = buildBank(
			{ id: "cet4", name: "CET-4 核心词", note: "四级考纲", tags: ["cet4"] },
			[entry("apple", 10, ["cet4"])],
			1700,
		);
		expect(bank.id).toBe("cet4");
		expect(bank.source).toBe("builtin");
		expect(bank.entries).toHaveLength(1);
		expect(bank.createdAt).toBe(1700);
		expect(bank.note).toContain("四级考纲");
		expect(bank.note).toContain("ECDICT (MIT)");
	});

	it("清单保留顺序并标 bundled", () => {
		const banks = [
			buildBank({ id: "core3000", name: "高频核心 3000", note: "高频", topByFrq: 3000 }, [entry("a", 1)], 1),
			buildBank({ id: "cet4", name: "CET-4 核心词", note: "四级", tags: ["cet4"] }, [entry("b", 2)], 1),
		];
		const manifest = buildManifest(banks);
		expect(manifest.banks.map((item) => item.id)).toEqual(["core3000", "cet4"]);
		expect(manifest.banks[0].url).toBe("./core3000.json");
		expect(manifest.banks[0].bundled).toBe(true);
		expect(manifest.banks[0].license).toBe("ECDICT (MIT)");
		expect(manifest.banks[1].count).toBe(1);
	});

	it("来源不同的词库各自带自己的许可（PET 不被标成 ECDICT）", () => {
		const bank = buildBank(
			{
				id: "pet",
				name: "剑桥 PET 核心词",
				note: "剑桥 B1 Preliminary 官方词表",
				words: new Set(["apple"]),
				license: "Cambridge University Press & Assessment（个人学习用）",
				sourceUrl: "https://example.test/pet.pdf",
			},
			[entry("apple", 10)],
			1700,
		);
		expect(bank.license).toContain("Cambridge");
		expect(bank.note).toContain("Cambridge University Press & Assessment");
		expect(bank.note).toContain("https://example.test/pet.pdf");
		const manifest = buildManifest([bank]);
		expect(manifest.banks[0].license).toContain("Cambridge");
	});

	it("重建时内容没变就沿用旧时间戳（避免九个词库全刷成新 diff）", () => {
		const entries = [entry("apple", 10), entry("banana", 20)];
		const first = buildBank({ id: "cet4", name: "CET-4", note: "", tags: ["cet4"] }, entries, 1000);
		const rebuilt = buildBank(
			{ id: "cet4", name: "CET-4", note: "", tags: ["cet4"] },
			entries,
			2000,
			first,
		);
		expect(rebuilt.createdAt).toBe(1000);
		expect(rebuilt.updatedAt).toBe(1000);

		const changed = buildBank(
			{ id: "cet4", name: "CET-4", note: "", tags: ["cet4"] },
			[entry("apple", 10)],
			2000,
			first,
		);
		expect(changed.createdAt).toBe(1000);
		expect(changed.updatedAt).toBe(2000);
	});
});

describe("parseWordListFile", () => {
	it("每行一个词，忽略空行与 # 注释，大小写/空白折叠", () => {
		const words = parseWordListFile(
			"# 来源：某官方词表\n\na\nApple\n  swimming   costume \n\n# 尾注\n",
		);
		expect([...words].sort()).toEqual(["a", "apple", "swimming costume"]);
	});
});

describe("内置词库规格", () => {
	it("id 唯一且符合文件命名规则", () => {
		const ids = BUILTIN_BANK_SPECS.map((spec) => spec.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const id of ids) {
			expect(id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
		}
	});

	it("每个规格要么按 tag、要么按词频、要么按词表，不会三个都空", () => {
		for (const spec of BUILTIN_BANK_SPECS) {
			expect(
				Boolean(spec.tags?.length) ||
					Boolean(spec.topByFrq) ||
					Boolean(spec.wordsFiles?.length),
			).toBe(true);
		}
	});

	it("词表型词库的源文件存在且能解析出足够词条（PET 回归）", () => {
		const spec = BUILTIN_BANK_SPECS.find((item) => item.id === "pet");
		expect(spec).toBeDefined();
		const wordsFiles = spec?.wordsFiles ?? [];
		expect(wordsFiles.length).toBeGreaterThan(0);
		const words = new Set();
		for (const file of wordsFiles) {
			const path = resolve(process.cwd(), file);
			expect(existsSync(path)).toBe(true);
			for (const key of parseWordListFile(readFileSync(path, "utf8"))) words.add(key);
		}
		expect(words.size).toBeGreaterThan(1000);
		// 字母表、主题表、词套补全各自要有代表性条目
		expect(words.has("swimming pool")).toBe(true);
		expect(words.has("dinner")).toBe(true);
		expect(words.has("monday")).toBe(true);
		expect(words.has("brazilian")).toBe(true);
	});
});
