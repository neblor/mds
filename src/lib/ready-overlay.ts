/** 准备完成弹层只用 Enter 确认，忽略按住按键产生的重复事件。 */
export function isReadyOverlayConfirmKey(event: {
	key: string;
	repeat: boolean;
}): boolean {
	return event.key === "Enter" && !event.repeat;
}

import type { ContentMode } from "./state";

/** 准备完成文案：组句轮没有语音轨，短句轮默写对象是整句，音标轮看词拼音标，混合轮逐词两种模式 */
export function readyOverlaySummary(options: {
	count: number;
	contentMode: ContentMode;
	summaryLabel?: string;
}): string {
	if (options.contentMode === "cloze") {
		return `${options.count} 道题 · 候选词已就绪 · 题序已打乱`;
	}
	if (options.contentMode === "sentence") {
		return `${options.count} 句 · 语音已就绪 · 顺序已打乱 · 默写整句`;
	}
	if (options.contentMode === "phonetic") {
		return `${options.count} 个单词 · 语音已就绪 · 顺序已打乱 · 看单词拼音标`;
	}
	if (options.contentMode === "mixed") {
		return `${options.count} 轮 · 每个词默 2 遍 · 释义/中文词/短句随机搭配 · 顺序已打乱`;
	}
	const mode = options.contentMode !== "word" ? ` · 含${options.summaryLabel ?? ""}` : "";
	return `${options.count} 个单词 · 语音已就绪 · 顺序已打乱${mode}`;
}
