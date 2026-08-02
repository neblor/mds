import { describe, expect, it } from "vitest";
import { isReadyOverlayConfirmKey } from "~/lib/ready-overlay";

describe("准备完成弹层快捷键", () => {
	it("首次按下 Enter 时开始默写", () => {
		expect(isReadyOverlayConfirmKey({ key: "Enter", repeat: false })).toBe(
			true,
		);
	});

	it("忽略其他按键与 Enter 长按重复事件", () => {
		expect(isReadyOverlayConfirmKey({ key: " ", repeat: false })).toBe(false);
		expect(isReadyOverlayConfirmKey({ key: "Enter", repeat: true })).toBe(false);
	});
});
