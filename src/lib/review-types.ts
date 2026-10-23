/**
 * 复习状态的数据模型与校验（sqlite / legacy 两个 store 共用）
 *
 * 这里只放纯类型与纯解析函数，不碰文件、不碰 SQL；迁移、两个 store、统计查询
 * 都从这里取形状，避免 review-store ↔ review-migrate 相互 import。
 */
import type { JsonValue } from "./json-file";

/** 卡片落盘形态：字段由 srs.ts 负责序列化/反序列化，存储层只做搬运 */
export type StoredCard = { [key: string]: JsonValue };
export type StoredCards = Record<string, StoredCard>;

export const REVIEW_MODES = [
	"word",
	"definition",
	"chinese",
	"sentence",
	"phonetic",
	"cloze",
] as const;
export type ReviewMode = (typeof REVIEW_MODES)[number];

export const QUEUE_KINDS = ["new", "review", "relearn"] as const;
export type QueueKind = (typeof QUEUE_KINDS)[number];

export const GEN_MODES = ["writing", "cyber"] as const;
export type GenMode = (typeof GEN_MODES)[number];

export interface ReviewLogRecord {
	/** 评分时刻（epoch ms） */
	at: number;
	word: string;
	bankId: string;
	/** 该条日志属于哪一场（旧数据迁移后没有） */
	sessionId?: string;
	/** ts-fsrs Rating：1 Again / 2 Hard / 3 Good / 4 Easy */
	rating: number;
	correct: boolean;
	/** 问什么 */
	mode: ReviewMode;
	/** 怎么答 */
	genMode: GenMode;
	/** 本题实际耗时（ms） */
	elapsedMs: number;
	/** 队列来源 */
	queueKind: QueueKind;
	/** 评分前的卡片状态（0 New / 1 Learning / 2 Review / 3 Relearning） */
	stateBefore: number;
	intervalBeforeDays: number;
	intervalAfterDays: number;
	stabilityAfter: number;
	difficultyAfter: number;
}

export interface SessionLogRecord {
	/** 客户端生成的 UUID；结算幂等键 */
	id: string;
	/** 结算时刻（epoch ms） */
	at: number;
	bankId: string;
	genMode: GenMode;
	/** 本场问什么（短句降级为单词轮时仍是 sentence） */
	contentMode: ReviewMode;
	/** 本场目标词（去重后最多 200 个） */
	words: string[];
	/** 赛博：判定正确数；书写：null */
	correct: number | null;
	/** 各轮作答耗时之和 */
	activeMs: number;
	/** 从开始到结算的总时长（含准备/停顿） */
	wallMs: number;
}

/** 今日进度（由 review_log 聚合，不再有 daily.json 缓存） */
export interface DayStats {
	date: string;
	correct: number;
	total: number;
	elapsedMs: number;
}

/* ---------- 统计查询的形状（SQL / 纯计算共用） ---------- */

export interface CardStatRow {
	wordKey: string;
	word: string;
	due: number;
	dueDay: string;
	state: number;
	stability: number;
	difficulty: number;
	scheduledDays: number;
	lapses: number;
	lastReview: number | null;
}

export interface LogDayRow {
	date: string;
	reviews: number;
	correct: number;
	elapsedMs: number;
}

export interface SessionDayRow {
	date: string;
	sessions: number;
	/** 书写场次涉及的词数（赛博不重复计入，日志已经算过） */
	writingWords: number;
	/** 书写场次作答耗时 */
	writingActiveMs: number;
}

export interface AccuracyWindow {
	correct: number;
	total: number;
}

export interface AccuracyWindows {
	last7: AccuracyWindow;
	last30: AccuracyWindow;
	all: AccuracyWindow;
}

export interface ModeStatRow {
	mode: ReviewMode;
	reviews: number;
	correct: number;
	elapsedMs: number;
}

export interface WordLogRow {
	wordKey: string;
	word: string;
	/** 全量判定次数 */
	seen: number;
	/** 全量判定正确数 */
	correct: number;
	/** 近 30 天错误数 */
	wrong30: number;
	firstAt: number;
	lastAt: number;
}

export interface WritingWordRow {
	wordKey: string;
	word: string;
	/** 书写场次出现次数 */
	practiced: number;
	lastAt: number;
}

