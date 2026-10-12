/**
 * 词库解析与归一（纯逻辑，可单测）
 *
 * 设计原则：**容忍脏数据，绝不因一条坏记录整库失败**。
 * 所有外部输入（内置/远端 JSON、用户导入文本、ECDICT CSV）都先过归一，
 * 能修的修（去空白、去重、限长），不能修的丢弃并计数。
 */
import type { BankEntry, ManifestEntry, WordBank } from "./bank-types";
import { isValidBankId } from "./bank-types";

/** 单词长度上限（防超长垃圾；正常词组远短于此） */
export const MAX_WORD_LENGTH = 80;
/** 释义长度上限（结果页单行展示，不需要更长） */
export const MAX_DEFINITION_LENGTH = 400;
/** 单个词库词条数上限 */
export const MAX_BANK_ENTRIES = 50_000;
/** 标签长度/个数上限 */
const MAX_TAGS = 8;
const MAX_TAG_LENGTH = 16;

/** 去重用键：小写 + 折叠内部空白（"Give  Up" 与 "give up" 视为同一个词） */
export function wordKey(word: string): string {
	return word.trim().toLowerCase().replace(/\s+/gu, " ");
}

/** 归一单词：去首尾空白 + 折叠内部空白；非法/超长返回 null */
export function normalizeWord(raw: unknown): string | null {
	if (typeof raw !== "string") return null;
	const word = raw.trim().replace(/\s+/gu, " ");
	if (!word || word.length > MAX_WORD_LENGTH) return null;
	// 控制字符一律拒绝（它们会污染文件名与界面）
	if (/[\u0000-\u001f\u007f]/u.test(word)) return null;
	return word;
}

function normalizeText(raw: unknown, max: number): string | undefined {
	if (typeof raw !== "string") return undefined;
	const text = raw.trim();
	if (!text) return undefined;
	return text.length > max ? text.slice(0, max) : text;
}

function normalizeFrq(raw: unknown): number | undefined {
	const value =
		typeof raw === "number"
			? raw
			: typeof raw === "string" && raw.trim()
				? Number(raw)
				: Number.NaN;
	if (!Number.isFinite(value) || value <= 0) return undefined;
	return Math.floor(value);
}

function normalizeTags(raw: unknown): string[] | undefined {
	const list = Array.isArray(raw)
		? raw
		: typeof raw === "string"
			? raw.split(/[\s,;]+/u)
			: [];
	const tags: string[] = [];
	for (const item of list) {
		if (typeof item !== "string") continue;
		const tag = item.trim().toLowerCase();
		if (!tag || tag.length > MAX_TAG_LENGTH || tags.includes(tag)) continue;
		tags.push(tag);
		if (tags.length >= MAX_TAGS) break;
	}
	return tags.length > 0 ? tags : undefined;
}

/** 归一单条词条；非法返回 null */
export function normalizeEntry(raw: unknown): BankEntry | null {
	if (typeof raw === "string") {
		const word = normalizeWord(raw);
		return word ? { word } : null;
	}
	if (typeof raw !== "object" || raw === null) return null;
	const source = raw as Record<string, unknown>;
	// 兼容 {name/trans} 这类常见词库格式（qwerty-learner 风格的数据也吃得下）
	const word = normalizeWord(source.word ?? source.name ?? source.w ?? "");
	if (!word) return null;
	const entry: BankEntry = { word };
	const definition = normalizeText(
		source.definition ?? source.d ?? source.trans,
		MAX_DEFINITION_LENGTH,
	);
	if (definition) entry.definition = definition;
	const translation = normalizeText(source.translation, MAX_DEFINITION_LENGTH);
	if (translation) entry.translation = translation;
	const phonetic = normalizeText(source.phonetic ?? source.usphone, 64);
	if (phonetic) entry.phonetic = phonetic;
	const frq = normalizeFrq(source.frq ?? source.frequency);
	if (frq !== undefined) entry.frq = frq;
	const tags = normalizeTags(source.tags ?? source.tag);
	if (tags) entry.tags = tags;
	return entry;
}

/** 把任意形状的 payload 摊平成候选词条数组（数组 / {entries} / {definitions:map} / 字符串） */
function candidatesOf(raw: unknown): unknown[] {
	if (Array.isArray(raw)) return raw;
	if (typeof raw === "string") return raw.split(/\r?\n/u);
	if (typeof raw !== "object" || raw === null) return [];
	const holder = raw as Record<string, unknown>;
	for (const key of ["entries", "words", "items"]) {
		if (Array.isArray(holder[key])) return holder[key] as unknown[];
	}
	if (holder.entries && typeof holder.entries === "object") {
		return Object.entries(holder.entries as Record<string, unknown>).map(
			([word, value]) =>
				typeof value === "string" ? { word, definition: value } : { word, ...(value as object) },
		);
	}
	return [];
}

