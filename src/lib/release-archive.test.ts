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