export interface RecentSessionRow {
	at: number;
	genMode: GenMode;
	contentMode: ReviewMode;
	/** 本场目标牌（去重后词数）；书写场次的热力/使用频率用这个 */
	wordCount: number;
	/**
	 * 本场**作答数**（逐题日志条数）：赛博场次的得分分母。
	 * 组句一轮多个空时 wordCount < judged（而结算页也是按空计分）；书写无判定 → 0。
	 */
	judged: number;
	/** 赛博：判定正确题数；书写：null */
	correct: number | null;
	activeMs: number;
}

export interface SessionTotals {
	total: number;
	firstAt: number | null;
	lastAt: number | null;
}

/**
 * 统计查询接口：SQLite store 实现；兼容模式为 null（统计页 503）。
 * 所有方法只读，按 bank 隔离。
 */
export interface BankStatsQuery {
	cardRows(bankId: string): CardStatRow[];
	activity(bankId: string): {
		logDays: LogDayRow[];
		sessionDays: SessionDayRow[];
	};
	accuracy(bankId: string, since7: string, since30: string): AccuracyWindows;
	modes(bankId: string, sinceDay: string): ModeStatRow[];
	words(bankId: string, sinceDay: string): WordLogRow[];
	writingWords(bankId: string): WritingWordRow[];
	sessionTotals(bankId: string): SessionTotals;
	recentSessions(bankId: string, limit: number): RecentSessionRow[];
}

export interface CommitPayload {
	cards: { key: string; card: StoredCard }[];
	logs: ReviewLogRecord[];
	session: SessionLogRecord | null;
}

export interface ReviewStore {
	readonly mode: "sqlite" | "legacy";
	/** 兼容模式没有 SQL 统计能力 */
	readonly stats: BankStatsQuery | null;
	readCards(bankId: string): StoredCards;
	readLogs(bankId: string): ReviewLogRecord[];
	readSessions(bankId: string): SessionLogRecord[];
	readDayStats(bankId: string, date: string): DayStats;
	/** 一场结算的原子写入；session.id 已存在时返回 duplicate=true 且不重写 */
	commit(bankId: string, payload: CommitPayload): { duplicate: boolean };
	removeBankState(bankId: string): void;
	close(): void;
}

/* ---------- 校验 / 解析 ---------- */

