/**
 * POST /api/review-commit — 把一场默写的判定结果写回复习计划
 * { bankId, items: [{ word, correct, mode, genMode, elapsedMs }], requestRetention? }
 *
 * 书写模式不写回（调用方不传 items 即可）；这里只做参数清洗 + 交给编排层。
 */
import { HTTPError } from "h3";
import type { ReviewCommitItem } from "~/lib/review-service";
import { commitReviews } from "~/lib/review-service";
import { REVIEW_MODES, type ReviewMode } from "~/lib/review-store";
import { bankStore, reviewStore } from "~/lib/runtime-stores";
import { readJsonBody, type RouteEvent } from "~/lib/server-body";

const MAX_ITEMS = 500;

function parseItems(raw: unknown): ReviewCommitItem[] {
	if (!Array.isArray(raw)) return [];
	const items: ReviewCommitItem[] = [];
	for (const value of raw.slice(0, MAX_ITEMS)) {
		if (typeof value !== "object" || value === null) continue;
		const item = value as {
			word?: unknown;
			correct?: unknown;
			mode?: unknown;
			genMode?: unknown;
			elapsedMs?: unknown;
		};
		if (typeof item.word !== "string" || !item.word.trim()) continue;
		const mode = REVIEW_MODES.includes(item.mode as ReviewMode)
			? (item.mode as ReviewMode)
			: "word";
		items.push({
			word: item.word.trim(),
			correct: item.correct === true,
			mode,
			genMode: item.genMode === "writing" ? "writing" : "cyber",
			elapsedMs:
				typeof item.elapsedMs === "number" && Number.isFinite(item.elapsedMs)
					? item.elapsedMs
					: 0,
		});
	}
	return items;
}

export async function POST(event: RouteEvent) {
	const body = await readJsonBody(event);
	const holder = (body ?? {}) as {
		bankId?: unknown;
		items?: unknown;
		requestRetention?: unknown;
	};
	const bankId = typeof holder.bankId === "string" ? holder.bankId : "";
	if (!bankStore.read(bankId)) {
		throw new HTTPError({
			status: 404,
			statusText: "Not Found",
			message: "词库不存在",
		});
	}
	const items = parseItems(holder.items);
	return commitReviews({
		bankStore,
		reviewStore,
		bankId,
		items,
		now: new Date(),
		requestRetention:
			typeof holder.requestRetention === "number"
				? holder.requestRetention
				: undefined,
	});
}
