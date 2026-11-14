#!/usr/bin/env node
/**
 * 一键发版：`pnpm release <major|minor|patch|X.Y.Z>`（替代手工 `client:package` + 手推 git）
 *
 * 阶段（判定全部在 src/lib/release-plan.ts，本文件只做 I/O）：
 *   P0 预检  分支 / origin / 工作树 / tag / gh 登录
 *   P1 构建  pnpm client:package <目标版本>（check → electron-builder → verify → cleanup）
 *   P2 归档  release-out/v<版本>/：安装包 + SHA256SUMS.txt + RELEASE-NOTES.md + release.json
 *   P3 提交  git commit "chore: release v<版本>" + annotated tag
 *   P4 推送  git push --atomic origin HEAD:refs/heads/master refs/tags/v<版本>
 *   P5 发布  gh release 草稿 → 上传 → 逐个核对 → 公开
 *
 * 失败语义：P1/P2 失败时 client:package 自己恢复 package.json，不留痕；
 * **P3 之后一律不回滚**（回滚会让工作树落后于 HEAD，重跑升版校验必然失败），
 * 按提示重跑 `pnpm release:publish v<版本> --execute` 即可补齐未完成的部分。
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	closeSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	readdirSync,
	readSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPackagePlan } from "../src/lib/client-package-version.ts";
import {
	RELEASE_MANIFEST_SCHEMA,
	parseGitLog,
	releaseNotesDraft,
	sha256SumsText,
	validateChecksumsText,
	validateManifest,
} from "../src/lib/release-artifacts.ts";
import {
	RELEASE_BRANCH,
	RELEASE_MANIFEST_FILE,
	RELEASE_NOTES_FILE,
	RELEASE_REPO,
	RELEASE_SUMS_FILE,
	createPublishPlan,
	createReleasePlan,
	isVersionOnlyPackageDiff,
	parseReleaseArgs,
	unexpectedReleaseCommitPaths,
	releaseArchiveDir,
	releaseNotesPath,
	releaseTag,
} from "../src/lib/release-plan.ts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

/* ────────────────────────────── 外部命令 ────────────────────────────── */

function gitText(root, args) {
	return String(
		execFileSync("git", args, {
			cwd: root,
			encoding: "utf8",
			maxBuffer: 64 * 1024 * 1024,
		}),
	).trim();
}

function gitRun(root, args) {
	execFileSync("git", args, { cwd: root, stdio: "inherit" });
}

function ghText(root, args) {
	return String(
		execFileSync("gh", args, {
			cwd: root,
			encoding: "utf8",
			maxBuffer: 64 * 1024 * 1024,
		}),
	).trim();
}

function ghRun(root, args) {
	execFileSync("gh", args, { cwd: root, stdio: "inherit" });
}

function ghBinary(root, args, maxBuffer) {
	return execFileSync("gh", args, {
		cwd: root,
		encoding: null,
		maxBuffer,
	});
}

function ghJson(root, args) {
	const raw = ghText(root, args);
	try {
		return JSON.parse(raw);
	} catch (error) {
		throw new Error(`gh 未返回合法 JSON（${args.join(" ")}）`, { cause: error });
	}
}

function runPnpm(root, args) {
	const result = spawnSync(pnpmCommand, args, {
		cwd: root,
		stdio: "inherit",
		env: process.env,
	});
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(`pnpm ${args.join(" ")} 失败（退出码 ${result.status}）`);
	}
}

function sleep(ms) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/* ────────────────────────────── 本地状态 ────────────────────────────── */

function readPackageJson(root) {
	const text = readFileSync(join(root, "package.json"), "utf8");
	try {
		return JSON.parse(text);
	} catch (error) {
		throw new Error("package.json 不是有效 JSON", { cause: error });
	}
}

function readCommittedPackageJson(root) {
	const text = gitText(root, ["show", "HEAD:package.json"]);
	try {
		return JSON.parse(text);
	} catch (error) {
		throw new Error("HEAD 的 package.json 不是有效 JSON", { cause: error });
	}
}

