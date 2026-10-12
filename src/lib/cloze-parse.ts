/**
 * 组句（范例组句 / cloze）AI 出题结果的解析与校验（纯逻辑，可单测）
 *
 * 与 SYSTEM_PROMPT 一致的契约：
 *   { "items": [ { "id": 1, "sentences": ["…##1…", "…##2…"],
 *                  "blanks": [{ "index": 1, "answer": "apple" }],
 *                  "usedWords": ["apple"] } ] }
 *
 * 校验口径（任一不满足即抛 ClozeParseError；准备阶段按「AI 当前不可用」结束，不降级）：
 *   1. 是 1–6 道题，每题 2–3 句非空句子
 *   2. 每题 2–4 个空；占位符 `##1..##n` 恰好各出现一次，与 blanks 一一对应
 *   3. 答案必须来自候选池（大小写不敏感，归一为候选词原始写法），usedWords 与答案一致
 *   4. 全场答案词去重后 ≤ 16（R6：一屏最多考到 16 个词）
 *   5. 短文里出现的候选词必须就是**本题的空答案**——未挖空的候选词出现在句子里等于送答案
 */
export const CLOZE_MAX_ITEMS = 6;
export const CLOZE_SENTENCE_MIN = 2;
export const CLOZE_SENTENCE_MAX = 3;
export const CLOZE_BLANK_MIN = 2;
export const CLOZE_BLANK_MAX = 4;
/** 全场答案词去重上限（R6：候选 ≤24、实际考到 ≤16） */
export const CLOZE_MAX_ANSWERS = 16;
/** 候选池上限（R6：一屏最多 24 个候选词；超出只取前 N 个） */
export const CLOZE_MAX_CANDIDATES = 24;
/** 单句长度上限（防止 AI 返回超长文本撑爆界面） */
export const CLOZE_MAX_SENTENCE_CHARS = 300;

export interface ClozeBlank {
	/** 空编号（1 起，与句子里的 ##n 对应） */
	index: number;
	/** 标准答案（已归一为候选词原始写法） */
	answer: string;
}

export interface ClozeItem {
	/** 题目序号（沿用 AI 返回的 id，缺省按顺序补） */
	id: number;
	/** 2–3 句短文，内含 ##n 占位符 */
	sentences: string[];
	blanks: ClozeBlank[];
	/** 本题答案词（与 blanks 去重后一致） */
	usedWords: string[];
}

