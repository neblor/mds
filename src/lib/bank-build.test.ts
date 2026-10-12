import { describe, expect, it } from "vitest";
import type { BankEntry } from "./bank-types";
import {
	BUILTIN_BANK_SPECS,
	buildBank,
	buildManifest,
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
});

describe("内置词库规格", () => {
	it("id 唯一且符合文件命名规则", () => {
		const ids = BUILTIN_BANK_SPECS.map((spec) => spec.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const id of ids) {
			expect(id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
		}
	});

	it("每个规格要么按 tag、要么按词频，不会两个都空", () => {
		for (const spec of BUILTIN_BANK_SPECS) {
			expect(Boolean(spec.tags?.length) || Boolean(spec.topByFrq)).toBe(true);
		}
	});
});