export interface ParseEntriesResult {
	entries: BankEntry[];
	/** 被丢弃的坏记录数（超长、非字符串、缺词等） */
	invalid: number;
	/** 因重复（大小写/空白差异）被合并掉的记录数 */
	duplicated: number;
}

/**
 * 解析词条数组：归一 + 按 wordKey 去重（保留首次出现的写法）+ 截断到上限。
 * 输入为空或形状不认识时返回空数组而不是抛错。
 */
export function parseEntries(raw: unknown): ParseEntriesResult {
	const seen = new Set<string>();
	const entries: BankEntry[] = [];
	let invalid = 0;
	let duplicated = 0;
	for (const candidate of candidatesOf(raw)) {
		const entry = normalizeEntry(candidate);
		if (!entry) {
			invalid++;
			continue;
		}
		const key = wordKey(entry.word);
		if (seen.has(key)) {
			duplicated++;
			continue;
		}
		seen.add(key);
		entries.push(entry);
		if (entries.length >= MAX_BANK_ENTRIES) break;
	}
	return { entries, invalid, duplicated };
}

export interface MergeResult {
	entries: BankEntry[];
	added: number;
	duplicated: number;
	/** 因超出上限被丢弃的条数 */
	overflow: number;
}

/** 合并词条到已有词库（大小写不敏感去重，保留已有条目与其顺序，新词追加在后） */
export function mergeEntries(
	existing: BankEntry[],
	incoming: BankEntry[],
	limit = MAX_BANK_ENTRIES,
): MergeResult {
	const seen = new Set(existing.map((entry) => wordKey(entry.word)));
	const entries = [...existing];
	let added = 0;
	let duplicated = 0;
	let overflow = 0;
	for (const entry of incoming) {
		const key = wordKey(entry.word);
		if (seen.has(key)) {
			duplicated++;
			continue;
		}
		if (entries.length >= limit) {
			overflow++;
			continue;
		}
		seen.add(key);
		entries.push(entry);
		added++;
	}
	return { entries, added, duplicated, overflow };
}

/** 从词库里删词（大小写不敏感） */
export function removeWords(
	entries: BankEntry[],
	words: string[],
): { entries: BankEntry[]; removed: number } {
	const drop = new Set(words.map(wordKey));
	const kept = entries.filter((entry) => !drop.has(wordKey(entry.word)));
	return { entries: kept, removed: entries.length - kept.length };
}

/**
 * 导入文本 → 词条：每行一条，支持 `word` / `word,释义` / `word<Tab>释义`；
 * 空行跳过；同一批内大小写不敏感去重。
 */
export function parseImportedText(text: unknown): ParseEntriesResult {
	if (typeof text !== "string") return { entries: [], invalid: 0, duplicated: 0 };
	const rows: unknown[] = [];
	for (const line of text.split(/\r?\n/u)) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		const match = trimmed.match(/^(.*?)(?:\t|,)(.*)$/u);
		if (!match) {
			rows.push(trimmed);
			continue;
		}
		const word = match[1].trim();
		const definition = match[2].trim();
		rows.push(definition ? { word, definition } : word);
	}
	return parseEntries(rows);
}

/* ---------------- 词库文件与清单的形状校验 ---------------- */

/** 校验并归一一个词库文件；形状不对返回 null（调用方按「跳过该库」处理） */
export function parseBankFile(
	raw: unknown,
	fallbackId: string,
): WordBank | null {
	if (typeof raw !== "object" || raw === null) return null;
	const holder = raw as Record<string, unknown>;
	const id = isValidBankId(holder.id) ? (holder.id as string) : fallbackId;
	if (!isValidBankId(id)) return null;
	const name =
		typeof holder.name === "string" && holder.name.trim()
			? holder.name.trim().slice(0, 60)
			: id;
	const source =
		holder.source === "builtin" ||
		holder.source === "remote" ||
		holder.source === "custom"
			? holder.source
			: "custom";
	const { entries } = parseEntries(holder.entries ?? holder.words);
	const version =
		typeof holder.version === "number" && Number.isFinite(holder.version)
			? Math.max(1, Math.floor(holder.version))
			: 1;
	const createdAt =
		typeof holder.createdAt === "number" && Number.isFinite(holder.createdAt)
			? holder.createdAt
			: 0;
	const updatedAt =
		typeof holder.updatedAt === "number" && Number.isFinite(holder.updatedAt)
			? holder.updatedAt
			: createdAt;
	const note =
		typeof holder.note === "string" && holder.note.trim()
			? holder.note.trim().slice(0, 200)
			: undefined;
	const bank: WordBank = {
		id,
		name,
		source,
		version,
		entries,
		createdAt,
		updatedAt,
	};
	if (note) bank.note = note;
	return bank;
}