function sha256File(path) {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function formatBytes(bytes) {
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** `git status --porcelain=v1 -z` 的路径；展开未跟踪目录，重命名会带出两个路径。 */
function statusPaths(root) {
	const raw = String(
		execFileSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
			cwd: root,
			encoding: "utf8",
		}),
	);
	const parts = raw.split("\0").filter(Boolean);
	const paths = [];
	for (let index = 0; index < parts.length; index += 1) {
		const entry = parts[index];
		const status = entry.slice(0, 2);
		paths.push(entry.slice(3));
		if (status.includes("R") || status.includes("C")) {
			index += 1;
			if (parts[index]) paths.push(parts[index]);
		}
	}
	return paths;
}

function stagedPaths(root) {
	return gitText(root, ["diff", "--cached", "--name-only"])
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
}

function gitDiffText(root, args) {
	return String(
		execFileSync("git", ["diff", "--unified=0", ...args], {
			cwd: root,
			encoding: "utf8",
		}),
	);
}

/** package.json 的差异是否只有 `"version"` 一行（发布时唯一允许的未提交改动）。 */
function packageJsonVersionOnlyDirty(root) {
	return isVersionOnlyPackageDiff(gitDiffText(root, ["--", "package.json"]));
}

function observeRepository(root, tag) {
	let branch = "";
	try {
		branch = gitText(root, ["symbolic-ref", "--short", "HEAD"]);
	} catch {
		branch = "";
	}
	let originUrl = null;
	try {
		originUrl = gitText(root, ["remote", "get-url", "origin"]);
	} catch {
		originUrl = null;
	}
	const headCommit = gitText(root, ["rev-parse", "HEAD"]);
	let headParentCommit = null;
	try {
		headParentCommit = gitText(root, ["rev-parse", "HEAD^"]);
	} catch {
		headParentCommit = null;
	}
	const localTags = gitText(root, ["tag", "--list", tag]);
	const tagCommit = localTags ? gitText(root, ["rev-parse", `${tag}^{commit}`]) : null;
	let remoteTagExists = false;
	try {
		remoteTagExists =
			gitText(root, ["ls-remote", "--tags", "origin", `refs/tags/${tag}`]).length > 0;
	} catch (error) {
		throw new Error(`读取远端 tag 失败（检查网络与 origin 权限）：${tag}`, {
			cause: error,
		});
	}
	return {
		branch,
		originUrl,
		dirtyPaths: statusPaths(root),
		stagedPaths: stagedPaths(root),
		packageJsonVersionOnlyDirty: packageJsonVersionOnlyDirty(root),
		headCommit,
		headParentCommit,
		tagCommit,
		remoteTagExists,
	};
}

function assertGitHubCli(root) {
	try {
		ghText(root, ["auth", "status"]);
	} catch (error) {
		throw new Error(
			"gh 未登录：先 export GITHUB_TOKEN（见 ~/.config/fish/conf.d/zz-github-token.fish）或 gh auth login",
			{ cause: error },
		);
	}
}

/* ────────────────────────────── 归档 ────────────────────────────── */

function assertWindowsInstaller(path) {
	const bytes = statSync(path).size;
	if (bytes < 1024 * 1024) throw new Error(`安装包体积异常小：${path}`);
	const header = Buffer.alloc(2);
	const descriptor = openSync(path, "r");
	try {
		readSync(descriptor, header, 0, header.length, 0);
	} finally {
		closeSync(descriptor);
	}
	if (header[0] !== 0x4d || header[1] !== 0x5a) {
		throw new Error(`安装包不是有效的 Windows MZ 可执行文件：${path}`);
	}
}

function previousReleaseTag(root) {
	try {
		const tag = gitText(root, ["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*"]);
		return tag || null;
	} catch {
		return null;
	}
}

