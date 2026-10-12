/**
 * GET /api/bank-detail?bankId=xxx&offset=0&limit=300&q=前缀
 * 词表详情：分页 + 关键词过滤（几千词的资源词表不可能一次全给前端）。
 */
import { HTTPError } from "h3";
import { bankStore } from "~/lib/runtime-stores";
import { getQuery, type RouteEvent } from "~/lib/server-body";

const DEFAULT_LIMIT = 300;
const MAX_LIMIT = 1000;

function clampInt(raw: string, fallback: number, min: number, max: number): number {
	const value = Number.parseInt(raw, 10);
	if (!Number.isFinite(value)) return fallback;
	return Math.min(max, Math.max(min, value));
}

export function GET(event: RouteEvent) {
	const bankId = getQuery(event, "bankId");
	const bank = bankStore.read(bankId);
	if (!bank) {
		throw new HTTPError({
			status: 404,
			statusText: "Not Found",
			message: "词库不存在",
		});
	}
	const offset = clampInt(getQuery(event, "offset"), 0, 0, bank.entries.length);
	const limit = clampInt(getQuery(event, "limit"), DEFAULT_LIMIT, 1, MAX_LIMIT);
	const query = getQuery(event, "q").trim().toLowerCase();
	const matched = query
		? bank.entries.filter((entry) => entry.word.toLowerCase().includes(query))
		: bank.entries;
	return {
		bank: {
			id: bank.id,
			name: bank.name,
			source: bank.source,
			count: bank.entries.length,
			updatedAt: bank.updatedAt,
			note: bank.note ?? null,
		},
		entries: matched.slice(offset, offset + limit),
		total: matched.length,
		offset,
		limit,
	};
}
