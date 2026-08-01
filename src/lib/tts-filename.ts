/**
 * 单词 → 语音缓存文件名转义（纯逻辑，可单测）
 *
 * 需求：语音按单词作为文件名保存，单词可能含 `'` 等怪字符，需转义。
 * 规则：保留 [a-z0-9]，其余替换为 `_`，去首尾下划线，小写；
 * 追加原始单词的 6 位 FNV 短哈希避免不同词碰撞。
 * 文件名同时含音色标识，防止同一单词不同音色间缓存冲突。
 */

export function escapeWordForFilename(word: string): string {
	const cleaned = word
		.trim()
		// 先剔除非 ASCII（全角/中文/emoji 等，避免残留导致音频路由校验失败）
		.replace(/[^\x00-\x7F]+/g, "_")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		// 截断防止超长文件名（服务端音频路由限制文件名 ≤80 字符，含音色与哈希后缀）
		.slice(0, 40);
	return cleaned || "word";
}

export function shortHash(word: string): string {
	// FNV-1a 32 位，良好的位分散避免相似词截断后碰撞
	let h = 0x811c9dc5;
	for (let i = 0; i < word.length; i++) {
		h ^= word.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h.toString(16).padStart(8, "0").slice(0, 6);
}

export function voiceSlug(voice: string): string {
	return (
		voice
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "voice"
	);
}

export function cacheFileName(word: string, voice: string): string {
	return `${escapeWordForFilename(word)}_${voiceSlug(voice)}_${shortHash(word)}.mp3`;
}