/** 读取并校验归档；目录不存在返回 null，存在但内容不自洽直接抛（不静默重建）。 */
function readArchiveAt(dir, version, label) {
	const manifestPath = join(dir, RELEASE_MANIFEST_FILE);
	if (!existsSync(manifestPath)) {
		throw new Error(
			`归档目录已存在但没有 ${RELEASE_MANIFEST_FILE}：${label}（先人工核对，不覆盖）`,
		);
	}
	let manifest;
	try {
		manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	} catch (error) {
		throw new Error(`归档清单不是有效 JSON：${label}`, { cause: error });
	}
	const name = String(manifest?.artifact?.name ?? "");
	if (basename(name) !== name || !name) {
		throw new Error(`归档清单里的产物名非法：${name}`);
	}
	const artifactPath = join(dir, name);
	if (!existsSync(artifactPath)) {
		throw new Error(`归档缺少安装包：${label}/${name}`);
	}
	const notesPath = join(dir, RELEASE_NOTES_FILE);
	const sumsPath = join(dir, RELEASE_SUMS_FILE);
	if (!existsSync(notesPath)) throw new Error(`归档缺少 ${RELEASE_NOTES_FILE}`);
	if (!existsSync(sumsPath)) throw new Error(`归档缺少 ${RELEASE_SUMS_FILE}`);
	const bytes = statSync(artifactPath).size;
	const sha256 = sha256File(artifactPath);
	validateManifest(manifest, { version, bytes, sha256 });
	validateChecksumsText(readFileSync(sumsPath, "utf8"), [{ sha256, name }]);
	if (!readFileSync(notesPath, "utf8").trim()) {
		throw new Error(`归档发布说明不能为空：${label}/${RELEASE_NOTES_FILE}`);
	}
	return {
		dir,
		relativeDir: label,
		manifest,
		artifactPath,
		notesPath,
		sumsPath,
		bytes,
		sha256,
	};
}

function readArchive(root, version) {
	const dir = join(root, releaseArchiveDir(version));
	if (!existsSync(dir)) return null;
	return readArchiveAt(dir, version, releaseArchiveDir(version));
}

/** 写文件用临时文件 + rename，避免写到一半被中断时留下半截清单/说明。 */
function writeFileAtomic(path, text) {
	const temporary = `${path}.tmp-${process.pid}`;
	writeFileSync(temporary, text);
	renameSync(temporary, path);
}

/** 清掉上次被强杀留下的暂存目录（只认本版本自己的命名）。 */
function removeStaleStaging(root, tag) {
	const archiveRoot = join(root, "release-out");
	if (!existsSync(archiveRoot)) return;
	const prefix = `.staging-${tag}-`;
	for (const entry of readdirSync(archiveRoot)) {
		if (!entry.startsWith(prefix)) continue;
		rmSync(join(archiveRoot, entry), { recursive: true, force: true });
	}
}

function writeReleaseNotes({ root, plan, dir, args, log }) {
	const target = join(dir, RELEASE_NOTES_FILE);
	const selected = readNotesSource(root, plan.notesPath, args);
	if (selected) {
		writeFileSync(target, selected.text);
		return selected.source;
	}
	const previousTag = previousReleaseTag(root);
	const commits = parseGitLog(
		gitText(root, [
			"log",
			"--pretty=format:%h%x09%ad%x09%s",
			"--date=short",
			previousTag ? `${previousTag}..HEAD` : "HEAD",
		]),
	);
	writeFileSync(
		target,
		releaseNotesDraft({
			version: plan.targetVersion,
			previousTag,
			commits,
		}),
	);
	log(
		`⚠ 没有 ${plan.notesPath}，已按 ${previousTag ? `${previousTag}..HEAD` : "全部提交"} 生成草稿：${plan.archiveDir}/${RELEASE_NOTES_FILE}`,
	);
	return "draft";
}

/** 发布说明的来源优先级：`--notes` → 仓里的手写文件 → null（走 git log 草稿）。 */
function pickNotesSource(root, notesPath, args) {
	if (args.notesFile) {
		const custom = resolve(root, args.notesFile);
		if (!existsSync(custom) || !statSync(custom).isFile()) {
			throw new Error(`--notes 文件不存在或不是普通文件：${args.notesFile}`);
		}
		return { path: custom, source: "custom" };
	}
	const canonical = join(root, notesPath);
	if (existsSync(canonical)) {
		if (!statSync(canonical).isFile()) {
			throw new Error(`发布说明不是普通文件：${notesPath}`);
		}
		return { path: canonical, source: "handwritten" };
	}
	return null;
}

