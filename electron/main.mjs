/**
 * 默点啥 — electron 主进程
 * 启动内置 nitro server（.output/server/index.mjs，import 即监听），
 * BrowserWindow 加载本地 http。portable 缓存优先放在 exe 同目录的 mds-data，
 * 不可写时回退到 userData/mds-data。
 * 启动/运行错误写入 <userData>/mds-error.log 便于排查。
 */
import { app, BrowserWindow, dialog } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import {
	clientDataDirCandidates,
	ensureWritableDataDir,
} from "./runtime-paths.mjs";
import { createMainWindowOptions } from "./window-options.mjs";

const PORT = 4827;
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
			portableExecutableDir: process.env.PORTABLE_EXECUTABLE_DIR,
			userDataDir: app.getPath("userData"),
		}),
	);
	const cacheDir = join(dataDir, "word-cache");
	mkdirSync(cacheDir, { recursive: true });
	process.env.PORT = String(PORT);
	process.env.NITRO_PORT = String(PORT);
	process.env.HOST = "127.0.0.1";
	process.env.NITRO_HOST = "127.0.0.1";
	process.env.MDS_RUNTIME_MODE = "client";
	process.env.MDS_CACHE_DIR = cacheDir;
	log(`启动 server: ${serverPath}; cache: ${cacheDir}`);
	await import(pathToFileURL(serverPath).href);
	for (let i = 0; i < 50; i++) {
		try {
			const r = await fetch(`http://127.0.0.1:${PORT}/`);
			if (r.ok) {
				log(`server 就绪 (${PORT})`);
				return;
			}
		} catch {
			// 未就绪，重试
		}
		await new Promise((r) => setTimeout(r, 200));
	}
	throw new Error("内置服务启动超时");
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
	try {
		await startServer();
	} catch (e) {
		log(`启动失败: ${e?.stack ?? e}`);
		dialog.showErrorBox("默点啥启动失败", String(e?.message ?? e));
		app.quit();
		return;
	}

	mainWindow = new BrowserWindow(createMainWindowOptions(app.getAppPath()));
	// 再通过实例 API 明确关闭最大化/全屏，避免平台窗口管理器忽略构造选项。
	mainWindow.setMaximizable(false);
	mainWindow.setFullScreenable(false);
	await mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
	mainWindow.on("closed", () => {
		mainWindow = undefined;
		app.quit();
	});
});

app.on("window-all-closed", () => app.quit());
