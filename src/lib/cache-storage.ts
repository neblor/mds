/**
 * 运行时缓存存储边界。
 * 业务路由只操作语义化的音频/释义接口，不感知 public、Electron 或具体磁盘布局。
 */
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { cacheDir, runtimeMode, type RuntimeMode } from "./word-cache";

export interface RuntimeCacheStorage {
	readonly mode: RuntimeMode;
	readonly rootDir: string;
	hasAudio(name: string): boolean;
	readAudio(name: string): Uint8Array | undefined;
	writeAudio(
		name: string,
		bytes: Uint8Array,
		shouldCommit?: () => boolean,
	): boolean;
	removeAudio(name: string): void;
	readDefinitions(): unknown | undefined;
	writeDefinitions(value: unknown): void;
	readChineseWords(): unknown | undefined;
	writeChineseWords(value: unknown): void;
	/** 短句模式的「英文单词 → 短句」（与释义分开文件，格式演进互不牵连） */
	readSentences(): unknown | undefined;
	writeSentences(value: unknown): void;
	/**
	 * 失效若干词的短句缓存（大小写不敏感），返回真正删掉的条数。
	 * 文件缺失/损坏/结构不认识时返回 0（不抛错），其余词与 model/contentLevel 原样保留。
	 */
	removeSentences(words: string[]): number;
}

const audioNamePattern = /^[a-z0-9_-]{1,80}\.mp3$/;

export function isAudioCacheName(name: string): boolean {
	return audioNamePattern.test(name);
}

function assertAudioName(name: string): void {
	if (!isAudioCacheName(name)) throw new Error("非法音频缓存文件名");
}

export class FileSystemRuntimeCacheStorage implements RuntimeCacheStorage {
	readonly definitionsPath: string;
	readonly chineseWordsPath: string;
	readonly sentencesPath: string;

	constructor(
		readonly mode: RuntimeMode,
		readonly rootDir: string,
	) {
		mkdirSync(rootDir, { recursive: true });
		this.definitionsPath = join(rootDir, "definitions.json");
		this.chineseWordsPath = join(rootDir, "chinese-words.json");
		this.sentencesPath = join(rootDir, "sentences.json");
	}

	private audioPath(name: string): string {
		assertAudioName(name);
		return join(this.rootDir, name);
	}

	hasAudio(name: string): boolean {
		return existsSync(this.audioPath(name));
	}

	readAudio(name: string): Uint8Array | undefined {
		const path = this.audioPath(name);
		return existsSync(path) ? readFileSync(path) : undefined;
	}

	writeAudio(
		name: string,
		bytes: Uint8Array,
		shouldCommit: () => boolean = () => true,
	): boolean {
		const target = this.audioPath(name);
		const tmp = join(
			this.rootDir,
			`.tmp-audio-${process.pid}-${randomUUID()}`,
		);
		try {
			writeFileSync(tmp, bytes);
			if (!shouldCommit()) return false;
			try {
				renameSync(tmp, target);
				return true;
			} catch (error) {
				// 同一音频并发生成时，先完成的有效文件胜出。
				if (!existsSync(target)) throw error;
				return false;
			}
		} finally {
			rmSync(tmp, { force: true });
		}
	}

	removeAudio(name: string): void {
		rmSync(this.audioPath(name), { force: true });
	}

	readDefinitions(): unknown | undefined {
		return readJsonFile(this.definitionsPath);
	}

	writeDefinitions(value: unknown): void {
		writeJsonAtomic(this.definitionsPath, value);
	}

	readChineseWords(): unknown | undefined {
		return readJsonFile(this.chineseWordsPath);
	}

	writeChineseWords(value: unknown): void {
		writeJsonAtomic(this.chineseWordsPath, value);
	}

	readSentences(): unknown | undefined {
		return readJsonFile(this.sentencesPath);
	}

	writeSentences(value: unknown): void {
		writeJsonAtomic(this.sentencesPath, value);
	}

	removeSentences(words: string[]): number {
		const wanted = new Set(
			words.map((word) => word.trim().toLowerCase()).filter(Boolean),
		);
		if (wanted.size === 0) return 0;
		const raw = readJsonFile(this.sentencesPath);
		if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return 0;
		const holder = (raw as { sentences?: unknown }).sentences;
		if (typeof holder !== "object" || holder === null || Array.isArray(holder)) {
			return 0;
		}
		const table = holder as Record<string, unknown>;
		let removed = 0;
		for (const key of Object.keys(table)) {
			if (!wanted.has(key.trim().toLowerCase())) continue;
			delete table[key];
			removed += 1;
		}
		if (removed > 0) writeJsonAtomic(this.sentencesPath, raw);
		return removed;
	}
}

/** 读 JSON 缓存；文件缺失或损坏返回 undefined（容忍坏缓存） */
function readJsonFile(path: string): unknown | undefined {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return undefined;
	}
}

/** 临时文件 + rename 原子写 JSON（Windows 目标已存在时先移除再重试） */
function writeJsonAtomic(path: string, value: unknown): void {
	const tmp = join(
		dirname(path),
		`.tmp-json-${process.pid}-${randomUUID()}`,
	);
	try {
		writeFileSync(tmp, JSON.stringify(value, null, 2));
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

/** 环境选择集中在工厂；业务代码不做 web/client 分支。 */
export function createRuntimeCacheStorage(options: {
	mode: RuntimeMode;
	rootDir: string;
}): RuntimeCacheStorage {
	switch (options.mode) {
		case "client":
			return new FileSystemRuntimeCacheStorage("client", options.rootDir);
		case "web":
			return new FileSystemRuntimeCacheStorage("web", options.rootDir);
	}
}

export const runtimeCache = createRuntimeCacheStorage({
	mode: runtimeMode,
	rootDir: cacheDir,
});