/** 校验并归一在线清单；形状不对返回 null */
export function parseManifest(raw: unknown): ManifestEntry[] | null {
	if (typeof raw !== "object" || raw === null) return null;
	const holder = raw as Record<string, unknown>;
	const list = Array.isArray(holder.banks)
		? holder.banks
		: Array.isArray(raw)
			? (raw as unknown[])
			: null;
	if (!list) return null;
	const banks: ManifestEntry[] = [];
	for (const item of list) {
		if (typeof item !== "object" || item === null) continue;
		const entry = item as Record<string, unknown>;
		if (!isValidBankId(entry.id)) continue;
		if (typeof entry.url !== "string" || !entry.url.trim()) continue;
		const count =
			typeof entry.count === "number" && Number.isFinite(entry.count)
				? Math.max(0, Math.floor(entry.count))
				: 0;
		const version =
			typeof entry.version === "number" && Number.isFinite(entry.version)
				? Math.max(1, Math.floor(entry.version))
				: 1;
		const name =
			typeof entry.name === "string" && entry.name.trim()
				? entry.name.trim().slice(0, 60)
				: (entry.id as string);
		const manifestEntry: ManifestEntry = {
			id: entry.id as string,
			name,
			count,
			version,
			url: entry.url.trim(),
		};
		if (entry.bundled === true) manifestEntry.bundled = true;
		if (typeof entry.description === "string" && entry.description.trim()) {
			manifestEntry.description = entry.description.trim().slice(0, 200);
		}
		if (typeof entry.license === "string" && entry.license.trim()) {
			manifestEntry.license = entry.license.trim().slice(0, 60);
		}
		banks.push(manifestEntry);
	}
	return banks;
}

/* ---------------- CSV（ECDICT 构建脚本与用户导入共用） ---------------- */

/**
 * 极简但正确的 CSV 解析：支持双引号包裹、字段内逗号/换行、`""` 转义、CRLF。
 * 只用于本项目会遇到的简单 CSV（ECDICT / 用户导出），不追求 RFC 4180 全量特性。
 */
export function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = "";
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if (quoted) {
			if (char === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i++;
				} else {
					quoted = false;
				}
			} else {
				field += char;
			}
			continue;
		}
		if (char === '"') {
			quoted = true;
		} else if (char === ",") {
			row.push(field);
			field = "";
		} else if (char === "\n") {
			row.push(field);
			rows.push(row);
			row = [];
			field = "";
		} else if (char === "\r") {
			// CRLF / CR 都按换行处理
			if (text[i + 1] !== "\n") {
				row.push(field);
				rows.push(row);
				row = [];
				field = "";
			}
		} else {
			field += char;
		}
	}
	if (field || row.length > 0) {
		row.push(field);
		rows.push(row);
	}
	return rows;
}

/** 首行当表头，其余行进 { 列名: 值 }；列数不足补空串，多余列忽略 */
export function csvRecords(rows: string[][]): {
	header: string[];
	records: Record<string, string>[];
} {
	if (rows.length === 0) return { header: [], records: [] };
	const header = rows[0].map((cell) => cell.trim());
	const records: Record<string, string>[] = [];
	for (const row of rows.slice(1)) {
		if (row.every((cell) => !cell.trim())) continue;
		const record: Record<string, string> = {};
		for (const [index, column] of header.entries()) {
			record[column] = (row[index] ?? "").trim();
		}
		records.push(record);
	}
	return { header, records };
}

/** ECDICT 行 → 词条（只取本项目要用的列；definition 取第一行释义） */
export function ecdictRowToEntry(record: Record<string, string>): BankEntry | null {
	const word = normalizeWord(record.word ?? "");
	if (!word) return null;
	const entry: BankEntry = { word };
	const definition = normalizeText(
		(record.definition ?? "").split("\n")[0],
		MAX_DEFINITION_LENGTH,
	);
	if (definition) entry.definition = definition;
	const translation = normalizeText(
		(record.translation ?? "").split("\n")[0],
		MAX_DEFINITION_LENGTH,
	);
	if (translation) entry.translation = translation;
	const phonetic = normalizeText(record.phonetic, 64);
	if (phonetic) entry.phonetic = phonetic;
	// ECDICT 的 frq 缺失时用 0 占位，所以 0 要能回落到 bnc（词频序号越大越低频，但总比没有好）
	const frq = normalizeFrq(record.frq) ?? normalizeFrq(record.bnc);
	if (frq !== undefined) entry.frq = frq;
	const tags = normalizeTags(record.tag);
	if (tags) entry.tags = tags;
	return entry;
}