/** 在构建前就读出并检查说明，避免路径打错后构建完才留下半个归档。 */
function readNotesSource(root, notesPath, args) {
	const picked = pickNotesSource(root, notesPath, args);
	if (!picked) return null;
	const text = readFileSync(picked.path, "utf8");
	if (!text.trim()) throw new Error(`发布说明不能为空：${picked.path}`);
	return { ...picked, text };
}

/** 归档已存在时，如果人类后来补了手写发布说明，就把它换进归档（并更新清单）。 */
function refreshNotes({ root, version, archive, args, log }) {
	const notesPath = releaseNotesPath(version);
	const selected = readNotesSource(root, notesPath, args);
	if (!selected) return archive;
	const target = join(archive.dir, RELEASE_NOTES_FILE);
	if (
		archive.manifest.notesSource === selected.source &&
		readFileSync(target, "utf8") === selected.text
	) {
		return archive;
	}
	writeFileAtomic(target, selected.text);
	writeFileAtomic(
		join(archive.dir, RELEASE_MANIFEST_FILE),
		`${JSON.stringify({ ...archive.manifest, notesSource: selected.source }, null, 2)}\n`,
	);
	log(`发布说明已更新：${selected.source === "custom" ? args.notesFile : notesPath}`);
	return readArchive(root, version);
}

function buildAndArchive({ root, plan, args, log }) {
	const dir = join(root, plan.archiveDir);
	if (existsSync(dir)) {
		throw new Error(`归档目录已存在但不是本次的产物：${plan.archiveDir}（先人工核对或删除，不覆盖）`);
	}
	const baseCommit = gitText(root, ["rev-parse", "HEAD"]);
	const distArtifact = join(root, "dist/electron", plan.artifactName);

	if (args.skipBuild) {
		log("\n[1/3] --skip-build：使用 dist/electron 中已有安装包");
	} else {
		log(
			`\n[1/3] 构建 ${plan.currentVersion} → ${plan.targetVersion}：pnpm client:package ${plan.targetVersion}`,
		);
		runPnpm(root, ["client:package", plan.targetVersion]);
	}

	if (!existsSync(distArtifact)) {
		throw new Error(
			`找不到安装包：dist/electron/${plan.artifactName}（去掉 --skip-build 重新构建）`,
		);
	}
	assertWindowsInstaller(distArtifact);

	const builtVersion = readPackageJson(root).version;
	if (builtVersion !== plan.targetVersion) {
		throw new Error(
			`构建后 package.json 版本是 ${builtVersion}，与目标 ${plan.targetVersion} 不一致`,
		);
	}

	// 归档先写进暂存目录，全部校验通过后再原子改名：
	// 进程被强杀/磁盘写满时不会留下「缺清单的归档」，重跑也不会误用半成品。
	removeStaleStaging(root, plan.tag);
	const stage = join(root, "release-out", `.staging-${plan.tag}-${process.pid}`);
	let finalized = false;
	try {
		mkdirSync(stage, { recursive: true });
		const artifactPath = join(stage, plan.artifactName);
		try {
			renameSync(distArtifact, artifactPath);
		} catch {
			copyFileSync(distArtifact, artifactPath);
			rmSync(distArtifact, { force: true });
		}
		const bytes = statSync(artifactPath).size;
		const sha256 = sha256File(artifactPath);
		writeFileSync(
			join(stage, RELEASE_SUMS_FILE),
			sha256SumsText([{ sha256, name: plan.artifactName }]),
		);

		const notesSource = writeReleaseNotes({ root, plan, dir: stage, args, log });
		const manifest = {
			schema: RELEASE_MANIFEST_SCHEMA,
			version: plan.targetVersion,
			baseCommit,
			builtAt: new Date().toISOString(),
			notesSource,
			artifact: { name: plan.artifactName, bytes, sha256 },
		};
		writeFileSync(
			join(stage, RELEASE_MANIFEST_FILE),
			`${JSON.stringify(manifest, null, 2)}\n`,
		);
		// 清单/大小/摘要/说明全部自洽后才落成正式目录。
		readArchiveAt(stage, plan.targetVersion, plan.archiveDir);
		renameSync(stage, dir);
		finalized = true;
		log(
			`[2/3] 归档完成：${plan.archiveDir}（${formatBytes(bytes)}，sha256 ${sha256.slice(0, 16)}…）`,
		);
	} finally {
		if (!finalized) rmSync(stage, { recursive: true, force: true });
	}
	return readArchive(root, plan.targetVersion);
}

