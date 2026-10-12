import { describe, expect, it } from "vitest";
import { isReadyOverlayConfirmKey, readyOverlaySummary } from "~/lib/ready-overlay";

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

describe("准备完成文案", () => {
	it("单词/释义/中文词：说语音与顺序", () => {
		expect(readyOverlaySummary({ count: 6, contentMode: "word" })).toBe(
			"6 个单词 · 语音已就绪 · 顺序已打乱",
		);
		expect(
			readyOverlaySummary({
				count: 6,
				contentMode: "definition",
				summaryLabel: "释义",
			}),
		).toBe("6 个单词 · 语音已就绪 · 顺序已打乱 · 含释义");
	});

	it("组句：说题数与候选词，不提语音", () => {
		const text = readyOverlaySummary({ count: 5, contentMode: "cloze" });
		expect(text).toBe("5 道题 · 候选词已就绪 · 题序已打乱");
		expect(text).not.toContain("语音");
	});
});
