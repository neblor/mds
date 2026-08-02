import {
	afterEach,
	describe,
	expect,
	it,
} from "vitest";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupPackageOutput } from "./client-package-cleanup";

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("client package output cleanup", () => {
	it("校验产物存在后删除所有临时目录、调试文件和旧 EXE", () => {
		const outputDir = mkdtempSync(join(tmpdir(), "mds-package-cleanup-"));
		temporaryDirectories.push(outputDir);
		const artifactName = "mds-1.2.3-x64.exe";
		writeFileSync(join(outputDir, artifactName), "portable");
		writeFileSync(join(outputDir, "mds-1.2.2-x64.exe"), "old");
		writeFileSync(join(outputDir, "builder-debug.yml"), "debug");
		mkdirSync(join(outputDir, "win-unpacked"));
		writeFileSync(join(outputDir, "win-unpacked", "mds.exe"), "unpacked");

		const result = cleanupPackageOutput(outputDir, artifactName);

		expect(readdirSync(outputDir)).toEqual([artifactName]);
		expect(result.removedEntries.sort()).toEqual([
			"builder-debug.yml",
			"mds-1.2.2-x64.exe",
			"win-unpacked",
		]);
	});

	it("最终 EXE 缺失或文件名越界时拒绝清理", () => {
		const outputDir = mkdtempSync(join(tmpdir(), "mds-package-cleanup-"));
		temporaryDirectories.push(outputDir);
		writeFileSync(join(outputDir, "keep.txt"), "keep");

		expect(() =>
			cleanupPackageOutput(outputDir, "mds-1.2.3-x64.exe"),
		).toThrow("未找到");
		expect(() => cleanupPackageOutput(outputDir, "../outside.exe")).toThrow(
			"非法",
		);
		expect(readdirSync(outputDir)).toEqual(["keep.txt"]);
	});
});
