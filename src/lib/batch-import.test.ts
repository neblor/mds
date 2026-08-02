import { describe, expect, it } from "vitest";
import { newBatchWords, parseBatchWords } from "./batch-import";

describe("batch vocabulary import", () => {
	it("支持空格、Tab、换行、英文逗号和分号并忽略重复项", () => {
		expect(
			parseBatchWords(" apple\tbanana\r\norange,pear;grape  apple "),
		).toEqual(["apple", "banana", "orange", "pear", "grape"]);
	});

	it("只返回词库中尚不存在的条目", () => {
		expect(newBatchWords("apple banana;constructor", ["apple"])).toEqual([
			"banana",
			"constructor",
		]);
	});
});
