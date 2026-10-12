import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	appendJsonl,
	readJsonFile,
	readJsonl,
	writeJsonFileAtomic,
} from "./json-file";

const dirs: string[] = [];

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "mds-json-"));
	dirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("readJsonFile", () => {
	it("文件缺失、空文件、坏 JSON 都返回 undefined 而不是抛错", () => {
		const dir = tempDir();
		expect(readJsonFile(join(dir, "nope.json"))).toBeUndefined();
		writeFileSync(join(dir, "empty.json"), "");
		expect(readJsonFile(join(dir, "empty.json"))).toBeUndefined();
		writeFileSync(join(dir, "bad.json"), "{ not json");
		expect(readJsonFile(join(dir, "bad.json"))).toBeUndefined();
	});

	it("正常读取并保留形状", () => {
		const dir = tempDir();
		const path = join(dir, "ok.json");
		writeJsonFileAtomic(path, { a: 1, b: ["x"], c: null });
		expect(readJsonFile(path)).toEqual({ a: 1, b: ["x"], c: null });
	});
});

describe("writeJsonFileAtomic", () => {
	it("自动创建目录，且覆盖已存在文件（Windows 下 rename 会失败的分支）", () => {
		const dir = tempDir();
		const path = join(dir, "nested", "deep", "file.json");
		writeJsonFileAtomic(path, { n: 1 });
		expect(readJsonFile(path)).toEqual({ n: 1 });
		writeJsonFileAtomic(path, { n: 2 });
		expect(readJsonFile(path)).toEqual({ n: 2 });
	});

	it("不留下临时文件", () => {
		const dir = tempDir();
		writeJsonFileAtomic(join(dir, "a.json"), { n: 1 });
		expect(readFileSync(join(dir, "a.json"), "utf8")).toBe('{"n":1}');
		expect(readdirSync(dir).filter((name) => name.startsWith(".tmp-"))).toEqual([]);
	});
});

describe("appendJsonl / readJsonl", () => {
	it("追加写入并按行读回；坏行跳过", () => {
		const dir = tempDir();
		const path = join(dir, "log.jsonl");
		appendJsonl(path, [{ a: 1 }, { a: 2 }]);
		appendJsonl(path, [{ a: 3 }]);
		expect(readJsonl(path)).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);

		writeFileSync(path, `${readFileSync(path, "utf8")}{ broken\n\n`);
		expect(readJsonl(path)).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
	});

	it("空数组不创建文件；文件缺失返回空数组", () => {
		const dir = tempDir();
		const path = join(dir, "none.jsonl");
		appendJsonl(path, []);
		expect(readJsonl(path)).toEqual([]);
	});
});
