/**
 * WSL/受限环境打包编排的纯逻辑（可单测）。
 *
 * 背景：NSIS 安装器是 32 位 PE，electron-builder 在非 Windows 平台需要用 wine
 * 运行安装器抽取卸载器；本沙箱 wine 只有 64 位组件且系统目录只读、无法 apt 安装。
 * 方案：解包 Ubuntu 的 libwine/wine32 i386 deb 得到 32 位 PE 集合，
 * 在用户挂载命名空间内 bind-mount 到 wine 系统目录，并用 tmpfs 覆盖只读的
 * /run/user/<uid>（wineserver socket 目录）。
 */
import { existsSync } from "node:fs";

/** 与系统 libwine:amd64 (9.0~repack-4build3) 版本对应的 i386 组件 */
export const WINE32_DEB_URLS = [
	"http://archive.ubuntu.com/ubuntu/pool/universe/w/wine/libwine_9.0~repack-4build3_i386.deb",
	"http://archive.ubuntu.com/ubuntu/pool/universe/w/wine/wine32_9.0~repack-4build3_i386.deb",
] as const;

export const SYSTEM_WINE_PEB_DIR =
	"/usr/lib/x86_64-linux-gnu/wine/i386-windows";

/** 系统 wine 具备 32 位支持的标志文件（Debian/Ubuntu/i386 布局） */
const WINE32_NTDLL_CANDIDATES = [
	"/usr/lib/x86_64-linux-gnu/wine/i386-windows/ntdll.dll",
	"/usr/lib/i386-linux-gnu/wine/i386-windows/ntdll.dll",
	"/usr/lib/wine/i386-windows/ntdll.dll",
];

/** 探测系统 wine 是否已具备 32 位 PE 支持（装了 wine32 / 完整 wow64 组件） */
export function systemHasWine32Support(): boolean {
	return WINE32_NTDLL_CANDIDATES.some((path) => existsSync(path));
}

/**
 * 是否应自动切换到受限环境（命名空间 + 自备 32 位 PE）打包。
 * Windows 直接用系统能力；已在命名空间内 / 系统已支持 32 位时无需切换；
 * 其余（非 win32 且缺 32 位 wine）只要有 unshare 就切换。
 */
export function shouldAutoUseNamespace(options: {
	platform: string;
	inNamespace: boolean;
	hasWine32: boolean;
	unshareAvailable: boolean;
}): boolean {
	if (options.platform === "win32") return false;
	if (options.inNamespace) return false;
	if (options.hasWine32) return false;
	return options.unshareAvailable;
}

export interface WslPackageEnv {
	/** wine32 就绪状态与产物的根目录（.tmp/wine32） */
	wine32Root: string;
	/** 解包后的 32 位 PE 集合目录（含合并的系统 zlib1.dll） */
	pebDir: string;
	/** 系统 wine 的 i386-windows 目录（bind-mount 目标） */
	systemPebDir: string;
	/** wineserver socket 目录（命名空间内用 tmpfs 覆盖） */
	runtimeDir: string;
	/**
	 * wine 前缀。**必须在项目目录之外**：wine 前缀按设计固定含
	 * `dosdevices/z: -> /`，落在仓库内会让「递归遍历 + 跟随符号链接」的工具
	 * （VS Code 搜索、文件索引器等）从 `/` 开始遍历整个文件系统。
	 * 见 plans/wine-prefix-rootfs-escape.md。
	 */
	winePrefix: string;
	/** electron-builder 缓存（同样放在仓库之外，避免任何指回仓库外的软链被源码树带走） */
	builderCache: string;
	/** 32 位 PE 集合是否已就绪（以 ntdll.dll 为标志） */
	pebReady: boolean;
}

/** 环境变量取值：空串/纯空白视为未设置（XDG 规范要求绝对路径） */
function nonEmptyAbsolute(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	if (!trimmed || !trimmed.startsWith("/")) return undefined;
	return trimmed;
}

