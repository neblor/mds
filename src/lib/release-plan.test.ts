import { describe, expect, it } from "vitest";
import {
	type ReleaseArgs,
	type RepositoryState,
	createPublishPlan,
	createReleasePlan,
	isVersionOnlyPackageDiff,
	parsePublishArgs,
	parseReleaseArgs,
	releaseArchiveDir,
	releaseArtifactName,
	releaseNotesPath,
	releaseTag,
	unexpectedReleaseCommitPaths,
} from "./release-plan";

const args = (overrides: Partial<ReleaseArgs> = {}): ReleaseArgs => ({
	target: "patch",
	dryRun: false,
	noPublish: false,
	skipBuild: false,
	useDraftNotes: false,
	...overrides,
});

const state = (overrides: Partial<RepositoryState> = {}): RepositoryState => ({
	branch: "master",
	originUrl: "git@github.com:neblor/mds.git",
	dirtyPaths: [],
	stagedPaths: [],
	packageJsonVersionOnlyDirty: false,
	headCommit: "a".repeat(40),
	headParentCommit: "b".repeat(40),
	tagCommit: null,
	remoteTagExists: false,
	...overrides,
});

const plan = (
	overrides: Partial<{
		currentVersion: string;
		targetVersion: string;
		args: ReleaseArgs;
		repository: RepositoryState;
		archiveValid: boolean;
		notesSourceAvailable: boolean;
	}> = {},
) =>
	createReleasePlan({
		currentVersion: "1.0.0",
		targetVersion: "1.0.1",
		args: args(),
		repository: state(),
		archiveValid: false,
		notesSourceAvailable: true,
		...overrides,
	});

describe("release args", () => {
	it("接受自增类型与显式版本（含 v 前缀）", () => {
		expect(parseReleaseArgs(["patch"]).target).toBe("patch");
		expect(parseReleaseArgs(["1.2.3"]).target).toBe("1.2.3");
		expect(parseReleaseArgs(["v1.2.3"]).target).toBe("1.2.3");
	});

	it("解析开关与 --notes 两种写法", () => {
		const parsed = parseReleaseArgs([
			"minor",
			"--dry-run",
			"--no-publish",
			"--skip-build",
			"--use-draft-notes",
			"--notes",
			"notes.md",
		]);
		expect(parsed).toEqual({
			target: "minor",
			dryRun: true,
			noPublish: true,
			skipBuild: true,
			useDraftNotes: true,
			notesFile: "notes.md",
		});
		expect(parseReleaseArgs(["1.2.3", "--notes=notes.md"]).notesFile).toBe(
			"notes.md",
		);
	});

	it("拒绝 test 通道、未知参数、重复参数与多余位置参数", () => {
		expect(() => parseReleaseArgs([])).toThrow("用法");
		expect(() => parseReleaseArgs(["test"])).toThrow("test 通道");
		expect(() => parseReleaseArgs(["patch", "minor"])).toThrow("用法");
		expect(() => parseReleaseArgs(["patch", "--nope"])).toThrow("未知参数");
		expect(() => parseReleaseArgs(["patch", "--dry-run", "--dry-run"])).toThrow(
			"重复参数",
		);
		expect(() => parseReleaseArgs(["patch", "--notes"])).toThrow("缺少文件路径");
		expect(() => parseReleaseArgs(["patch", "--notes", "a", "--notes=b"])).toThrow(
			"重复的 --notes",
		);
	});
});

describe("publish args", () => {
	it("解析版本与执行/预览开关", () => {
		expect(parsePublishArgs(["v1.2.3", "--execute", "--use-draft-notes"])).toEqual({
			version: "1.2.3",
			execute: true,
			dryRun: false,
			allowDraftNotes: true,
		});
		expect(parsePublishArgs(["1.2.3", "--dry-run"])).toMatchObject({
			execute: false,
			dryRun: true,
		});
	});

	it("预览与执行互斥，且拒绝重复/未知参数", () => {
		expect(() => parsePublishArgs(["1.2.3", "--dry-run", "--execute"])).toThrow(
			"冲突",
		);
		expect(() => parsePublishArgs(["1.2.3", "--execute", "--execute"])).toThrow(
			"重复参数",
		);
		expect(() => parsePublishArgs(["1.2.3", "--unknown"])).toThrow("未知参数");
		expect(() => parsePublishArgs([])).toThrow("用法");
	});
});

describe("release paths", () => {
	it("tag / 归档目录 / 产物名 / 说明路径都由版本推出", () => {
		expect(releaseTag("1.0.0")).toBe("v1.0.0");
		expect(releaseArchiveDir("1.0.0")).toBe("release-out/v1.0.0");
		expect(releaseArtifactName("1.0.0")).toBe("mds-1.0.0-setup.exe");
		expect(releaseNotesPath("1.0.0")).toBe("docs/release-notes/1.0.0.md");
	});
});

