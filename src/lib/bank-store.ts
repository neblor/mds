/**
 * 词库存储（服务端文件）：<rootDir>/<id>.json + <rootDir>/index.json
 *
 * 设计要点：
 * - **索引可自愈**：index.json 缺失、损坏、或与实际文件数不一致时，直接从磁盘重建
 * - **原子写**：临时文件 + rename（Windows 目标已存在时先删除再重试）
 * - **坏数据隔离**：单个词库文件损坏只影响该库（read 返回 undefined 并从索引剔除），不牵连其它库
 * - id 一律过 isValidBankId，杜绝路径穿越（../）
 */
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
	BANK_STORE_VERSION,
	isValidBankId,
	type BankSummary,
	type WordBank,
} from "./bank-types";
import { parseBankFile } from "./bank-parse";

export interface BankStore {
	readonly rootDir: string;
	list(): BankSummary[];
	read(id: string): WordBank | undefined;
	write(bank: WordBank): void;
	remove(id: string): boolean;
}

interface StoredIndex {
	version: number;
	banks: BankSummary[];
}

/** JSON 文件里可能出现的东西：读进来一律当不可信数据处理 */
export type JsonValue =
	| null
	| boolean
	| number
	| string
	| JsonValue[]
	| { [key: string]: JsonValue };

const INDEX_FILE = "index.json";

export function bankPath(rootDir: string, id: string): string {
	if (!isValidBankId(id)) throw new Error(`非法词库 id：${id}`);
	return join(rootDir, `${id}.json`);
}

function readJson(path: string): JsonValue | undefined {
	try {
		return JSON.parse(readFileSync(path, "utf8")) as JsonValue;
	} catch {
		return undefined;
	}
}

/** 临时文件 + rename 原子写（Windows 下目标存在时先移除再重试） */
function writeJsonAtomic(path: string, value: unknown): void {
	mkdirSync(join(path, ".."), { recursive: true });
	const tmp = join(join(path, ".."), `.tmp-${process.pid}-${randomUUID()}`);
	try {
		writeFileSync(tmp, JSON.stringify(value));
		try {
			renameSync(tmp, path);
		} catch (error) {
			if (!existsSync(path)) throw error;
			rmSync(path, { force: true });
			renameSync(tmp, path);
		}
	} finally {
		rmSync(tmp, { force: true });
	}
}

function summaryOf(bank: WordBank): BankSummary {
	return {
		id: bank.id,
		name: bank.name,
		source: bank.source,
		count: bank.entries.length,
		version: bank.version,
		updatedAt: bank.updatedAt,
	};
}

/** 词库 → 列表摘要（路由新建/更新后用同一口径返回给前端） */
export function bankSummary(bank: WordBank): BankSummary {
	return summaryOf(bank);
}

function isSummary(value: unknown): value is BankSummary {
	if (typeof value !== "object" || value === null) return false;
	const item = value as Record<string, unknown>;
	return (
		isValidBankId(item.id) &&
		typeof item.name === "string" &&
		(item.source === "builtin" ||
			item.source === "remote" ||
			item.source === "custom") &&
		typeof item.count === "number" &&
		typeof item.version === "number" &&
		typeof item.updatedAt === "number"
	);
}

/** 扫描磁盘重建索引（只解析文件内容，用于索引缺失/不一致时） */
function rebuildIndex(rootDir: string): BankSummary[] {
	const banks: BankSummary[] = [];
	for (const file of bankFiles(rootDir)) {
		const bank = parseBankFile(readJson(join(rootDir, file)), file.slice(0, -5));
		if (bank) banks.push(summaryOf(bank));
	}
	return banks.sort((a, b) => a.id.localeCompare(b.id));
}

function bankFiles(rootDir: string): string[] {
	if (!existsSync(rootDir)) return [];
	return readdirSync(rootDir)
		.filter((file) => file.endsWith(".json") && file !== INDEX_FILE)
		.filter((file) => isValidBankId(file.slice(0, -5)))
		.sort();
}

export function createBankStore(rootDir: string): BankStore {
	mkdirSync(rootDir, { recursive: true });
	const indexPath = join(rootDir, INDEX_FILE);

	const readIndex = (): BankSummary[] | undefined => {		const raw = readJson(indexPath);
		if (typeof raw !== "object" || raw === null) return undefined;
		const stored = raw as { version?: JsonValue; banks?: JsonValue };
		if (stored.version !== BANK_STORE_VERSION || !Array.isArray(stored.banks)) {
			return undefined;
		}
		const banks: BankSummary[] = [];
		for (const item of stored.banks) {
			if (isSummary(item)) banks.push(item);
		}
		if (banks.length !== stored.banks.length) return undefined;
		return banks;
	};

	const writeIndex = (banks: BankSummary[]): void => {
		writeJsonAtomic(indexPath, {
			version: BANK_STORE_VERSION,
			banks,
		} satisfies StoredIndex);
	};

	/** 引擎读到打不开的库（文件被删/写坏）时，就把它从索引剔除：列表里不再提供一个点开就报错的库 */
	const healIndex = (id: string): void => {
		const index = readIndex();
		if (!index?.some((item) => item.id === id)) return;
		writeIndex(index.filter((item) => item.id !== id));
	};

	return {
		rootDir,

		list(): BankSummary[] {
			const files = bankFiles(rootDir);
			const index = readIndex();
			// 索引与磁盘不一致（手工放文件、删文件、写失败）→ 以磁盘为准重建
			if (!index || index.length !== files.length) {
				const rebuilt = rebuildIndex(rootDir);
				writeIndex(rebuilt);
				return rebuilt;
			}
			return [...index].sort((a, b) => a.id.localeCompare(b.id));
		},

		read(id: string): WordBank | undefined {
			if (!isValidBankId(id)) return undefined;
			const path = bankPath(rootDir, id);
			const bank = existsSync(path)
				? (parseBankFile(readJson(path), id) ?? undefined)
				: undefined;
			if (!bank) healIndex(id);
			return bank;
		},

		write(bank: WordBank): void {
			writeJsonAtomic(bankPath(rootDir, bank.id), bank);
			const index = readIndex() ?? rebuildIndex(rootDir);
			const next = index.filter((item) => item.id !== bank.id);
			next.push(summaryOf(bank));
			writeIndex(next);
		},

		remove(id: string): boolean {
			if (!isValidBankId(id)) return false;
			const path = bankPath(rootDir, id);
			const existed = existsSync(path);
			if (existed) rmSync(path, { force: true });
			const index = readIndex() ?? rebuildIndex(rootDir);
			writeIndex(index.filter((item) => item.id !== id));
			return existed;
		},
	};
}
