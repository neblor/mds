import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { resolveBankDir, resolveDataDir, resolveReviewDir } from "./data-paths";

describe("resolveDataDir", () => {
	it("MDS_DATA_DIR 优先", () => {
		expect(
			resolveDataDir(
				{ MDS_DATA_DIR: "/data/app", MDS_CACHE_DIR: "/other/word-cache" },
				"/cwd",
			),
		).toBe("/data/app");
	});

	it("只给 MDS_CACHE_DIR 时取它的父目录（Electron 注入的就是 mds-data/word-cache）", () => {
		expect(resolveDataDir({ MDS_CACHE_DIR: "/data/app/word-cache" }, "/cwd")).toBe(
			"/data/app",
		);
	});

	it("都没有时回落到 <cwd>/.mds-data", () => {
		expect(resolveDataDir({}, "/cwd")).toBe(join("/cwd", ".mds-data"));
	});

	it("相对路径按 cwd 解析；空白值视为未配置", () => {
		expect(resolveDataDir({ MDS_DATA_DIR: "local-data" }, "/cwd")).toBe(
			join("/cwd", "local-data"),
		);
		expect(resolveDataDir({ MDS_DATA_DIR: "  " }, "/cwd")).toBe(
			join("/cwd", ".mds-data"),
		);
	});
});

describe("子目录", () => {
	it("词库与复习目录", () => {
		expect(resolveBankDir("/data")).toBe(join("/data", "banks"));
		expect(resolveReviewDir("/data")).toBe(join("/data", "review"));
	});
});
