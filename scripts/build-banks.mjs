/**
 * 生成随包发布的内置词库：ECDICT CSV → public/banks/<id>.json + manifest.json
 *
 * 用法：
 *   pnpm build:banks                     # 用 .tmp/banks-src/ecdict.csv，缺了就下载（63 MB）
 *   pnpm build:banks -- --csv /tmp/ecdict.csv
 *   pnpm build:banks -- --out public/banks
 *
 * 说明：
 * - 数据源 ECDICT 是 MIT 许可（https://github.com/skywind3000/ECDICT），构建产物随包发布
 * - 词库 JSON 与运行时 WordBank 完全同构，导入本地时无需转换
 * - 只保留有单词的词条；**不做英文释义过滤**（缺释义的词在「单词」模式下仍然可用），
 *   脚本会打印各库的英文释义覆盖率供参考
 */
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import { join, resolve } from "node:path";
import process from "node:process";

// 项目源码用无扩展名的相对导入（Vite 风格），Node 需要这个钩子才能解析
register("./ts-resolve-hook.mjs", import.meta.url);
const { csvRecords, ecdictRowToEntry, parseCsv } = await import(
	"../src/lib/bank-parse.ts"
);
const { BUILTIN_BANK_SPECS, buildBank, buildManifest, selectSpecEntries } =
	await import("../src/lib/bank-build.ts");

const ECDICT_URL =
	"https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv";

const projectRoot = resolve(import.meta.dirname, "..");

function argValue(name) {
	const index = process.argv.indexOf(name);
	if (index < 0) return undefined;
	const value = process.argv[index + 1];
	return value && !value.startsWith("--") ? value : undefined;
}

const csvPath = resolve(
	argValue("--csv") ??
		process.env.MDS_ECDICT_CSV ??
		join(projectRoot, ".tmp", "banks-src", "ecdict.csv"),
);
const outDir = resolve(argValue("--out") ?? join(projectRoot, "public", "banks"));

function kb(bytes) {
	return `${(bytes / 1024).toFixed(1)} KB`;
}

async function ensureCsv(path) {
	if (existsSync(path) && statSync(path).size > 1_000_000) return;
	mkdirSync(join(path, ".."), { recursive: true });
	console.log(`下载 ECDICT CSV → ${path}`);
	const response = await fetch(ECDICT_URL);
	if (!response.ok) {
		throw new Error(`下载失败：HTTP ${response.status}`);
	}
	const buffer = Buffer.from(await response.arrayBuffer());
	writeFileSync(path, buffer);
	console.log(`下载完成：${kb(buffer.length)}`);
}

async function main() {
	await ensureCsv(csvPath);
	const started = Date.now();
	console.log(`读取 ${csvPath}`);
	const text = await readFile(csvPath, "utf8");
	const rows = parseCsv(text);
	const { records } = csvRecords(rows);
	console.log(`CSV 解析完成：${records.length} 行（${Date.now() - started} ms）`);

	const entries = [];
	let dropped = 0;
	for (const record of records) {
		const entry = ecdictRowToEntry(record);
		if (entry) entries.push(entry);
		else dropped++;
	}
	console.log(`词条归一完成：${entries.length} 条（丢弃 ${dropped} 条）`);

	mkdirSync(outDir, { recursive: true });
	const built = [];
	for (const spec of BUILTIN_BANK_SPECS) {
		const picked = selectSpecEntries(spec, entries);
		if (picked.length === 0) {
			console.warn(`跳过 ${spec.id}：没有命中的词条`);
			continue;
		}
		const bank = buildBank(spec, picked, Date.now());
		const json = JSON.stringify(bank);
		writeFileSync(join(outDir, `${spec.id}.json`), json);
		const withDefinition = picked.filter((item) => item.definition).length;
		console.log(
			`${spec.id.padEnd(9)} ${String(picked.length).padStart(6)} 词  ` +
				`${kb(Buffer.byteLength(json)).padStart(10)}  英文释义覆盖 ` +
				`${((withDefinition / picked.length) * 100).toFixed(1)}%`,
		);
		built.push(bank);
	}

	const manifest = buildManifest(built);
	writeFileSync(
		join(outDir, "manifest.json"),
		`${JSON.stringify(manifest, null, 2)}\n`,
	);
	console.log(
		`清单已写入 ${join(outDir, "manifest.json")}（${built.length} 个词库，` +
			`总耗时 ${((Date.now() - started) / 1000).toFixed(1)} s）`,
	);
}

await main();
