import { describe, expect, it, vi } from "vitest";
import { HTTPError } from "h3";

const captured = vi.hoisted(() => ({
	options: null as Record<string, unknown> | null,
}));

vi.mock("~/lib/runtime-stores", () => ({
	bankStore: {},
	reviewStore: {},
}));

vi.mock("~/lib/review-service", () => ({
	buildQueueForBank: (options: Record<string, unknown>) => {
		captured.options = options;
		if (options.bankId === "nope") return null;
		return {
			bankId: options.bankId,
			queue: { words: [] },
			progress: {},
		};
	},
}));

import { GET } from "./review-queue";

function event(query: string) {
	return {
		request: new Request(`http://localhost/api/review-queue?${query}`),
		params: {},
	};
}

describe("GET /api/review-queue", () => {
	it("size 优先", () => {
		GET(event("bankId=b1&size=15&target=30"));
		expect(captured.options?.size).toBe("15");
	});

	it("size 缺省时兼容旧 target", () => {
		GET(event("bankId=b1&target=30"));
		expect(captured.options?.size).toBe("30");
	});

	it("词库不存在返回 404", () => {
		try {
			GET(event("bankId=nope&size=20"));
			expect.unreachable("应抛 404");
		} catch (error) {
			expect(error).toBeInstanceOf(HTTPError);
			expect((error as HTTPError).statusCode).toBe(404);
		}
	});
});
