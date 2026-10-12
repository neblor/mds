/**
 * JSON 文件读写（服务端，同步）
 *
 * 抽出来的目的：词库、复习状态、每日汇总都用同一套「原子写 + 坏数据不抛错」的规则，
 * 避免三份各自实现的 rename 细节（Windows 覆盖已存在文件会失败）。
 */
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";

/** JSON 文件里可能出现的东西：读进来一律当不可信数据处理 */
export type JsonValue =
	| null
	| boolean
	| number
	| string
	| JsonValue[]
	| { [key: string]: JsonValue };

/** 读 JSON；文件缺失、为空或损坏都返回 undefined（调用方按「没有」处理） */
export function readJsonFile(path: string): JsonValue | undefined {
	try {
		return JSON.parse(readFileSync(path, "utf8")) as JsonValue;
	} catch {
		return undefined;
	}
}

/** 临时文件 + rename 原子写（Windows 下目标存在时先移除再重试） */
export function writeJsonFileAtomic(path: string, value: JsonValue): void {
	mkdirSync(dirname(path), { recursive: true });
	const tmp = join(dirname(path), `.tmp-${process.pid}-${randomUUID()}`);
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

/** 追加写 JSONL（每行一条记录，只增不改，便于将来做统计） */
export function appendJsonl(path: string, records: JsonValue[]): void {
	if (records.length === 0) return;
	mkdirSync(dirname(path), { recursive: true });
	const payload = records.map((record) => `${JSON.stringify(record)}\n`).join("");
	appendFileSync(path, payload);
}

/** 读 JSONL：逐行解析，坏行直接跳过（不因一行损坏丢整份日志） */
export function readJsonl(path: string): JsonValue[] {
	if (!existsSync(path)) return [];
	const records: JsonValue[] = [];
	for (const line of readFileSync(path, "utf8").split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			records.push(JSON.parse(trimmed) as JsonValue);
		} catch {
			// 坏行跳过
		}
	}
	return records;
}
