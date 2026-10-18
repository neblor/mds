import { afterEach, describe, expect, it } from "vitest";
import { existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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

	it("短句缓存可按词失效，大小写不敏感，meta 与其余词保留", () => {
		const storage = createRuntimeCacheStorage({ mode: "web", rootDir: root });
		storage.writeSentences({
			model: "m",
			contentLevel: "primary",
			sentences: {
				apple: "a red apple",
				Apple: "A Red Apple",
				banana: "a yellow banana",
			},
		});
		expect(storage.removeSentences(["APPLE", "cherry"])).toBe(2);
		expect(storage.readSentences()).toEqual({
			model: "m",
			contentLevel: "primary",
			sentences: { banana: "a yellow banana" },
		});
	});

	it("短句缓存缺失/损坏时失效不抛错（返回 0）", () => {
		const storage = createRuntimeCacheStorage({ mode: "web", rootDir: root });
		expect(storage.removeSentences(["apple"])).toBe(0);
		expect(storage.removeSentences([])).toBe(0);
		writeFileSync(join(root, "sentences.json"), "{ not json");
		expect(storage.removeSentences(["apple"])).toBe(0);
		writeFileSync(join(root, "sentences.json"), JSON.stringify({ sentences: 42 }));
		expect(storage.removeSentences(["apple"])).toBe(0);
	});

	it("中文词使用独立 JSON 文件读写，互不污染释义缓存", () => {
		const storage = createRuntimeCacheStorage({ mode: "web", rootDir: root });
		storage.writeDefinitions({ model: "m", defs: { apple: "A fruit." } });
		storage.writeChineseWords({ model: "m", words: { apple: "苹果" } });
		expect(storage.readChineseWords()).toEqual({
			model: "m",
			words: { apple: "苹果" },
		});
		expect(storage.readDefinitions()).toEqual({
			model: "m",
			defs: { apple: "A fruit." },
		});
		expect(existsSync(join(root, "chinese-words.json"))).toBe(true);
		expect(existsSync(join(root, "definitions.json"))).toBe(true);
	});

	it("中文词缓存损坏/缺失时返回 undefined", () => {
		const storage = createRuntimeCacheStorage({ mode: "web", rootDir: root });
		expect(storage.readChineseWords()).toBeUndefined();
		storage.writeChineseWords({ model: "m", words: { apple: "苹果" } });
		writeFileSync(join(root, "chinese-words.json"), "{broken");
		expect(storage.readChineseWords()).toBeUndefined();
	});

	it("音频名校验在存储边界阻断路径穿越", () => {
		expect(isAudioCacheName("ok_123.mp3")).toBe(true);
		expect(isAudioCacheName("../../bad.mp3")).toBe(false);
		const storage = createRuntimeCacheStorage({ mode: "web", rootDir: root });
		expect(() => storage.readAudio("../../bad.mp3")).toThrow("非法音频");
	});
});