/** 出题结果不符合契约（原因直接对用户可见） */
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

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 文本里是否出现该词（词边界匹配，大小写不敏感；词组按整体匹配，apples 不算 apple） */
export function textContainsWord(text: string, word: string): boolean {
	if (!word.trim()) return false;
	const pattern = new RegExp(`(^|[^A-Za-z])${escapeRegExp(word.trim())}([^A-Za-z]|$)`, "i");
	return pattern.test(text);
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

function parseSentences(raw: unknown, where: string): string[] {
	if (!Array.isArray(raw)) {
		throw new ClozeParseError(`${where}缺少 sentences 数组`);
	}
	const sentences = raw
		.map((value) => (typeof value === "string" ? value.trim() : ""))
		.filter((value) => value.length > 0);
	if (
		sentences.length < CLOZE_SENTENCE_MIN ||
		sentences.length > CLOZE_SENTENCE_MAX
	) {
		throw new ClozeParseError(
			`${where}的句子数为 ${sentences.length}，要求 ${CLOZE_SENTENCE_MIN}–${CLOZE_SENTENCE_MAX} 句`,
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

/** 占位符 ##n 必须恰好覆盖 1..n 且各一次；返回空个数 */
function parsePlaceholders(sentences: string[], where: string): number {
	const indices = [...sentences.join("\n").matchAll(/##(\d+)/g)].map((match) =>
		Number(match[1]),
	);
	const count = indices.length;
	if (count < CLOZE_BLANK_MIN || count > CLOZE_BLANK_MAX) {
		throw new ClozeParseError(
			`${where}有 ${count} 个空，要求 ${CLOZE_BLANK_MIN}–${CLOZE_BLANK_MAX} 个`,
		);
	}
	const seen = new Set<number>();
	for (const index of indices) {
		if (!Number.isInteger(index) || index < 1 || index > count || seen.has(index)) {
			throw new ClozeParseError(`${where}的空占位符不是 ##1..##${count} 各一次`);
		}
		seen.add(index);
	}
	return count;
}

function parseBlanks(
	raw: unknown,
	where: string,
	blankCount: number,
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
		if (!Number.isInteger(index) || index < 1 || index > blankCount) {
			throw new ClozeParseError(
				`${where}的空编号「${String(holder.index)}」超出 1..${blankCount}`,
			);
		}
		const answerRaw = typeof holder.answer === "string" ? holder.answer.trim() : "";
		if (!answerRaw) {
			throw new ClozeParseError(`${where}第 ${index} 个空没有答案`);
		}
		const canonical = pool.get(fold(answerRaw));
		if (!canonical) {
			throw new ClozeParseError(
				`${where}的答案「${answerRaw}」不在候选词里`,
			);
		}
		return { index, answer: canonical };
	});
	if (blanks.length !== blankCount) {
		throw new ClozeParseError(
			`${where}的空数量（${blanks.length}）与占位符（${blankCount}）不一致`,
		);
	}
	if (new Set(blanks.map((blank) => blank.index)).size !== blankCount) {
		throw new ClozeParseError(`${where}的空编号有重复`);
	}
	return blanks;
}

function parseUsedWords(raw: unknown, where: string, blanks: ClozeBlank[]): string[] {
	const answers = new Set(blanks.map((blank) => fold(blank.answer)));
	const used = (Array.isArray(raw) ? raw : []).map((value) =>
		typeof value === "string" ? fold(value) : "",
	);
	if (
		used.length !== answers.size ||
		new Set(used).size !== used.length ||
		used.some((word) => !answers.has(word))
	) {
		throw new ClozeParseError(`${where}的 usedWords 与实际答案不一致`);
	}
	return blanks.map((blank) => blank.answer).filter((word, i, all) => all.indexOf(word) === i);
}

/** 未挖空的候选词不得出现在本题短文里（出现即等于送答案） */
function assertNoLeakedCandidates(
	sentences: string[],
	blanks: ClozeBlank[],
	pool: Map<string, string>,
	where: string,
): void {
	const text = sentences.join("\n").replace(/##\d+/g, " ");
	const answers = new Set(blanks.map((blank) => fold(blank.answer)));
	for (const [key, word] of pool) {
		if (answers.has(key)) continue;
		if (textContainsWord(text, word)) {
			throw new ClozeParseError(
				`${where}的短文里出现了没被挖空的候选词「${word}」`,
			);
		}
	}
}

/**
 * 解析并校验 AI 出题结果。
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
			`AI 返回了 ${rawItems.length} 道题，超过上限 ${CLOZE_MAX_ITEMS} 道`,
		);
	}

	const items: ClozeItem[] = [];
	const answerForms = new Map<string, string>();
	for (const [position, rawItem] of rawItems.entries()) {
		const where = `第 ${position + 1} 题`;
		if (!rawItem || typeof rawItem !== "object") {
			throw new ClozeParseError(`${where}不是对象`);
		}
		const holder = rawItem as {
			id?: unknown;
			sentences?: unknown;
			blanks?: unknown;
			usedWords?: unknown;
		};
		const sentences = parseSentences(holder.sentences, where);
		const blankCount = parsePlaceholders(sentences, where);
		const blanks = parseBlanks(holder.blanks, where, blankCount, pool).sort(
			(a, b) => a.index - b.index,
		);
		const usedWords = parseUsedWords(holder.usedWords, where, blanks);
		assertNoLeakedCandidates(sentences, blanks, pool, where);
		for (const blank of blanks) {
			answerForms.set(fold(blank.answer), blank.answer);
		}
		if (answerForms.size > CLOZE_MAX_ANSWERS) {
			throw new ClozeParseError(
				`全场答案词去重后有 ${answerForms.size} 个，超过上限 ${CLOZE_MAX_ANSWERS} 个`,
			);
		}
		const id =
			typeof holder.id === "number" && Number.isFinite(holder.id)
				? holder.id
				: position + 1;
		items.push({ id, sentences, blanks, usedWords });
	}
	return items;
}
