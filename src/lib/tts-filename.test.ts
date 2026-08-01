import { describe, it, expect } from "vitest";
import {
	escapeWordForFilename,
	shortHash,
	cacheFileName,
	voiceSlug,
} from "./tts-filename";

describe("escapeWordForFilename", () => {
	it("普通小写词原样", () => {
		expect(escapeWordForFilename("apple")).toBe("apple");
	});
	it("特殊字符转下划线", () => {
		expect(escapeWordForFilename("don't")).toBe("don_t");
		expect(escapeWordForFilename("give up")).toBe("give_up");
		expect(escapeWordForFilename("it's-a")).toBe("it_s_a");
	});
	it("大小写归一为小写", () => {
		expect(escapeWordForFilename("Apple")).toBe("apple");
	});
	it("首尾符号剔除", () => {
		expect(escapeWordForFilename("'hello'")).toBe("hello");
	});
	it("全符号回退 word", () => {
		expect(escapeWordForFilename("'")).toBe("word");
	});
});

describe("voiceSlug", () => {
	it("音色转短标识", () => {
		expect(voiceSlug("en-US-EmmaMultilingualNeural")).toBe(
			"en-us-emmamultilingualneural",
		);
		expect(voiceSlug("en-US-JennyMultilingualNeural")).toMatch(
			/^en-us-jennymultilingualneural$/,
		);
	});
});

describe("cacheFileName", () => {
	const VOICE_A = "en-US-EmmaMultilingualNeural";
	const VOICE_B = "en-US-JennyMultilingualNeural";
	it("格式：转义_音色_哈希.mp3", () => {
		expect(cacheFileName("apple", VOICE_A)).toMatch(
			/^apple_en-us-emmamultilingualneural_[0-9a-f]{6}\.mp3$/,
		);
	});
	it("哈希区分易碰撞词", () => {
		expect(cacheFileName("give up", VOICE_A)).not.toBe(
			cacheFileName("give-up", VOICE_A),
		);
	});
	it("哈希稳定", () => {
		expect(cacheFileName("apple", VOICE_A)).toBe(
			cacheFileName("apple", VOICE_A),
		);
	});
	it("同一单词不同音色缓存不冲突", () => {
		expect(cacheFileName("apple", VOICE_A)).not.toBe(
			cacheFileName("apple", VOICE_B),
		);
	});
});

describe("shortHash", () => {
	it("长度 6 且稳定", () => {
		expect(shortHash("abc")).toHaveLength(6);
		expect(shortHash("abc")).toBe(shortHash("abc"));
		expect(shortHash("abc")).not.toBe(shortHash("abd"));
	});
});

describe("tts-filename 边界用例", () => {
	it("超长单词截断（音频路由文件名 ≤80 字符约束）", () => {
		const long = "pneumonoultramicroscopicsilicovolcanoconiosis".repeat(3);
		const name = cacheFileName(long, "en-US-AvaNeural");
		expect(name.length).toBeLessThanOrEqual(80);
		expect(name.endsWith(".mp3")).toBe(true);
	});
	it("全角/中文/emoji 单词转义", () => {
		expect(escapeWordForFilename("苹果apple")).toBe("apple");
		expect(escapeWordForFilename("hello😀world")).toBe("hello_world");
		expect(escapeWordForFilename("ＡＢＣ")).toBe("word");
	});
	it("空 voice 回退 voice", () => {
		expect(voiceSlug("")).toBe("voice");
	});
	it("voice 带特殊字符", () => {
		expect(voiceSlug("en-US Voice!@#")).toBe("en-us-voice");
	});
	it("空单词回退 word", () => {
		expect(escapeWordForFilename("")).toBe("word");
		expect(escapeWordForFilename("!!!")).toBe("word");
	});
	it("缓存文件名总长可控（40+音色+6哈希+后缀）", () => {
		const name = cacheFileName("a".repeat(100), "en-US-ChristopherNeural");
		expect(name).toMatch(/^a{40}_en-us-christopherneural_[0-9a-f]{6}\.mp3$/);
	});
	it("截断后不同长单词哈希仍区分", () => {
		const a = "a".repeat(60);
		const b = "a".repeat(61);
		expect(cacheFileName(a, "en-US-AvaNeural")).not.toBe(
			cacheFileName(b, "en-US-AvaNeural"),
		);
	});
});
