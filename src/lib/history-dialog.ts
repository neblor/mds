/** 历史弹窗的纯逻辑（时间格式化 + Escape 分层行为），可单测 */

/** `8月21日 20:15`；跨年记录补年份前缀 `2025年8月21日 20:15` */
export function formatHistoryTime(ts: number, now = Date.now()): string {
	const d = new Date(ts);
	const pad = (n: number) => String(n).padStart(2, "0");
	const base = `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
	return d.getFullYear() === new Date(now).getFullYear()
		? base
		: `${d.getFullYear()}年${base}`;
}

/** Escape 分层：详情态返回列表，列表态关闭弹窗 */
export function historyEscapeAction(hasSelection: boolean): "back" | "close" {
	return hasSelection ? "back" : "close";
}
