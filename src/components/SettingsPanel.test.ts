import { describe, expect, it } from "vitest";
import { isSettingsBackdropClick } from "~/lib/settings-panel";

describe("SettingsPanel backdrop", () => {
	it("点击遮罩自身时关闭", () => {
		const backdrop = new EventTarget();
		expect(
			isSettingsBackdropClick({ target: backdrop, currentTarget: backdrop }),
		).toBe(true);
	});

	it("点击设置面板内部时不关闭", () => {
		const panel = new EventTarget();
		const backdrop = new EventTarget();
		expect(
			isSettingsBackdropClick({ target: panel, currentTarget: backdrop }),
		).toBe(false);
	});
});
