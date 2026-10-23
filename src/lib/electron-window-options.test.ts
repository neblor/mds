import { describe, expect, it } from "vitest";
import {
	WINDOW_BOUNDS,
	createMainWindowOptions,
	createMainWindowTitle,
	createPhoneticWindowOptions,
	isPhoneticChartUrl,
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
			title: "默点啥",
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

	it("带版本号时标题为「默点啥 v版本号」", () => {
		expect(createMainWindowTitle("0.2.2")).toBe("默点啥 v0.2.2");
		expect(createMainWindowTitle(undefined)).toBe("默点啥");
		expect(createMainWindowOptions("/app", "0.2.2").title).toBe(
			"默点啥 v0.2.2",
		);
	});
});

describe("音标表独立窗口", () => {
	it("只允许同源且路径精确为 /phonetic-symbols", () => {
		const main = "http://127.0.0.1:4827/";
		expect(
			isPhoneticChartUrl("http://127.0.0.1:4827/phonetic-symbols", main),
		).toBe(true);
		expect(
			isPhoneticChartUrl(
				"http://127.0.0.1:4827/phonetic-symbols?paused=1",
				main,
			),
		).toBe(true);
		expect(
			isPhoneticChartUrl("http://127.0.0.1:4827/other", main),
		).toBe(false);
		expect(
			isPhoneticChartUrl("http://evil.example/phonetic-symbols", main),
		).toBe(false);
		expect(
			isPhoneticChartUrl("http://127.0.0.1:9999/phonetic-symbols", main),
		).toBe(false);
		expect(isPhoneticChartUrl("not a url", main)).toBe(false);
	});

	it("全屏、无边框、无 Node 集成；主窗口限制不受影响", () => {
		const options = createPhoneticWindowOptions();
		expect(options).toMatchObject({
			frame: false,
			fullscreen: true,
			fullscreenable: true,
			resizable: false,
			backgroundColor: "#0b1220",
			webPreferences: {
				contextIsolation: true,
				nodeIntegration: false,
			},
		});
		expect(options.width).toBeGreaterThan(WINDOW_BOUNDS.maxWidth);
	});
});
