/**
 * WSL/受限环境打包编排的纯逻辑（可单测）。
 *
 * 背景：NSIS 安装器是 32 位 PE，electron-builder 在非 Windows 平台需要用 wine
 * 运行安装器抽取卸载器；本沙箱 wine 只有 64 位组件且系统目录只读、无法 apt 安装。
 * 方案：解包 Ubuntu 的 libwine/wine32 i386 deb 得到 32 位 PE 集合，
 * 在用户挂载命名空间内 bind-mount 到 wine 系统目录，并用 tmpfs 覆盖只读的
 * /run/user/<uid>（wineserver socket 目录）。
 */

/** 与系统 libwine:amd64 (9.0~repack-4build3) 版本对应的 i386 组件 */
export const WINE32_DEB_URLS = [
	"http://archive.ubuntu.com/ubuntu/pool/universe/w/wine/libwine_9.0~repack-4build3_i386.deb",
	"http://archive.ubuntu.com/ubuntu/pool/universe/w/wine/wine32_9.0~repack-4build3_i386.deb",
] as const;

export const SYSTEM_WINE_PEB_DIR =
	"/usr/lib/x86_64-linux-gnu/wine/i386-windows";

export interface WslPackageEnv {
	/** wine32 就绪状态与产物的根目录（.tmp/wine32） */
	wine32Root: string;
	/** 解包后的 32 位 PE 集合目录（含合并的系统 zlib1.dll） */
	pebDir: string;
	/** 系统 wine 的 i386-windows 目录（bind-mount 目标） */
	systemPebDir: string;
	/** wineserver socket 目录（命名空间内用 tmpfs 覆盖） */
	runtimeDir: string;
	/** wine 前缀（独立于只读 HOME 缓存） */
	winePrefix: string;
	/** electron-builder 缓存（默认 ~/.cache 只读时重定向） */
	builderCache: string;
	/** 32 位 PE 集合是否已就绪（以 ntdll.dll 为标志） */
	pebReady: boolean;
}

export function buildWslPackageEnv(
	projectRoot: string,
	uid: number,
	pebReady: boolean,
): WslPackageEnv {
	const wine32Root = joinPosix(projectRoot, ".tmp/wine32");
	return {
		wine32Root,
		pebDir: joinPosix(wine32Root, "root/usr/lib/i386-linux-gnu/wine/i386-windows"),
		systemPebDir: SYSTEM_WINE_PEB_DIR,
		runtimeDir: `/run/user/${uid}`,
		winePrefix: joinPosix(projectRoot, ".tmp/wine-prefix"),
		builderCache: joinPosix(projectRoot, ".tmp/eb-cache"),
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
		`export WINEPREFIX=${env.winePrefix}`,
		`export ELECTRON_BUILDER_CACHE=${env.builderCache}`,
		`export XDG_RUNTIME_DIR=${env.runtimeDir}`,
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
		`export WINEPREFIX=${env.winePrefix}`,
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
