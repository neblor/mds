import { afterEach, describe, expect, it } from "vitest";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
	createRuntimeCacheStorage,
	isAudioCacheName,
} from "./cache-storage";

const root = "/tmp/mds-runtime-cache-storage-test";

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("runtime cache storage", () => {
	it("按环境创建存储并读写、失效音频", () => {
		const storage = createRuntimeCacheStorage({ mode: "client", rootDir: root });
		const name = "apple_en-us-avaneural_123abc.mp3";
		expect(storage.mode).toBe("client");
		expect(storage.writeAudio(name, new Uint8Array([0x49, 0x44, 0x33]))).toBe(
			true,
		);
		expect(storage.hasAudio(name)).toBe(true);
		expect([...storage.readAudio(name)!]).toEqual([0x49, 0x44, 0x33]);
		storage.removeAudio(name);
		expect(storage.hasAudio(name)).toBe(false);
	});

	it("中止提交不会留下音频或临时文件", () => {
		const storage = createRuntimeCacheStorage({ mode: "web", rootDir: root });
		const name = "apple_123abc.mp3";
		expect(
			storage.writeAudio(name, new Uint8Array([1, 2, 3]), () => false),
		).toBe(false);
		expect(storage.hasAudio(name)).toBe(false);
		expect(readdirSync(root)).toEqual([]);
	});

	it("释义以 JSON 原子写入并可容忍坏缓存", () => {
		const storage = createRuntimeCacheStorage({ mode: "web", rootDir: root });
		storage.writeDefinitions({ model: "m", defs: { apple: "A fruit." } });
		expect(storage.readDefinitions()).toEqual({
			model: "m",
			defs: { apple: "A fruit." },
		});
		expect(existsSync(join(root, "definitions.json"))).toBe(true);
	});

	it("音频名校验在存储边界阻断路径穿越", () => {
		expect(isAudioCacheName("ok_123.mp3")).toBe(true);
		expect(isAudioCacheName("../../bad.mp3")).toBe(false);
		const storage = createRuntimeCacheStorage({ mode: "web", rootDir: root });
		expect(() => storage.readAudio("../../bad.mp3")).toThrow("非法音频");
	});
});
