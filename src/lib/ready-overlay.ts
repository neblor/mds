/** 准备完成弹层只用 Enter 确认，忽略按住按键产生的重复事件。 */
export function isReadyOverlayConfirmKey(event: {
	key: string;
	repeat: boolean;
}): boolean {
	return event.key === "Enter" && !event.repeat;
}

/** 准备完成文案：组句轮没有语音轨，措辞需要区分（「候选词/题序」而不是「语音/顺序」） */
export function readyOverlaySummary(options: {
	count: number;
	contentMode: "word" | "definition" | "chinese" | "cloze";
	summaryLabel?: string;
}): string {
	if (options.contentMode === "cloze") {
		return `${options.count} 道题 · 候选词已就绪 · 题序已打乱`;
	}
	const mode = options.contentMode !== "word" ? ` · 含${options.summaryLabel ?? ""}` : "";
	return `${options.count} 个单词 · 语音已就绪 · 顺序已打乱${mode}`;
}