/* ────────────────────────────── 打印 ────────────────────────────── */

function describeNotes(root, plan, args) {
	const picked = pickNotesSource(root, plan.notesPath, args);
	if (!picked) return `${plan.notesPath} 不存在 → 从 git log 生成草稿`;
	if (picked.source === "custom") return `${args.notesFile}（--notes）`;
	return `${plan.notesPath}（手写）`;
}

function printReleasePlan({ root, plan, args, repository, log }) {
	log(`\n发布计划：${plan.currentVersion} → ${plan.targetVersion}（${String(args.target)}）`);
	log(`  tag      ${plan.tag}`);
	log(`  归档     ${plan.archiveDir}/`);
	log(`  安装包   ${plan.artifactName}`);
	log(`  说明     ${describeNotes(root, plan, args)}`);
	log(`  构建     ${plan.buildNeeded ? `需要：pnpm client:package ${plan.targetVersion}` : "跳过（复用已有归档 / --skip-build）"}`);
	log(
		`  分支     ${repository.branch || "（分离 HEAD）"} @ ${repository.headCommit.slice(0, 12)}`,
	);
	for (const warning of plan.warnings) log(`⚠ ${warning}`);
	for (const blocker of plan.blockers) log(`⛔ ${blocker}`);
}

// 打印阶段还没拿到 root；这里只用于「说明文件是否存在」的展示，由调用方补齐。
function printPublishPlan({ plan, archive, execute, log }) {
	log(`\n发布：${plan.tag}（归档 ${releaseArchiveDir(plan.version)}）`);
	log(`  动作     ${plan.skipCommit ? "跳过提交与打 tag（已在 HEAD）" : "提交版本文件 + 打 tag"} → 原子 push → Release 草稿 → 上传 → 核对 → 公开`);
	log(`  资产     ${archive.manifest.artifact.name}、${RELEASE_SUMS_FILE}`);
	for (const warning of plan.warnings) log(`⚠ ${warning}`);
	for (const blocker of plan.blockers) log(`⛔ ${blocker}`);
	if (!execute) log("\n预览：没有写入 git、没有上传。确认后加 --execute。");
}

/* ────────────────────────────── 发布 ────────────────────────────── */

function sleepBetweenReleases() {
	sleep(2000);
}

