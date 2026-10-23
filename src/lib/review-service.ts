/**
 * 复习编排层（生产实际调用的实现，直接单测覆盖）
 *
 * 两件事：
 * 1. buildQueueForBank：按「今天默几个」算出今日队列 + 今日进度
 * 2. commitReviews：把一场默写写回卡片、日志、场次（一个事务）
 *
 * 原则：
 * - 队列不落盘，每次重算；进度直接由 review_log 聚合
 * - 服务端是权威：queueKind（新词/复习/重学）由服务端按卡片状态判定，不信客户端
 * - 书写模式不进调度由调用方决定（items 为空就不写卡片/日志，但场次照写）
 */
import { State, type Card } from "ts-fsrs";
import type { BankStore } from "./bank-store";
import type { BankEntry } from "./bank-types";
import { wordKey } from "./bank-parse";
import {
	buildDailyQueue,
	clampTodayTarget,
	localDateKey,
	doneWordsToday,
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
import {
	REVIEW_MODES,
	type CommitPayload,
	type ReviewLogRecord,
	type ReviewMode,
	type ReviewStore,
	type SessionLogRecord,
	type StoredCard,
} from "./review-types";

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
	const date = localDateKey(now);
	const day = reviewStore.readDayStats(bankId, date);

	return {
		bankId,
		queue,
		doneWords,
		definitions: queueWordDefinitions(bank.entries, queue.words),
		progress: {
			date,
			target,
			done: doneWords.length,
			correct: day.correct,
			total: day.total,
			elapsedMs: day.elapsedMs,
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

/** 客户端提交的场次信息（bankId / at 由服务端补） */
export interface SessionCommitInput {
	id: string;
	genMode: "writing" | "cyber";
	contentMode: ReviewMode;
	words: string[];
	correct: number | null;
	activeMs: number;
	wallMs: number;
}

export interface CommittedWord {
	word: string;
	rating: number;
	due: string;
	inDays: number;
	laterToday: boolean;
	/** 该词在队列里的来源（服务端判定） */
	queueKind: "new" | "review" | "relearn";
}

/** 结果行的最小形状（避免与 results.ts 耦合，同时便于单测） */
export interface ResultRowLike {
	word: string;
	/** 短句/组句轮带标准句子（展示信息；判定看 fields 的字段种类） */
	context?: string;
	/** 该行来自第几轮（组句一轮多个空共用一轮耗时）；缺省按行号算 */
	roundIndex?: number;
	fields: { kind: string; graded: boolean; correct?: boolean }[];
}

/**
 * 结果行 → 复习写回条目（纯映射，可单测）。
 *
 * 对错口径：**该行所有参与批改的字段都对，才算这一题对**。
 * - 短句轮是 `sentence`（整句归一化比较），其余模式与短句场次的降级轮是 `word`；
 *   书写模式没有判定字段 → 整行跳过（不进调度）。
 * - 曾经只取 `word` 字段：短句场次 items 恒为空（整场不写回）；释义/中文词模式又
 *   会「拼写对、释义错」也记成对（与结算页判错矛盾）。两处都是同一行错误（2026-10-18）。
 * - elapsedMs 按**轮**取（`roundIndex`）：组句一轮多个空共用一次轮耗时，均分到各空，
 *   保证逐题耗时之和 ≈ 轮耗时；缺 `roundIndex` 时按行号兼容旧调用（一行一轮）。
 * - 缺失/空单词行直接忽略，不因一行坏数据丢整场写回
 * - 短句场次里被降级的词（没有整句判定字段）按 `word` 记账：否则复习统计会把
 *   「只默了单词」的轮次算成短句轮，长期看会污染模式维度的统计
 */
export function buildCommitItems(options: {
	rows: ResultRowLike[];
	mode: ReviewMode;
	genMode: "writing" | "cyber";
	elapsedMs?: number[];
}): ReviewCommitItem[] {
	const items: ReviewCommitItem[] = [];
	const roundOfRow = (row: ResultRowLike, index: number): number =>
		typeof row.roundIndex === "number" && Number.isFinite(row.roundIndex)
			? Math.max(0, Math.round(row.roundIndex))
			: index;
	const gradedOf = (row: ResultRowLike) =>
		(row.fields ?? []).filter((field) => field.graded);

	// 先数「同一轮里有多少道要写回的题」，用于均分轮耗时
	const perRound = new Map<number, number>();
	options.rows.forEach((row, index) => {
		const word = typeof row.word === "string" ? row.word.trim() : "";
		if (!word || gradedOf(row).length === 0) return;
		const round = roundOfRow(row, index);
		perRound.set(round, (perRound.get(round) ?? 0) + 1);
	});

	options.rows.forEach((row, index) => {
		const word = typeof row.word === "string" ? row.word.trim() : "";
		if (!word) return;
		const graded = gradedOf(row);
		if (graded.length === 0) return;
		const hasSentenceField = graded.some((field) => field.kind === "sentence");
		const hasPhoneticField = graded.some((field) => field.kind === "phonetic");
		const correct = graded.every((field) => field.correct === true);
		const round = roundOfRow(row, index);
		const roundElapsed = options.elapsedMs?.[round] ?? 0;
		const share = perRound.get(round) ?? 1;
		const elapsed = Number.isFinite(roundElapsed)
			? Math.max(0, Math.round(roundElapsed / Math.max(1, share)))
			: 0;
		// 短句/音标场次的降级轮：判定来自单词字段（本词没有合格短句/可用音标）
		const rowMode: ReviewMode =
			options.mode === "sentence" && !hasSentenceField
				? "word"
				: options.mode === "phonetic" && !hasPhoneticField
					? "word"
					: options.mode;
		items.push({
			word,
			correct,
			mode: rowMode,
			genMode: options.genMode,
			elapsedMs: elapsed,
		});
	});
	return items;
}

export interface CommitResult {
	updated: CommittedWord[];
	progress: QueueProgress;
}

function queueKindOf(stateBefore: number, hadCard: boolean): CommittedWord["queueKind"] {
	if (!hadCard) return "new";
	return stateBefore === State.Relearning ? "relearn" : "review";
}

function fallbackSessionId(now: Date): string {
	return `${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function clampSession(input: SessionCommitInput, bankId: string, now: Date): SessionLogRecord {
	const words = Array.from(
		new Map(
			input.words
				.map((word) => (typeof word === "string" ? word.trim().slice(0, 80) : ""))
				.filter(Boolean)
				.map((word) => [word.toLowerCase(), word] as const),
		).values(),
	).slice(0, 200);
	const genMode = input.genMode === "writing" ? "writing" : "cyber";
	const contentMode = REVIEW_MODES.includes(input.contentMode)
		? input.contentMode
		: "word";
	const activeMs =
		typeof input.activeMs === "number" && Number.isFinite(input.activeMs)
			? Math.max(0, input.activeMs)
			: 0;
	const wallMs =
		typeof input.wallMs === "number" && Number.isFinite(input.wallMs)
			? Math.max(0, input.wallMs)
			: activeMs;
	const correct =
		genMode === "writing" || typeof input.correct !== "number"
			? null
			: Math.min(words.length, Math.max(0, Math.round(input.correct)));
	return {
		id:
			typeof input.id === "string" && input.id.trim()
				? input.id.trim().slice(0, 100)
				: fallbackSessionId(now),
		at: now.getTime(),
		bankId,
		genMode,
		contentMode,
		words,
		correct,
		activeMs,
		wallMs: Math.max(activeMs, wallMs),
	};
}

/**
 * 一场里同一个词的多次作答 → 用于卡片推进的一条聚合结果。
 *
 * 为什么必须聚合：组句一轮里可能出现同一个词两个空，或者同一场里重复出现。
 * FSRS 的卡是「一个词一张卡」，同一时刻对同一张卡连续评分两次会让它**提前毕业**
 * （实测：新卡在同一毫秒 Good 两次 → 直接从 Learning 跳进 Review，due 跳到 2 天后；
 * 而正确的路径应是今天先停在 10 分钟学习步、隔天才拉开间隔）。
 */
interface AggregatedItem {
	word: string;
	mode: ReviewMode;
	genMode: "writing" | "cyber";
	/** 本场该词的所有作答全对才算对（有一空错就是没掌握） */
	correct: boolean;
	elapsedMs: number;
}

/** 按 wordKey 聚合（纯函数）；顺序按首次出现，方便单测断言 */
function aggregateItemsByWord(
	items: ReviewCommitItem[],
): Map<string, AggregatedItem> {
	const out = new Map<string, AggregatedItem>();
	for (const item of items) {
		const key = wordKey(item.word);
		if (!key) continue;
		const current = out.get(key);
		if (current) {
			current.correct = current.correct && item.correct;
			current.elapsedMs += Math.max(0, Math.round(item.elapsedMs));
			continue;
		}
		out.set(key, {
			word: item.word,
			mode: item.mode,
			genMode: item.genMode,
			correct: item.correct,
			elapsedMs: Math.max(0, Math.round(item.elapsedMs)),
		});
	}
	return out;
}

/** 写回一场默写：卡片 + 日志 + 场次（store 内一个事务）+ 今日进度 */
export function commitReviews(options: {
	reviewStore: ReviewStore;
	bankStore: BankStore;
	bankId: string;
	items: ReviewCommitItem[];
	now: Date;
	requestRetention?: number;
	session?: SessionCommitInput | null;
}): CommitResult {
	const { reviewStore, bankStore, bankId, now } = options;
	const bank = bankStore.read(bankId);
	const entries = bank?.entries ?? [];
	const cards = reviewStore.readCards(bankId);
	const updated: CommittedWord[] = [];
	const logs: ReviewLogRecord[] = [];
	const changed = new Map<string, StoredCard>();
	const session = options.session
		? clampSession(options.session, bankId, now)
		: null;
	// 卡片按词聚合（每词一场只推进一次）；日志保持逐题（正确率/耗时按题看）
	const aggregated = aggregateItemsByWord(options.items);
	const scheduler = createScheduler({
		requestRetention: options.requestRetention,
	});

	/** 每个词的卡片推进结果（供逐题日志共享同一套「卡片之后是什么样」） */
	const outcomes = new Map<
		string,
		{
			stateBefore: number;
			intervalBeforeDays: number;
			queueKind: CommittedWord["queueKind"];
			next: Card;
		}
	>();

	for (const [key, item] of aggregated) {
		const existing = parseCard(cards[key]);
		const card = existing ?? scheduler.createCard(now);
		const stateBefore = card.state;
		const intervalBeforeDays = existing ? intervalDaysOf(card) : 0;
		const rating = ratingForCorrect(item.correct);
		const { card: next } = scheduler.review(card, rating, now);
		const stored = serializeCard(next);
		cards[key] = stored;
		changed.set(key, stored);
		const info = nextDueInfo(next, now);
		const queueKind = queueKindOf(stateBefore, Boolean(existing));
		outcomes.set(key, { stateBefore, intervalBeforeDays, queueKind, next });
		updated.push({
			word: item.word,
			rating,
			due: next.due.toISOString(),
			inDays: info.inDays,
			laterToday: info.laterToday,
			queueKind,
		});
	}

	for (const item of options.items) {
		const key = wordKey(item.word);
		const outcome = key ? outcomes.get(key) : undefined;
		if (!outcome) continue;
		const next = outcome.next;
		logs.push({
			at: now.getTime(),
			word: item.word,
			bankId,
			// 日志按题记：rating/correct 是这一题的判定；卡片状态字段来自该词的聚合推进
			rating: ratingForCorrect(item.correct),
			correct: item.correct,
			mode: item.mode,
			genMode: item.genMode,
			elapsedMs: Math.max(0, Math.round(item.elapsedMs)),
			queueKind: outcome.queueKind,
			stateBefore: outcome.stateBefore,
			intervalBeforeDays: outcome.intervalBeforeDays,
			intervalAfterDays: intervalDaysOf(next),
			stabilityAfter: next.stability,
			difficultyAfter: next.difficulty,
			...(session ? { sessionId: session.id } : {}),
		});
	}

	// 场次得分以实际判定为准，不信任客户端传的 correct；分母是逐题日志条数（「最近练习」用
	// judged），所以这里也按题数夹取——旧实现夹到 word_count，组句多空时会出现 2/2 这种假满分。
	if (session && session.genMode === "cyber") {
		session.correct = Math.min(
			logs.length,
			logs.filter((log) => log.correct).length,
		);
	}

	const payload: CommitPayload = {
		cards: [...changed.entries()].map(([key, card]) => ({ key, card })),
		logs,
		session,
	};
	const outcome = reviewStore.commit(bankId, payload);
	const date = localDateKey(now);
	const day = reviewStore.readDayStats(bankId, date);
	const freshCards = outcome.duplicate ? reviewStore.readCards(bankId) : cards;
	return {
		updated: outcome.duplicate ? [] : updated,
		progress: {
			date,
			// target 由队列/prefs 负责；commit 响应不作为进度条数据源
			target: 0,
			done: doneWordsToday(entries, freshCards, now).length,
			correct: day.correct,
			total: day.total,
			elapsedMs: day.elapsedMs,
		},
	};
}