function isFiniteNumber(value: JsonValue | undefined): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function isObject(
	value: JsonValue | undefined,
): value is { [key: string]: JsonValue } {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 单条日志 → JSON。显式逐字段列出：加字段时这里会编译报错，不会静默丢数据 */
export function logToJson(record: ReviewLogRecord): { [key: string]: JsonValue } {
	const json: { [key: string]: JsonValue } = {
		at: record.at,
		word: record.word,
		bankId: record.bankId,
		rating: record.rating,
		correct: record.correct,
		mode: record.mode,
		genMode: record.genMode,
		elapsedMs: record.elapsedMs,
		queueKind: record.queueKind,
		stateBefore: record.stateBefore,
		intervalBeforeDays: record.intervalBeforeDays,
		intervalAfterDays: record.intervalAfterDays,
		stabilityAfter: record.stabilityAfter,
		difficultyAfter: record.difficultyAfter,
	};
	if (record.sessionId) json.sessionId = record.sessionId;
	return json;
}

/** 校验单条日志：字段不全的旧记录直接丢弃（不信任存储内容） */
export function parseLogRecord(value: JsonValue): ReviewLogRecord | null {
	if (!isObject(value)) return null;
	if (
		!isFiniteNumber(value.at) ||
		typeof value.word !== "string" ||
		!value.word.trim() ||
		typeof value.bankId !== "string" ||
		!isFiniteNumber(value.rating) ||
		typeof value.correct !== "boolean"
	) {
		return null;
	}
	const mode = REVIEW_MODES.includes(value.mode as ReviewMode)
		? (value.mode as ReviewMode)
		: "word";
	const queueKind = QUEUE_KINDS.includes(value.queueKind as QueueKind)
		? (value.queueKind as QueueKind)
		: "review";
	const record: ReviewLogRecord = {
		at: value.at,
		word: value.word.trim(),
		bankId: value.bankId,
		rating: Math.min(4, Math.max(1, Math.round(value.rating))),
		correct: value.correct,
		mode,
		genMode: value.genMode === "writing" ? "writing" : "cyber",
		elapsedMs: isFiniteNumber(value.elapsedMs) ? Math.max(0, value.elapsedMs) : 0,
		queueKind,
		stateBefore: isFiniteNumber(value.stateBefore) ? value.stateBefore : 0,
		intervalBeforeDays: isFiniteNumber(value.intervalBeforeDays)
			? Math.max(0, value.intervalBeforeDays)
			: 0,
		intervalAfterDays: isFiniteNumber(value.intervalAfterDays)
			? Math.max(0, value.intervalAfterDays)
			: 0,
		stabilityAfter: isFiniteNumber(value.stabilityAfter) ? value.stabilityAfter : 0,
		difficultyAfter: isFiniteNumber(value.difficultyAfter)
			? value.difficultyAfter
			: 0,
	};
	if (typeof value.sessionId === "string" && value.sessionId.trim()) {
		record.sessionId = value.sessionId.trim();
	}
	return record;
}

/** 卡片文件整体形状校验；坏条目丢弃（下次写回自愈） */
export function parseCards(value: JsonValue | undefined): StoredCards {
	const cards: StoredCards = {};
	if (!isObject(value)) return cards;
	const holder = value.cards;
	if (!isObject(holder)) return cards;
	for (const [word, card] of Object.entries(holder)) {
		if (!isObject(card)) continue;
		cards[word] = card;
	}
	return cards;
}

/** 场次里的词：去空、去重（大小写不敏感）、限长；顺序保留 */
export function normalizeSessionWords(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const words: string[] = [];
	const seen = new Set<string>();
	for (const item of value) {
		if (typeof item !== "string") continue;
		const word = item.trim().slice(0, 80);
		if (!word) continue;
		const key = word.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		words.push(word);
		if (words.length >= 200) break;
	}
	return words;
}

export function sessionToJson(record: SessionLogRecord): {
	[key: string]: JsonValue;
} {
	return {
		id: record.id,
		at: record.at,
		bankId: record.bankId,
		genMode: record.genMode,
		contentMode: record.contentMode,
		words: record.words,
		correct: record.correct,
		activeMs: record.activeMs,
		wallMs: record.wallMs,
	};
}

/**
 * 场次解析。`bankIdOverride` 用于按文件归属（迁移/兼容模式），避免记录内 bankId 打架。
 * id 缺失直接丢弃：场次是幂等键，没有 id 的场次无法安全重放。
 */
export function parseSessionRecord(
	value: JsonValue,
	bankIdOverride?: string,
): SessionLogRecord | null {
	if (!isObject(value)) return null;
	if (typeof value.id !== "string" || !value.id.trim()) return null;
	if (!isFiniteNumber(value.at)) return null;
	const bankId =
		bankIdOverride ??
		(typeof value.bankId === "string" ? value.bankId.trim() : "");
	if (!bankId) return null;
	const words = normalizeSessionWords(value.words);
	const genMode: GenMode =
		value.genMode === "writing" ? "writing" : "cyber";
	const contentMode = REVIEW_MODES.includes(value.contentMode as ReviewMode)
		? (value.contentMode as ReviewMode)
		: "word";
	const rawCorrect = value.correct;
	const correct =
		genMode === "writing"
			? null
			: isFiniteNumber(rawCorrect)
				? Math.min(words.length, Math.max(0, Math.round(rawCorrect)))
				: null;
	const activeMs = isFiniteNumber(value.activeMs)
		? Math.max(0, value.activeMs)
		: 0;
	const rawWall = isFiniteNumber(value.wallMs)
		? Math.max(0, value.wallMs)
		: activeMs;
	return {
		id: value.id.trim().slice(0, 100),
		at: value.at,
		bankId,
		genMode,
		contentMode,
		words,
		correct,
		activeMs,
		wallMs: Math.max(rawWall, activeMs),
	};
}

/** 今日进度空值（readDayStats 无记录时） */
export function emptyDayStats(date: string): DayStats {
	return { date, correct: 0, total: 0, elapsedMs: 0 };
}
