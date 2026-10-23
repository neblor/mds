import { join } from "node:path";

/**
 * 默认 1120×820 同时也是最大尺寸；最小尺寸取各边约 2/3，
 * 给低分辨率屏幕留出缩放空间，同时避免核心内容被压缩到不可用。
 */
export const WINDOW_BOUNDS = Object.freeze({
	width: 1120,
	height: 820,
	minWidth: 747,
	minHeight: 547,
	maxWidth: 1120,
	maxHeight: 820,
});

/**
 * 窗口标题：带版本号时显示「默点啥 v0.2.2」，否则显示「默点啥」。
 * 页面 <title> 会覆盖窗口标题，需由主进程阻止 page-title-updated。
 */
export function createMainWindowTitle(version) {
	return version ? `默点啥 v${version}` : "默点啥";
}

export function createMainWindowOptions(appPath, version) {
	return {
		...WINDOW_BOUNDS,
		title: createMainWindowTitle(version),
		resizable: true,
		maximizable: false,
		fullscreen: false,
		fullscreenable: false,
		autoHideMenuBar: true, // 只是隐藏；彻底禁用（Alt 也唤不出）在主进程 Menu.setApplicationMenu(null)
		icon: join(appPath, ".output", "public", "icons", "app.ico"),
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
		},
	};
}

/** 只允许同源、路径精确为 /phonetic-symbols 的窗口请求 */
export function isPhoneticChartUrl(url, mainUrl) {
	try {
		const target = new URL(url, mainUrl);
		const main = new URL(mainUrl);
		return (
			target.origin === main.origin && target.pathname === "/phonetic-symbols"
		);
	} catch {
		return false;
	}
}

/**
 * 音标表独立窗口：无边框全屏，不继承主窗口 1120×820 的限制；
 * 不引入 preload/IPC，子窗口只负责显示图片与自行关闭。
 */
export function createPhoneticWindowOptions() {
	return {
		width: 1280,
		height: 800,
		title: "音标表 · 默点啥",
		frame: false,
		fullscreen: true,
		fullscreenable: true,
		resizable: false,
		skipTaskbar: true,
		backgroundColor: "#0b1220",
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
		},
	};
}
