/**
 * 全屏音标表（独立窗口）
 *
 * Electron 主进程用 setWindowOpenHandler 把它变成无边框全屏子窗口；
 * Web 下是普通弹窗。任意键/点击关闭，关闭前先给主窗口 postMessage，
 * 让默写从暂停处恢复（轮询 win.closed 作为 Alt+F4 的兜底）。
 */
import { createSignal, onMount } from "solid-js";
import { PHONETIC_CHART_CLOSED_MESSAGE } from "~/lib/phonetic-chart";

export default function PhoneticSymbolsPage() {
	const [paused, setPaused] = createSignal(false);

	onMount(() => {
		setPaused(new URLSearchParams(window.location.search).get("paused") === "1");
		let armed = false;
		let closed = false;

		const close = () => {
			if (!armed || closed) return;
			closed = true;
			try {
				window.opener?.postMessage(
					{ type: PHONETIC_CHART_CLOSED_MESSAGE },
					window.location.origin,
				);
			} catch {
				// 跨源/opener 已关闭：忽略，仍尝试关闭自身
			}
			window.close();
			// 非脚本打开的窗口 close 可能被浏览器拒绝：退回历史/首页，
			// 父窗口已经收到 postMessage，不会一直卡在暂停态。
			window.setTimeout(() => {
				if (window.closed) return;
				if (window.history.length > 1) window.history.back();
				else window.location.replace("/");
			}, 100);
		};

		const onKeyDown = (event: KeyboardEvent) => {
			if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
			event.preventDefault();
			close();
		};
		const onPointerDown = () => close();

		// 150ms 后再绑定：避免打开窗口的那次点击/回车立刻把表关掉
		const timer = window.setTimeout(() => {
			armed = true;
			window.addEventListener("keydown", onKeyDown);
			window.addEventListener("pointerdown", onPointerDown);
		}, 150);

		return () => {
			window.clearTimeout(timer);
			window.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("pointerdown", onPointerDown);
		};
	});

	return (
		<main class="relative flex h-screen w-screen items-center justify-center overflow-hidden bg-[#0b1220] p-4">
			<img
				src="/ipa/phonetic-symbols.png"
				alt="英语音标表（44 个音素 + happy 尾音 i）"
				class="max-h-full max-w-full object-contain select-none"
				draggable={false}
			/>
			<div class="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-4 py-1.5 text-[12px] text-white/70 backdrop-blur">
				{paused() ? "默写已暂停 · " : ""}按任意键或点击关闭
			</div>
		</main>
	);
}
