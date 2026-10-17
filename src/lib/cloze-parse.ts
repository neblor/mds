/**
 * 组句（范例组句 / cloze）AI 出题结果的解析与校验（纯逻辑，可单测）
 *
 * 校验口径：**只拦格式，不拦质量**。本地没有模型，判不出题目好不好，所以这里只保证
 * 「能被解析、能跑起来」，题面是否合理一律交给提示词去要求（见 cloze-provider）：
 *   1. 形状：items 是非空数组（≤ 防护上限）；每题 sentences 非空、blanks 是对象数组
 *   2. 占位符 ##n 与 blanks 一一对应：正文里出现过的编号集合 == blanks 的编号集合
 *      （编号不必从 1 连续、同一个编号可以在正文里出现多次——重复词本就该共用一个答案）
 *   3. 答案必须来自候选池（大小写不敏感，归一为候选词原始写法）：池外答案学生选不出来，
 *      属于「跑不了」，这条必须拦
 *
 * 明确放行（不再当错误）的偏差：题数/句数/空数「多了少了」、同一个词填多个空、
 * 一句里出现两三个同词、未挖空的候选词出现在句子里（如候选池里有 I / the 时根本躲不开）、
 * usedWords 缺失或不一致（该字段已不参与校验，只按答案现算）。
 */
export const CLOZE_MAX_ITEMS = 12;
export const CLOZE_MAX_SENTENCES = 8;
export const CLOZE_MAX_BLANKS = 8;
/** 候选池上限（R6：一屏最多 24 个候选词；超出只取前 N 个） */
export const CLOZE_MAX_CANDIDATES = 24;
/** 单句长度上限（防止 AI 返回超长文本撑爆界面） */
export const CLOZE_MAX_SENTENCE_CHARS = 400;

export interface ClozeBlank {
	/** 空编号（与句子里的 ##n 对应） */
	index: number;
	/** 标准答案（已归一为候选词原始写法） */
	answer: string;
}

export interface ClozeItem {
	/** 题目序号（沿用 AI 返回的 id，缺省按顺序补） */
	id: number;
	/** 短文句子（内含 ##n 占位符），正文顺序即作答顺序 */
	sentences: string[];
	/** 本题的空，按正文出现顺序排列 */
	blanks: ClozeBlank[];
	/** 本题答案词（按答案现算去重，兼容旧字段，不参与校验） */
	usedWords: string[];
}

/** 出题结果不符合可识别的格式（原因直接对用户可见） */
export class ClozeParseError extends Error {
	readonly reason: string;

	constructor(reason: string) {
		super(reason);
		this.name = "ClozeParseError";
		this.reason = reason;
	}
}

function fold(text: string): string {
	return text.trim().toLocaleLowerCase("en-US");
}

/** 兼容 {items}/{questions}/裸数组三种形状 */
function itemsOf(raw: unknown): unknown[] {
	if (Array.isArray(raw)) return raw;
	if (raw && typeof raw === "object") {
		const holder = raw as { items?: unknown; questions?: unknown };
		if (Array.isArray(holder.items)) return holder.items;
		if (Array.isArray(holder.questions)) return holder.questions;
	}
	return [];
}

/** 候选词归一表：小写 → 原始写法（同池内大小写不同的重复项视为同一词） */
function candidateIndex(candidates: string[]): Map<string, string> {
	const map = new Map<string, string>();
	for (const candidate of candidates) {
		const word = candidate.trim();
		if (!word) continue;
		const key = fold(word);
		if (!map.has(key)) map.set(key, word);
	}
	return map;
}

/** 把句子里的 ##n 换成对应答案（结果页展示上下文用；未知编号原样保留） */
export function fillClozeSentence(
	sentence: string,
	blanks: { index: number; answer: string }[],
): string {
	return sentence.replace(/##(\d+)/g, (marker, digits: string) => {
		const index = Number(digits);
		const blank = blanks.find((entry) => entry.index === index);
		return blank ? blank.answer : marker;
	});
}

/**
 * 把句子按 ##n 占位符切成「文本段 + 空槽」序列（组句轮渲染用，纯函数）
 * 例："Eat ##1 now." → [{text:"Eat "},{blank:1},{text:" now."}]
 */
export type ClozeSentencePart =
	| { kind: "text"; text: string }
	| { kind: "blank"; index: number };

export function splitClozeSentence(sentence: string): ClozeSentencePart[] {
	const parts: ClozeSentencePart[] = [];
	const pattern = /##(\d+)/g;
	let last = 0;
	let match = pattern.exec(sentence);
	while (match) {
		if (match.index > last) {
			parts.push({ kind: "text", text: sentence.slice(last, match.index) });
		}
		parts.push({ kind: "blank", index: Number(match[1]) });
		last = match.index + match[0].length;
		match = pattern.exec(sentence);
	}
	if (last < sentence.length) {
		parts.push({ kind: "text", text: sentence.slice(last) });
	}
	return parts;
}

/** 该空所在的那一句（已填入答案）；找不到时退回第一句 */
export function sentenceOfBlank(
	sentences: string[],
	blanks: { index: number; answer: string }[],
	index: number,
): string {
	const marker = new RegExp(`##${index}(?![0-9])`);
	const sentence = sentences.find((entry) => marker.test(entry));
	return fillClozeSentence(sentence ?? sentences[0] ?? "", blanks);
}

