import { describe, expect, it } from "vitest";
import {
	bumpVersion,
	createPackagePlan,
	parseBumpType,
} from "./client-package-version";

describe("client package version", () => {
	it("major/minor 清零低级版本，patch 只递增末位", () => {
		expect(bumpVersion("0.1.45", "major")).toBe("1.0.0");
		expect(bumpVersion("0.1.45", "minor")).toBe("0.2.0");
		expect(bumpVersion("0.1.45", "patch")).toBe("0.1.46");
	});

	it("test 不修改版本并使用独立输出目录", () => {
		expect(createPackagePlan("0.1.45", "test")).toEqual({
			bumpType: "test",
			currentVersion: "0.1.45",
			targetVersion: "0.1.45",
			artifactName: "mds-0.1.45-setup.exe",
			changesVersion: false,
			outputDir: "dist/electron-test",
		});
	});

	it("正式 bump 输出到正式目录", () => {
		expect(createPackagePlan("2.3.4", "patch")).toMatchObject({
			targetVersion: "2.3.5",
			artifactName: "mds-2.3.5-setup.exe",
			changesVersion: true,
			outputDir: "dist/electron",
		});
	});

	it("bump_type 必填且拒绝非法值或多余参数", () => {
		expect(() => parseBumpType([])).toThrow("bump_type 必填");
		expect(() => parseBumpType(["beta"])).toThrow("bump_type 必填");
		expect(() => parseBumpType(["patch", "extra"])).toThrow(
			"bump_type 必填",
		);
		expect(parseBumpType(["test"])).toBe("test");
	});

	it("拒绝非 x.y.z 版本", () => {
		expect(() => bumpVersion("1.2", "patch")).toThrow("x.y.z");
		expect(() => bumpVersion("1.2.3-beta", "patch")).toThrow("x.y.z");
	});
});
