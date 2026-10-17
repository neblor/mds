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