function publishGitHubRelease({ root, archive, tag, log }) {
	const assets = [
		{
			path: archive.artifactPath,
			name: archive.manifest.artifact.name,
			bytes: archive.bytes,
			sha256: archive.sha256,
		},
		{
			path: archive.sumsPath,
			name: RELEASE_SUMS_FILE,
			bytes: statSync(archive.sumsPath).size,
			sha256: sha256File(archive.sumsPath),
		},
	];
	const readRemote = () => {
		// `/releases/tags/<tag>` 对草稿固定 404；列表接口分页查找才能同时覆盖草稿与已公开。
		for (let page = 1; ; page += 1) {
			const list = ghJson(root, [
				"api",
				`repos/${RELEASE_REPO}/releases?per_page=100&page=${page}`,
			]);
			if (!Array.isArray(list)) throw new Error("gh api 未返回 Release 列表");
			const found = list.find((item) => item?.tag_name === tag);
			if (found) return found;
			if (list.length < 100) return null;
		}
	};
	const verifyAssets = (release, requireAll) => {
		const expected = new Map(assets.map((asset) => [asset.name, asset]));
		for (const asset of release.assets ?? []) {
			const local = expected.get(asset.name);
			if (!local) {
				throw new Error(`远端 Release 含未知资产，拒绝覆盖：${asset.name}`);
			}
			// 中断上传留下的零字节占位不算已完成
			if (release.draft && asset.state === "starter" && asset.size === 0) continue;
			if (asset.size !== local.bytes) {
				throw new Error(`远端资产大小与本地不符：${asset.name}`);
			}
			// 较旧 Release / API 可能没有 digest：下载远端字节补算，不能只凭 size 放行。
			let digest = asset.digest;
			if (!digest) {
				if (!asset.id) throw new Error(`远端资产缺少 id，无法核对摘要：${asset.name}`);
				const remoteBytes = ghBinary(
					root,
					[
						"api",
						`repos/${RELEASE_REPO}/releases/assets/${asset.id}`,
						"-H",
						"Accept: application/octet-stream",
					],
					local.bytes + 1024 * 1024,
				);
				digest = `sha256:${createHash("sha256").update(remoteBytes).digest("hex")}`;
			}
			if (digest !== `sha256:${local.sha256}`) {
				throw new Error(`远端资产摘要与本地不符：${asset.name}`);
			}
			expected.delete(asset.name);
		}
		if (requireAll && expected.size > 0) {
			throw new Error(
				`上传尚未完整（缺 ${[...expected.keys()].join(", ")}）；Release 保持草稿，重跑同一指令即可`,
			);
		}
		return [...expected.values()];
	};

	let release = readRemote();
	if (release && !release.draft) {
		verifyAssets(release, true);
		log(`Release 已公开且资产核对一致（幂等，无需重传）：${release.html_url}`);
		return release;
	}

	if (!release) {
		log(`[3/3] 在 GitHub 建 Release 草稿 ${tag} 并上传（约 ${formatBytes(archive.bytes)}）…`);
		ghRun(root, [
			"release",
			"create",
			tag,
			"--repo",
			RELEASE_REPO,
			"--verify-tag",
			"--draft",
			"--title",
			`默点啥 ${tag}`,
			"--notes-file",
			archive.notesPath,
		]);
		// 刚建的草稿有秒级索引延迟：轮询几次再判失败（失败按幂等重跑处理）
		for (let attempt = 0; attempt < 10 && !release; attempt += 1) {
			if (attempt > 0) sleepBetweenReleases();
			release = readRemote();
		}
		if (!release) {
			throw new Error(
				`创建后读不到 Release 草稿（可能已建成）；重跑 pnpm release:publish ${tag} --execute`,
			);
		}
	}

	const missing = verifyAssets(release, false);
	for (const asset of release.assets ?? []) {
		if (
			asset.state === "starter" &&
			asset.size === 0 &&
			missing.some((item) => item.name === asset.name)
		) {
			ghRun(root, ["release", "delete-asset", tag, asset.name, "--repo", RELEASE_REPO, "--yes"]);
		}
	}
	if (missing.length > 0) {
		ghRun(root, [
			"release",
			"upload",
			tag,
			...missing.map((asset) => asset.path),
			"--repo",
			RELEASE_REPO,
		]);
	}
	release = readRemote();
	if (!release) throw new Error("上传后读不到 Release");
	verifyAssets(release, true);
	ghRun(root, ["release", "edit", tag, "--repo", RELEASE_REPO, "--draft=false", "--latest"]);

	log(
		[
			"",
			`已发布：https://github.com/${RELEASE_REPO}/releases/tag/${tag}`,
			`安装包：https://github.com/${RELEASE_REPO}/releases/download/${tag}/${encodeURIComponent(archive.manifest.artifact.name)}`,
			`sha256：${archive.sha256}`,
			"（未做 Authenticode 签名：首次运行时 Windows 会提示「未知发布者」，属预期）",
		].join("\n"),
	);
	return readRemote();
}

/** P3 之后的任何失败都不回滚：带上固定的续跑指令，别让失败原因被吞掉。 */
function executePublish({ root, archive, plan, log }) {
	try {
		return executePublishSteps({ root, archive, plan, log });
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		throw new Error(
			`发布未完成（归档与已完成的 git 操作都保留，不回滚）：${reason}\n  排障后重跑：pnpm release:publish ${plan.tag} --execute`,
			{ cause: error },
		);
	}
}