/** 一题里的句子：非空即可（句数多少不是错误，只防「一句都没有」和超长文本） */
function parseSentences(raw: unknown, where: string): string[] {
	if (!Array.isArray(raw)) {
		throw new ClozeParseError(`${where}缺少 sentences 数组`);
	}
	const sentences = raw
		.map((value) => (typeof value === "string" ? value.trim() : ""))
		.filter((value) => value.length > 0);
	if (sentences.length === 0) {
		throw new ClozeParseError(`${where}没有非空句子`);
	}
	if (sentences.length > CLOZE_MAX_SENTENCES) {
		throw new ClozeParseError(
			`${where}有 ${sentences.length} 句，超过防护上限 ${CLOZE_MAX_SENTENCES} 句`,
		);
	}
	for (const sentence of sentences) {
		if (sentence.length > CLOZE_MAX_SENTENCE_CHARS) {
			throw new ClozeParseError(
				`${where}有句子超过 ${CLOZE_MAX_SENTENCE_CHARS} 字符`,
			);
		}
	}
	return sentences;
}

/** 正文里出现过的空编号（按首次出现顺序去重；同一个编号重复出现按一个算） */
function markerIndexes(sentences: string[]): number[] {
	const indexes: number[] = [];
	for (const match of sentences.join("\n").matchAll(/##(\d+)/g)) {
		const index = Number(match[1]);
		if (!indexes.includes(index)) indexes.push(index);
	}
	return indexes;
}

/**
 * 解析本题的空：编号与答案都要合法，且与正文里的 ##n 恰好一一对应。
 * 顺序按正文首次出现排列（决定「自动跳到下一个空」的方向）。
 */
function parseBlanks(
	raw: unknown,
	where: string,
	markers: number[],
	pool: Map<string, string>,
): ClozeBlank[] {
	if (!Array.isArray(raw)) {
		throw new ClozeParseError(`${where}缺少 blanks 数组`);
	}
	const blanks = raw.map((entry, position) => {
		if (!entry || typeof entry !== "object") {
			throw new ClozeParseError(`${where}第 ${position + 1} 个空不是对象`);
		}
		const holder = entry as { index?: unknown; answer?: unknown };
		const index =
			typeof holder.index === "number" ? holder.index : Number(holder.index);
		if (!Number.isInteger(index) || index < 1) {
			throw new ClozeParseError(
				`${where}的空编号「${String(holder.index)}」不是正整数`,
			);
		}
		const answerRaw = typeof holder.answer === "string" ? holder.answer.trim() : "";
		if (!answerRaw) {
			throw new ClozeParseError(`${where}第 ${index} 个空没有答案`);
		}
		const canonical = pool.get(fold(answerRaw));
		if (!canonical) {
			throw new ClozeParseError(`${where}的答案「${answerRaw}」不在候选词里`);
		}
		return { index, answer: canonical };
	});

	const seen = new Set<number>();
	for (const blank of blanks) {
		if (seen.has(blank.index)) {
			throw new ClozeParseError(`${where}的同一个空编号给了多个答案`);
		}
		seen.add(blank.index);
	}
	for (const index of markers) {
		if (!seen.has(index)) {
			throw new ClozeParseError(`${where}的 ##${index} 没有对应答案`);
		}
	}
	for (const blank of blanks) {
		if (!markers.includes(blank.index)) {
			throw new ClozeParseError(
				`${where}的答案编号 ${blank.index} 在短文里没有对应空`,
			);
		}
	}
	return [...blanks].sort(
		(a, b) => markers.indexOf(a.index) - markers.indexOf(b.index),
	);
}

/**
 * 解析并校验 AI 出题结果（只校验可跑性，不评价题面质量）。
 * @param raw 已 JSON.parse 的响应内容（也兼容裸数组）
 * @param candidates 本场候选词（≤24，出题只用它们）
 */
export function parseClozeItems(raw: unknown, candidates: string[]): ClozeItem[] {
	const pool = candidateIndex(candidates);
	if (pool.size === 0) {
		throw new ClozeParseError("候选词为空，无法出题");
	}
	const rawItems = itemsOf(raw);
	if (rawItems.length === 0) {
		throw new ClozeParseError("AI 没有返回任何题目");
	}
	if (rawItems.length > CLOZE_MAX_ITEMS) {
		throw new ClozeParseError(
			`AI 返回了 ${rawItems.length} 道题，超过防护上限 ${CLOZE_MAX_ITEMS} 道`,
		);
	}

	const items: ClozeItem[] = [];
	for (const [position, rawItem] of rawItems.entries()) {
		const where = `第 ${position + 1} 题`;
		if (!rawItem || typeof rawItem !== "object") {
			throw new ClozeParseError(`${where}不是对象`);
		}
		const holder = rawItem as {
			id?: unknown;
			sentences?: unknown;
			blanks?: unknown;
		};
		const sentences = parseSentences(holder.sentences, where);
		const markers = markerIndexes(sentences);
		if (markers.length === 0) {
			throw new ClozeParseError(`${where}没有 ##n 空占位符`);
		}
		if (markers.length > CLOZE_MAX_BLANKS) {
			throw new ClozeParseError(
				`${where}有 ${markers.length} 个空，超过防护上限 ${CLOZE_MAX_BLANKS} 个`,
			);
		}
		const blanks = parseBlanks(holder.blanks, where, markers, pool);
		const usedWords = blanks
			.map((blank) => blank.answer)
			.filter((word, i, all) => all.indexOf(word) === i);
		const id =
			typeof holder.id === "number" && Number.isFinite(holder.id)
				? holder.id
				: position + 1;
		items.push({ id, sentences, blanks, usedWords });
	}
	return items;
}
