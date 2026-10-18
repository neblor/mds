/**
 * SQLite 统计查询（只读）
 *
 * 这里只负责把 SQL 结果映射成 review-types.ts 里的行形状；
 * 「怎么算掌握/薄弱/连续天数」在 bank-stats.ts 的纯函数里，便于单测。
 */
import type { DatabaseSync } from "node:sqlite";
import {
	REVIEW_MODES,
	type AccuracyWindows,
	type BankStatsQuery,
	type CardStatRow,
	type LogDayRow,
	type ModeStatRow,
	type RecentSessionRow,
	type ReviewMode,
	type SessionDayRow,
	type SessionTotals,
	type WordLogRow,
	type WritingWordRow,
} from "./review-types";

function num(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function modeOf(value: unknown): ReviewMode {
	return REVIEW_MODES.includes(value as ReviewMode)
		? (value as ReviewMode)
		: "word";
}

export function createSqliteBankStatsQuery(db: DatabaseSync): BankStatsQuery {
	return {
		cardRows(bankId: string): CardStatRow[] {
			// SAFETY: SELECT 的列与 CardStatRow 一一对应；schema 由 review-schema.ts 固定。
			const rows = db
				.prepare(
					`SELECT word_key, word, due, due_day, state, stability, difficulty,
					        scheduled_days, lapses, last_review
					   FROM cards WHERE bank_id = ?`,
				)
				.all(bankId) as {
				word_key: string;
				word: string;
				due: number;
				due_day: string;
				state: number;
				stability: number;
				difficulty: number;
				scheduled_days: number;
				lapses: number;
				last_review: number | null;
			}[];
			return rows.map((row) => ({
				wordKey: row.word_key,
				word: row.word,
				due: row.due,
				dueDay: row.due_day,
				state: row.state,
				stability: row.stability,
				difficulty: row.difficulty,
				scheduledDays: row.scheduled_days,
				lapses: row.lapses,
				lastReview: row.last_review,
			}));
		},

		activity(bankId: string): {
			logDays: LogDayRow[];
			sessionDays: SessionDayRow[];
		} {
			// SAFETY: day/reviews/correct/elapsed 是 GROUP BY 的结果列。
			const logRows = db
				.prepare(
					`SELECT day AS date, COUNT(*) AS reviews,
					        COALESCE(SUM(correct), 0) AS correct,
					        COALESCE(SUM(elapsed_ms), 0) AS elapsed
					   FROM review_log WHERE bank_id = ?
					  GROUP BY day ORDER BY day`,
				)
				.all(bankId) as {
				date: string;
				reviews: number;
				correct: number;
				elapsed: number;
			}[];
			// SAFETY: 同上，按 session.day 分组；writing 字段用 CASE 聚合。
			const sessionRows = db
				.prepare(
					`SELECT day AS date, COUNT(*) AS sessions,
					        COALESCE(SUM(CASE WHEN gen_mode = 'writing' THEN word_count ELSE 0 END), 0) AS writing_words,
					        COALESCE(SUM(CASE WHEN gen_mode = 'writing' THEN active_ms ELSE 0 END), 0) AS writing_active
					   FROM session WHERE bank_id = ?
					  GROUP BY day ORDER BY day`,
				)
				.all(bankId) as {
				date: string;
				sessions: number;
				writing_words: number;
				writing_active: number;
			}[];
			return {
				logDays: logRows.map((row) => ({
					date: row.date,
					reviews: num(row.reviews),
					correct: num(row.correct),
					elapsedMs: num(row.elapsed),
				})),
				sessionDays: sessionRows.map((row) => ({
					date: row.date,
					sessions: num(row.sessions),
					writingWords: num(row.writing_words),
					writingActiveMs: num(row.writing_active),
				})),
			};
		},

		accuracy(
			bankId: string,
			since7: string,
			since30: string,
		): AccuracyWindows {
			// SAFETY: 所有列都是 SUM/COUNT 聚合结果，至少一行（无记录时全为 0）。
			const row = db
				.prepare(
					`SELECT
					   COALESCE(SUM(CASE WHEN day >= ? THEN correct ELSE 0 END), 0) AS c7,
					   COALESCE(SUM(CASE WHEN day >= ? THEN 1 ELSE 0 END), 0) AS n7,
					   COALESCE(SUM(CASE WHEN day >= ? THEN correct ELSE 0 END), 0) AS c30,
					   COALESCE(SUM(CASE WHEN day >= ? THEN 1 ELSE 0 END), 0) AS n30,
					   COALESCE(SUM(correct), 0) AS call,
					   COUNT(*) AS nall
					 FROM review_log WHERE bank_id = ?`,
				)
				.get(since7, since7, since30, since30, bankId) as {
				c7: number;
				n7: number;
				c30: number;
				n30: number;
				call: number;
				nall: number;
			};
			return {
				last7: { correct: num(row.c7), total: num(row.n7) },
				last30: { correct: num(row.c30), total: num(row.n30) },
				all: { correct: num(row.call), total: num(row.nall) },
			};
		},

		modes(bankId: string, sinceDay: string): ModeStatRow[] {
			// SAFETY: mode 经 modeOf 白名单归一；其余为 GROUP BY 聚合列。
			const rows = db
				.prepare(
					`SELECT mode, COUNT(*) AS reviews,
					        COALESCE(SUM(correct), 0) AS correct,
					        COALESCE(SUM(elapsed_ms), 0) AS elapsed
					   FROM review_log WHERE bank_id = ? AND day >= ?
					  GROUP BY mode`,
				)
				.all(bankId, sinceDay) as {
				mode: string;
				reviews: number;
				correct: number;
				elapsed: number;
			}[];
			return rows.map((row) => ({
				mode: modeOf(row.mode),
				reviews: num(row.reviews),
				correct: num(row.correct),
				elapsedMs: num(row.elapsed),
			}));
		},

		words(bankId: string, sinceDay: string): WordLogRow[] {
			// SAFETY: word_key 分组；wrong30 是条件 SUM，MIN/MAX 由 at 计算。
			const rows = db
				.prepare(
					`SELECT word_key, MAX(word) AS word, COUNT(*) AS seen,
					        COALESCE(SUM(correct), 0) AS correct,
					        COALESCE(SUM(CASE WHEN day >= ? AND correct = 0 THEN 1 ELSE 0 END), 0) AS wrong30,
					        MIN(at) AS first_at, MAX(at) AS last_at
					   FROM review_log WHERE bank_id = ?
					  GROUP BY word_key`,
				)
				.all(sinceDay, bankId) as {
				word_key: string;
				word: string;
				seen: number;
				correct: number;
				wrong30: number;
				first_at: number;
				last_at: number;
			}[];
			return rows.map((row) => ({
				wordKey: row.word_key,
				word: row.word,
				seen: num(row.seen),
				correct: num(row.correct),
				wrong30: num(row.wrong30),
				firstAt: num(row.first_at),
				lastAt: num(row.last_at),
			}));
		},

		writingWords(bankId: string): WritingWordRow[] {
			// SAFETY: session_word 与 session 按 id 关联；只统计书写场次。
			const rows = db
				.prepare(
					`SELECT sw.word_key, MAX(sw.word) AS word, COUNT(*) AS practiced,
					        MAX(s.at) AS last_at
					   FROM session_word sw JOIN session s ON s.id = sw.session_id
					  WHERE sw.bank_id = ? AND s.gen_mode = 'writing'
					  GROUP BY sw.word_key`,
				)
				.all(bankId) as {
				word_key: string;
				word: string;
				practiced: number;
				last_at: number;
			}[];
			return rows.map((row) => ({
				wordKey: row.word_key,
				word: row.word,
				practiced: num(row.practiced),
				lastAt: num(row.last_at),
			}));
		},

		sessionTotals(bankId: string): SessionTotals {
			// SAFETY: COUNT/MIN/MAX 聚合，单行；空库时 MIN/MAX 为 null。
			const row = db
				.prepare(
					`SELECT COUNT(*) AS total, MIN(at) AS first_at, MAX(at) AS last_at
					   FROM session WHERE bank_id = ?`,
				)
				.get(bankId) as {
				total: number;
				first_at: number | null;
				last_at: number | null;
			};
			return {
				total: num(row.total),
				firstAt: row.first_at === null ? null : num(row.first_at),
				lastAt: row.last_at === null ? null : num(row.last_at),
			};
		},

		recentSessions(bankId: string, limit: number): RecentSessionRow[] {
			const size = Math.max(1, Math.min(20, Math.round(limit)));
			// SAFETY: SELECT 的列与 RecentSessionRow 对应；LIMIT 绑定为整数。
			// judged = 本场日志条数（逐题），供「最近练习」的得分分母；
			// review_log_session_idx (bank_id, session_id) 让这个相关子查询走索引。
			const rows = db
				.prepare(
					`SELECT at, gen_mode, content_mode, word_count, correct, active_ms,
					        (SELECT COUNT(*) FROM review_log l
					           WHERE l.bank_id = session.bank_id AND l.session_id = session.id) AS judged
					   FROM session WHERE bank_id = ?
					  ORDER BY at DESC, id DESC LIMIT ?`,
				)
				.all(bankId, size) as {
				at: number;
				gen_mode: string;
				content_mode: string;
				word_count: number;
				judged: number;
				correct: number | null;
				active_ms: number;
			}[];
			return rows.map((row) => ({
				at: num(row.at),
				genMode: row.gen_mode === "writing" ? "writing" : "cyber",
				contentMode: modeOf(row.content_mode),
				wordCount: num(row.word_count),
				judged: num(row.judged),
				correct: row.correct === null ? null : num(row.correct),
				activeMs: num(row.active_ms),
			}));
		},
	};
}
