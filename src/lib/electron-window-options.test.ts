import { describe, expect, it } from "vitest";
import {
	WINDOW_BOUNDS,
	createMainWindowOptions,
} from "../../electron/window-options.mjs";

describe("Electron window options", () => {
	it("默认尺寸是最大上限，最小尺寸约为各边的三分之二", () => {
		expect(WINDOW_BOUNDS).toEqual({
			width: 1120,
			height: 820,
			minWidth: 747,
			minHeight: 547,
			maxWidth: 1120,
			maxHeight: 820,
		});
	});

	it("允许范围内缩放，但禁用最大化和全屏", () => {
		const options = createMainWindowOptions("/app");
		expect(options).toMatchObject({
			resizable: true,
			maximizable: false,
			fullscreen: false,
			fullscreenable: false,
			icon: "/app/.output/public/icons/app.ico",
			webPreferences: {
				contextIsolation: true,
				nodeIntegration: false,
			},
		});
	});
});
