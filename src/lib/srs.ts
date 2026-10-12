/**
 * SRS 调度核心（包一层 ts-fsrs，注入时钟、参数与序列化）
 *
 * 为什么包一层：
 * - 评分口径由业务决定（赛博判定 → Again/Good），不把 4 档评级暴露给界面
 * - 时钟注入 → 单测可以确定性地断言「新卡 → 学习 → 毕业 → 到期 → 失误 → 重学」整条轨迹
 * - 序列化/反序列化集中在这里，存储层只做 JSON 搬运，坏数据一律回落到「当新卡」
 *
 * 参数口径（见 plans/wordbank-srs-cloze.md 决策点 3/4）：
 * - 算法：FSRS-6（ts-fsrs 默认参数）
 * - 期望保持率：设置项，默认 0.9（越高复习越频繁）
 * - 学习步 1m/10m、重学步 10m（Anki 默认档），保证当天内能再见到刚错的词
 * - 不开启 fuzz：同一天重复计算得到同样结果，便于测试与用户预期稳定
 */
import {
	type Card,
	type Grade,
	type ReviewLog,
	Rating,
	State,
	createEmptyCard,
	fsrs,
} from "ts-fsrs";
import type { JsonValue } from "./json-file";
import type { StoredCard } from "./review-store";

export const DEFAULT_REQUEST_RETENTION = 0.9;
export const MIN_REQUEST_RETENTION = 0.7;
export const MAX_REQUEST_RETENTION = 0.97;
/** 学习步（新卡）与重学步（答错后）：Anki 默认档 */
export const LEARNING_STEPS = ["1m", "10m"] as const;
export const RELEARNING_STEPS = ["10m"] as const;
const MAXIMUM_INTERVAL_DAYS = 36500;

export interface SrsScheduler {
	createCard(now: Date): Card;
	review(
		card: Card,
		grade: Grade,
		now: Date,
	): { card: Card; log: ReviewLog };
}

/** 保持率夹到可用区间（0.7–0.97）；非法输入回落默认 0.9 */
export function clampRequestRetention(value: JsonValue | undefined): number {
	const num = typeof value === "number" ? value : Number.NaN;
	if (!Number.isFinite(num)) return DEFAULT_REQUEST_RETENTION;
	const rounded = Math.round(num * 100) / 100;
	return Math.min(MAX_REQUEST_RETENTION, Math.max(MIN_REQUEST_RETENTION, rounded));
}

export function createScheduler(
	options: { requestRetention?: number; fuzz?: boolean } = {},
): SrsScheduler {
	const scheduler = fsrs({
		request_retention: clampRequestRetention(options.requestRetention),
		maximum_interval: MAXIMUM_INTERVAL_DAYS,
		enable_fuzz: options.fuzz === true,
		enable_short_term: true,
		learning_steps: LEARNING_STEPS,
		relearning_steps: RELEARNING_STEPS,
	});
	return {
		createCard: (now: Date): Card => createEmptyCard(now),
		review: (card: Card, grade: Grade, now: Date) => {
			const result = scheduler.next(card, now, grade);
			return { card: result.card, log: result.log };
		},
	};
}

/**
 * 判定 → 评级：本项目只给两档（对 = Good、错 = Again）。
 * 不引入 Hard/Easy：教育类应用里用户无从判断，错档比少一档更糟。
 */
export function ratingForCorrect(correct: boolean): Grade {
	return correct ? Rating.Good : Rating.Again;
}

/** 该卡当前的间隔天数（用于日志与「多久后再见」文案） */
export function intervalDaysOf(card: Card): number {
	const days = card.scheduled_days;
	return Number.isFinite(days) && days > 0 ? days : 0;
}

export interface NextDueInfo {
	/** 距离下次到期还有多少天（向上取整，最小 0） */
	inDays: number;
	/** 是否当天内还会再见到（学习/重学步内） */
	laterToday: boolean;
}

/** 结算页文案用：这张卡下次什么时候见 */
export function nextDueInfo(card: Card, now: Date): NextDueInfo {
	const gapMs = card.due.getTime() - now.getTime();
	const inDays = Math.max(0, Math.ceil(gapMs / (24 * 60 * 60 * 1000)));
	return { inDays, laterToday: gapMs > 0 && sameLocalDay(card.due, now) };
}

/** 是否同一个本地日（跨日判断处处用它，避免时区混用） */
export function sameLocalDay(a: Date, b: Date): boolean {
	return (
		a.getFullYear() === b.getFullYear() &&
		a.getMonth() === b.getMonth() &&
		a.getDate() === b.getDate()
	);
}

function parseDate(value: JsonValue | undefined): Date | null {
	if (typeof value !== "string" || !value.trim()) return null;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

function parseNumber(value: JsonValue | undefined): number | null {
	if (typeof value !== "number" || !Number.isFinite(value)) return null;
	return value;
}

/** 卡片 → 可 JSON 化的存储形态（Date 一律 ISO 串） */
export function serializeCard(card: Card): StoredCard {
	const stored: StoredCard = {
		due: card.due.toISOString(),
		stability: card.stability,
		difficulty: card.difficulty,
		elapsed_days: card.elapsed_days,
		scheduled_days: card.scheduled_days,
		learning_steps: card.learning_steps,
		reps: card.reps,
		lapses: card.lapses,
		state: card.state,
	};
	if (card.last_review) stored.last_review = card.last_review.toISOString();
	return stored;
}

/**
 * 存储形态 → 卡片；任何字段缺失/非法都返回 null（调用方按新卡处理）。
 * 宁可把坏卡当新卡重学，也不能让一张损坏的卡把整条队列算崩。
 */
export function parseCard(stored: StoredCard | undefined): Card | null {
	if (!stored) return null;
	const due = parseDate(stored.due);
	if (!due) return null;
	const state = parseNumber(stored.state);
	if (state === null || !Number.isInteger(state) || state < 0 || state > 3) {
		return null;
	}
	const lastReview = parseDate(stored.last_review);
	const card: Card = {
		due,
		state: state as State,
		stability: parseNumber(stored.stability) ?? 0,
		difficulty: parseNumber(stored.difficulty) ?? 0,
		elapsed_days: parseNumber(stored.elapsed_days) ?? 0,
		scheduled_days: parseNumber(stored.scheduled_days) ?? 0,
		learning_steps: parseNumber(stored.learning_steps) ?? 0,
		reps: parseNumber(stored.reps) ?? 0,
		lapses: parseNumber(stored.lapses) ?? 0,
	};
	if (lastReview) card.last_review = lastReview;
	return card;
}