function executePublishSteps({ root, archive, plan, log }) {
	const version = plan.version;
	const tag = plan.tag;

	// 1. HEAD 必须是构建来源本身，或只比它多一个发布提交
	let head = gitText(root, ["rev-parse", "HEAD"]);
	const base = archive.manifest.baseCommit;
	if (head !== base) {
		const count = Number(gitText(root, ["rev-list", "--count", `${base}..HEAD`]));
		if (count > 1 || gitText(root, ["rev-parse", "HEAD^"]) !== base) {
			throw new Error("HEAD 已离开构建来源；请重新构建，不能发布并行提交");
		}
	}

	// 2. 版本文件 + 发布说明一起进发布提交
	if (!plan.skipCommit) {
		const allowed = new Set(["package.json", releaseNotesPath(version)]);
		const paths = statusPaths(root).filter((path) => allowed.has(path));
		if (paths.length > 0) {
			gitRun(root, ["add", "--", ...paths]);
			gitRun(root, ["commit", "-m", `chore: release ${tag}`]);
			head = gitText(root, ["rev-parse", "HEAD"]);
			log(`[1/2] 已提交：chore: release ${tag}（${paths.join(", ")}）`);
		}
	}
	// 构建后的那一个提交只能包含版本号与本次说明；否则 tag 会包含未进入二进制的代码。
	if (head !== base) {
		const changedPaths = gitText(root, ["diff", "--name-only", `${base}..HEAD`])
			.split("\n")
			.filter(Boolean);
		const unexpected = unexpectedReleaseCommitPaths(changedPaths, version);
		if (unexpected.length > 0) {
			throw new Error(
				`构建来源之后出现并行改动，拒绝发布：${unexpected.join(", ")}`,
			);
		}
		if (
			changedPaths.includes("package.json") &&
			!isVersionOnlyPackageDiff(
				gitDiffText(root, [base, head, "--", "package.json"]),
			)
		) {
			throw new Error("构建后的 package.json 提交含版本号以外的改动，拒绝发布");
		}
	}
	if (statusPaths(root).length > 0) {
		throw new Error(
			`发布提交后工作树仍有改动，拒绝推送：${statusPaths(root).join(", ")}`,
		);
	}

	// 3. HEAD 的版本号必须是本次目标
	const committed = readCommittedPackageJson(root);
	if (committed.version !== version) {
		throw new Error(
			`HEAD 的 package.json 版本是 ${committed.version}，不是 ${version}`,
		);
	}

	// 4. tag
	const existingTag = gitText(root, ["tag", "--list", tag]);
	if (existingTag) {
		const commit = gitText(root, ["rev-parse", `${tag}^{commit}`]);
		if (commit !== head) throw new Error(`tag ${tag} 已指向其它提交，不覆盖`);
	} else {
		gitRun(root, ["tag", "-a", tag, "-m", `默点啥 ${tag}`]);
		log(`已打 tag：${tag}`);
	}

	// 5. 原子推送（分支与 tag 要么一起上去，要么都不动）
	log(`[2/2] 推送 ${RELEASE_BRANCH} 与 ${tag}…`);
	execFileSync(
		"git",
		[
			"push",
			"--atomic",
			"origin",
			`HEAD:refs/heads/${RELEASE_BRANCH}`,
			`refs/tags/${tag}:refs/tags/${tag}`,
		],
		{ cwd: root, stdio: "inherit" },
	);

	// 6. GitHub Release
	return publishGitHubRelease({ root, archive, tag, log });
}

function assertReleaseNotesReady(archive, version, allowDraftNotes) {
	if (archive.manifest.notesSource === "draft" && !allowDraftNotes) {
		throw new Error(
			`发布说明还是自动草稿（${releaseArchiveDir(version)}/${RELEASE_NOTES_FILE}）；改写后保存到 ${releaseNotesPath(version)}，或用 --use-draft-notes 明确接受草稿`,
		);
	}
}