/**
 * 仓库之外的缓存根目录：`$XDG_CACHE_HOME/mds`（未设置则 `~/.cache/mds`）。
 * 前缀与 builder 缓存都落在这里，绝不进源码树 —— 理由见 plans/wine-prefix-rootfs-escape.md。
 * 注意不可用 `XDG_RUNTIME_DIR`：命名空间内会用 tmpfs 覆盖 `/run/user/<uid>`。
 */
export function defaultCacheRoot(
	env: NodeJS.ProcessEnv = process.env,
): string {
	const xdgCache = nonEmptyAbsolute(env.XDG_CACHE_HOME);
	const home = nonEmptyAbsolute(env.HOME);
	const base = xdgCache ?? (home ? joinPosix(home, ".cache") : "/tmp");
	return joinPosix(base, "mds");
}

export function buildWslPackageEnv(
	projectRoot: string,
	uid: number,
	pebReady: boolean,
	cacheRoot: string = defaultCacheRoot(),
): WslPackageEnv {
	const wine32Root = joinPosix(projectRoot, ".tmp/wine32");
	return {
		wine32Root,
		pebDir: joinPosix(wine32Root, "root/usr/lib/i386-linux-gnu/wine/i386-windows"),
		systemPebDir: SYSTEM_WINE_PEB_DIR,
		runtimeDir: `/run/user/${uid}`,
		winePrefix: joinPosix(cacheRoot, "wine-prefix"),
		builderCache: joinPosix(cacheRoot, "eb-cache"),
		pebReady,
	};
}

function joinPosix(base: string, rel: string): string {
	return `${base.replace(/\/+$/, "")}/${rel}`;
}

/**
 * 组装在挂载命名空间内执行的 bash 脚本（环境变量 + 挂载 + 打包命令）。
 * nodeDir/pnpmDir 为真实安装目录（避免 fnm 的 /run/user 符号链接被 tmpfs 覆盖）。
 */
export function wslNamespaceScript(options: {
	env: WslPackageEnv;
	nodeDir: string;
	pnpmDir: string;
	projectRoot: string;
	bumpType: string;
}): string[] {
	const { env, nodeDir, pnpmDir, projectRoot, bumpType } = options;
	return [
		"set -e",
		`mount -t tmpfs tmpfs ${env.runtimeDir}`,
		`mount --bind ${env.pebDir} ${env.systemPebDir}`,
		`export PATH=${nodeDir}:${pnpmDir}:/usr/bin:/bin`,
		`export WINEPREFIX="${env.winePrefix}"`,
		`export ELECTRON_BUILDER_CACHE="${env.builderCache}"`,
		`export XDG_RUNTIME_DIR=${env.runtimeDir}`,
		// 阻止命名空间内重入的 client:package 再次触发自动切换到命名空间（防循环）
		"export MDS_PACKAGING_IN_NS=1",
		"export WINEDEBUG=-all",
		`export HOME=${process.env.HOME ?? "/root"}`,
		`cd ${projectRoot}`,
		`pnpm client:package ${bumpType}`,
	];
}

/** 命名空间内的 wine 前缀初始化脚本（打包前调用一次，失败容忍重试） */
export function wslPrefixInitScript(env: WslPackageEnv): string[] {
	return [
		"set -e",
		`mount -t tmpfs tmpfs ${env.runtimeDir}`,
		`mount --bind ${env.pebDir} ${env.systemPebDir}`,
		`export WINEPREFIX="${env.winePrefix}"`,
		`export XDG_RUNTIME_DIR=${env.runtimeDir}`,
		"export PATH=/usr/bin:/bin",
		"export WINEDEBUG=-all",
		`rm -rf "${env.winePrefix}"`,
		"wineboot --init >/dev/null 2>&1 || true",
		`for i in 1 2 3 4 5; do [ -f "${env.winePrefix}/drive_c/windows/syswow64/ntdll.dll" ] && break; sleep 2; done`,
		`[ -f "${env.winePrefix}/drive_c/windows/syswow64/ntdll.dll" ] || { echo "wine 前缀初始化失败：syswow64 未填充" >&2; exit 1; }`,
		"wineserver -k >/dev/null 2>&1 || true",
		`echo "wine prefix ready: $(ls "${env.winePrefix}/drive_c/windows/syswow64" | wc -l) PE files"`,
	];
}
