/** 准备完成弹层只用 Enter 确认，忽略按住按键产生的重复事件。 */
export function isReadyOverlayConfirmKey(event: {
	key: string;
	repeat: boolean;
}): boolean {
	return event.key === "Enter" && !event.repeat;
}
