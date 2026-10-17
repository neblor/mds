/**
 * 复习编排层（生产实际调用的实现，直接单测覆盖）
 *
 * 两件事：
 * 1. buildQueueForBank：按「今天默几个」算出今日队列 + 今日进度
 * 2. commitReviews：把一场默写的判定结果写回卡片状态、追加日志、更新每日汇总
 *
 * 原则：
 * - 队列不落盘，每次重算；只有卡片状态与每日汇总落盘
 * - 服务端是权威：queueKind（新词/复习/重学）由服务端按卡片状态判定，不信客户端
 * - 书写模式不进调度由调用方决定（不传 items 就不会写回），见 docs/plans
 */
import { State } from "ts-fsrs";
import type { BankStore } from "./bank-store";
import type {
	DailyStat,
	QueueKind,
	ReviewLogRecord,
	ReviewMode,
	ReviewStore,
} from "./review-store";
import {
	buildDailyQueue,
	clampTodayTarget,
	DEFAULT_TODAY_TARGET,
	doneWordsToday,
	localDateKey,
	type DailyQueue,
} from "./daily-queue";
import {
	createScheduler,
	intervalDaysOf,
	nextDueInfo,
	parseCard,
	ratingForCorrect,
	serializeCard,
} from "./srs";
import { wordKey } from "./bank-parse";
import type { BankEntry } from "./bank-types";

// 「今天默几个」的常量与夹取函数定义在 daily-queue（客户端也要用，不能依赖服务端模块）
export { clampTodayTarget, MAX_TODAY_TARGET, MIN_TODAY_TARGET } from "./daily-queue";

export interface QueueProgress {
	date: string;
	target: number;
	done: number;
	correct: number;
	total: number;
	elapsedMs: number;
}

export interface QueueResult {
	bankId: string;
	queue: DailyQueue;
	progress: QueueProgress;
	/** 队列词的英文释义（组句出题用；词表里没有释义时缺省） */
	definitions: Record<string, string>;
	/** 今天已默过的词（界面用来在队列胶囊上打勾） */
	doneWords: string[];
}

function emptyStat(date: string, target: number): DailyStat {
	return { date, target, done: 0, correct: 0, total: 0, elapsedMs: 0 };
}

/**
 * 队列词的英文释义表（组句出题时给 AI 作选题依据）。
 * 只取队列里出现过的词；自建词表没有释义就不进入结果（不编造）。
 */
function queueWordDefinitions(
	entries: BankEntry[],
	words: string[],
): Record<string, string> {
	const wanted = new Map<string, string>();
	for (const word of words) {
		wanted.set(wordKey(word), word);
	}
	const definitions: Record<string, string> = {};
	for (const entry of entries) {
		const word = wanted.get(wordKey(entry.word));
		const definition = entry.definition?.trim();
		if (word && definition && !definitions[word]) {
			definitions[word] = definition;
		}
	}
	return definitions;
}

/** 今日队列 + 今日进度；词库不存在返回 null */
export function buildQueueForBank(options: {
	bankStore: BankStore;
	reviewStore: ReviewStore;
	bankId: string;
	target: unknown;
	now: Date;
}): QueueResult | null {
	const { bankStore, reviewStore, bankId, now } = options;
	const bank = bankStore.read(bankId);
	if (!bank) return null;
	const target = clampTodayTarget(options.target);
	const cards = reviewStore.readCards(bankId);
	const doneWords = doneWordsToday(bank.entries, cards, now);
	const queue = buildDailyQueue({
		entries: bank.entries,
		cards,
		now,
		target,
		doneToday: doneWords,
	});

	// 今日汇总随队列一起维护：target 以本次为准，done 按卡片重新数（自愈）
	const date = localDateKey(now);
	const daily = reviewStore.readDaily();
	const stat = daily[date] ?? emptyStat(date, target);
	stat.target = target;
	stat.done = doneWords.length;
	daily[date] = stat;
	reviewStore.writeDaily(daily);

	return {
		bankId,
		queue,
		doneWords,
		definitions: queueWordDefinitions(bank.entries, queue.words),
		progress: {
			date,
			target: stat.target,
			done: stat.done,
			correct: stat.correct,
			total: stat.total,
			elapsedMs: stat.elapsedMs,
		},
	};
}

export interface ReviewCommitItem {
	word: string;
	correct: boolean;
	mode: ReviewMode;
	genMode: "writing" | "cyber";
	elapsedMs: number;
}

export interface CommittedWord {
	word: string;
	rating: number;
	due: string;
	inDays: number;
	laterToday: boolean;
	/** 该词在队列里的来源（服务端判定） */
	queueKind: QueueKind;
}

