/** 只有事件直接落在设置遮罩本身时关闭；面板内部点击不会误触。 */
export function isSettingsBackdropClick(event: {
	target: EventTarget | null;
	currentTarget: EventTarget | null;
}): boolean {
	return event.target === event.currentTarget;
}
