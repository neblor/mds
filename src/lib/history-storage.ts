/**
 * 默写历史 localStorage 持久化
 *
 * 书写与赛博模式都记录（书写无批改，条目仅作对照回看）。
 * 条目在记录时已烘入判定结果（含 AI 批改覆盖与降级说明），回看不依赖现场状态。
 * 读取时逐条校验形状并重算计数，损坏条目直接丢弃；上限 HISTORY_MAX 条。
 * 老数据（无 mode 字段）兼容视为 cyber。
 */
import { correctCount, type ResultField, type ResultRow } from "./results";
import { isContentMode, type ContentMode } from "./state";

export const HISTORY_STORAGE_KEY = "mds.history.v1";
export const HISTORY_MAX = 5;
export type HistoryMode = "writing" | "cyber";

export interface HistoryEntry {
	id: string;
	/** 完成时间（epoch ms），同时作为 id 来源 */
	finishedAt: number;
	/** 默写方式：书写（无评分）/ 赛博（有评分）；老数据缺省视为 cyber */
	mode: HistoryMode;
	contentMode: ContentMode;
	/** 冗余汇总（读取时按 rows 重算，不信任存储值） */
	correctCount: number;
	wordCount: number;
	/** 当场 AI 批改来源说明（失败/中止降级提示），无则 null */
	gradeNote: string | null;
	rows: ResultRow[];
}

const FIELD_KINDS: readonly ResultField["kind"][] = [
	"word",
	"definition",
	"chinese",
];

function normalizeField(value: unknown): ResultField | null {
	if (typeof value !== "object" || value === null) return null;
	const f = value as Record<string, unknown>;
	if (!FIELD_KINDS.includes(f.kind as ResultField["kind"])) return null;
	if (typeof f.expected !== "string") return null;
	if (typeof f.graded !== "boolean") return null;
	const field: ResultField = {
		kind: f.kind as ResultField["kind"],
		expected: f.expected,
		graded: f.graded,
	};
	if (typeof f.userValue === "string") field.userValue = f.userValue;
	if (typeof f.correct === "boolean") field.correct = f.correct;
	if (typeof f.note === "string") field.note = f.note;
	return field;
}

function normalizeRow(value: unknown): ResultRow | null {
	if (typeof value !== "object" || value === null) return null;
	const r = value as Record<string, unknown>;
	if (typeof r.word !== "string" || !r.word.trim()) return null;
	if (!Array.isArray(r.fields)) return null;
	const fields = r.fields
		.map(normalizeField)
		.filter((f): f is ResultField => f !== null);
	return {
		word: r.word,
		audioName: typeof r.audioName === "string" ? r.audioName : "",
		...(typeof r.context === "string" && r.context ? { context: r.context } : {}),
		fields,
	};
}

function normalizeEntry(value: unknown): HistoryEntry | null {
	if (typeof value !== "object" || value === null) return null;
	const e = value as Record<string, unknown>;
	if (typeof e.finishedAt !== "number" || !Number.isFinite(e.finishedAt))
		return null;
	if (!isContentMode(e.contentMode)) return null;
	if (!Array.isArray(e.rows)) return null;
	const rows = e.rows
		.map(normalizeRow)
		.filter((r): r is ResultRow => r !== null);
	// 一场默写至少有一个有效结果行，否则视为损坏条目
	if (rows.length === 0) return null;
	const mode: HistoryMode = e.mode === "writing" ? "writing" : "cyber";
	return {
		id: typeof e.id === "string" && e.id ? e.id : `${e.finishedAt}`,
		finishedAt: e.finishedAt,
		mode,
		contentMode: e.contentMode as ContentMode,
		correctCount: correctCount(rows),
		wordCount: rows.length,
		gradeNote: typeof e.gradeNote === "string" ? e.gradeNote : null,
		rows,
	};
}

/** 校验并规整历史列表：丢弃损坏条目，按时间倒序，截断至上限 */
export function normalizeHistory(value: unknown): HistoryEntry[] {
	if (!Array.isArray(value)) return [];
	return value
		.map(normalizeEntry)
		.filter((e): e is HistoryEntry => e !== null)
		.sort((a, b) => b.finishedAt - a.finishedAt)
		.slice(0, HISTORY_MAX);
}

export function loadHistory(): HistoryEntry[] {
	if (typeof localStorage === "undefined") return [];
	try {
		const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
		return raw ? normalizeHistory(JSON.parse(raw)) : [];
	} catch {
		return [];
	}
}

export function saveHistory(entries: HistoryEntry[]): void {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(entries));
	} catch {
		// localStorage 不可用或达到配额时保持现状（历史仅是附加体验）
	}
}

/** 新纪录置顶并截断至上限；返回写入后的最新列表 */
export function appendHistory(entry: HistoryEntry): HistoryEntry[] {
	const next = normalizeHistory([entry, ...loadHistory()]);
	saveHistory(next);
	return next;
}

/** 由结果行构建历史条目（纯函数，便于单测与编排层复用） */
export function buildHistoryEntry(args: {
	rows: ResultRow[];
	mode: HistoryMode;
	contentMode: ContentMode;
	finishedAt: number;
	gradeNote: string | null;
}): HistoryEntry {
	return {
		id: `${args.finishedAt}`,
		finishedAt: args.finishedAt,
		mode: args.mode,
		contentMode: args.contentMode,
		correctCount: correctCount(args.rows),
		wordCount: args.rows.length,
		gradeNote: args.gradeNote,
		rows: args.rows,
	};
}