/** 结果行的最小形状（避免与 results.ts 耦合，同时便于单测） */
export interface ResultRowLike {
	word: string;
	/** 短句/组句轮带标准句子；短句场次里缺它是「降级为单词轮」的信号 */
	context?: string;
	fields: { kind: string; graded: boolean; correct?: boolean }[];
}

/**
 * 结果行 → 复习写回条目（纯映射，可单测）。
 *
 * - 只取「参与判定的单词字段」作为对错：书写模式没有判定字段 → 整行跳过（不进调度）
 * - elapsedMs 按行索引取（每轮实际耗时），缺省算 0
 * - 缺失/空单词行直接忽略，不因一行坏数据丢整场写回
 * - 短句场次里被降级的词（没有标准句子）按 `word` 记账：否则复习统计会把
 *   「只默了单词」的轮次算成短句轮，长期看会污染模式维度的统计
 */
export function buildCommitItems(options: {
	rows: ResultRowLike[];
	mode: ReviewMode;
	genMode: "writing" | "cyber";
	elapsedMs?: number[];
}): ReviewCommitItem[] {
	const items: ReviewCommitItem[] = [];
	options.rows.forEach((row, index) => {
		const word = typeof row.word === "string" ? row.word.trim() : "";
		if (!word) return;
		const judged = row.fields?.find(
			(field) => field.kind === "word" && field.graded,
		);
		if (!judged) return;
		const elapsed = options.elapsedMs?.[index] ?? 0;
		// 短句场次的降级轮：没有 context 即「本词没有合格短句」
		const rowMode: ReviewMode =
			options.mode === "sentence" && !row.context ? "word" : options.mode;
		items.push({
			word,
			correct: judged.correct === true,
			mode: rowMode,
			genMode: options.genMode,
			elapsedMs: Number.isFinite(elapsed) ? Math.max(0, Math.round(elapsed)) : 0,
		});
	});
	return items;
}

export interface CommitResult {
	updated: CommittedWord[];
	progress: QueueProgress;
}

function queueKindOf(stateBefore: number, hadCard: boolean): QueueKind {
	if (!hadCard) return "new";
	return stateBefore === State.Relearning ? "relearn" : "review";
}

/** 写回一场默写的判定结果：卡片状态 + 复习日志（append-only）+ 每日汇总 */
export function commitReviews(options: {
	reviewStore: ReviewStore;
	bankStore: BankStore;
	bankId: string;
	items: ReviewCommitItem[];
	now: Date;
	requestRetention?: number;
}): CommitResult {
	const { reviewStore, bankStore, bankId, now } = options;
	const bank = bankStore.read(bankId);
	const entries = bank?.entries ?? [];
	const cards = reviewStore.readCards(bankId);
	const daily = reviewStore.readDaily();
	const date = localDateKey(now);
	const stat = daily[date] ?? emptyStat(date, DEFAULT_TODAY_TARGET);
	const updated: CommittedWord[] = [];
	const logs: ReviewLogRecord[] = [];

	const scheduler = createScheduler({
		requestRetention: options.requestRetention,
	});

	for (const item of options.items) {
		const key = wordKey(item.word);
		if (!key) continue;
		const existing = parseCard(cards[key]);
		const card = existing ?? scheduler.createCard(now);
		const stateBefore = card.state;
		const intervalBeforeDays = existing ? intervalDaysOf(card) : 0;
		const rating = ratingForCorrect(item.correct);
		const { card: next } = scheduler.review(card, rating, now);
		cards[key] = serializeCard(next);
		const info = nextDueInfo(next, now);
		const queueKind = queueKindOf(stateBefore, Boolean(existing));
		updated.push({
			word: item.word,
			rating,
			due: next.due.toISOString(),
			inDays: info.inDays,
			laterToday: info.laterToday,
			queueKind,
		});
		logs.push({
			at: now.getTime(),
			word: item.word,
			bankId,
			rating,
			correct: item.correct,
			mode: item.mode,
			genMode: item.genMode,
			elapsedMs: Math.max(0, Math.round(item.elapsedMs)),
			queueKind,
			stateBefore,
			intervalBeforeDays,
			intervalAfterDays: intervalDaysOf(next),
			stabilityAfter: next.stability,
			difficultyAfter: next.difficulty,
		});
		stat.correct += item.correct ? 1 : 0;
		stat.total += 1;
		stat.elapsedMs += Math.max(0, Math.round(item.elapsedMs));
	}

	reviewStore.writeCards(bankId, cards);
	if (logs.length > 0) reviewStore.appendLogs(bankId, logs);
	stat.done = doneWordsToday(entries, cards, now).length;
	daily[date] = stat;
	reviewStore.writeDaily(daily);

	return {
		updated,
		progress: {
			date,
			target: stat.target,
			done: stat.done,
			correct: stat.correct,
			total: stat.total,
			elapsedMs: stat.elapsedMs,
		},
	};
}