export function publishRelease({
	root = projectRoot,
	version,
	execute = false,
	allowDraftNotes = false,
	log = console.log,
} = {}) {
	let archive = readArchive(root, version);
	if (!archive) {
		throw new Error(
			`找不到归档：${releaseArchiveDir(version)}（先跑 pnpm release ${version}）`,
		);
	}
	// 续跑也不能把旧归档标成 latest；与主入口共用「不得低于当前版本」规则。
	createPackagePlan(readPackageJson(root).version, version);
	// 预览不写文件；执行时先过仓库闸门，再吸收后来补写的手写说明。
	if (!execute) assertReleaseNotesReady(archive, version, allowDraftNotes);
	const tag = releaseTag(version);
	const repository = observeRepository(root, tag);
	const plan = createPublishPlan({ version, repository });
	printPublishPlan({ plan, archive, execute, log });
	if (plan.blockers.length > 0) throw new Error(plan.blockers.join("；"));
	if (!execute) return plan;
	archive = refreshNotes({ root, version, archive, args: {}, log });
	assertReleaseNotesReady(archive, version, allowDraftNotes);
	return executePublish({ root, archive, plan, log });
}

/* ────────────────────────────── 主流程 ────────────────────────────── */

export function runRelease({ root = projectRoot, argv = process.argv.slice(2), log = console.log } = {}) {
	const args = parseReleaseArgs(argv);
	const { version: currentVersion } = readPackageJson(root);
	const packagePlan = createPackagePlan(currentVersion, args.target);
	const { targetVersion } = packagePlan;
	const tag = releaseTag(targetVersion);

	assertGitHubCli(root);

	// 无论是否 dry-run，都在构建前验证显式/手写说明存在、可读且非空。
	const notesSourceAvailable = Boolean(
		readNotesSource(root, releaseNotesPath(targetVersion), args),
	);
	const existingArchive = readArchive(root, targetVersion);
	const repository = observeRepository(root, tag);
	const plan = createReleasePlan({
		currentVersion,
		targetVersion,
		args,
		repository,
		archiveValid: Boolean(existingArchive),
		notesSourceAvailable,
	});

	printReleasePlan({ root, plan, args, repository, log });

	if (args.dryRun) {
		log("\ndry-run：没有改文件、没有构建、没有提交或上传。");
		return plan;
	}
	if (plan.blockers.length > 0) throw new Error(plan.blockers.join("；"));

	const archive =
		existingArchive ??
		buildAndArchive({ root, plan, args, log });

	const current = refreshNotes({ root, version: targetVersion, archive, args, log });

	if (current.manifest.notesSource === "draft" && !args.useDraftNotes) {
		log(
			[
				"",
				"⏸  停在归档阶段：发布说明还是自动草稿，等你过一眼。",
				`  草稿：${plan.archiveDir}/${RELEASE_NOTES_FILE}`,
				`  改写后保存到 ${plan.notesPath} 再重跑 pnpm release ${plan.targetVersion}（安装包已归档，不会重新构建）`,
				`  或确认草稿可用：pnpm release ${plan.targetVersion} --use-draft-notes`,
			].join("\n"),
		);
		return plan;
	}

	if (args.noPublish) {
		log(
			[
				"",
				"⏸  已停在归档阶段（--no-publish）。",
				`  安装包：${plan.archiveDir}/${plan.artifactName}`,
				`  验收后执行：pnpm release:publish ${tag} --execute`,
			].join("\n"),
		);
		return plan;
	}

	// 归档完成后由 publishRelease 重新读一次仓库状态并做发布闸门（单一事实来源）
	return publishRelease({
		root,
		version: targetVersion,
		execute: true,
		allowDraftNotes: args.useDraftNotes,
		log,
	});
}

function main() {
	try {
		runRelease();
	} catch (error) {
		console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`);
		const cause = error instanceof Error ? error.cause : undefined;
		if (cause instanceof Error && cause.message !== error.message) {
			console.error(`  原因：${cause.message}`);
		}
		process.exitCode = 1;
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main();
}

