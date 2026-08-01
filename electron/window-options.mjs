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

export function createMainWindowOptions(appPath) {
	return {
		...WINDOW_BOUNDS,
		resizable: true,
		maximizable: false,
		fullscreen: false,
		fullscreenable: false,
		autoHideMenuBar: true,
		icon: join(appPath, ".output", "public", "icons", "app.ico"),
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
		},
	};
}
