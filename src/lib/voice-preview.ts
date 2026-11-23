/**
 * 设置里「语音音色 → 试听」的纯逻辑：预设台词与随机不重复选取
 *
 * 只做可单测的部分；合成/播放由 SettingsPanel 复用 `/api/tts` +
 * `playWithIntervals`（与结算页试听同一套引擎），这里不碰网络与音频。
 */

/** 试听台词（崔总提供，逐字保留；不要本地化或改写标点） */
export const PREVIEW_SENTENCES = [
	"May the force be with you.",
	"Everything that has a beginning, has an end.",
	"You want a piece of me, boy?",
	"Greetings, my friend. Stay awhile and listen!",
	"A woman's heart is a deep ocean of secrets.",
] as const;

/** 试听卡提示行的空闲文案（与实现里的原文案一致） */
export const PREVIEW_IDLE_HINT = "不同音色缓存互不冲突";

export type PreviewPhase = "idle" | "synthesizing" | "playing" | "error";

/**
 * 随机取一句台词，**不与上一次重复**（用户连点试听要能听出音色差别，
 * 而不是同一句反复念）。
 *
 * `random` 可注入以便单测；返回值越界时回落到边界，不抛错。
 */
export function pickPreviewSentence(
	previous: string | null,
	random: () => number = Math.random,
): string {
	const candidates: readonly string[] = previous
		? PREVIEW_SENTENCES.filter((s) => s !== previous)
		: PREVIEW_SENTENCES;
	// 只有一句台词时（或过滤器被改坏）直接退化，保证一定有返回值
	const pool = candidates.length > 0 ? candidates : PREVIEW_SENTENCES;
	const raw = random();
	const normalized = Number.isFinite(raw)
		? Math.min(0.999999, Math.max(0, raw))
		: 0;
	return pool[Math.floor(normalized * pool.length)] ?? PREVIEW_SENTENCES[0];
}

/** 试听按钮文案（合成中禁用、播放中变停止） */
export function previewButtonLabel(phase: PreviewPhase): string {
	switch (phase) {
		case "synthesizing":
			return "合成中";
		case "playing":
			return "停止";
		default:
			return "试听";
	}
}

/**
 * 提示行文案：高度恒定的单行。
 * 播放中显示正在念的这句原文（等于字幕，也让「随机换句」可感知），
 * 失败显示原因，其余回到缓存说明。
 */
export function previewHintText(
	phase: PreviewPhase,
	sentence: string | null,
	error: string,
): string {
	if (phase === "playing") return sentence ?? PREVIEW_IDLE_HINT;
	if (phase === "synthesizing") return "正在生成试听音频…";
	if (phase === "error") return error || "试听失败，请再试一次";
	return PREVIEW_IDLE_HINT;
}
