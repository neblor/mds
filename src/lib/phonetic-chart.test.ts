import { afterEach, describe, expect, it, vi } from "vitest";
import {
	PHONETIC_CHART_CLOSED_MESSAGE,
	phoneticChartUrl,
	watchPhoneticChartWindow,
} from "./phonetic-chart";

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("phoneticChartUrl", () => {
	it("暂停时带 paused=1，普通打开不带", () => {
		expect(phoneticChartUrl(false)).toBe("/phonetic-symbols");
		expect(phoneticChartUrl(true)).toBe("/phonetic-symbols?paused=1");
	});
});

describe("watchPhoneticChartWindow", () => {
	it("轮询到 win.closed 时只回调一次，并可清理", () => {
		vi.useFakeTimers();
		const add = vi.fn();
		const remove = vi.fn();
		vi.stubGlobal("window", {
			location: { origin: "http://localhost:5199" },
			addEventListener: add,
			removeEventListener: remove,
		});
		const fakeWin = { closed: false };
		const win = fakeWin as unknown as Window;
		const onClose = vi.fn();
		const stop = watchPhoneticChartWindow(win, onClose);

		vi.advanceTimersByTime(249);
		expect(onClose).not.toHaveBeenCalled();
		fakeWin.closed = true;
		vi.advanceTimersByTime(1);
		expect(onClose).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(1000);
		expect(onClose).toHaveBeenCalledTimes(1);

		stop();
		expect(remove).toHaveBeenCalled();
	});

	it("收到同源 closed 消息立即回调；跨源消息忽略", () => {
		vi.useFakeTimers();
		let listener: ((event: MessageEvent) => void) | undefined;
		vi.stubGlobal("window", {
			location: { origin: "http://localhost:5199" },
			addEventListener: (_type: string, fn: (event: MessageEvent) => void) => {
				listener = fn;
			},
			removeEventListener: vi.fn(),
		});
		const win = { closed: false } as unknown as Window;
		const onClose = vi.fn();
		watchPhoneticChartWindow(win, onClose);

		listener?.({
			origin: "http://evil.example",
			data: { type: PHONETIC_CHART_CLOSED_MESSAGE },
		} as MessageEvent);
		expect(onClose).not.toHaveBeenCalled();

		listener?.({
			origin: "http://localhost:5199",
			data: { type: PHONETIC_CHART_CLOSED_MESSAGE },
		} as MessageEvent);
		expect(onClose).toHaveBeenCalledTimes(1);
	});
});
