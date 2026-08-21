import { describe, expect, it } from "vitest";
import {
	WINE32_DEB_URLS,
	SYSTEM_WINE_PEB_DIR,
	buildWslPackageEnv,
	wslNamespaceScript,
	wslPrefixInitScript,
} from "./client-wsl-env";

describe("client-wsl-env", () => {
	it("wine32 deb 与系统 PE 目录常量指向正确位置", () => {
		expect(WINE32_DEB_URLS).toHaveLength(2);
		for (const url of WINE32_DEB_URLS) {
			expect(url).toMatch(
				/^http:\/\/archive\.ubuntu\.com\/ubuntu\/pool\/universe\/w\/wine\/(libwine|wine32)_9\.0.*_i386\.deb$/,
			);
		}
		expect(SYSTEM_WINE_PEB_DIR).toBe(
			"/usr/lib/x86_64-linux-gnu/wine/i386-windows",
		);
	});

	it("打包环境路径基于项目根且互不重叠", () => {
		const env = buildWslPackageEnv("/repo", 1000, true);
		expect(env.wine32Root).toBe("/repo/.tmp/wine32");
		expect(env.pebDir).toBe(
			"/repo/.tmp/wine32/root/usr/lib/i386-linux-gnu/wine/i386-windows",
		);
		expect(env.runtimeDir).toBe("/run/user/1000");
		expect(env.winePrefix).toBe("/repo/.tmp/wine-prefix");
		expect(env.builderCache).toBe("/repo/.tmp/eb-cache");
		expect(env.pebReady).toBe(true);
		// 根目录带尾斜杠也可归一
		expect(buildWslPackageEnv("/repo/", 0, false).runtimeDir).toBe(
			"/run/user/0",
		);
	});

	it("命名空间脚本包含挂载、环境与打包命令", () => {
		const env = buildWslPackageEnv("/repo", 1000, true);
		const lines = wslNamespaceScript({
			env,
			nodeDir: "/opt/node/bin",
			pnpmDir: "/opt/pnpm/bin",
			projectRoot: "/repo",
			bumpType: "test",
		});
		const script = lines.join("\n");
		expect(script).toContain("mount -t tmpfs tmpfs /run/user/1000");
		expect(script).toContain(
			`mount --bind ${env.pebDir} ${SYSTEM_WINE_PEB_DIR}`,
		);
		expect(script).toContain("export WINEPREFIX=/repo/.tmp/wine-prefix");
		expect(script).toContain(
			"export ELECTRON_BUILDER_CACHE=/repo/.tmp/eb-cache",
		);
		expect(script).toContain("export XDG_RUNTIME_DIR=/run/user/1000");
		expect(script).toContain("export PATH=/opt/node/bin:/opt/pnpm/bin");
		expect(script).toMatch(/^pnpm client:package test$/m);
		expect(script).toContain("cd /repo");
	});

	it("前缀初始化脚本校验 syswow64 填充成功与否", () => {
		const env = buildWslPackageEnv("/repo", 1000, true);
		const script = wslPrefixInitScript(env).join("\n");
		expect(script).toContain("wineboot --init");
		expect(script).toContain("syswow64/ntdll.dll");
		expect(script).toContain("wineserver -k");
		// 初始化失败时必须显式失败
		expect(script).toContain("exit 1");
	});
});
