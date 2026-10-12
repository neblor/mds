import { describe, expect, it } from "vitest";
import { Rating, State } from "ts-fsrs";
import {
	clampRequestRetention,
	createScheduler,
	intervalDaysOf,
	nextDueInfo,
	parseCard,
	ratingForCorrect,
	serializeCard,
} from "./srs";

const NOW = new Date(2026, 9, 12, 10, 0, 0); // 本地 2026-10-12 10:00
const MINUTE = 60 * 1000;

function plus(date: Date, ms: number): Date {
	return new Date(date.getTime() + ms);
}

describe("参数与评分口径", () => {
	it("保持率夹在 0.7–0.97，非法回落 0.9", () => {
		expect(clampRequestRetention(0.9)).toBe(0.9);
		expect(clampRequestRetention(0.5)).toBe(0.7);
		expect(clampRequestRetention(1)).toBe(0.97);
		expect(clampRequestRetention("x")).toBe(0.9);
		expect(clampRequestRetention(undefined)).toBe(0.9);
		expect(clampRequestRetention(0.856)).toBe(0.86);
	});

	it("只有两档：对 = Good（3），错 = Again（1）", () => {
		expect(ratingForCorrect(true)).toBe(Rating.Good);
		expect(ratingForCorrect(false)).toBe(Rating.Again);
		expect(ratingForCorrect(true)).toBe(3);
		expect(ratingForCorrect(false)).toBe(1);
	});
});

describe("新卡轨迹", () => {
	const scheduler = createScheduler();
	const card = scheduler.createCard(NOW);

	it("新卡是 New 状态、due 即现在", () => {
		expect(card.state).toBe(State.New);
		expect(card.due.getTime()).toBe(NOW.getTime());
		expect(card.reps).toBe(0);
	});

	it("答对进入学习步（10 分钟内再见），不停留在 New", () => {
		const { card: next, log } = scheduler.review(card, Rating.Good, NOW);
		expect(next.state).toBe(State.Learning);
		expect(next.reps).toBe(1);
		expect(next.due.getTime()).toBeGreaterThan(NOW.getTime());
		expect(next.due.getTime()).toBeLessThanOrEqual(NOW.getTime() + 11 * MINUTE);
		expect(log.rating).toBe(Rating.Good);
	});

	it("答错回到第一步（1 分钟内再见）", () => {
		const { card: next } = scheduler.review(card, Rating.Again, NOW);
		expect(next.state).toBe(State.Learning);
		expect(next.due.getTime()).toBeLessThanOrEqual(NOW.getTime() + 2 * MINUTE);
	});

	it("走完学习步后毕业进 Review，间隔至少 1 天", () => {
		const step1 = scheduler.review(card, Rating.Good, NOW).card;
		const step2 = scheduler.review(step1, Rating.Good, plus(NOW, 10 * MINUTE)).card;
		expect(step2.state).toBe(State.Review);
		expect(step2.scheduled_days).toBeGreaterThanOrEqual(1);
		expect(intervalDaysOf(step2)).toBeGreaterThanOrEqual(1);
		expect(nextDueInfo(step2, NOW).inDays).toBeGreaterThanOrEqual(1);
	});
});

describe("复习卡轨迹", () => {
	const scheduler = createScheduler();
	const graduated = (() => {
		const newCard = scheduler.createCard(NOW);
		const step1 = scheduler.review(newCard, Rating.Good, NOW).card;
		return scheduler.review(step1, Rating.Good, plus(NOW, 10 * MINUTE)).card;
	})();

	it("复习答对：间隔变长、状态保持 Review", () => {
		const later = plus(NOW, 24 * 60 * MINUTE);
		const { card: next } = scheduler.review(graduated, Rating.Good, later);
		expect(next.state).toBe(State.Review);
		expect(next.scheduled_days).toBeGreaterThanOrEqual(graduated.scheduled_days);
		expect(next.lapses).toBe(0);
	});

	it("复习答错：进重学（当天内再见）且 lapses +1", () => {
		const later = plus(NOW, 24 * 60 * MINUTE);
		const { card: next } = scheduler.review(graduated, Rating.Again, later);
		expect(next.state).toBe(State.Relearning);
		expect(next.lapses).toBe(1);
		expect(next.due.getTime()).toBeLessThanOrEqual(later.getTime() + 11 * MINUTE);
		expect(nextDueInfo(next, later).laterToday).toBe(true);
	});

	it("期望保持率越高，毕业后的首个间隔不会更长（单调性）", () => {
		const low = createScheduler({ requestRetention: 0.7 });
		const high = createScheduler({ requestRetention: 0.97 });
		const first = (s: ReturnType<typeof createScheduler>) => {
			const fresh = s.createCard(NOW);
			const a = s.review(fresh, Rating.Good, NOW).card;
			return s.review(a, Rating.Good, plus(NOW, 10 * MINUTE)).card.scheduled_days;
		};
		expect(first(high)).toBeLessThanOrEqual(first(low));
	});
});

describe("序列化", () => {
	const scheduler = createScheduler();

	it("往返一致（含 last_review）", () => {
		const card = scheduler.review(
			scheduler.createCard(NOW),
			Rating.Good,
			NOW,
		).card;
		const restored = parseCard(serializeCard(card));
		expect(restored).not.toBeNull();
		expect(restored?.due.toISOString()).toBe(card.due.toISOString());
		expect(restored?.state).toBe(card.state);
		expect(restored?.reps).toBe(card.reps);
		expect(restored?.last_review?.toISOString()).toBe(
			card.last_review?.toISOString(),
		);
	});

	it("坏数据一律回落到 null（调用方按新卡处理）", () => {
		expect(parseCard(undefined)).toBeNull();
		expect(parseCard({})).toBeNull();
		expect(parseCard({ due: "not-a-date", state: 2 })).toBeNull();
		expect(parseCard({ due: NOW.toISOString() })).toBeNull();
		expect(parseCard({ due: NOW.toISOString(), state: 9 })).toBeNull();
		expect(parseCard({ due: NOW.toISOString(), state: 1.5 })).toBeNull();
	});

	it("缺可选数值字段时补 0，而不是整卡作废", () => {
		const parsed = parseCard({ due: NOW.toISOString(), state: 2 });
		expect(parsed).not.toBeNull();
		expect(parsed?.stability).toBe(0);
		expect(parsed?.reps).toBe(0);
		expect(parsed?.last_review).toBeUndefined();
	});
});
