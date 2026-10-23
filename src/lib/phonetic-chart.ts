/**
 * 全屏音标表窗口（Web 弹窗 / Electron 独立全屏窗口共用的打开与监听）
 *
 * - 路径固定 `/phonetic-symbols`；Electron 主进程只允许这个同源路径，
 *   并用 `setWindowOpenHandler` 的 override 选项把它做成无边框全屏窗口；
 * - 子窗口关闭时先 `postMessage`，父窗口再轮询 `win.closed` 兜底
 *   （Alt+F4 / 窗口管理器关闭也能恢复暂停的默写）。
 */
export const PHONETIC_CHART_PATH = "/phonetic-symbols";
export const PHONETIC_CHART_WINDOW_NAME = "mds-phonetic-chart";
export const PHONETIC_CHART_CLOSED_MESSAGE = "mds-phonetic-chart-closed";

export function phoneticChartUrl(paused: boolean): string {
	return paused ? `${PHONETIC_CHART_PATH}?paused=1` : PHONETIC_CHART_PATH;
}

/** 打开音标表；被浏览器拦截时返回 null（调用方不得进入暂停态） */
export function openPhoneticChartWindow(paused: boolean): Window | null {
	if (typeof window === "undefined") return null;
	// 固定内部路径、不接受调用方传入的 URL：避免开放重定向；
	// paused 只影响主窗口的暂停编排，音标表自身只负责显示与关闭。
	// pi-lens-ignore: no-open-redirect -- 目标固定为内部路径 /phonetic-symbols
	return window.open(
		phoneticChartUrl(paused),
		"mds-phonetic-chart",
		"popup=yes,width=1280,height=800",
	);
}

/**
 * 监听音标表窗口关闭。返回取消监听的函数。
 * 只在确实拿到窗口时调用；`onClose` 保证最多执行一次。
 */
export function watchPhoneticChartWindow(
	win: Window,
	onClose: () => void,
): () => void {
	let closed = false;
	let timer: ReturnType<typeof setInterval> | null = null;

	const cleanup = () => {
		if (timer !== null) {
			clearInterval(timer);
			timer = null;
		}
		if (typeof window !== "undefined") {
			window.removeEventListener("message", onMessage);
		}
	};
	const complete = () => {
		if (closed) return;
		closed = true;
		cleanup();
		onClose();
	};
	const onMessage = (event: MessageEvent) => {
		if (typeof window === "undefined") return;
		if (event.origin !== window.location.origin) return;
		if (
			typeof event.data === "object" &&
			event.data !== null &&
			(event.data as { type?: unknown }).type === PHONETIC_CHART_CLOSED_MESSAGE
		) {
			complete();
		}
	};

	if (typeof window !== "undefined") {
		window.addEventListener("message", onMessage);
	}
	timer = setInterval(() => {
		if (win.closed) complete();
	}, 250);

	return () => {
		closed = true;
		cleanup();
	};
}
