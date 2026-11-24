/**
 * 发布（`pnpm release` / `pnpm release:publish`）的纯逻辑：参数解析、闸门判定、路径命名。
 *
 * 脚本只执行这里算出来的计划，不重复计算；判据全部可单测，脚本本身只做 I/O。
 * 本模块**不得 import `node:*`**（与 `review-service.ts` 同一约定，便于在任意环境复用）。
 */
import {
	type PackageTarget,
	normalizeVersion,
	parsePackageTarget,
} from "./client-package-version.ts";

export const RELEASE_BRANCH = "master";
export const RELEASE_REPO = "neblor/mds";
export const RELEASE_NOTES_DIR = "docs/release-notes";
export const RELEASE_ARCHIVE_ROOT = "release-out";
export const RELEASE_SUMS_FILE = "SHA256SUMS.txt";
export const RELEASE_MANIFEST_FILE = "release.json";
export const RELEASE_NOTES_FILE = "RELEASE-NOTES.md";

const ORIGIN_PATTERN =
	/^(?:git@github\.com:|https:\/\/github\.com\/)neblor\/mds(?:\.git)?$/i;

const RELEASE_USAGE =
	"用法：pnpm release <major|minor|patch|X.Y.Z> [--dry-run] [--no-publish] [--skip-build] [--notes <文件>]";

const RELEASE_FLAGS = ["--dry-run", "--no-publish", "--skip-build"] as const;

export interface ReleaseArgs {
	target: PackageTarget;
	dryRun: boolean;
	noPublish: boolean;
	skipBuild: boolean;
	notesFile?: string;
}

/** 解析 `pnpm release` 的位置参数与开关；`test` 通道一律拒绝（发布不能出测试包）。 */
export function parseReleaseArgs(argv: readonly string[]): ReleaseArgs {
	const positionals: string[] = [];
	const flags = new Set<string>();
	let notesFile: string | undefined;

	for (let index = 0; index < argv.length; index++) {
		const arg = String(argv[index]);
		if (arg === "--notes" || arg.startsWith("--notes=")) {
			const value = arg === "--notes" ? argv[++index] : arg.slice(8);
			if (!value || String(value).startsWith("--")) {
				throw new Error("--notes 缺少文件路径");
			}
			if (notesFile !== undefined) throw new Error("重复的 --notes");
			notesFile = String(value).trim();
			continue;
		}
		if (arg.startsWith("--")) {
			if (!(RELEASE_FLAGS as readonly string[]).includes(arg)) {
				throw new Error(`未知参数：${arg}`);
			}
			if (flags.has(arg)) throw new Error(`重复参数：${arg}`);
			flags.add(arg);
			continue;
		}
		positionals.push(arg);
	}

	let target: PackageTarget;
	try {
		target = parsePackageTarget(positionals);
	} catch {
		throw new Error(RELEASE_USAGE);
	}
	if (target === "test") {
		throw new Error(
			"发布不能使用 test 通道：本地测试打包请用 pnpm client:package test",
		);
	}

	return {
		target,
		dryRun: flags.has("--dry-run"),
		noPublish: flags.has("--no-publish"),
		skipBuild: flags.has("--skip-build"),
		notesFile,
	};
}

export interface PublishArgs {
	version: string;
	execute: boolean;
	dryRun: boolean;
}

const PUBLISH_USAGE =
	"用法：pnpm release:publish <vX.Y.Z|X.Y.Z> [--execute|--dry-run]";

/** 续跑入口参数；`--dry-run` 与 `--execute` 必须互斥，避免预览命令产生真实发布。 */
export function parsePublishArgs(argv: readonly string[]): PublishArgs {
	const flags = new Set<string>();
	let version: string | undefined;
	for (const arg of argv) {
		if (arg.startsWith("--")) {
			if (!["--execute", "--dry-run"].includes(arg)) {
				throw new Error(`未知参数：${arg}\n${PUBLISH_USAGE}`);
			}
			if (flags.has(arg)) throw new Error(`重复参数：${arg}`);
			flags.add(arg);
			continue;
		}
		if (version !== undefined) throw new Error(PUBLISH_USAGE);
		version = normalizeVersion(arg);
	}
	if (version === undefined) throw new Error(PUBLISH_USAGE);
	if (flags.has("--dry-run") && flags.has("--execute")) {
		throw new Error("--dry-run 与 --execute 冲突：预览不会执行发布");
	}
	return {
		version,
		execute: flags.has("--execute"),
		dryRun: flags.has("--dry-run"),
	};
}

export function releaseTag(version: string): string {
	return `v${normalizeVersion(version)}`;
}

export function releaseArchiveDir(version: string): string {
	return `${RELEASE_ARCHIVE_ROOT}/${releaseTag(version)}`;
}

export function releaseArtifactName(version: string): string {
	return `mds-${normalizeVersion(version)}-setup.exe`;
}

export function releaseNotesPath(version: string): string {
	return `${RELEASE_NOTES_DIR}/${normalizeVersion(version)}.md`;
}

/** 脚本从 git / 文件系统观察到的仓库状态；判定全部放在本文件里做。 */
export interface RepositoryState {
	branch: string;
	originUrl: string | null;
	/** `git status --porcelain` 的路径（相对仓库根） */
	dirtyPaths: string[];
	stagedPaths: string[];
	/** package.json 的差异只有 `"version"` 一行 */
	packageJsonVersionOnlyDirty: boolean;
	headCommit: string;
	headParentCommit: string | null;
	tagCommit: string | null;
	remoteTagExists: boolean;
}

interface GateInput {
	version: string;
	tag: string;
	allowedDirty: readonly string[];
}

interface GateResult {
	skipCommit: boolean;
	blockers: string[];
}

