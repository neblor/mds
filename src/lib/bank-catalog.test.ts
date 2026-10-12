import { describe, expect, it } from "vitest";
import {
	MAX_MANIFEST_BANKS,
	mergeCatalog,
	parseBankManifest,
} from "./bank-catalog";
import type { ManifestEntry } from "./bank-types";

const BASE = "https://example.test/banks/manifest.json";

describe("parseBankManifest", () => {
	it("解析清单并把相对 url 解析成绝对地址", () => {
		const entries = parseBankManifest(
			{
				version: 2,
				banks: [
					{
						id: "cet4",
						name: "CET-4 核心词",
						count: 3846,
						version: 3,
						url: "cet4.json",
						license: "MIT",
						description: "  四级词汇  ",
					},
					{ id: "gre", name: "GRE", url: "https://cdn.test/gre.json" },
				],
			},
			BASE,
		);
		expect(entries).toEqual([
			{
				id: "cet4",
				name: "CET-4 核心词",
				count: 3846,
				version: 3,
				url: "https://example.test/banks/cet4.json",
				license: "MIT",
				description: "四级词汇",
			},
			{
				id: "gre",
				name: "GRE",
				count: 0,
				version: 1,
				url: "https://cdn.test/gre.json",
			},
		]);
	});

	it("兼容裸数组，丢弃坏条目而不丢整份清单", () => {
		const entries = parseBankManifest(
			[
				{ id: "ok", name: "OK", url: "ok.json" },
				{ id: "BAD ID", name: "bad", url: "bad.json" },
				{ id: "ok", name: "重复 id", url: "dup.json" },
				{ id: "no-url", name: "缺 url" },
				{ id: "bad-scheme", name: "非法协议", url: "ftp://x/y.json" },
				{ id: "no-name", url: "x.json" },
				null,
			],
			BASE,
		);
		expect(entries.map((entry) => entry.id)).toEqual(["ok"]);
		expect(entries[0].url).toBe("https://example.test/banks/ok.json");
	});

	it("非对象/结构不对返回空清单", () => {
		expect(parseBankManifest(null, BASE)).toEqual([]);
		expect(parseBankManifest({ banks: "nope" }, BASE)).toEqual([]);
		expect(parseBankManifest(42, BASE)).toEqual([]);
	});

	it("截断超长字段并限制条目数", () => {
		const many = Array.from({ length: MAX_MANIFEST_BANKS + 20 }, (_, i) => ({
			id: `bank${i}`,
			name: "n".repeat(200),
			url: `bank${i}.json`,
		}));
		const entries = parseBankManifest({ banks: many }, BASE);
		expect(entries).toHaveLength(MAX_MANIFEST_BANKS);
		expect(entries[0].name).toHaveLength(80);
	});
});

describe("mergeCatalog", () => {
	const entry = (id: string, version: number): ManifestEntry => ({
		id,
		name: id,
		count: 10,
		version,
		url: `https://example.test/${id}.json`,
	});

	it("本地没有 → 下载；本地版本低 → 更新；否则已是最新", () => {
		const rows = mergeCatalog({
			builtin: [entry("a", 1), entry("b", 2), entry("c", 3)],
			remote: [],
			local: [
				{ id: "b", version: 1 },
				{ id: "c", version: 3 },
			],
		});
		expect(rows.map((row) => [row.entry.id, row.state])).toEqual([
			["a", "download"],
			["b", "update"],
			["c", "latest"],
		]);
		expect(rows[1].localVersion).toBe(1);
		expect(rows[2].localVersion).toBe(3);
	});

	it("远端优先于内置，同 id 只留一条", () => {
		const rows = mergeCatalog({
			builtin: [entry("a", 1)],
			remote: [entry("a", 5), entry("z", 1)],
			local: [],
		});
		expect(rows.map((row) => [row.entry.id, row.source, row.entry.version])).toEqual([
			["a", "remote", 5],
			["z", "remote", 1],
		]);
	});

	it("标签为 builtin 的条目带上来源，便于界面区分", () => {
		const rows = mergeCatalog({
			builtin: [entry("a", 1)],
			remote: [entry("b", 1)],
			local: [],
		});
		expect(rows.map((row) => row.source)).toEqual(["remote", "builtin"]);
	});
});
