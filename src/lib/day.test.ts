import { describe, expect, it } from "vitest";
import { localDateKey } from "./day";

describe("localDateKey", () => {
	it("用本地日，不经过 UTC", () => {
		expect(localDateKey(new Date(2026, 9, 12, 10, 0, 0))).toBe("2026-10-12");
		expect(localDateKey(new Date(2026, 0, 5, 0, 0, 0))).toBe("2026-01-05");
		expect(localDateKey(new Date(2026, 11, 31, 23, 59, 59))).toBe("2026-12-31");
	});
});
