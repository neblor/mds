import { describe, expect, it } from "vitest";
import {
	buildPhoneticPool,
	columnsForWidth,
	PHONETIC_CONFUSABLE,
	type PhoneticPoolItem,
} from "./phonetic-pool";

const identity = <T,>(list: T[]): T[] => [...list];

function tokensOf(pool: PhoneticPoolItem[]): string[] {
	return pool.map((item) => item.token);
}

function countOf(pool: PhoneticPoolItem[], token: string): number {
	return pool.filter((item) => item.token === token).length;
}

describe("buildPhoneticPool", () => {
	it("答案多重集合完整 + 4 个干扰项 + 下标连续", () => {
		const pool = buildPhoneticPool([["ˈ", "æ", "p", "ə", "l"]], {
			shuffleFn: identity,
			decoyCount: 4,
		});
		expect(pool).toHaveLength(9);
		expect(pool.map((item) => item.index)).toEqual([
			0, 1, 2, 3, 4, 5, 6, 7, 8,
		]);
		for (const token of ["ˈ", "æ", "p", "ə", "l"]) {
			expect(countOf(pool, token)).toBe(1);
		}
		const answerSet = new Set(["ˈ", "æ", "p", "ə", "l"]);
		const decoys = tokensOf(pool).filter((token) => !answerSet.has(token));
		expect(decoys).toHaveLength(4);
		expect(new Set(decoys).size).toBe(4);
		expect(pool.find((item) => item.token === "æ")?.kind).toBe("vowel");
		expect(pool.find((item) => item.token === "p")?.kind).toBe("consonant");
		expect(pool.find((item) => item.token === "ˈ")?.kind).toBe("stress");
	});

	it("重复 token 是不同下标", () => {
		const pool = buildPhoneticPool([["ə", "ə", "p"]], {
			shuffleFn: identity,
			decoyCount: 0,
		});
		expect(pool).toHaveLength(3);
		expect(countOf(pool, "ə")).toBe(2);
		expect(countOf(pool, "p")).toBe(1);
		const indices = pool
			.filter((item) => item.token === "ə")
			.map((item) => item.index);
		expect(indices).toHaveLength(2);
		expect(indices[0]).not.toBe(indices[1]);
	});

	it("多读音取并集，保证任一读音都拼得出来", () => {
		const pool = buildPhoneticPool(
			[
				["ˈ", "ð", "ə"],
				["ˈ", "ð", "iː"],
			],
			{ shuffleFn: identity, decoyCount: 0 },
		);
		expect(pool).toHaveLength(4);
		expect(countOf(pool, "ˈ")).toBe(1);
		expect(countOf(pool, "ð")).toBe(1);
		expect(countOf(pool, "ə")).toBe(1);
		expect(countOf(pool, "iː")).toBe(1);
	});

	it("干扰项排除答案已有符号和重音；默认 4–6 个", () => {
		const pool = buildPhoneticPool([["ˈ", "æ", "p"]], {
			shuffleFn: identity,
		});
		expect(pool).toHaveLength(3 + 4);
		const answerSet = new Set(["ˈ", "æ", "p"]);
		const decoys = pool.filter((item) => !answerSet.has(item.token));
		expect(decoys).toHaveLength(4);
		expect(decoys.every((item) => item.kind !== "stress")).toBe(true);
		expect(decoys.some((item) => item.token === "b" || item.token === "t")).toBe(
			true,
		);
	});

	it("池子上限优先保证答案完整，干扰项自动减少", () => {
		const pool = buildPhoneticPool([["ˈ", "æ", "p", "ə", "l"]], {
			shuffleFn: identity,
			decoyCount: 6,
			maxPool: 7,
		});
		expect(pool).toHaveLength(7);
		expect(pool.filter((item) => item.kind !== "stress")).toHaveLength(6);
		for (const token of ["ˈ", "æ", "p", "ə", "l"]) {
			expect(countOf(pool, token)).toBe(1);
		}
	});

	it("答案本身超过上限时不再加干扰项", () => {
		const answer = Array.from({ length: 20 }, () => "ə");
		const pool = buildPhoneticPool([answer], {
			shuffleFn: identity,
			decoyCount: 6,
		});
		expect(pool).toHaveLength(20);
		expect(pool.every((item) => item.token === "ə")).toBe(true);
	});

	it("可注入 shuffle；非法 token 报错；空答案返回空", () => {
		const pool = buildPhoneticPool([["ˈ", "æ", "p"]], {
			shuffleFn: (list) => [...list].reverse(),
			decoyCount: 0,
		});
		expect(tokensOf(pool)).toEqual(["p", "æ", "ˈ"]);
		expect(pool.map((item) => item.index)).toEqual([0, 1, 2]);

		expect(() =>
			buildPhoneticPool([["x"]], { shuffleFn: identity, decoyCount: 0 }),
		).toThrow(/非法音素/);
		expect(buildPhoneticPool([], { decoyCount: 0 })).toEqual([]);
	});

	it("易混表覆盖常见对", () => {
		expect(PHONETIC_CONFUSABLE["iː"]).toContain("ɪ");
		expect(PHONETIC_CONFUSABLE["æ"]).toContain("e");
		expect(PHONETIC_CONFUSABLE["θ"]).toContain("ð");
		expect(PHONETIC_CONFUSABLE["tʃ"]).toContain("dʒ");
		expect(PHONETIC_CONFUSABLE["l"]).toContain("r");
	});
});

describe("columnsForWidth", () => {
	it("1120 窗口（内容 1064）刚好 8 列", () => {
		expect(columnsForWidth(1064, 125, 8)).toBe(8);
	});

	it("容器刚够 8 列宽度时仍是 8 列", () => {
		// 8 * 125 + 7 * 8 = 1056
		expect(columnsForWidth(1056, 125, 8)).toBe(8);
		expect(columnsForWidth(1055, 125, 8)).toBe(7);
	});

	it("最小窗口 747（内容 691）是 5 列", () => {
		expect(columnsForWidth(691, 125, 8)).toBe(5);
	});

	it("异常输入不返回 0 或负数", () => {
		expect(columnsForWidth(0, 125, 8)).toBe(1);
		expect(columnsForWidth(1064, 0, 8)).toBe(1);
		expect(columnsForWidth(1064, 125, -4)).toBe(8);
	});
});