describe("release plan", () => {
	it("干净工作树、无 tag → 需要构建，无阻断", () => {
		const result = plan();
		expect(result.blockers).toEqual([]);
		expect(result.buildNeeded).toBe(true);
		expect(result.skipCommit).toBe(false);
		expect(result.notesNeedsReview).toBe(false);
	});

	it("分支 / 远端 / 暂存区不对时阻断", () => {
		expect(plan({ repository: state({ branch: "dev" }) }).blockers[0]).toContain(
			"发布只允许在 master",
		);
		expect(
			plan({ repository: state({ originUrl: "git@github.com:other/mds.git" }) })
				.blockers[0],
		).toContain("origin 必须是");
		expect(
			plan({ repository: state({ originUrl: null }) }).blockers[0],
		).toContain("origin 必须是");
		expect(
			plan({ repository: state({ stagedPaths: ["src/app.tsx"] }) }).blockers[0],
		).toContain("暂存区非空");
	});

	it("只容忍 package.json 的版本号差异与本次发布说明", () => {
		const allowed = plan({
			repository: state({
				dirtyPaths: ["package.json", "docs/release-notes/1.0.1.md"],
				packageJsonVersionOnlyDirty: true,
			}),
		});
		expect(allowed.blockers).toEqual([]);

		const unknown = plan({
			repository: state({
				dirtyPaths: ["package.json", "src/app.tsx"],
				packageJsonVersionOnlyDirty: true,
			}),
		});
		expect(unknown.blockers.join()).toContain("src/app.tsx");

		const packageJsonTouched = plan({
			repository: state({
				dirtyPaths: ["package.json"],
				packageJsonVersionOnlyDirty: false,
			}),
		});
		expect(packageJsonTouched.blockers.join()).toContain("版本号以外");
	});

	it("tag 已指向 HEAD → 跳过提交；指向父提交或其它提交 → 阻断", () => {
		const head = "a".repeat(40);
		const parent = "b".repeat(40);

		expect(
			plan({ repository: state({ headCommit: head, tagCommit: head }) })
				.skipCommit,
		).toBe(true);

		expect(
			plan({ repository: state({ headCommit: head, tagCommit: parent }) })
				.blockers.join(),
		).toContain("构建前的提交");

		expect(
			plan({ repository: state({ headCommit: head, tagCommit: "c".repeat(40) }) })
				.blockers.join(),
		).toContain("已指向其它提交");
	});

	it("远端已有同名 tag 而本地没有时阻断", () => {
		expect(
			plan({ repository: state({ remoteTagExists: true }) }).blockers.join(),
		).toContain("git fetch --tags");
	});

	it("已有归档或 --skip-build 时不构建，并各给一条提示", () => {
		const archived = plan({ archiveValid: true });
		expect(archived.buildNeeded).toBe(false);
		expect(archived.warnings.join()).toContain("跳过构建");

		const skipped = plan({ args: args({ skipBuild: true }) });
		expect(skipped.buildNeeded).toBe(false);
		expect(skipped.warnings.join()).toContain("核不到包内内容");
	});

	it("没有手写发布说明时标记需要人工过目", () => {
		expect(plan({ notesSourceAvailable: false }).notesNeedsReview).toBe(true);
	});

	it("目标版本等于当前版本时只打 tag，并提示", () => {
		const same = plan({ currentVersion: "1.0.0", targetVersion: "1.0.0" });
		expect(same.blockers).toEqual([]);
		expect(same.warnings.join()).toContain("只打 tag");
	});
});

describe("发布提交来源约束", () => {
	it("package.json 只接受一删一增的版本号差异", () => {
		expect(
			isVersionOnlyPackageDiff(
				[
					"@@ -1 +1 @@",
					'-  "version": "1.0.0",',
					'+  "version": "1.0.1",',
				].join("\n"),
			),
		).toBe(true);
		expect(isVersionOnlyPackageDiff('+  "version": "1.0.1",')).toBe(false);
		expect(
			isVersionOnlyPackageDiff(
				'-  "version": "1.0.0",\n+  "private": true,',
			),
		).toBe(false);
	});

	it("构建后的提交不能夹带业务文件", () => {
		expect(
			unexpectedReleaseCommitPaths(
				["package.json", "docs/release-notes/1.0.1.md"],
				"1.0.1",
			),
		).toEqual([]);
		expect(
			unexpectedReleaseCommitPaths(["package.json", "src/app.tsx"], "1.0.1"),
		).toEqual(["src/app.tsx"]);
	});
});

describe("publish plan", () => {
	it("复用同一套仓库闸门", () => {
		expect(
			createPublishPlan({ version: "1.0.0", repository: state() }),
		).toMatchObject({ tag: "v1.0.0", skipCommit: false, blockers: [] });
		expect(
			createPublishPlan({
				version: "1.0.0",
				repository: state({ originUrl: null }),
			}).blockers[0],
		).toContain("origin 必须是");
	});

	it("tag 已在 HEAD 时只补上传", () => {
		const head = "a".repeat(40);
		const result = createPublishPlan({
			version: "1.0.0",
			repository: state({ headCommit: head, tagCommit: head }),
		});
		expect(result.skipCommit).toBe(true);
		expect(result.warnings.join()).toContain("只补上传");
	});
});
