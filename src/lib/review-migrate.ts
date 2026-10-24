/**
 * 旧 JSON/JSONL → SQLite 无感迁移
 *
 * 安全顺序：临时库 → 事务导入 → 计数校验 + quick_check → close → 原子 rename → 归档旧文件。
 * 任一步失败都保留旧文件、删除临时库，调用方回退兼容模式（下次启动重试）。
 */
import {
	appendFileSync,
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readdirSync,
	renameSync,
	rmSync,
	statSync,
	writeSync,
} from "node:fs";
import { basename, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { isValidBankId } from "./bank-types";
import { wordKey } from "./bank-parse";
import { localDateKey } from "./day";
import { readJsonFile, readJsonl } from "./json-file";
import { parseCard } from "./srs";
import {
	LEGACY_ARCHIVE_DIR,
	REVIEW_DB_FILE,
	applyReviewSchema,
	hasUserTables,
	readSchemaVersion,
} from "./review-schema";
import {
	parseCards,
	parseLogRecord,
	parseSessionRecord,
	type SessionLogRecord,
} from "./review-types";

const LOCK_FILE = ".migrate.lock";
const LOCK_STALE_MS = 60_000;
const LOCK_WAIT_MS = 2_000;
const MIGRATION_LOG = "migration.log";

interface LegacyBankFiles {
	bankId: string;
	cardsPath: string | null;
	logPath: string | null;
	sessionsPath: string | null;
}

interface LegacyArtifacts {
	banks: LegacyBankFiles[];
	dailyPath: string | null;
	/** 文件名不合法、直接跳过（不参与导入） */
	skipped: string[];
}

export interface MigrationResult {
	status: "ready" | "failed";
	dbPath: string;
	reason?: string;
}

export function prepareReviewDatabase(options: {
	reviewDir: string;
	sqlite: typeof import("node:sqlite");
}): MigrationResult {
	const { reviewDir, sqlite } = options;
	mkdirSync(reviewDir, { recursive: true });
	const dbPath = join(reviewDir, REVIEW_DB_FILE);

	if (existsSync(dbPath)) {
		return openExistingDatabase(dbPath, sqlite);
	}

	const artifacts = collectLegacyArtifacts(reviewDir);
	if (artifacts.banks.length === 0 && !artifacts.dailyPath) {
		try {
			const db = new sqlite.DatabaseSync(dbPath);
			applyReviewSchema(db);
			db.close();
			return { status: "ready", dbPath };
		} catch (error) {
			const reason = messageOf(error);
			writeMigrationLog(reviewDir, {
				event: "init-failed",
				reason,
			});
			return { status: "failed", dbPath, reason };
		}
	}

	return migrateLegacyDatabase({ reviewDir, dbPath, sqlite, artifacts });
}

function openExistingDatabase(
	dbPath: string,
	sqlite: typeof import("node:sqlite"),
): MigrationResult {
	let db: DatabaseSync | null = null;
	try {
		db = new sqlite.DatabaseSync(dbPath);
		const version = readSchemaVersion(db);
		if (version >= 1) {
			db.close();
			return { status: "ready", dbPath };
		}
		if (version === 0 && !hasUserTables(db)) {
			applyReviewSchema(db);
			db.close();
			return { status: "ready", dbPath };
		}
		const reason = `未知 schema 版本：${version}`;
		db.close();
		writeMigrationLog(dirOf(dbPath), {
			event: "open-failed",
			reason,
		});
		return { status: "failed", dbPath, reason };
	} catch (error) {
		try {
			db?.close();
		} catch (closeError) {
			void closeError;
		}
		const reason = messageOf(error);
		writeMigrationLog(dirOf(dbPath), {
			event: "open-failed",
			reason,
		});
		return { status: "failed", dbPath, reason };
	}
}

function migrateLegacyDatabase(options: {
	reviewDir: string;
	dbPath: string;
	sqlite: typeof import("node:sqlite");
	artifacts: LegacyArtifacts;
}): MigrationResult {
	const { reviewDir, dbPath, sqlite, artifacts } = options;
	const startedAt = Date.now();
	const lock = acquireLock(reviewDir);
	if (lock === "busy") {
		// 另一个进程可能刚好迁移完：优先使用已出现的 DB
		if (existsSync(dbPath)) {
			return { status: "ready", dbPath };
		}
		const reason = "另一个进程正在迁移";
		writeMigrationLog(reviewDir, { event: "migration-busy", reason });
		return { status: "failed", dbPath, reason };
	}

	const tempPath = join(
		reviewDir,
		`.migrating-${process.pid}-${Date.now()}.sqlite`,
	);
	let db: DatabaseSync | null = null;
	try {
		db = new sqlite.DatabaseSync(tempPath);
		applyReviewSchema(db);
		db.exec("BEGIN IMMEDIATE");

		const cardStatement = db.prepare(
			`INSERT OR REPLACE INTO cards (
			   bank_id, word_key, word, due, due_day, state, stability, difficulty,
			   elapsed_days, scheduled_days, learning_steps, reps, lapses, last_review
			 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		);
		const logStatement = db.prepare(
			`INSERT INTO review_log (
			   bank_id, session_id, at, day, word, word_key, mode, gen_mode, rating,
			   correct, elapsed_ms, queue_kind, state_before, interval_before_days,
			   interval_after_days, stability_after, difficulty_after
			 ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		);
		const sessionStatement = db.prepare(
			`INSERT OR IGNORE INTO session (
			   id, bank_id, at, day, gen_mode, content_mode, word_count, correct, active_ms, wall_ms
			 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		);
		const sessionWordStatement = db.prepare(
			"INSERT OR IGNORE INTO session_word (session_id, bank_id, word_key, word) VALUES (?, ?, ?, ?)",
		);

		let cardsImported = 0;
		let logsImported = 0;
		let sessionsImported = 0;

		for (const bank of artifacts.banks) {
			if (bank.cardsPath) {
				const cards = parseCards(readJsonFile(bank.cardsPath));
				for (const [key, stored] of Object.entries(cards)) {
					const card = parseCard(stored);
					if (!card) continue;
					cardStatement.run(
						bank.bankId,
						key,
						key,
						card.due.getTime(),
						localDateKey(card.due),
						card.state,
						card.stability,
						card.difficulty,
						card.elapsed_days,
						card.scheduled_days,
						card.learning_steps,
						card.reps,
						card.lapses,
						card.last_review ? card.last_review.getTime() : null,
					);
					cardsImported += 1;
				}
			}

			if (bank.logPath) {
				for (const value of readJsonl(bank.logPath)) {
					const record = parseLogRecord(value);
					if (!record) continue;
					const day = localDateKey(new Date(record.at));
					logStatement.run(
						bank.bankId,
						record.at,
						day,
						record.word,
						wordKey(record.word),
						record.mode,
						record.genMode,
						record.rating,
						record.correct ? 1 : 0,
						Math.max(0, record.elapsedMs),
						record.queueKind,
						record.stateBefore,
						record.intervalBeforeDays,
						record.intervalAfterDays,
						record.stabilityAfter,
						record.difficultyAfter,
					);
					logsImported += 1;
				}
			}

			if (bank.sessionsPath) {
				for (const value of readJsonl(bank.sessionsPath)) {
					const session = parseSessionRecord(value, bank.bankId);
					if (!session) continue;
					const inserted = sessionStatement.run(
						session.id,
						bank.bankId,
						session.at,
						localDateKey(new Date(session.at)),
						session.genMode,
						session.contentMode,
						session.words.length,
						session.correct,
						session.activeMs,
						session.wallMs,
					);
					if (inserted.changes === 0) continue;
					for (const word of session.words) {
						sessionWordStatement.run(
							session.id,
							bank.bankId,
							wordKey(word),
							word,
						);
					}
					sessionsImported += 1;
				}
			}
		}

		db.exec("COMMIT");
		const check = db.prepare("PRAGMA quick_check").get() as
			| { quick_check?: string }
			| undefined;
		if (check?.quick_check !== "ok") {
			throw new Error(`quick_check 未通过：${check?.quick_check ?? "unknown"}`);
		}
		db.close();
		db = null;

		renameDatabase(tempPath, dbPath);
		const archived = archiveLegacyFiles(reviewDir, artifacts);
		writeMigrationLog(reviewDir, {
			event: "migration-ok",
			durationMs: Date.now() - startedAt,
			banks: artifacts.banks.length,
			cards: cardsImported,
			logs: logsImported,
			sessions: sessionsImported,
			archivedFiles: archived.moved,
			archiveErrors: archived.errors,
			skippedFiles: artifacts.skipped.length,
		});
		return { status: "ready", dbPath };
	} catch (error) {
		try {
			db?.exec("ROLLBACK");
		} catch (rollbackError) {
			void rollbackError;
		}
		try {
			db?.close();
		} catch (closeError) {
			void closeError;
		}
		removeDatabaseFiles(tempPath);
		const reason = messageOf(error);
		writeMigrationLog(reviewDir, {
			event: "migration-failed",
			durationMs: Date.now() - startedAt,
			reason,
		});
		return { status: "failed", dbPath, reason };
	} finally {
		releaseLock(reviewDir, lock);
	}
}

function collectLegacyArtifacts(reviewDir: string): LegacyArtifacts {
	const byBank = new Map<string, LegacyBankFiles>();
	const skipped: string[] = [];
	let dailyPath: string | null = null;
	if (!existsSync(reviewDir)) return { banks: [], dailyPath, skipped };

	for (const file of readdirSync(reviewDir)) {
		if (file === "daily.json") {
			dailyPath = join(reviewDir, file);
			continue;
		}
		const match =
			/^(.+)\.(cards\.json|log\.jsonl|sessions\.jsonl)$/.exec(file);
		if (!match) continue;
		const bankId = match[1];
		if (!isValidBankId(bankId)) {
			skipped.push(file);
			continue;
		}
		const entry = byBank.get(bankId) ?? {
			bankId,
			cardsPath: null,
			logPath: null,
			sessionsPath: null,
		};
		const path = join(reviewDir, file);
		if (match[2] === "cards.json") entry.cardsPath = path;
		else if (match[2] === "log.jsonl") entry.logPath = path;
		else entry.sessionsPath = path;
		byBank.set(bankId, entry);
	}

	return {
		banks: [...byBank.values()].sort((a, b) =>
			a.bankId.localeCompare(b.bankId),
		),
		dailyPath,
		skipped,
	};
}

function renameDatabase(tempPath: string, dbPath: string): void {
	try {
		renameSync(tempPath, dbPath);
	} catch (error) {
		// 并发迁移/Windows 已存在目标：以既有 DB 为准，删临时库
		if (existsSync(dbPath)) {
			removeDatabaseFiles(tempPath);
			return;
		}
		throw error;
	}
}

function removeDatabaseFiles(path: string): void {
	for (const suffix of ["", "-wal", "-shm", "-journal"]) {
		rmSync(`${path}${suffix}`, { force: true });
	}
}

function archiveLegacyFiles(
	reviewDir: string,
	artifacts: LegacyArtifacts,
): { moved: number; errors: number } {
	const archiveDir = join(reviewDir, LEGACY_ARCHIVE_DIR);
	let moved = 0;
	let errors = 0;
	try {
		mkdirSync(archiveDir, { recursive: true });
	} catch (error) {
		void error;
		return { moved: 0, errors: 1 };
	}
	const files: string[] = [];
	for (const bank of artifacts.banks) {
		for (const path of [bank.cardsPath, bank.logPath, bank.sessionsPath]) {
			if (path) files.push(path);
		}
	}
	if (artifacts.dailyPath) files.push(artifacts.dailyPath);

	for (const source of files) {
		const name = basename(source);
		let target = join(archiveDir, name);
		if (existsSync(target)) {
			target = join(archiveDir, `${name}.${Date.now()}`);
		}
		try {
			renameSync(source, target);
			moved += 1;
		} catch (error) {
			void error;
			errors += 1;
		}
	}
	return { moved, errors };
}

/* ---------- 迁移锁 ---------- */

type LockState = "acquired" | "busy" | "disabled";

function acquireLock(reviewDir: string): LockState {
	const lockPath = join(reviewDir, LOCK_FILE);
	const deadline = Date.now() + LOCK_WAIT_MS;
	for (;;) {
		try {
			const fd = openSync(lockPath, "wx");
			try {
				writeSync(fd, String(process.pid));
			} finally {
				closeSync(fd);
			}
			return "acquired";
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
				// 锁目录不可写等异常：不阻塞迁移（单进程场景由 SQLite 自身的锁兜底）
				return "disabled";
			}
			try {
				const age = Date.now() - statSync(lockPath).mtimeMs;
				if (age > LOCK_STALE_MS) {
					rmSync(lockPath, { force: true });
					continue;
				}
			} catch (statError) {
				void statError;
			}
			if (Date.now() >= deadline) return "busy";
			sleepSync(50);
		}
	}
}

function releaseLock(reviewDir: string, state: LockState): void {
	if (state !== "acquired") return;
	rmSync(join(reviewDir, LOCK_FILE), { force: true });
}

/** 同步 sleep（迁移锁重试；不引入异步/定时器） */
function sleepSync(ms: number): void {
	const buffer = new SharedArrayBuffer(4);
	Atomics.wait(new Int32Array(buffer), 0, 0, ms);
}

/* ---------- 诊断日志 ---------- */

function writeMigrationLog(
	reviewDir: string,
	details: Record<string, unknown>,
): void {
	const filePath = join(reviewDir, MIGRATION_LOG);
	try {
		mkdirSync(reviewDir, { recursive: true });
		if (existsSync(filePath) && statSync(filePath).size > 256 * 1024) {
			rmSync(`${filePath}.1`, { force: true });
			renameSync(filePath, `${filePath}.1`);
		}
		appendFileSync(
			filePath,
			`${JSON.stringify({
				timestamp: new Date().toISOString(),
				event: "review-store",
				details,
			})}\n`,
			"utf8",
		);
	} catch {
		// 诊断日志失败不能影响主流程
	}
}

function messageOf(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

function dirOf(path: string): string {
	const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
	return index > 0 ? path.slice(0, index) : ".";
}