function gateRepository(
	state: RepositoryState,
	{ version, tag, allowedDirty }: GateInput,
): GateResult {
	const blockers: string[] = [];

	if (state.branch !== RELEASE_BRANCH) {
		blockers.push(
			`当前分支是 ${state.branch || "（分离 HEAD）"}，发布只允许在 ${RELEASE_BRANCH} 上进行（不自动切换或合并）`,
		);
	}
	if (!state.originUrl || !ORIGIN_PATTERN.test(state.originUrl.trim())) {
		blockers.push(
			`origin 必须是 github.com/${RELEASE_REPO}，当前是 ${state.originUrl ?? "（未配置）"}`,
		);
	}
	if (state.stagedPaths.length > 0) {
		blockers.push(
			`暂存区非空，发布只提交自己的版本文件：${state.stagedPaths.join(", ")}`,
		);
	}
	if (
		state.dirtyPaths.includes("package.json") &&
		!state.packageJsonVersionOnlyDirty
	) {
		blockers.push("package.json 含版本号以外的改动，先收口再发版");
	}
	const allowed = new Set(allowedDirty);
	if (state.packageJsonVersionOnlyDirty) allowed.add("package.json");
	const unexpected = state.dirtyPaths.filter((path) => !allowed.has(path));
	if (unexpected.length > 0) {
		blockers.push(`工作树有未收口的改动：${unexpected.join(", ")}`);
	}

	let skipCommit = false;
	if (state.tagCommit) {
		if (state.tagCommit === state.headCommit) {
			// 已经是「提交 + tag」都完成的状态：重跑只补上传
			skipCommit = true;
		} else if (state.tagCommit === state.headParentCommit) {
			blockers.push(
				`tag ${tag} 指向构建前的提交，拒绝续跑（先核对现场，不要手工移动 tag）`,
			);
		} else {
			blockers.push(
				`tag ${tag} 已指向其它提交（${state.tagCommit.slice(0, 12)}），不覆盖`,
			);
		}
	} else if (state.remoteTagExists) {
		blockers.push(`远端已有 tag ${tag} 但本地没有：先 git fetch --tags 核对`);
	}
	if (!version) blockers.push("缺少目标版本");

	return { skipCommit, blockers };
}

export interface ReleasePlan {
	currentVersion: string;
	targetVersion: string;
	tag: string;
	archiveDir: string;
	artifactName: string;
	notesPath: string;
	/** 归档里的发布说明来源（handwritten / custom / 自动草稿）；草稿也直接发布，不再等人工改写 */
	buildNeeded: boolean;
	skipCommit: boolean;
	warnings: string[];
	blockers: string[];
}

export interface ReleasePlanInput {
	currentVersion: string;
	targetVersion: string;
	args: ReleaseArgs;
	repository: RepositoryState;
	/** `release-out/v<版本>/` 已有可用归档（校验通过） */
	archiveValid: boolean;
}

export function createReleasePlan(input: ReleasePlanInput): ReleasePlan {
	const { currentVersion, targetVersion, args, repository } = input;
	const tag = releaseTag(targetVersion);
	const notesPath = releaseNotesPath(targetVersion);
	const gate = gateRepository(repository, {
		version: targetVersion,
		tag,
		allowedDirty: [notesPath],
	});

	const warnings: string[] = [];
	if (targetVersion === currentVersion) {
		warnings.push(
			`目标版本与当前版本一致（${targetVersion}）：不产生版本号改动，只打 tag（首个版本或补发时正常）`,
		);
	}
	if (args.skipBuild && !input.archiveValid) {
		warnings.push(
			"--skip-build：直接使用 dist/electron 里已有的安装包，只核对文件头与大小，核不到包内内容",
		);
	}
	if (input.archiveValid) {
		warnings.push("已存在可用归档：跳过构建，直接从归档续跑");
	}

	return {
		currentVersion,
		targetVersion,
		tag,
		archiveDir: releaseArchiveDir(targetVersion),
		artifactName: releaseArtifactName(targetVersion),
		notesPath,
		buildNeeded: !(input.archiveValid || args.skipBuild),
		skipCommit: gate.skipCommit,
		warnings,
		blockers: gate.blockers,
	};
}

export interface PublishPlan {
	version: string;
	tag: string;
	skipCommit: boolean;
	warnings: string[];
	blockers: string[];
}

/** package.json 的 diff 是否恰好只有一处顶层版本号替换。 */
export function isVersionOnlyPackageDiff(diff: string): boolean {
	const changed = String(diff)
		.split("\n")
		.filter((line) => /^[+-]/.test(line) && !/^(?:\+\+\+|---)/.test(line));
	return (
		changed.length === 2 &&
		changed.some((line) => /^-  "version"\s*:/.test(line)) &&
		changed.some((line) => /^\+  "version"\s*:/.test(line))
	);
}

/** 构建后的唯一一个提交只能是版本文件与本次发布说明，不能把并行开发提交带进 tag。 */
export function unexpectedReleaseCommitPaths(
	paths: readonly string[],
	version: string,
): string[] {
	const allowed = new Set(["package.json", releaseNotesPath(version)]);
	return paths.filter((path) => !allowed.has(path));
}

/** `pnpm release:publish` 的判定：只复核仓库状态，不动构建。 */
export function createPublishPlan(input: {
	version: string;
	repository: RepositoryState;
}): PublishPlan {
	const tag = releaseTag(input.version);
	const gate = gateRepository(input.repository, {
		version: input.version,
		tag,
		allowedDirty: [releaseNotesPath(input.version)],
	});
	return {
		version: input.version,
		tag,
		skipCommit: gate.skipCommit,
		warnings: gate.skipCommit ? ["tag 已指向 HEAD：跳过提交与打 tag，只补上传"] : [],
		blockers: gate.blockers,
	};
}
