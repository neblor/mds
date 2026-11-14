import { describe, expect, it } from "vitest";
import {
	bumpVersion,
	compareVersions,
	createPackagePlan,
	normalizeVersion,
	parsePackageTarget,
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

	it("显式版本不升版，按给定版本打包且落在正式目录", () => {
		expect(createPackagePlan("1.0.0", "1.0.0")).toEqual({
			bumpType: "explicit",
			currentVersion: "1.0.0",
			targetVersion: "1.0.0",
			artifactName: "mds-1.0.0-setup.exe",
			changesVersion: false,
			outputDir: "dist/electron",
		});
		expect(createPackagePlan("1.0.0", "1.2.3")).toMatchObject({
			targetVersion: "1.2.3",
			changesVersion: true,
			outputDir: "dist/electron",
		});
	});

	it("显式版本小于当前版本时拒绝", () => {
		expect(() => createPackagePlan("1.0.0", "0.12.0")).toThrow(
			"不能小于当前版本",
		);
	});

	it("目标必填且拒绝非法值与多余参数", () => {
		expect(() => parsePackageTarget([])).toThrow("目标必填");
		expect(() => parsePackageTarget(["beta"])).toThrow("目标必填");
		expect(() => parsePackageTarget(["patch", "extra"])).toThrow("目标必填");
		expect(parsePackageTarget(["test"])).toBe("test");
		expect(parsePackageTarget(["patch"])).toBe("patch");
	});

	it("显式目标接受 v 前缀并归一", () => {
		expect(parsePackageTarget(["v1.2.3"])).toBe("1.2.3");
		expect(parsePackageTarget(["1.2.3"])).toBe("1.2.3");
		expect(() => parsePackageTarget(["1.2"])).toThrow("x.y.z");
		expect(() => parsePackageTarget(["v1.2.3-beta"])).toThrow("x.y.z");
	});

	it("版本比较按位进行，且不接受超出安全整数精度的分段", () => {
		expect(compareVersions("1.0.0", "1.0.1")).toBeLessThan(0);
		expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
		expect(compareVersions("2.0.0", "2.0.0")).toBe(0);
		expect(() =>
			compareVersions("9007199254740993.0.0", "9007199254740992.0.0"),
		).toThrow("安全整数");
		expect(() => bumpVersion("1.0.9007199254740991", "patch")).toThrow(
			"安全整数",
		);
	});

	it("拒绝非 x.y.z 版本", () => {
		expect(() => bumpVersion("1.2", "patch")).toThrow("x.y.z");
		expect(() => bumpVersion("1.2.3-beta", "patch")).toThrow("x.y.z");
		expect(() => normalizeVersion("")).toThrow("x.y.z");
	});
});
