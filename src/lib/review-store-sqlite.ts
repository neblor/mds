/**
 * SQLite 版复习状态存储（正常路径）
 *
 * - 一场结算 = 一个事务：卡片 upsert + 日志批量插入 + 场次 + session_word
 * - 场次 id 作为幂等键：已存在则整场不重写
 * - 读卡片时还原成 srs.ts 认识的 StoredCard 形状，队列/统计逻辑不需要知道 SQL
 */
import type { DatabaseSync } from "node:sqlite";
import { isValidBankId } from "./bank-types";
import { wordKey } from "./bank-parse";
import { localDateKey } from "./day";
import { createSqliteBankStatsQuery } from "./review-stats-query";
import type {
	CommitPayload,
	DayStats,
	ReviewLogRecord,
	ReviewStore,
	SessionLogRecord,
	StoredCard,
	StoredCards,
} from "./review-types";

interface CardDbRow {
	bank_id: string;
	word_key: string;
	word: string;
	due: number;
	due_day: string;
	state: number;
	stability: number;
	difficulty: number;
	elapsed_days: number;
	scheduled_days: number;
	learning_steps: number;
	reps: number;
	lapses: number;
	last_review: number | null;
}

interface LogDbRow {
	id: number;
	bank_id: string;
	session_id: string | null;
	at: number;
	day: string;
	word: string;
	word_key: string;
	mode: string;
	gen_mode: string;
	rating: number;
	correct: number;
	elapsed_ms: number;
	queue_kind: string;
	state_before: number;
	interval_before_days: number;
	interval_after_days: number;
	stability_after: number;
	difficulty_after: number;
}

interface SessionDbRow {
	id: string;
	bank_id: string;
	at: number;
	day: string;
	gen_mode: string;
	content_mode: string;
	word_count: number;
	correct: number | null;
	active_ms: number;
	wall_ms: number;
}

const CARD_UPSERT = `
INSERT INTO cards (
  bank_id, word_key, word, due, due_day, state, stability, difficulty,
  elapsed_days, scheduled_days, learning_steps, reps, lapses, last_review
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(bank_id, word_key) DO UPDATE SET
  word = excluded.word,
  due = excluded.due,
  due_day = excluded.due_day,
  state = excluded.state,
  stability = excluded.stability,
  difficulty = excluded.difficulty,
  elapsed_days = excluded.elapsed_days,
  scheduled_days = excluded.scheduled_days,
  learning_steps = excluded.learning_steps,
  reps = excluded.reps,
  lapses = excluded.lapses,
  last_review = excluded.last_review
`;

