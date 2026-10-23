/**
 * 默点啥 — electron 主进程
 * 启动内置 nitro server（.output/server/index.mjs，import 即监听），
 * BrowserWindow 加载本地 http。安装版运行时数据统一放 userData/mds-data。
 * 启动/运行错误写入 <userData>/mds-error.log 便于排查。
 */
import { app, BrowserWindow, Menu, dialog } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import {
	clientDataDirCandidates,
	ensureWritableDataDir,
} from "./runtime-paths.mjs";
import {
	createMainWindowOptions,
	createPhoneticWindowOptions,
	isPhoneticChartUrl,
} from "./window-options.mjs";
import { acquireServerPort } from "./port-picker.mjs";

let mainWindow;

/** 错误日志（userData 下，窗口异常退出时排查用） */
function log(msg) {
	try {
		writeFileSync(
			join(app.getPath("userData"), "mds-error.log"),
			`${new Date().toISOString()} ${msg}\n`,
			{ flag: "a" },
		);
	} catch {
		// 日志失败忽略
	}
}

process.on("uncaughtException", (e) =>
	log(`uncaughtException: ${e?.stack ?? e}`),
);
process.on("unhandledRejection", (e) =>
	log(`unhandledRejection: ${e?.stack ?? e}`),
);

/** 启动内置 server（import 即 listen），轮询等待就绪 */
async function startServer() {
	const serverPath = join(app.getAppPath(), ".output", "server", "index.mjs");
	const dataDir = ensureWritableDataDir(
		clientDataDirCandidates({
			userDataDir: app.getPath("userData"),
		}),
	);
	const cacheDir = join(dataDir, "word-cache");
	mkdirSync(cacheDir, { recursive: true });
	// Windows 的动态端口保留段可能圈走任意固定端口（listen 报 EACCES 且被
	// srvx 静默吞掉），必须先探测再绑定：首选 4827，不可绑则由 OS 分配空闲端口。
	const { port, release } = await acquireServerPort();
	process.env.PORT = String(port);
	process.env.NITRO_PORT = String(port);
	process.env.HOST = "127.0.0.1";
	process.env.NITRO_HOST = "127.0.0.1";
	process.env.MDS_RUNTIME_MODE = "client";
	process.env.MDS_CACHE_DIR = cacheDir;
	log(`启动 server: ${serverPath}; port: ${port}; cache: ${cacheDir}`);
	// 释放探测占位后立即让 nitro 绑定（缩短端口被第三方抢占的窗口）
	await release();
	await import(pathToFileURL(serverPath).href);
	for (let i = 0; i < 50; i++) {
		try {
			const r = await fetch(`http://127.0.0.1:${port}/`);
			if (r.ok) {
				log(`server 就绪 (${port})`);
				return port;
			}
		} catch {
			// 未就绪，重试
		}
		await new Promise((r) => setTimeout(r, 200));
	}
	throw new Error(`内置服务启动超时 (端口 ${port})`);
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
	app.quit();
} else {
	app.on("second-instance", () => {
		if (!mainWindow) return;
		if (mainWindow.isMinimized()) mainWindow.restore();
		mainWindow.focus();
	});
}

app.whenReady().then(async () => {
	if (!hasSingleInstanceLock) return;
	// 彻底禁用应用菜单：autoHideMenuBar 只是隐藏，单按 Alt 仍会把菜单栏唤出来；
	// 传 null 才是「没有菜单可唤出」（Windows/Linux 下同时会移除窗口菜单栏）。
	// 文字输入框的 Ctrl+C/V/X/A/Z 由 Chromium 自己处理，不依赖菜单加速键；
	// 该限制只影响 macOS（那边需要 Edit 菜单角色），本项目只出 Windows 包。
	Menu.setApplicationMenu(null);
	let port;
	try {
		port = await startServer();
	} catch (e) {
		log(`启动失败: ${e?.stack ?? e}`);
		dialog.showErrorBox("默点啥启动失败", String(e?.message ?? e));
		app.quit();
		return;
	}

	mainWindow = new BrowserWindow(
		createMainWindowOptions(app.getAppPath(), app.getVersion()),
	);
	// 音标表：只允许同源 /phonetic-symbols 打开独立全屏子窗口；
	// 主窗口的 fullscreenable=false 不受影响。
	mainWindow.webContents.setWindowOpenHandler(({ url }) => {
		if (!isPhoneticChartUrl(url, mainWindow.webContents.getURL())) {
			return { action: "deny" };
		}
		return {
			action: "allow",
			overrideBrowserWindowOptions: createPhoneticWindowOptions(),
		};
	});
	mainWindow.webContents.on("did-create-window", (child) => {
		// override 在个别平台上可能不生效，这里兜底
		child.setFullScreen(true);
		child.setMenuBarVisibility(false);
		child.on("closed", () => mainWindow?.focus());
	});
	// 阻止页面 <title>（SSR 的「默点啥」）覆盖窗口标题，保持「默点啥 v版本号」。
	mainWindow.on("page-title-updated", (event) => event.preventDefault());
	// 再通过实例 API 明确关闭最大化/全屏，避免平台窗口管理器忽略构造选项。
	mainWindow.setMaximizable(false);
	mainWindow.setFullScreenable(false);
	await mainWindow.loadURL(`http://127.0.0.1:${port}`);
	mainWindow.on("closed", () => {
		mainWindow = undefined;
		app.quit();
	});
});

app.on("window-all-closed", () => app.quit());
