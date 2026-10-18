import { describe, expect, it, vi } from "vitest";
import { HTTPError } from "h3";

const state = vi.hoisted(() => ({
	bank: {
		id: "b1",
		name: "测试",
		source: "custom" as const,
		version: 1,
		entries: [{ word: "apple" }],
		createdAt: 0,
		updatedAt: 0,
	},
	stats: null as object | null,
}));

vi.mock("~/lib/runtime-stores", () => ({
	bankStore: {
		read: (id: string) => (id === "b1" ? state.bank : undefined),
	},
	reviewStore: { stats: state.stats },
}));

import { GET } from "./bank-stats";

function event(query: string) {
	return {
		request: new Request(`http://localhost/api/bank-stats?${query}`),
		params: {},
	};
}

describe("GET /api/bank-stats", () => {
	it("词库不存在返回 404", () => {
		try {
			GET(event("bankId=nope"));
			throw new Error("应当抛错");
		} catch (error) {
			expect(error).toBeInstanceOf(HTTPError);
			expect((error as HTTPError).statusCode).toBe(404);
		}
	});

	it("兼容模式（stats=null）返回 503 与可读文案", () => {
		state.stats = null;
		try {
			GET(event("bankId=b1"));
			throw new Error("应当抛错");
		} catch (error) {
			expect(error).toBeInstanceOf(HTTPError);
			expect((error as HTTPError).statusCode).toBe(503);
			expect((error as HTTPError).message).toMatch(/兼容模式/);
		}
	});
});
