/**
 * 学习档案的纯计算层（无 IO、无 SQL，直接单测）
 *
 * 输入是 review-store 的查询行，输出是 /api/bank-stats 的视图。
 * 口径常量集中在这里；界面只做格式化，不再各自定义「已掌握/薄弱」。
 */
import type { BankEntry, BankSource } from "./bank-types";
import { wordKey } from "./bank-parse";
import { localDateKey } from "./day";
import type {
	AccuracyWindows,
	CardStatRow,
	LogDayRow,
	ModeStatRow,
	RecentSessionRow,
	ReviewMode,
	SessionDayRow,
	SessionTotals,
	WordLogRow,
	WritingWordRow,
} from "./review-types";

/** 「已掌握」= 下次间隔 ≥ 3 周（Anki mature 档） */
export const MASTERED_SCHEDULED_DAYS = 21;
export const WEAK_WINDOW_DAYS = 30;
export const WEAK_LAPSES = 2;
export const WEAK_WRONG_IN_WINDOW = 2;
export const MIN_ACCURACY_SAMPLE = 10;
export const HEATMAP_DAYS = 180;
export const FORECAST_DAYS = 14;
export const WEAK_LIMIT = 5;
export const RECENT_SESSIONS = 3;
/** 连续天数最多回溯一年，避免异常数据造成死循环 */
export const STREAK_LOOKBACK_DAYS = 365;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface BankStatsInput {
	bank: {
		id: string;
		name: string;
		source: BankSource;
		count: number;
		updatedAt: number;
	};
	entries: BankEntry[];
	cards: CardStatRow[];
	logDays: LogDayRow[];
	sessionDays: SessionDayRow[];
	accuracy: AccuracyWindows;
	modes: ModeStatRow[];
	words: WordLogRow[];
	writingWords: WritingWordRow[];
	sessionTotals: SessionTotals;
	recentSessions: RecentSessionRow[];
	now: Date;
	heatmapDays?: number;
}

export interface BankStatsView {
	bank: {
		id: string;
		name: string;
		source: BankSource;
		count: number;
		updatedAt: number;
	};
	coverage: {
		total: number;
		started: number;
		unstarted: number;
		mastered: number;
		reviewing: number;
		learning: number;
	};
	due: {
		overdue: number;
		today: number;
		next7: number;
		next30: number;
		forecast: { date: string; count: number }[];
	};
	activity: {
		heatmap: {
			date: string;
			attempts: number;
			reviews: number;
			correct: number;
		}[];
		sessions: { last7: number; last30: number; total: number };
		sessionsAvailable: boolean;
		lastUsedAt: number | null;
		firstUsedAt: number | null;
		activeDays30: number;
		streak: number;
		practiceMs7: number;
		practiceMs30: number;
	};
	accuracy: AccuracyWindows;
	modes: ModeStatRow[];
	words: {
		weak: {
			word: string;
			seen: number;
			wrong30: number;
			lapses: number;
			reason: string;
			dueAt: string | null;
		}[];
		mostPracticed: {
			word: string;
			practiced: number;
			judged: number;
			correct: number;
			lastAt: number | null;
		}[];
	};
	recentSessions: RecentSessionRow[];
	/** 只在样本足够时给出；不足时为 null */
	estimate: {
		newStarted30: number;
		remainingUnstarted: number;
		daysLeft: number | null;
	} | null;
	meta: {
		generatedAt: number;
		statsSince: number | null;
		heatmapDays: number;
	};
}

function shiftDay(now: Date, offset: number): string {
	return localDateKey(
		new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset),
	);
}

function lastDays(now: Date, days: number): string[] {
	const keys: string[] = [];
	for (let i = days - 1; i >= 0; i -= 1) keys.push(shiftDay(now, -i));
	return keys;
}

/** 今天起 days 天（含今天），用于到期预测 */
function nextDays(now: Date, days: number): string[] {
	const keys: string[] = [];
	for (let i = 0; i < days; i += 1) keys.push(shiftDay(now, i));
	return keys;
}

function startOfLocalDay(now: Date): number {
	return new Date(
		now.getFullYear(),
		now.getMonth(),
		now.getDate(),
	).getTime();
}

function clampHeatmapDays(value: number | undefined): number {
	if (!Number.isFinite(value)) return HEATMAP_DAYS;
	return Math.min(365, Math.max(30, Math.round(value as number)));
}

function uniqueEntries(entries: BankEntry[]): Map<string, BankEntry> {
	const map = new Map<string, BankEntry>();
	for (const entry of entries) {
		const key = wordKey(entry.word);
		if (!key || map.has(key)) continue;
		map.set(key, entry);
	}
	return map;
}

function dayMapOf<T extends { date: string }>(
	rows: T[],
): Map<string, T> {
	return new Map(rows.map((row) => [row.date, row]));
}

