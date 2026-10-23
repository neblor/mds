import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	loadPhoneticDictionary,
	lookupPhonetic,
	parsePhoneticDictionary,
	resetPhoneticDictionaryCache,
} from "./phonetic-dictionary";
import { phoneticToString } from "./phonetic-parse";

const dictPath = fileURLToPath(
	new URL("../../public/ipa/en-gb.v1.json", import.meta.url),
);
const asset = JSON.parse(readFileSync(dictPath, "utf8")) as unknown;

afterEach(() => resetPhoneticDictionaryCache());

describe("内置音标词典查找", () => {
	const dictionary = parsePhoneticDictionary(asset);

	it("大小写不敏感；保留多读音；展示为空格分隔 token", () => {
		const apple = lookupPhonetic(dictionary, "Apple");
		expect(apple).not.toBeNull();
		expect(apple?.length).toBeGreaterThan(0);
		expect(phoneticToString(apple?.[0] ?? [])).toBe("ˈ æ p ə l");

		const the = lookupPhonetic(dictionary, "the");
		expect(the?.length).toBeGreaterThan(1);
	});

	it("词组/未收录/空词返回 null（调用方降级为单词轮）", () => {
		expect(lookupPhonetic(dictionary, "not-a-real-word-xyz")).toBeNull();
		expect(lookupPhonetic(dictionary, "red apple")).toBeNull();
		expect(lookupPhonetic(dictionary, "   ")).toBeNull();
	});

	it("过滤坏 token，不让坏条目抛出", () => {
		const broken = parsePhoneticDictionary({
			version: 1,
			source: {},
			symbols: [],
			words: { bad: [["nope"], ["ˈ", "æ"]] },
		});
		expect(lookupPhonetic(broken, "bad")?.map(phoneticToString)).toEqual([
			"ˈ æ",
		]);
	});
});

describe("词典懒加载", () => {
	it("共享同一个 Promise；成功后不再请求", async () => {
		const fetchMock = vi.fn(async () => ({
			ok: true,
			json: async () => asset,
		}));
		const [a, b] = await Promise.all([
			loadPhoneticDictionary(fetchMock as unknown as typeof fetch),
			loadPhoneticDictionary(fetchMock as unknown as typeof fetch),
		]);
		expect(a).toBe(b);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(lookupPhonetic(a, "apple")).not.toBeNull();
	});

	it("失败清掉缓存，下次可以重试", async () => {
		const failing = vi.fn(async () => ({
			ok: false,
			status: 500,
			json: async () => ({}),
		}));
		await expect(
			loadPhoneticDictionary(failing as unknown as typeof fetch),
		).rejects.toThrow("HTTP 500");

		const ok = vi.fn(async () => ({
			ok: true,
			json: async () => asset,
		}));
		const loaded = await loadPhoneticDictionary(
			ok as unknown as typeof fetch,
		);
		expect(lookupPhonetic(loaded, "apple")).not.toBeNull();
		expect(failing).toHaveBeenCalledTimes(1);
		expect(ok).toHaveBeenCalledTimes(1);
	});

	it("顶层形状不对时拒绝", () => {
		expect(() => parsePhoneticDictionary(null)).toThrow();
		expect(() => parsePhoneticDictionary({})).toThrow();
		expect(() => parsePhoneticDictionary({ words: [] })).toThrow();
	});
});
