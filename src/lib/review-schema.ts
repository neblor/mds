/**
 * 复习库 schema（SQLite，v1）
 *
 * 时间戳统一 epoch ms；day / due_day 是本地时区的 YYYY-MM-DD，写入时用
 * localDateKey 固化，SQL 里不做时区换算（避免 DST/时区漂移）。
 * 版本只增不改：以后用 PRAGMA user_version 做增量迁移。
 */
import type { DatabaseSync } from "node:sqlite";

export const REVIEW_SCHEMA_VERSION = 1;
export const REVIEW_DB_FILE = "review.sqlite";
export const LEGACY_ARCHIVE_DIR = "migrated-v1";

export const REVIEW_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS cards (
  bank_id        TEXT NOT NULL,
  word_key       TEXT NOT NULL,
  word           TEXT NOT NULL,
  due            INTEGER NOT NULL,
  due_day        TEXT NOT NULL,
  state          INTEGER NOT NULL,
  stability      REAL NOT NULL,
  difficulty     REAL NOT NULL,
  elapsed_days   REAL NOT NULL,
  scheduled_days REAL NOT NULL,
  learning_steps INTEGER NOT NULL,
  reps           INTEGER NOT NULL,
  lapses         INTEGER NOT NULL,
  last_review    INTEGER,
  PRIMARY KEY (bank_id, word_key)
);
CREATE INDEX IF NOT EXISTS cards_due_idx     ON cards (bank_id, due);
CREATE INDEX IF NOT EXISTS cards_due_day_idx ON cards (bank_id, due_day);
CREATE INDEX IF NOT EXISTS cards_state_idx   ON cards (bank_id, state);

CREATE TABLE IF NOT EXISTS review_log (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  bank_id               TEXT NOT NULL,
  session_id            TEXT,
  at                    INTEGER NOT NULL,
  day                   TEXT NOT NULL,
  word                  TEXT NOT NULL,
  word_key              TEXT NOT NULL,
  mode                  TEXT NOT NULL,
  gen_mode              TEXT NOT NULL,
  rating                INTEGER NOT NULL,
  correct               INTEGER NOT NULL,
  elapsed_ms            INTEGER NOT NULL,
  queue_kind            TEXT NOT NULL,
  state_before          INTEGER NOT NULL,
  interval_before_days  REAL NOT NULL,
  interval_after_days   REAL NOT NULL,
  stability_after       REAL NOT NULL,
  difficulty_after      REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS review_log_bank_day_idx  ON review_log (bank_id, day);
CREATE INDEX IF NOT EXISTS review_log_bank_word_idx ON review_log (bank_id, word_key);
CREATE INDEX IF NOT EXISTS review_log_bank_at_idx   ON review_log (bank_id, at);
CREATE INDEX IF NOT EXISTS review_log_session_idx   ON review_log (bank_id, session_id);

CREATE TABLE IF NOT EXISTS session (
  id           TEXT PRIMARY KEY,
  bank_id      TEXT NOT NULL,
  at           INTEGER NOT NULL,
  day          TEXT NOT NULL,
  gen_mode     TEXT NOT NULL,
  content_mode TEXT NOT NULL,
  word_count   INTEGER NOT NULL,
  correct      INTEGER,
  active_ms    INTEGER NOT NULL,
  wall_ms      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS session_bank_day_idx ON session (bank_id, day);
CREATE INDEX IF NOT EXISTS session_bank_at_idx  ON session (bank_id, at);

CREATE TABLE IF NOT EXISTS session_word (
  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  bank_id    TEXT NOT NULL,
  word_key   TEXT NOT NULL,
  word       TEXT NOT NULL,
  PRIMARY KEY (session_id, word_key)
);
CREATE INDEX IF NOT EXISTS session_word_bank_word_idx ON session_word (bank_id, word_key);
`;

/** 建表并写版本号（幂等） */
export function applyReviewSchema(db: DatabaseSync): void {
	db.exec(REVIEW_SCHEMA_SQL);
	db.exec(`PRAGMA user_version = ${REVIEW_SCHEMA_VERSION}`);
}

export function readSchemaVersion(db: DatabaseSync): number {
	const row = db.prepare("PRAGMA user_version").get() as
		| { user_version?: number }
		| undefined;
	return typeof row?.user_version === "number" ? row.user_version : 0;
}

/** 库里是否已有用户表（用于区分「空库」与「未知旧库」） */
export function hasUserTables(db: DatabaseSync): boolean {
	const row = db
		.prepare(
			"SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
		)
		.get() as { count?: number } | undefined;
	return typeof row?.count === "number" && row.count > 0;
}