export function computeBankStats(input: BankStatsInput): BankStatsView {
	const now = input.now;
	const todayKey = localDateKey(now);
	const todayStart = startOfLocalDay(now);
	const tomorrowStart = todayStart + DAY_MS;
	const since7 = shiftDay(now, -6);
	const since30 = shiftDay(now, -(WEAK_WINDOW_DAYS - 1));
	const entries = uniqueEntries(input.entries);
	const cardsForEntries = new Map<string, CardStatRow>();
	for (const card of input.cards) {
		if (entries.has(card.wordKey) && !cardsForEntries.has(card.wordKey)) {
			cardsForEntries.set(card.wordKey, card);
		}
	}

	let mastered = 0;
	let reviewing = 0;
	let learning = 0;
	let overdue = 0;
	let dueToday = 0;
	let next7 = 0;
	let next30 = 0;
	const forecast = nextDays(now, FORECAST_DAYS).map((date) => ({
		date,
		count: 0,
	}));
	const forecastIndex = new Map(
		forecast.map((item, index) => [item.date, index]),
	);
	const next7End = todayStart + 7 * DAY_MS;
	const next30End = todayStart + 30 * DAY_MS;

	for (const card of cardsForEntries.values()) {
		if (card.state === 2) {
			if (card.scheduledDays >= MASTERED_SCHEDULED_DAYS) mastered += 1;
			else reviewing += 1;
		} else {
			learning += 1;
		}
		if (card.due < todayStart) {
			overdue += 1;
			continue;
		}
		if (card.due < tomorrowStart) dueToday += 1;
		if (card.due < next7End) next7 += 1;
		if (card.due < next30End) next30 += 1;
		const index = forecastIndex.get(card.dueDay);
		if (index !== undefined) forecast[index].count += 1;
	}

	const total = entries.size;
	const started = cardsForEntries.size;
	const unstarted = Math.max(0, total - started);

	const logDays = dayMapOf(input.logDays);
	const sessionDays = dayMapOf(input.sessionDays);
	const activityDates = new Set<string>();
	for (const day of input.logDays) {
		if (day.reviews > 0) activityDates.add(day.date);
	}
	for (const day of input.sessionDays) {
		if (day.sessions > 0) activityDates.add(day.date);
	}

	const heatmapDays = clampHeatmapDays(input.heatmapDays);
	const heatmap = lastDays(now, heatmapDays).map((date) => {
		const log = logDays.get(date);
		const session = sessionDays.get(date);
		return {
			date,
			reviews: log?.reviews ?? 0,
			correct: log?.correct ?? 0,
			attempts: (log?.reviews ?? 0) + (session?.writingWords ?? 0),
		};
	});

	let activeDays30 = 0;
	for (const date of activityDates) {
		if (date >= since30 && date <= todayKey) activeDays30 += 1;
	}

	let streak = 0;
	// 今天没练则从昨天开始算；连续断一天即停
	const streakStart = activityDates.has(todayKey) ? 0 : 1;
	if (activityDates.has(shiftDay(now, -streakStart))) {
		for (let i = 0; i < STREAK_LOOKBACK_DAYS; i += 1) {
			if (!activityDates.has(shiftDay(now, -(streakStart + i)))) break;
			streak += 1;
		}
	}

	const sessions7 = input.sessionDays
		.filter((day) => day.date >= since7 && day.date <= todayKey)
		.reduce((sum, day) => sum + day.sessions, 0);
	const sessions30 = input.sessionDays
		.filter((day) => day.date >= since30 && day.date <= todayKey)
		.reduce((sum, day) => sum + day.sessions, 0);
	const practiceMsFor = (since: string): number =>
		input.logDays
			.filter((day) => day.date >= since && day.date <= todayKey)
			.reduce((sum, day) => sum + day.elapsedMs, 0) +
		input.sessionDays
			.filter((day) => day.date >= since && day.date <= todayKey)
			.reduce((sum, day) => sum + day.writingActiveMs, 0);
	const practiceMs7 = practiceMsFor(since7);
	const practiceMs30 = practiceMsFor(since30);

	const logFirst = minPositive(input.words.map((word) => word.firstAt));
	const logLast = maxPositive(input.words.map((word) => word.lastAt));
	const writingLast = maxPositive(input.writingWords.map((word) => word.lastAt));
	const firstUsedAt = minPositive([
		input.sessionTotals.firstAt,
		logFirst,
	]);
	const lastUsedAt = maxPositive([
		input.sessionTotals.lastAt,
		logLast,
		writingLast,
	]);

	const wordLogs = new Map(input.words.map((word) => [word.wordKey, word]));
	const writingLogs = new Map(
		input.writingWords.map((word) => [word.wordKey, word]),
	);

	const weak: BankStatsView["words"]["weak"] = [];
	for (const [key, entry] of entries) {
		const card = cardsForEntries.get(key);
		const log = wordLogs.get(key);
		if (!card || !log || log.seen < 2) continue;
		const reasons: { priority: number; text: string }[] = [];
		if (log.wrong30 >= WEAK_WRONG_IN_WINDOW) {
			reasons.push({
				priority: 3,
				text: `近 30 天错 ${log.wrong30} 次`,
			});
		}
		if (card.lapses >= WEAK_LAPSES) {
			reasons.push({
				priority: 2,
				text: `累计重学 ${card.lapses} 次`,
			});
		}
		if (card.difficulty >= 7) {
			reasons.push({ priority: 1, text: "难度偏高" });
		}
		if (reasons.length === 0) continue;
		reasons.sort((a, b) => b.priority - a.priority);
		weak.push({
			word: entry.word,
			seen: log.seen,
			wrong30: log.wrong30,
			lapses: card.lapses,
			reason: reasons[0].text,
			dueAt: new Date(card.due).toISOString(),
		});
	}
	weak.sort((a, b) => {
		const scoreA =
			a.wrong30 * 3 +
			a.lapses * 2 +
			Math.max(0, (cardsForEntries.get(wordKey(a.word))?.difficulty ?? 0) - 5) * 0.5;
		const scoreB =
			b.wrong30 * 3 +
			b.lapses * 2 +
			Math.max(0, (cardsForEntries.get(wordKey(b.word))?.difficulty ?? 0) - 5) * 0.5;
		return scoreB - scoreA || a.word.localeCompare(b.word);
	});
	weak.splice(WEAK_LIMIT);

	const mostPracticed: BankStatsView["words"]["mostPracticed"] = [];
	for (const [key, entry] of entries) {
		const log = wordLogs.get(key);
		const writing = writingLogs.get(key);
		const judged = log?.seen ?? 0;
		const practiced = judged + (writing?.practiced ?? 0);
		if (practiced === 0) continue;
		mostPracticed.push({
			word: entry.word,
			practiced,
			judged,
			correct: log?.correct ?? 0,
			lastAt: maxPositive([log?.lastAt ?? null, writing?.lastAt ?? null]),
		});
	}
	mostPracticed.sort(
		(a, b) =>
			b.practiced - a.practiced ||
			b.correct - a.correct ||
			(b.lastAt ?? 0) - (a.lastAt ?? 0),
	);
	mostPracticed.splice(WEAK_LIMIT);

	const newStarted30 = input.words.filter(
		(word) => word.firstAt >= dateToMs(since30, now),
	).length;
	const estimate =
		newStarted30 >= 9 || (unstarted === 0 && newStarted30 > 0)
			? {
					newStarted30,
					remainingUnstarted: unstarted,
					daysLeft:
						newStarted30 > 0
							? Math.ceil(unstarted / (newStarted30 / WEAK_WINDOW_DAYS))
							: null,
				}
			: null;

	return {
		bank: input.bank,
		coverage: {
			total,
			started,
			unstarted,
			mastered,
			reviewing,
			learning,
		},
		due: {
			overdue,
			today: dueToday,
			next7,
			next30,
			forecast,
		},
		activity: {
			heatmap,
			sessions: {
				last7: sessions7,
				last30: sessions30,
				total: input.sessionTotals.total,
			},
			sessionsAvailable: input.sessionTotals.total > 0,
			lastUsedAt,
			firstUsedAt,
			activeDays30,
			streak,
			practiceMs7,
			practiceMs30,
		},
		accuracy: input.accuracy,
		modes: input.modes,
		words: { weak, mostPracticed },
		recentSessions: input.recentSessions.slice(0, RECENT_SESSIONS),
		estimate,
		meta: {
			generatedAt: now.getTime(),
			statsSince: firstUsedAt,
			heatmapDays,
		},
	};
}

/** 本地日期键 → 当天 00:00 的 epoch ms（用于 30 天窗口比较） */
function dateToMs(dateKey: string, fallback: Date): number {
	const [year, month, day] = dateKey.split("-").map(Number);
	if (!year || !month || !day) {
		return startOfLocalDay(fallback);
	}
	return new Date(year, month - 1, day).getTime();
}

function minPositive(values: (number | null | undefined)[]): number | null {
	let result: number | null = null;
	for (const value of values) {
		if (typeof value !== "number" || !Number.isFinite(value)) continue;
		if (result === null || value < result) result = value;
	}
	return result;
}

function maxPositive(values: (number | null | undefined)[]): number | null {
	let result: number | null = null;
	for (const value of values) {
		if (typeof value !== "number" || !Number.isFinite(value)) continue;
		if (result === null || value > result) result = value;
	}
	return result;
}

export { REVIEW_MODES, type ReviewMode } from "./review-types";
