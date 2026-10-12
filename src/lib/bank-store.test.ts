import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBankStore } from "./bank-store";
import type { WordBank } from "./bank-types";

const dirs: string[] = [];

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "mds-bank-"));
	dirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeBank(id: string, words: string[], extra: Partial<WordBank> = {}): WordBank {
	return {
		id,
		name: `库 ${id}`,
		source: "custom",
		version: 1,
		entries: words.map((word) => ({ word })),
		createdAt: 100,
		updatedAt: 200,
		...extra,
	};
}

describe("bank-store", () => {
	it("写入后可按 id 读回，并出现在列表摘要里", () => {
		const store = createBankStore(tempDir());
		store.write(makeBank("cet4", ["apple", "banana"], { source: "builtin" }));
		store.write(makeBank("my-words", ["pear"]));

		expect(store.read("cet4")?.entries.map((e) => e.word)).toEqual(["apple", "banana"]);
		expect(store.list()).toEqual([
			{
				id: "cet4",
				name: "库 cet4",
				source: "builtin",
				count: 2,
				version: 1,
				updatedAt: 200,
			},
			{
				id: "my-words",
				name: "库 my-words",
				source: "custom",
				count: 1,
				version: 1,
				updatedAt: 200,
			},
		]);
	});

	it("覆盖写入时索引跟着更新（不残留旧计数）", () => {
		const store = createBankStore(tempDir());
		store.write(makeBank("b1", ["a"]));
		store.write(makeBank("b1", ["a", "b"]));
		expect(store.list()).toHaveLength(1);
		expect(store.list()[0].count).toBe(2);
	});

	it("索引缺失时按磁盘重建（自愈）", () => {
		const dir = tempDir();
		const store = createBankStore(dir);
		store.write(makeBank("b1", ["a"]));
		store.write(makeBank("b2", ["b"]));
		unlinkSync(join(dir, "index.json"));

		expect(store.list().map((item) => item.id)).toEqual(["b1", "b2"]);
	});

	it("索引与磁盘不一致时以磁盘为准（手工放入/删掉文件都能自愈）", () => {
		const dir = tempDir();
		const store = createBankStore(dir);
		store.write(makeBank("b1", ["a"]));
		// 绕过 store 直接塞一个文件（模拟从别处拷来的词库）
		writeFileSync(
			join(dir, "b2.json"),
			JSON.stringify(makeBank("b2", ["b", "c"], { source: "remote" })),
		);
		expect(store.list().map((item) => item.id)).toEqual(["b1", "b2"]);

		unlinkSync(join(dir, "b2.json"));
		expect(store.list().map((item) => item.id)).toEqual(["b1"]);
	});

	it("单个词库文件损坏只影响该库：read 返回 undefined，索引重建时被剔除", () => {
		const dir = tempDir();
		const store = createBankStore(dir);
		store.write(makeBank("good", ["a"]));
		store.write(makeBank("broken", ["b"]));
		writeFileSync(join(dir, "broken.json"), "{ not json");

		expect(store.read("broken")).toBeUndefined();
		expect(store.list().map((item) => item.id)).toEqual(["good"]);
	});

	it("remove 删除文件与索引条目", () => {
		const dir = tempDir();
		const store = createBankStore(dir);
		store.write(makeBank("b1", ["a"]));
		expect(store.remove("b1")).toBe(true);
		expect(store.remove("b1")).toBe(false);
		expect(store.read("b1")).toBeUndefined();
		expect(store.list()).toEqual([]);
		expect(readdirSync(dir).filter((f) => f.endsWith(".json"))).toEqual(["index.json"]);
	});

	it("非法 id 一律拒绝（防路径穿越 / 防写坏目录）", () => {
		const dir = tempDir();
		const store = createBankStore(dir);
		expect(store.read("../evil")).toBeUndefined();
		expect(store.read("A1")).toBeUndefined();
		expect(store.remove("../evil")).toBe(false);
		expect(() => store.write(makeBank("../evil", ["a"]))).toThrow();
	});
});
