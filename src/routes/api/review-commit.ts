/**
 * POST /api/review-commit — 把一场默写的判定结果写回复习计划
 * { bankId, items: [{ word, correct, mode, genMode, elapsedMs }], requestRetention? }
 *
 * 书写模式不写回（调用方不传 items 即可）；这里只做参数清洗 + 交给编排层。
 */
import { randomUUID } from "node:crypto";
import { HTTPError } from "h3";
import type {
	ReviewCommitItem,
	SessionCommitInput,
} from "~/lib/review-service";
import { commitReviews } from "~/lib/review-service";
import { REVIEW_MODES, type ReviewMode } from "~/lib/review-types";
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

function finite(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** 场次参数清洗；缺失/非对象直接视为「没有场次」（旧客户端兼容） */
function parseSession(raw: unknown): SessionCommitInput | null {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return null;
	}
	const holder = raw as {
		id?: unknown;
		genMode?: unknown;
		contentMode?: unknown;
		words?: unknown;
		correct?: unknown;
		activeMs?: unknown;
		wallMs?: unknown;
	};
	const genMode = holder.genMode === "writing" ? "writing" : "cyber";
	const contentMode = REVIEW_MODES.includes(holder.contentMode as ReviewMode)
		? (holder.contentMode as ReviewMode)
		: "word";
	const words = Array.isArray(holder.words)
		? holder.words.filter((word): word is string => typeof word === "string")
		: [];
	const activeMs = finite(holder.activeMs) ?? 0;
	const wallMs = finite(holder.wallMs) ?? activeMs;
	return {
		id:
			typeof holder.id === "string" && holder.id.trim()
				? holder.id.trim()
				: randomUUID(),
		genMode,
		contentMode,
		words,
		correct:
			genMode === "writing" ? null : finite(holder.correct),
		activeMs: Math.max(0, activeMs),
		wallMs: Math.max(0, wallMs),
	};
}

export async function POST(event: RouteEvent) {
	const body = await readJsonBody(event);
	const holder = (body ?? {}) as {
		bankId?: unknown;
		items?: unknown;
		requestRetention?: unknown;
		session?: unknown;
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
		session: parseSession(holder.session),
	});
}