const LOG_INSERT = `
INSERT INTO review_log (
  bank_id, session_id, at, day, word, word_key, mode, gen_mode, rating,
  correct, elapsed_ms, queue_kind, state_before, interval_before_days,
  interval_after_days, stability_after, difficulty_after
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

const SESSION_INSERT = `
INSERT INTO session (
  id, bank_id, at, day, gen_mode, content_mode, word_count, correct, active_ms, wall_ms
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

function finite(value: unknown, fallback = 0): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function cardParams(
	bankId: string,
	key: string,
	card: StoredCard,
): (string | number | null)[] | null {
	const dueMs = typeof card.due === "string" ? Date.parse(card.due) : Number.NaN;
	if (!Number.isFinite(dueMs)) return null;
	const lastReview =
		typeof card.last_review === "string" ? Date.parse(card.last_review) : Number.NaN;
	return [
		bankId,
		key,
		key,
		dueMs,
		localDateKey(new Date(dueMs)),
		Math.round(finite(card.state)),
		finite(card.stability),
		finite(card.difficulty),
		finite(card.elapsed_days),
		finite(card.scheduled_days),
		Math.round(finite(card.learning_steps)),
		Math.round(finite(card.reps)),
		Math.round(finite(card.lapses)),
		Number.isFinite(lastReview) ? lastReview : null,
	];
}

function isSessionIdUsed(db: DatabaseSync, id: string): boolean {
	const row = db.prepare("SELECT 1 AS found FROM session WHERE id = ?").get(id) as
		| { found?: number }
		| undefined;
	return row?.found === 1;
}

function readSessionWords(db: DatabaseSync, sessionId: string): string[] {
	const rows = db
		.prepare(
			"SELECT word FROM session_word WHERE session_id = ? ORDER BY rowid",
		)
		.all(sessionId) as { word: string }[];
	return rows.map((row) => row.word);
}

export function createSqliteReviewStore(
	dbPath: string,
	sqlite: typeof import("node:sqlite"),
): ReviewStore {
	const db = new sqlite.DatabaseSync(dbPath);
	db.exec("PRAGMA journal_mode = WAL");
	db.exec("PRAGMA synchronous = NORMAL");
	db.exec("PRAGMA busy_timeout = 3000");
	db.exec("PRAGMA foreign_keys = ON");

	let closed = false;
	const close = (): void => {
		if (closed) return;
		closed = true;
		try {
			db.close();
		} finally {
			closers.delete(close);
		}
	};
	registerCloser(close);

	const assertBank = (bankId: string): void => {
		if (!isValidBankId(bankId)) throw new Error(`非法词库 id：${bankId}`);
	};

	const store: ReviewStore = {
		mode: "sqlite",
		stats: createSqliteBankStatsQuery(db),

		readCards(bankId: string): StoredCards {
			assertBank(bankId);
			// SAFETY: SQLite 返回 Record<string, SQLOutputValue>；列由 review-schema.ts 的 cards 表固定，与 CardDbRow 一致。
			const rows = db
				.prepare("SELECT * FROM cards WHERE bank_id = ?")
				.all(bankId) as unknown as CardDbRow[];
			const cards: StoredCards = {};
			for (const row of rows) {
				const card: StoredCard = {
					due: new Date(row.due).toISOString(),
					stability: row.stability,
					difficulty: row.difficulty,
					elapsed_days: row.elapsed_days,
					scheduled_days: row.scheduled_days,
					learning_steps: row.learning_steps,
					reps: row.reps,
					lapses: row.lapses,
					state: row.state,
				};
				if (row.last_review !== null) {
					card.last_review = new Date(row.last_review).toISOString();
				}
				cards[row.word_key] = card;
			}
			return cards;
		},

		readLogs(bankId: string): ReviewLogRecord[] {
			assertBank(bankId);
			// SAFETY: SQLite 返回 Record<string, SQLOutputValue>；列由 review-schema.ts 的 review_log 表固定，与 LogDbRow 一致。
			const rows = db
				.prepare("SELECT * FROM review_log WHERE bank_id = ? ORDER BY id")
				.all(bankId) as unknown as LogDbRow[];
			return rows.map((row) => {
				const record: ReviewLogRecord = {
					at: row.at,
					word: row.word,
					bankId: row.bank_id,
					rating: row.rating,
					correct: row.correct === 1,
					mode: row.mode as ReviewLogRecord["mode"],
					genMode: row.gen_mode === "writing" ? "writing" : "cyber",
					elapsedMs: row.elapsed_ms,
					queueKind: row.queue_kind as ReviewLogRecord["queueKind"],
					stateBefore: row.state_before,
					intervalBeforeDays: row.interval_before_days,
					intervalAfterDays: row.interval_after_days,
					stabilityAfter: row.stability_after,
					difficultyAfter: row.difficulty_after,
				};
				if (row.session_id) record.sessionId = row.session_id;
				return record;
			});
		},

		readSessions(bankId: string): SessionLogRecord[] {
			assertBank(bankId);
			// SAFETY: SQLite 返回 Record<string, SQLOutputValue>；列由 review-schema.ts 的 session 表固定，与 SessionDbRow 一致。
			const rows = db
				.prepare("SELECT * FROM session WHERE bank_id = ? ORDER BY at, id")
				.all(bankId) as unknown as SessionDbRow[];
			return rows.map((row) => ({
				id: row.id,
				at: row.at,
				bankId: row.bank_id,
				genMode: row.gen_mode === "writing" ? "writing" : "cyber",
				contentMode: row.content_mode as SessionLogRecord["contentMode"],
				words: readSessionWords(db, row.id),
				correct: row.correct,
				activeMs: row.active_ms,
				wallMs: row.wall_ms,
			}));
		},

		readDayStats(bankId: string, date: string): DayStats {
			assertBank(bankId);
			const row = db
				.prepare(
					`SELECT COUNT(*) AS total,
					        COALESCE(SUM(correct), 0) AS correct,
					        COALESCE(SUM(elapsed_ms), 0) AS elapsed
					   FROM review_log WHERE bank_id = ? AND day = ?`,
				)
				.get(bankId, date) as
				| { total?: number; correct?: number; elapsed?: number }
				| undefined;
			// 统计侧按「每日练过的词数」求和：每场 session 的去重词数相加，
			// 同一词当天默了两次会算两个，而不是被去重成 1 个。
			const wordsRow = db
				.prepare(
					`SELECT COALESCE(SUM(word_count), 0) AS words
					   FROM session WHERE bank_id = ? AND day = ?`,
				)
				.get(bankId, date) as { words?: number } | undefined;
			return {
				date,
				words: Number(wordsRow?.words ?? 0),
				correct: Number(row?.correct ?? 0),
				total: Number(row?.total ?? 0),
				elapsedMs: Number(row?.elapsed ?? 0),
			};
		},

		commit(bankId: string, payload: CommitPayload): { duplicate: boolean } {
			assertBank(bankId);
			if (
				payload.cards.length === 0 &&
				payload.logs.length === 0 &&
				!payload.session
			) {
				return { duplicate: false };
			}
			db.exec("BEGIN IMMEDIATE");
			try {
				if (payload.session && isSessionIdUsed(db, payload.session.id)) {
					db.exec("COMMIT");
					return { duplicate: true };
				}
				const cardStatement = db.prepare(CARD_UPSERT);
				for (const item of payload.cards) {
					const params = cardParams(bankId, item.key, item.card);
					if (params) cardStatement.run(...params);
				}
				const logStatement = db.prepare(LOG_INSERT);
				for (const log of payload.logs) {
					const at = finite(log.at);
					logStatement.run(
						bankId,
						log.sessionId ?? payload.session?.id ?? null,
						at,
						localDateKey(new Date(at)),
						log.word,
						wordKey(log.word),
						log.mode,
						log.genMode,
						Math.min(4, Math.max(1, Math.round(finite(log.rating, 3)))),
						log.correct ? 1 : 0,
						Math.max(0, Math.round(finite(log.elapsedMs))),
						log.queueKind,
						Math.round(finite(log.stateBefore)),
						Math.max(0, finite(log.intervalBeforeDays)),
						Math.max(0, finite(log.intervalAfterDays)),
						finite(log.stabilityAfter),
						finite(log.difficultyAfter),
					);
				}
				if (payload.session) {
					const session = payload.session;
					db.prepare(SESSION_INSERT).run(
						session.id,
						bankId,
						session.at,
						localDateKey(new Date(session.at)),
						session.genMode,
						session.contentMode,
						session.words.length,
						session.correct,
						Math.max(0, Math.round(session.activeMs)),
						Math.max(0, Math.round(session.wallMs)),
					);
					const wordStatement = db.prepare(
						"INSERT OR IGNORE INTO session_word (session_id, bank_id, word_key, word) VALUES (?, ?, ?, ?)",
					);
					for (const word of session.words) {
						wordStatement.run(session.id, bankId, wordKey(word), word);
					}
				}
				db.exec("COMMIT");
				return { duplicate: false };
			} catch (error) {
				try {
					db.exec("ROLLBACK");
				} catch {
					// 事务可能已被 SQLite 自动回滚
				}
				throw error;
			}
		},

		removeBankState(bankId: string): void {
			assertBank(bankId);
			db.exec("BEGIN IMMEDIATE");
			try {
				db.prepare("DELETE FROM session_word WHERE bank_id = ?").run(bankId);
				db.prepare("DELETE FROM session WHERE bank_id = ?").run(bankId);
				db.prepare("DELETE FROM review_log WHERE bank_id = ?").run(bankId);
				db.prepare("DELETE FROM cards WHERE bank_id = ?").run(bankId);
				db.exec("COMMIT");
			} catch (error) {
				try {
					db.exec("ROLLBACK");
				} catch (rollbackError) {
					void rollbackError; // 原错误更重要，回滚失败不覆盖它
				}
				throw error;
			}
		},

		close,
	};

	return store;
}

/* 进程退出时统一关库：WAL 本身崩溃安全，但正常退出尽量 checkpoint */
const closers = new Set<() => void>();
let exitHookInstalled = false;

function registerCloser(close: () => void): void {
	closers.add(close);
	if (exitHookInstalled) return;
	exitHookInstalled = true;
	process.once("exit", () => {
		for (const closer of [...closers]) {
			try {
				closer();
			} catch {
				// 退出阶段忽略关闭错误（进程即将结束，WAL 仍可恢复）
			}
		}
	});
}
