/**
 * WSL/受限环境的 NSIS 打包入口：`pnpm client:package:wsl <major|minor|patch|test>`
 *
 * 与 client:package 的区别仅在运行环境：本脚本确保 wine 具备 32 位 PE 支持
 * （NSIS 安装器为 32 位，electron-builder 需用 wine 运行安装器抽取卸载器）。
 * 步骤：
 * 1. 首次运行时下载并解包 Ubuntu libwine/wine32 i386 deb 到 .tmp/wine32，
 *    并合并系统已有的 32 位 zlib1.dll（deb 不含该文件）
 * 2. 在用户挂载命名空间内初始化 wine 前缀（bind-mount PE 目录 + tmpfs 运行时目录）
 * 3. 在同一命名空间内执行 `pnpm client:package <bump_type>`
 * 在正常 Linux/Windows 环境直接使用 `pnpm client:package` 即可。
 *
 * wine 前缀与 electron-builder 缓存落在 `~/.cache/mds`（仓库之外）：
 * 前缀按设计必含 `dosdevices/z: -> /`，一旦落在源码树内，跟随软链的遍历工具
 * 会逃逸到根文件系统（见 plans/wine-prefix-rootfs-escape.md）。
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	realpathSync,
	rmSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseBumpType } from "../src/lib/client-package-version.ts";
import {
	WINE32_DEB_URLS,
	SYSTEM_WINE_PEB_DIR,
	buildWslPackageEnv,
	defaultCacheRoot,
	wslNamespaceScript,
	wslPrefixInitScript,
} from "../src/lib/client-wsl-env.ts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let bumpType;
try {
	bumpType = parseBumpType(process.argv.slice(2));
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	console.error("用法：pnpm client:package:wsl <major|minor|patch|test>");
	process.exit(1);
}

/** 首次运行时准备 32 位 PE 集合（下载 deb → 解包 → 合并系统 zlib1.dll） */
function ensureWine32PebSet(env) {
	if (existsSync(join(env.pebDir, "ntdll.dll"))) return;
	const debDir = join(env.wine32Root, "debs");
	mkdirSync(debDir, { recursive: true });
	for (const url of WINE32_DEB_URLS) {
		const file = join(debDir, url.split("/").pop());
		if (!existsSync(file)) {
			console.log(`下载 ${url}`);
			execFileSync("curl", ["-sL", "--retry", "3", "--max-time", "300", "-o", file, url], {
				stdio: "inherit",
			});
		}
		execFileSync("dpkg", ["-x", file, join(env.wine32Root, "root")], { stdio: "inherit" });
	}
	if (!existsSync(join(env.pebDir, "ntdll.dll"))) {
		throw new Error(`wine32 PE 集合解包后仍缺少 ntdll.dll：${env.pebDir}`);
	}
	// Debian 的 libwine:i386 不含 zlib1.dll（32 位 wow64 进程需要），
	// 从系统 wine 目录合并（libwine:amd64 已提供该 32 位文件）
	const systemZlib = join(SYSTEM_WINE_PEB_DIR, "zlib1.dll");
	if (existsSync(systemZlib) && !existsSync(join(env.pebDir, "zlib1.dll"))) {
		copyFileSync(systemZlib, join(env.pebDir, "zlib1.dll"));
	}
	console.log(`wine32 PE 集合就绪：${readdirSync(env.pebDir).length} 个文件`);
}

/**
 * 解析仓库之外的缓存根目录：先确保存在，再 realpath 解析符号链接，
 * 避免把 `~/.cache` 这类软链路径写进命名空间脚本（与 nodeDir/pnpmDir 同理）。
 */
function resolveCacheRoot() {
	const root = defaultCacheRoot();
	mkdirSync(root, { recursive: true });
	return realpathSync(root);
}

function runInNamespace(lines) {
	const result = spawnSync(
		"unshare",
		["--map-root-user", "--mount", "bash", "-c", lines.join("\n")],
		{ stdio: "inherit", cwd: projectRoot, env: process.env },
	);
	if (result.error) {
		console.error(`无法启动 unshare 命名空间：${result.error.message}`);
		console.error("该入口依赖用户命名空间（WSL2 默认可用）。");
		process.exit(1);
	}
	return result.status ?? 1;
}

const env = buildWslPackageEnv(
	projectRoot,
	process.getuid(),
	existsSync(join(projectRoot, ".tmp/wine32/root/usr/lib/i386-linux-gnu/wine/i386-windows/ntdll.dll")),
	resolveCacheRoot(),
);

ensureWine32PebSet(env);

// 初始化（或修复）wine 前缀；已有健康前缀时跳过
const prefixHealthy = existsSync(
	join(env.winePrefix, "drive_c/windows/syswow64/ntdll.dll"),
);
if (!prefixHealthy) {
	console.log("初始化 wine 前缀…");
	const initStatus = runInNamespace(wslPrefixInitScript(env));
	if (initStatus !== 0) {
		rmSync(env.winePrefix, { recursive: true, force: true });
		console.error("wine 前缀初始化失败，已清理。请检查 wine 与网络后重试。");
		process.exit(initStatus);
	}
}

// 解析 node/pnpm 真实安装目录：fnm 通过 /run/user 符号链接提供 shim，
// 命名空间内 tmpfs 会覆盖该目录，必须用真实路径
const nodeDir = dirname(realpathSync(process.execPath));
const pnpmDir = dirname(
	realpathSync(execFileSync("which", ["pnpm"]).toString().trim()),
);

console.log(`在挂载命名空间内执行打包（bump=${bumpType}）…`);
process.exitCode = runInNamespace(
	wslNamespaceScript({
		env,
		nodeDir,
		pnpmDir,
		projectRoot,
		bumpType,
	}),
);
