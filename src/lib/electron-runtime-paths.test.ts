import { describe, expect, it, vi } from "vitest";
import {
	clientDataDirCandidates,
	ensureWritableDataDir,
} from "../../electron/runtime-paths.mjs";

describe("Electron runtime paths", () => {
	it("安装版运行时数据统一使用 userData/mds-data", () => {
		expect(
			clientDataDirCandidates({
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
		expect(ensureWritableDataDir(["/ro", "/fallback"], fs)).toBe(
			"/fallback",
		);
	});

	it("所有候选都不可写时抛错并携带原因", () => {
		const fs = {
			mkdirSync: vi.fn(),
			writeFileSync: vi.fn(() => {
				throw new Error("denied");
			}),
			unlinkSync: vi.fn(),
		};
		expect(() => ensureWritableDataDir(["/a", "/b"], fs)).toThrow(
			"没有可写的应用数据目录",
		);
	});
});
