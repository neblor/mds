/** 批量导入约定：任意空白字符、英文逗号或英文分号均为分隔符。 */
export function parseBatchWords(text: string): string[] {
	const words: string[] = [];
	for (const item of text.split(/[\s,;]+/u)) {
		const word = item.trim();
		if (word && !words.includes(word)) words.push(word);
	}
	return words;
}

export function newBatchWords(text: string, existing: string[]): string[] {
	const existingSet = new Set(existing);
	return parseBatchWords(text).filter((word) => !existingSet.has(word));
}
