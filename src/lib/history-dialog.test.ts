import { describe, expect, it } from "vitest";
import { formatHistoryTime, historyEscapeAction } from "./history-dialog";

describe("formatHistoryTime", () => {
	it("当年记录不带年份，分补零", () => {
		expect(formatHistoryTime(new Date("2026-08-21T20:15:00").getTime())).toBe(
			"8月21日 20:15",
		);
		expect(formatHistoryTime(new Date("2026-01-02T09:05:00").getTime())).toBe(
			"1月2日 09:05",
		);
	});

	it("跨年记录补年份前缀", () => {
		const now = new Date("2026-08-21T20:15:00").getTime();
		expect(formatHistoryTime(new Date("2025-12-31T23:00:00").getTime(), now)).toBe(
			"2025年12月31日 23:00",
		);
	});
});

describe("historyEscapeAction", () => {
	it("详情态返回列表，列表态关闭弹窗", () => {
		expect(historyEscapeAction(true)).toBe("back");
		expect(historyEscapeAction(false)).toBe("close");
	});
});
