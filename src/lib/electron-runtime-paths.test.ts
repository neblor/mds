import { describe, expect, it, vi } from "vitest";
import {
	clientDataDirCandidates,
	ensureWritableDataDir,
} from "../../electron/runtime-paths.mjs";

describe("Electron runtime paths", () => {
	it("portable 模式优先 exe 同目录，userData 作为回退", () => {
		expect(
			clientDataDirCandidates({
				portableExecutableDir: "/portable",
				userDataDir: "/user-data",
			}),
		).toEqual(["/portable/mds-data", "/user-data/mds-data"]);
	});

	it("非 portable 模式只使用 userData", () => {
		expect(
			clientDataDirCandidates({
				portableExecutableDir: "",
				userDataDir: "/tmp/mds-user-data",
			}),
		).toEqual(["/tmp/mds-user-data/mds-data"]);
	});

	it("首选目录不可写时使用下一候选", () => {
		const fs = {
			mkdirSync: vi.fn(),
			writeFileSync: vi
				.fn()
				.mockImplementationOnce(() => {
					throw new Error("read only");
				})
				.mockImplementationOnce(() => undefined),
			unlinkSync: vi.fn(),
		};
		expect(ensureWritableDataDir(["/portable", "/fallback"], fs)).toBe(
			"/fallback",
		);
	});
});
