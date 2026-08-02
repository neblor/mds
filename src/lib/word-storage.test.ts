import { afterEach, describe, expect, it, vi } from "vitest";
import {
	loadWords,
	normalizeWords,
	saveWords,
	WORDS_STORAGE_KEY,
} from "./word-storage";

afterEach(() => vi.unstubAllGlobals());

describe("word storage", () => {
	it("清理空白、重复项和非字符串值", () => {
		expect(
			normalizeWords([" apple ", "banana", "apple", "", 1, null]),
		).toEqual(["apple", "banana"]);
	});

	it("读取有效词库并安全处理损坏内容", () => {
		const getItem = vi.fn().mockReturnValue('["apple","give up"]');
		vi.stubGlobal("localStorage", { getItem });
		expect(loadWords()).toEqual(["apple", "give up"]);
		getItem.mockReturnValue("{broken");
		expect(loadWords()).toEqual([]);
	});

	it("保存规范化词库，存储失败不影响业务", () => {
		const setItem = vi.fn();
		vi.stubGlobal("localStorage", { setItem });
		saveWords([" apple ", "apple", "banana"]);
		expect(setItem).toHaveBeenCalledWith(
			WORDS_STORAGE_KEY,
			JSON.stringify(["apple", "banana"]),
		);
		setItem.mockImplementation(() => {
			throw new Error("quota");
		});
		expect(() => saveWords(["orange"])).not.toThrow();
	});
});
