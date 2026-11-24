import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildAndArchive,
	pruneReleaseArchives,
	removeStaleStaging,
} from "../../scripts/release.mjs";

const roots: string[] = [];

function makeRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "mds-release-archive-"));
	roots.push(root);
	return root;
}

function makeRepository(root: string): void {
	writeFileSync(
		join(root, "package.json"),
		`${JSON.stringify({ name: "release-archive-test", version: "1.0.0" }, null, 2)}\n`,
	);
	execFileSync("git", ["init", "-b", "master"], { cwd: root, stdio: "ignore" });
	execFileSync("git", ["config", "user.name", "Release Test"], { cwd: root });
	execFileSync("git", ["config", "user.email", "release@example.test"], {
		cwd: root,
	});
	execFileSync("git", ["add", "package.json"], { cwd: root });
	execFileSync("git", ["commit", "-m", "base"], { cwd: root, stdio: "ignore" });
}

function installerBytes(): Buffer {
	const bytes = Buffer.alloc(1024 * 1024 + 16, 7);
	bytes[0] = 0x4d;
	bytes[1] = 0x5a;
	return bytes;
}

function releasePlan() {
	return {
		currentVersion: "1.0.0",
		targetVersion: "1.0.0",
		tag: "v1.0.0",
		archiveDir: "release-out/v1.0.0",
		artifactName: "mds-1.0.0-setup.exe",
		notesPath: "docs/release-notes/1.0.0.md",
	};
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("release archive staging", () => {
	it("归档中途失败时回退安装包，不留下正式目录或暂存目录", () => {
		const root = makeRoot();
		makeRepository(root);
		const distDir = join(root, "dist/electron");
		mkdirSync(distDir, { recursive: true });
		const bytes = installerBytes();
		const distArtifact = join(distDir, "mds-1.0.0-setup.exe");
		writeFileSync(distArtifact, bytes);
		// 让说明读取在安装包已移入暂存区之后失败，覆盖最容易丢产物的路径。
		mkdirSync(join(root, "docs/release-notes/1.0.0.md"), { recursive: true });

		expect(() =>
			buildAndArchive({
				root,
				plan: releasePlan(),
				args: { skipBuild: true },
				log: () => {},
			}),
		).toThrow("发布说明不是普通文件");

		expect(readFileSync(distArtifact)).toEqual(bytes);
		expect(existsSync(join(root, "release-out/v1.0.0"))).toBe(false);
		const archiveRoot = join(root, "release-out");
		const staging = existsSync(archiveRoot)
			? readdirSync(archiveRoot).filter((name) => name.startsWith(".staging-"))
			: [];
		expect(staging).toEqual([]);
	}, 15000); // 真实 git + 文件系统夹具在全量并行测试下可能超过默认 5s。

	it("只清理已退出进程的暂存目录，活跃发布与异常命名均不动", async () => {
		const root = makeRoot();
		const active = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
			stdio: "ignore",
		});
		const exited = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
		await once(exited, "exit");
		const activePid = active.pid;
		const exitedPid = exited.pid;
		expect(activePid).toBeTypeOf("number");
		expect(exitedPid).toBeTypeOf("number");

		try {
			const archiveRoot = join(root, "release-out");
			const activeDir = join(archiveRoot, `.staging-v1.0.0-${activePid}`);
			const exitedDir = join(archiveRoot, `.staging-v1.0.0-${exitedPid}`);
			const malformedDir = join(archiveRoot, ".staging-v1.0.0-not-a-pid");
			for (const dir of [activeDir, exitedDir, malformedDir]) {
				mkdirSync(dir, { recursive: true });
				writeFileSync(join(dir, "marker"), "keep-check");
			}

			removeStaleStaging(root, "v1.0.0");

			expect(existsSync(activeDir)).toBe(true);
			expect(existsSync(exitedDir)).toBe(false);
			expect(existsSync(malformedDir)).toBe(true);
		} finally {
			if (active.exitCode === null && active.signalCode === null) {
				const done = once(active, "exit");
				active.kill();
				await done;
			}
		}
	}, 15000);
});

describe("release archive retention", () => {
	function makeArchive(root: string, version: string, bytes = 8): string {
		const dir = join(root, "release-out", `v${version}`);
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, "release.json"),
			JSON.stringify({ schema: 1, version, artifact: { name: `mds-${version}-setup.exe` } }),
		);
		writeFileSync(join(dir, `mds-${version}-setup.exe`), Buffer.alloc(bytes, 1));
		return dir;
	}

	it("只删已公开的旧归档，草稿/缺失的留作续跑依据", () => {
		const root = makeRoot();
		const published = makeArchive(root, "1.0.0");
		const draft = makeArchive(root, "1.0.1");
		const current = makeArchive(root, "1.1.0");

		const result = pruneReleaseArchives({
			root,
			currentTag: "v1.1.0",
			remoteStates: {
				"v1.0.0": "public",
				"v1.0.1": "draft",
				"v1.1.0": "public",
			},
			log: () => {},
		});

		expect(result.removed).toEqual(["v1.0.0"]);
		expect(existsSync(published)).toBe(false);
		expect(existsSync(draft)).toBe(true);
		expect(existsSync(current)).toBe(true);
		expect(result.kept.map((item) => item.entry.tag)).toEqual([
			"v1.1.0",
			"v1.0.1",
		]);
	});

	it("全部已公开时只留最新一版，释放字节数按目录实际大小汇总", () => {
		const root = makeRoot();
		makeArchive(root, "1.0.0", 16);
		makeArchive(root, "1.0.1", 32);
		const current = makeArchive(root, "1.1.0", 64);

		const result = pruneReleaseArchives({
			root,
			currentTag: "v1.1.0",
			remoteStates: {
				"v1.0.0": "public",
				"v1.0.1": "public",
				"v1.1.0": "public",
			},
			log: () => {},
		});

		expect(result.removed.sort()).toEqual(["v1.0.0", "v1.0.1"]);
		expect(readdirSync(join(root, "release-out"))).toEqual(["v1.1.0"]);
		expect(existsSync(current)).toBe(true);
	});

	it("不碰非归档目录，并顺带清理已退出进程的暂存目录", async () => {
		const root = makeRoot();
		makeArchive(root, "1.1.0");
		const archiveRoot = join(root, "release-out");
		mkdirSync(join(archiveRoot, "notes"), { recursive: true });
		const exited = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
		await once(exited, "exit");
		const staleStaging = join(archiveRoot, `.staging-v1.0.0-${exited.pid}`);
		mkdirSync(staleStaging, { recursive: true });

		const result = pruneReleaseArchives({
			root,
			currentTag: "v1.1.0",
			remoteStates: { "v1.1.0": "public" },
			log: () => {},
		});

		expect(result.stagingRemoved).toEqual([`.staging-v1.0.0-${exited.pid}`]);
		expect(existsSync(staleStaging)).toBe(false);
		expect(existsSync(join(archiveRoot, "notes"))).toBe(true);
	}, 15000);

	it("远端状态未知时什么都不删", () => {
		const root = makeRoot();
		makeArchive(root, "1.0.0");
		makeArchive(root, "1.1.0");

		const result = pruneReleaseArchives({
			root,
			currentTag: "v1.1.0",
			remoteStates: {},
			log: () => {},
		});

		expect(result.removed).toEqual([]);
		expect(readdirSync(join(root, "release-out")).sort()).toEqual([
			"v1.0.0",
			"v1.1.0",
		]);
	});
});
