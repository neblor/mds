import { describe, expect, it } from "vitest";
import { resolveCacheDir, resolveRuntimeMode } from "./word-cache";

describe("word cache runtime path", () => {
	it("web 模式默认使用独立运行时目录而不是 public", () => {
		expect(resolveRuntimeMode({})).toBe("web");
		expect(resolveCacheDir({}, "/srv/mds")).toBe(
			"/srv/mds/.mds-data/word-cache",
		);
	});

	it("显式 MDS_CACHE_DIR 在 web/client 模式都优先", () => {
		expect(
			resolveCacheDir(
				{ MDS_RUNTIME_MODE: "client", MDS_CACHE_DIR: "runtime/audio" },
				"/srv/mds",
			),
		).toBe("/srv/mds/runtime/audio");
	});

	it("client 未注入路径时拒绝回退到 web 目录", () => {
		expect(() =>
			resolveCacheDir({ MDS_RUNTIME_MODE: "client" }, "/srv/mds"),
		).toThrow("MDS_CACHE_DIR");
	});
});
