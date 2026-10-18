/**
 * pnpm db:rollback -- --yes — 把学习状态从 SQLite 回滚到旧 JSON
 *
 * 前提：先退出应用（不要有 Electron/Nitro 进程占用 review.sqlite）。
 * 动作：review.sqlite* 改名为 review.sqlite.bak-<时间戳>；
 *       把 review/migrated-v1/ 里的旧文件搬回 review/；下次启动重新迁移。
 * 不做隐式删除：归档里的文件全部保留，冲突时直接中止。
 */
import {
	existsSync,
	mkdirSync,
	readdirSync,
	renameSync,
	rmdirSync,
} from "node:fs";
import { register } from "node:module";
import { resolve } from "node:path";

register("./ts-resolve-hook.mjs", import.meta.url);

const { resolveDataDir, resolveReviewDir } = await import(
	"../src/lib/data-paths.ts"
);
const { LEGACY_ARCHIVE_DIR, REVIEW_DB_FILE } = await import(
	"../src/lib/review-schema.ts"
);

if (!process.argv.includes("--yes")) {
	console.error("用法：pnpm db:rollback -- --yes");
	console.error("会先把 review.sqlite* 改名为备份，再把 migrated-v1/ 的旧文件搬回 review/。");
	console.error("请先退出应用。");
	process.exit(1);
}

const projectRoot = resolve(import.meta.dirname, "..");
const dataDir = resolveDataDir(process.env, projectRoot);
const reviewDir = resolveReviewDir(dataDir);
const dbPath = resolve(reviewDir, REVIEW_DB_FILE);
const archiveDir = resolve(reviewDir, LEGACY_ARCHIVE_DIR);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

if (!existsSync(dbPath)) {
	console.error(`没有找到 ${dbPath}，无需回滚。`);
	process.exit(1);
}
if (!existsSync(archiveDir)) {
	console.error(
		`没有找到归档目录 ${archiveDir}。\n` +
			"没有归档就无法恢复旧数据；请保留当前 review.sqlite 并联系维护者。",
	);
	process.exit(1);
}

const archivedFiles = readdirSync(archiveDir);
if (archivedFiles.length === 0) {
	console.error(`归档目录为空：${archiveDir}`);
	process.exit(1);
}

// 先检查冲突，避免搬了一半才发现
const collisions = archivedFiles.filter((file) =>
	existsSync(resolve(reviewDir, file)),
);
if (collisions.length > 0) {
	console.error("以下文件在 review/ 已存在，回滚中止（避免覆盖）：");
	for (const file of collisions) console.error(`  - ${file}`);
	process.exit(1);
}

mkdirSync(reviewDir, { recursive: true });

for (const suffix of ["", "-wal", "-shm"]) {
	const source = `${dbPath}${suffix}`;
	if (!existsSync(source)) continue;
	const target = `${dbPath}.bak-${stamp}${suffix}`;
	renameSync(source, target);
	console.log(`备份 ${source} -> ${target}`);
}

for (const file of archivedFiles) {
	const source = resolve(archiveDir, file);
	const target = resolve(reviewDir, file);
	renameSync(source, target);
	console.log(`恢复 ${file}`);
}

try {
	rmdirSync(archiveDir);
} catch {
	// 目录非空/被占用则保留
}

console.log("\n回滚完成。下次启动会把恢复的旧文件重新迁移进 SQLite。");
console.log(`SQLite 备份：${dbPath}.bak-${stamp}`);
