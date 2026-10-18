/**
 * pnpm db:status — 只读查看复习 SQLite 状态
 *
 * 不启动 Nitro、不迁移、不写业务数据；用于打包前/排查迁移问题。
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { register } from "node:module";
import { resolve } from "node:path";

register("./ts-resolve-hook.mjs", import.meta.url);

const { resolveDataDir, resolveReviewDir } = await import(
	"../src/lib/data-paths.ts"
);
const { LEGACY_ARCHIVE_DIR, REVIEW_DB_FILE } = await import(
	"../src/lib/review-schema.ts"
);

const projectRoot = resolve(import.meta.dirname, "..");
const dataDir = resolveDataDir(process.env, projectRoot);
const reviewDir = resolveReviewDir(dataDir);
const dbPath = resolve(reviewDir, REVIEW_DB_FILE);

console.log(`data dir  : ${dataDir}`);
console.log(`review dir: ${reviewDir}`);

if (!existsSync(dbPath)) {
	console.log(`\n${REVIEW_DB_FILE}: 不存在（尚未迁移，或正在兼容模式）`);
	const legacy = listLegacy(reviewDir);
	const archive = listArchive(reviewDir);
	console.log(`旧文件    : ${legacy.length} 个${legacy.length ? ` -> ${legacy.join(", ")}` : ""}`);
	console.log(`归档      : ${archive.length} 个${archive.length ? `（${LEGACY_ARCHIVE_DIR}/）` : ""}`);
	process.exit(0);
}

console.log(`\n${REVIEW_DB_FILE}: ${dbPath}`);
console.log(`主库大小  : ${sizeOf(dbPath)}`);

let db;
try {
	db = new DatabaseSync(dbPath, { readOnly: true });
	const version = db.prepare("PRAGMA user_version").get()?.user_version ?? 0;
	console.log(`schema    : v${version}`);
	const check = db.prepare("PRAGMA quick_check").get()?.quick_check ?? "unknown";
	console.log(`quick_check: ${check}`);

	const banks = new Set();
	for (const table of ["cards", "review_log", "session"]) {
		for (const row of db.prepare(`SELECT bank_id FROM ${table} GROUP BY bank_id`).all()) {
			banks.add(row.bank_id);
		}
	}
	console.log("\n每库条数（cards / logs / sessions / session_words）：");
	if (banks.size === 0) {
		console.log("  （空库）");
	}
	for (const bankId of [...banks].sort()) {
		const count = (table, column = "bank_id") =>
			db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE ${column} = ?`).get(bankId)?.c ?? 0;
		console.log(
			`  ${bankId.padEnd(24)} ${String(count("cards")).padStart(6)} / ${String(
				count("review_log"),
			).padStart(6)} / ${String(count("session")).padStart(6)} / ${String(
				count("session_word"),
			).padStart(6)}`,
		);
	}

	const archive = listArchive(reviewDir);
	console.log(`\n归档      : ${archive.length} 个${archive.length ? `（${LEGACY_ARCHIVE_DIR}/）` : ""}`);
	for (const suffix of ["-wal", "-shm"]) {
		const path = `${dbPath}${suffix}`;
		if (existsSync(path)) console.log(`${suffix} 大小  : ${sizeOf(path)}`);
	}
	if (check !== "ok") process.exitCode = 1;
} catch (error) {
	console.error(`\n无法读取 ${dbPath}: ${error instanceof Error ? error.message : error}`);
	process.exitCode = 1;
} finally {
	try {
		db?.close();
	} catch {
		// 状态脚本退出阶段忽略
	}
}

function listLegacy(dir) {
	if (!existsSync(dir)) return [];
	return readdirSync(dir).filter((file) =>
		/^(.+)\.(cards\.json|log\.jsonl|sessions\.jsonl)$/.test(file) || file === "daily.json",
	);
}

function listArchive(dir) {
	const archiveDir = resolve(dir, LEGACY_ARCHIVE_DIR);
	return existsSync(archiveDir) ? readdirSync(archiveDir) : [];
}

function sizeOf(path) {
	try {
		const bytes = statSync(path).size;
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	} catch {
		return "?";
	}
}
