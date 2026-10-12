/**
 * 复习状态存储（服务端文件）
 *
 * - 卡片状态：<rootDir>/<bankId>.cards.json（原子写，整体覆盖）
 * - 复习日志：<rootDir>/<bankId>.log.jsonl（append-only，只增不改）
 * - 每日汇总：<rootDir>/daily.json（streak 与今日进度的数据源）
 *
 * 字段口径见 plans/wordbank-srs-cloze.md §3 与 FUTURE.md：
 * 这里刻意存得比当前界面需要的多（耗时、队列来源、状态与间隔变化、稳定度/难度），
 * 因为将来的统计图与积分进度全部依赖这些原始数据。
 */
import { join } from "node:path";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import {
	type JsonValue,
	appendJsonl,
	readJsonFile,
	readJsonl,
	writeJsonFileAtomic,
} from "./json-file";
import { isValidBankId } from "./bank-types";

/** 卡片落盘形态：字段由 srs.ts 负责序列化/反序列化，存储层只做 JSON 搬运 */
export type StoredCard = { [key: string]: JsonValue };
export type StoredCards = Record<string, StoredCard>;

export const REVIEW_MODES = ["word", "definition", "chinese", "cloze"] as const;
export type ReviewMode = (typeof REVIEW_MODES)[number];
export const QUEUE_KINDS = ["new", "review", "relearn"] as const;
export type QueueKind = (typeof QUEUE_KINDS)[number];

export interface ReviewLogRecord {
	/** 评分时刻（epoch ms） */
	at: number;
	word: string;
	bankId: string;
	/** ts-fsrs Rating：1 Again / 2 Hard / 3 Good / 4 Easy */
	rating: number;
	correct: boolean;
	/** 问什么 */
	mode: ReviewMode;
	/** 怎么答 */
	genMode: "writing" | "cyber";
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

export interface DailyStat {
	/** 本地时区 YYYY-MM-DD */
	date: string;
	/** 当天目标（「今天默几个」） */
	target: number;
	/** 已完成词数 */
	done: number;
	/** 判定正确的词数 */
	correct: number;
	/** 参与判定的词数 */
	total: number;
	/** 当天累计作答耗时（ms） */
	elapsedMs: number;
}

export interface ReviewStore {
	readonly rootDir: string;
	readCards(bankId: string): StoredCards;
	writeCards(bankId: string, cards: StoredCards): void;
	readLogs(bankId: string): ReviewLogRecord[];
	appendLogs(bankId: string, records: ReviewLogRecord[]): void;
	readDaily(): Record<string, DailyStat>;
	writeDaily(stats: Record<string, DailyStat>): void;
	/** 删除该词表的卡片与日志（删词表时一并清除，避免遗留孤儿数据） */
	removeBankState(bankId: string): void;
}

/**
 * 日志记录 → 普通 JSON 对象。显式逐字段列出（而不是直接断言）：
 * 将来给 ReviewLogRecord 加非 JSON 字段时，这里会编译报错，不会静默丢数据。
 */
function logToJson(record: ReviewLogRecord): { [key: string]: JsonValue } {
	return {
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
}

function isFiniteNumber(value: JsonValue | undefined): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

/** 校验单条日志：字段不全的旧记录直接丢弃（不信任存储内容） */
export function parseLogRecord(value: JsonValue): ReviewLogRecord | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return null;
	}
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
	return {
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
		difficultyAfter: isFiniteNumber(value.difficultyAfter) ? value.difficultyAfter : 0,
	};
}

export function isDailyStat(value: JsonValue | undefined): value is DailyStat & JsonValue {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}
	return (
		typeof value.date === "string" &&
		/^\d{4}-\d{2}-\d{2}$/.test(value.date) &&
		isFiniteNumber(value.target) &&
		isFiniteNumber(value.done) &&
		isFiniteNumber(value.correct) &&
		isFiniteNumber(value.total) &&
		isFiniteNumber(value.elapsedMs)
	);
}

function parseDaily(value: JsonValue | undefined): Record<string, DailyStat> {
	const stats: Record<string, DailyStat> = {};
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return stats;
	}
	// 落盘形状是 { version, days: {...} }；也容忍直接给日期映射，方便手工修数据
	const nested = value.days;
	const source =
		typeof nested === "object" && nested !== null && !Array.isArray(nested)
			? nested
			: value;
	for (const [date, item] of Object.entries(source)) {
		// 日期以 **键** 为准：键不规范直接丢弃（不信内部的 date 字段，防“键与内容打架”）
		if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
		if (!isDailyStat(item)) continue;
		stats[date] = {
			date,
			target: item.target,
			done: item.done,
			correct: item.correct,
			total: item.total,
			elapsedMs: item.elapsedMs,
		};
	}
	return stats;
}

/** 校验卡片文件整体形状；坏文件按空处理（下次写回时自愈） */
function parseCards(value: JsonValue | undefined): StoredCards {
	const cards: StoredCards = {};
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return cards;
	}
	const holder = value.cards;
	if (typeof holder !== "object" || holder === null || Array.isArray(holder)) {
		return cards;
	}
	for (const [word, card] of Object.entries(holder)) {
		if (typeof card !== "object" || card === null || Array.isArray(card)) continue;
		cards[word] = card;
	}
	return cards;
}

export function createReviewStore(rootDir: string): ReviewStore {
	mkdirSync(rootDir, { recursive: true });
	const cardsPath = (bankId: string): string => {
		if (!isValidBankId(bankId)) throw new Error(`非法词库 id：${bankId}`);
		return join(rootDir, `${bankId}.cards.json`);
	};
	const logPath = (bankId: string): string => {
		if (!isValidBankId(bankId)) throw new Error(`非法词库 id：${bankId}`);
		return join(rootDir, `${bankId}.log.jsonl`);
	};
	const dailyPath = join(rootDir, "daily.json");

	return {
		rootDir,

		readCards(bankId: string): StoredCards {
			const path = cardsPath(bankId);
			if (!existsSync(path)) return {};
			return parseCards(readJsonFile(path));
		},

		writeCards(bankId: string, cards: StoredCards): void {
			writeJsonFileAtomic(cardsPath(bankId), {
				version: 1,
				updatedAt: Date.now(),
				cards,
			});
		},

		readLogs(bankId: string): ReviewLogRecord[] {
			const records: ReviewLogRecord[] = [];
			for (const value of readJsonl(logPath(bankId))) {
				const record = parseLogRecord(value);
				if (record) records.push(record);
			}
			return records;
		},

		appendLogs(bankId: string, records: ReviewLogRecord[]): void {
			appendJsonl(logPath(bankId), records.map(logToJson));
		},

		readDaily(): Record<string, DailyStat> {
			return parseDaily(readJsonFile(dailyPath));
		},

		writeDaily(stats: Record<string, DailyStat>): void {			const days: { [key: string]: JsonValue } = {};
			for (const [date, stat] of Object.entries(stats)) {
				days[date] = {
					date: stat.date,
					target: stat.target,
					done: stat.done,
					correct: stat.correct,
					total: stat.total,
					elapsedMs: stat.elapsedMs,
				};
			}
			writeJsonFileAtomic(dailyPath, { version: 1, days });
		},

		removeBankState(bankId: string): void {
			rmSync(cardsPath(bankId), { force: true });
			rmSync(logPath(bankId), { force: true });
		},
	};
}
