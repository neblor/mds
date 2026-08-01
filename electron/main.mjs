/**
 * 默点啥 — electron 主进程
 * 启动内置 nitro server（.output/server/index.mjs，import 即监听），
 * BrowserWindow 加载本地 http。缓存目录指向 userData（可写、持久）。
 * 启动/运行错误写入 <userData>/mds-error.log 便于排查。
 */
import { app, BrowserWindow, dialog } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";

const PORT = 4827;

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
	const cacheDir = join(app.getPath("userData"), "word-cache");
	mkdirSync(cacheDir, { recursive: true });
	process.env.PORT = String(PORT);
	process.env.NITRO_PORT = String(PORT);
	process.env.MDS_CACHE_DIR = cacheDir;
	log(`启动 server: ${serverPath}`);
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

app.whenReady().then(async () => {
	try {
		await startServer();
	} catch (e) {
		log(`启动失败: ${e?.stack ?? e}`);
		dialog.showErrorBox("默点啥启动失败", String(e?.message ?? e));
		app.quit();
		return;
	}

	const win = new BrowserWindow({
		width: 1120,
		height: 820,
		minWidth: 640,
		minHeight: 480,
		autoHideMenuBar: true,
		icon: join(app.getAppPath(), "public", "icons", "app.ico"),
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
		},
	});
	await win.loadURL(`http://127.0.0.1:${PORT}`);
	win.on("closed", () => app.quit());
});

app.on("window-all-closed", () => app.quit());
