/** 词库 localStorage 持久化；只接受去空白、去重后的非空字符串。 */
export const WORDS_STORAGE_KEY = "mds.words.v1";

export function normalizeWords(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const words: string[] = [];
	for (const item of value) {
		if (typeof item !== "string") continue;
		const word = item.trim();
		if (word && !words.includes(word)) words.push(word);
	}
	return words;
}

export function loadWords(): string[] {
	if (typeof localStorage === "undefined") return [];
	try {
		const raw = localStorage.getItem(WORDS_STORAGE_KEY);
		return raw ? normalizeWords(JSON.parse(raw)) : [];
	} catch {
		return [];
	}
}

export function saveWords(words: string[]): void {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(
			WORDS_STORAGE_KEY,
			JSON.stringify(normalizeWords(words)),
		);
	} catch {
		// localStorage 不可用或达到配额时保持当前内存状态。
	}
}
