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
import { join } from "node:path";
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

	constructor(
		readonly mode: RuntimeMode,
		readonly rootDir: string,
	) {
		mkdirSync(rootDir, { recursive: true });
		this.definitionsPath = join(rootDir, "definitions.json");
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
		try {
			return JSON.parse(readFileSync(this.definitionsPath, "utf8"));
		} catch {
			return undefined;
		}
	}

	writeDefinitions(value: unknown): void {
		const tmp = join(
			this.rootDir,
			`.tmp-definitions-${process.pid}-${randomUUID()}`,
		);
		try {
			writeFileSync(tmp, JSON.stringify(value, null, 2));
			try {
				renameSync(tmp, this.definitionsPath);
			} catch (error) {
				// Windows 上目标已存在时 rename 可能拒绝覆盖；移除旧 JSON 后重试。
				if (!existsSync(this.definitionsPath)) throw error;
				rmSync(this.definitionsPath, { force: true });
				renameSync(tmp, this.definitionsPath);
			}
		} finally {
			rmSync(tmp, { force: true });
		}
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
