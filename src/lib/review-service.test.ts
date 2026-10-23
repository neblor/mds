import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBankStore } from "./bank-store";
import { createReviewStore } from "./review-store";
import { buildQueueForBank, buildCommitItems, clampTodayTarget, commitReviews } from "./review-service";
import { buildResultRows, rowJudgement, type WordRoundLike } from "./results";
import { localDateKey } from "./daily-queue";
import type { BankEntry, WordBank } from "./bank-types";

const dirs: string[] = [];
const NOW = new Date(2026, 9, 12, 10, 0, 0);

function tempStores() {
	const dir = mkdtempSync(join(tmpdir(), "mds-review-service-"));
	dirs.push(dir);
	return {
		bankStore: createBankStore(join(dir, "banks")),
		reviewStore: createReviewStore(join(dir, "review")),
	};
}

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeBank(id: string, words: [string, number?][]): WordBank {
	const entries: BankEntry[] = words.map(([word, frq]) =>
		frq === undefined ? { word } : { word, frq },
	);
	return {
		id,
		name: `库 ${id}`,
		source: "custom",
		version: 1,
		entries,
		createdAt: NOW.getTime(),
		updatedAt: NOW.getTime(),
	};
}

describe("clampTodayTarget", () => {
	it("夹到 5–100，非法回落 20", () => {
		expect(clampTodayTarget(20)).toBe(20);
		expect(clampTodayTarget(1)).toBe(5);
		expect(clampTodayTarget(999)).toBe(100);
		expect(clampTodayTarget("30")).toBe(30);
		expect(clampTodayTarget("x")).toBe(20);
		expect(clampTodayTarget(undefined)).toBe(20);
		expect(clampTodayTarget(20.6)).toBe(21);
	});
});

describe("buildQueueForBank", () => {
	it("词库不存在返回 null", () => {
		const { bankStore, reviewStore } = tempStores();
		expect(
			buildQueueForBank({ bankStore, reviewStore, bankId: "nope", target: 10, now: NOW }),
		).toBeNull();
	});

	it("新词库：按词频取前 N 个，并回传目标", () => {
		const { bankStore, reviewStore } = tempStores();
		bankStore.write(
			makeBank("b1", [
				["low", 5000],
				["high", 100],
				["mid", 2000],
			]),
		);
		// 目标下限是 5（界面步进器同上），词库只有 3 个词 → 全部取出
		const result = buildQueueForBank({
			bankStore,
			reviewStore,
			bankId: "b1",
			target: 5,
			now: NOW,
		});
		expect(result?.queue.fresh).toEqual(["high", "mid", "low"]);
		expect(result?.queue.reviews).toEqual([]);
		expect(result?.progress).toMatchObject({
			date: localDateKey(NOW),
			target: 5,
			done: 0,
			correct: 0,
			total: 0,
		});
		expect(result?.progress.target).toBe(5);
	});

	it("目标越界时夹取后再回传", () => {
		const { bankStore, reviewStore } = tempStores();
		bankStore.write(makeBank("b1", [["a", 1]]));
		const result = buildQueueForBank({
			bankStore,
			reviewStore,
			bankId: "b1",
			target: 9999,
			now: NOW,
		});
		expect(result?.queue.target).toBe(100);
		expect(result?.progress.target).toBe(100);
	});

	it("队列返回词的英文释义（组句出题用），只含队列词且有释义的词", () => {
		const { bankStore, reviewStore } = tempStores();
		const bank = makeBank("b1", [
			["apple", 10],
			["banana", 20],
			["cherry", 30],
			["date", 40],
			["elderberry", 50],
			["fig", 60],
		]);
		bank.entries[0].definition = "a round fruit";
		bank.entries[1].definition = "   ";
		bank.entries[5].definition = "a small sweet fruit"; // 词频最低，不在队列里
		bankStore.write(bank);

		const result = buildQueueForBank({
			bankStore,
			reviewStore,
			bankId: "b1",
			target: 5,
			now: NOW,
		});
		expect(result?.queue.words).toEqual([
			"apple",
			"banana",
			"cherry",
			"date",
			"elderberry",
		]);
		expect(result?.definitions).toEqual({ apple: "a round fruit" });
	});
});

describe("短句写回", () => {
	/**
	 * 生产形状：短句轮的字段是 `sentence`（由 buildResultRows 产出），只有降级轮才是
	 * `word`。这里必须走 buildResultRows 而不是手搓 fields——曾经手搓成 word 字段，
	 * 于是测试全绿而生产写回恒为空。
	 */
	const sentenceRound = (
		overrides: Partial<WordRoundLike> = {},
	): WordRoundLike => ({
		kind: "word",
		word: "apple",
		audioName: "a_red_apple_en-us-avaneural_1.mp3",
		variant: "sentence",
		sentence: "a red apple",
		answer: "a red apple",
		...overrides,
	});

	it("有标准整句的轮次记 sentence，降级轮（无句子）记 word", () => {
		const rows = buildResultRows(
			[
				sentenceRound(),
				sentenceRound({
					// 降级轮：本词没拿到合格短句，按单词默写
					word: "banana",
					audioName: "banana_en-us-avaneural_2.mp3",
					variant: "word",
					sentence: undefined,
					answer: "banana",
				}),
			],
			"cyber",
			"sentence",
		);
		const items = buildCommitItems({
			rows,
			mode: "sentence",
			genMode: "cyber",
			elapsedMs: [4000, 2000],
		});
		expect(items).toEqual([
			{
				word: "apple",
				correct: true,
				mode: "sentence",
				genMode: "cyber",
				elapsedMs: 4000,
			},
			{
				word: "banana",
				correct: true,
				// 降级轮按单词轮记账，避免污染短句模式的统计
				mode: "word",
				genMode: "cyber",
				elapsedMs: 2000,
			},
		]);
	});

	it("回归：短句场次真的写进 cards / review_log（写回为空曾让档案页全空）", () => {
		const { bankStore, reviewStore } = tempStores();
		bankStore.write(makeBank("b1", [["apple", 10], ["banana", 20]]));
		const rows = buildResultRows(
			[
				sentenceRound({ answer: "A  Red apple!" }),
				sentenceRound({
					word: "banana",
					sentence: "a yellow banana",
					answer: "a yellow apples",
				}),
			],
			"cyber",
			"sentence",
		);
		const result = commitReviews({
			bankStore,
			reviewStore,
			bankId: "b1",
			items: buildCommitItems({
				rows,
				mode: "sentence",
				genMode: "cyber",
				elapsedMs: [3000, 4000],
			}),
			now: NOW,
			session: {
				id: "s-sentence",
				genMode: "cyber",
				contentMode: "sentence",
				words: ["apple", "banana"],
				correct: 1,
				activeMs: 7000,
				wallMs: 20000,
			},
		});

		expect(result.updated.map((entry) => entry.word)).toEqual(["apple", "banana"]);
		const logs = reviewStore.readLogs("b1");
		expect(logs.map((log) => [log.word, log.mode, log.correct])).toEqual([
			["apple", "sentence", true],
			["banana", "sentence", false],
		]);
		expect(logs.map((log) => log.sessionId)).toEqual(["s-sentence", "s-sentence"]);
		expect(Object.keys(reviewStore.readCards("b1")).sort()).toEqual([
			"apple",
			"banana",
		]);
		const day = reviewStore.readDayStats("b1", localDateKey(NOW));
		expect(day).toMatchObject({ total: 2, correct: 1, elapsedMs: 7000 });
		// 场次得分以实际判定为准（客户端传什么都会被服务端重算）
		expect(reviewStore.readSessions("b1")[0]).toMatchObject({
			contentMode: "sentence",
			correct: 1,
		});
	});

	it("其余模式不受影响：mode 原样保留", () => {
		const items = buildCommitItems({
			rows: [
				{
					word: "apple",
					fields: [{ kind: "word", graded: true, correct: true }],
				},
			],
			mode: "cloze",
			genMode: "cyber",
		});
		expect(items[0]?.mode).toBe("cloze");
	});
});

describe("组句写回", () => {
	it("组句轮每空一行，取「单词判定字段」；无 roundIndex 时按行号兼容（一行一轮）", () => {
		const items = buildCommitItems({
			rows: [
				{
					word: "apple",
					fields: [
						{
							kind: "word",
							graded: true,
							correct: true,
						},
					],
				},
				{
					word: "umbrella",
					fields: [
						{
							kind: "word",
							graded: true,
							correct: false,
						},
					],
				},
			],
			mode: "cloze",
			genMode: "cyber",
			elapsedMs: [3000, 2500],
		});
		expect(items).toEqual([
			{
				word: "apple",
				correct: true,
				mode: "cloze",
				genMode: "cyber",
				elapsedMs: 3000,
			},
			{
				word: "umbrella",
				correct: false,
				mode: "cloze",
				genMode: "cyber",
				elapsedMs: 2500,
			},
		]);
	});

	it("同一轮多个空共用一次轮耗时：按轮均分，不会后几空拿不到耗时", () => {
		const items = buildCommitItems({
			rows: [
				{ roundIndex: 0, word: "apple", fields: [{ kind: "word", graded: true, correct: true }] },
				{ roundIndex: 0, word: "banana", fields: [{ kind: "word", graded: true, correct: true }] },
				{ roundIndex: 1, word: "cherry", fields: [{ kind: "word", graded: true, correct: false }] },
			],
			mode: "cloze",
			genMode: "cyber",
			elapsedMs: [12000, 9000],
		});
		expect(items.map((item) => item.elapsedMs)).toEqual([6000, 6000, 9000]);
	});

	it("释义模式：拼写对但释义错 → 这一题记错（与结算页判错一致）", () => {
		const rows = buildResultRows(
			[
				{
					kind: "word",
					word: "apple",
					audioName: "apple_en-us-avaneural_1.mp3",
					definition: "a round fruit",
					answer: "apple",
					answerDef: "a long vehicle",
				},
			],
			"cyber",
			"definition",
		);
		// 结算页：两个判定字段必须都对
		expect(rowJudgement(rows[0])).toBe(false);
		const items = buildCommitItems({
			rows,
			mode: "definition",
			genMode: "cyber",
			elapsedMs: [8000],
		});
		expect(items[0]?.correct).toBe(false);
	});

	it("释义模式：两段都对才算对", () => {
		const rows = buildResultRows(
			[
				{
					kind: "word",
					word: "apple",
					audioName: "apple_en-us-avaneural_1.mp3",
					definition: "a round fruit",
					answer: "apple",
					answerDef: "a round fruit",
				},
			],
			"cyber",
			"definition",
		);
		const items = buildCommitItems({
			rows,
			mode: "definition",
			genMode: "cyber",
			elapsedMs: [8000],
		});
		expect(items[0]?.correct).toBe(true);
	});

	it("commitReviews：cloze 模式对/错分别进调度，日志 mode=cloze", () => {
		const { bankStore, reviewStore } = tempStores();
		bankStore.write(makeBank("b1", [["apple", 10], ["umbrella", 20]]));
		const result = commitReviews({
			bankStore,
			reviewStore,
			bankId: "b1",
			items: [
				{ word: "apple", correct: true, mode: "cloze", genMode: "cyber", elapsedMs: 3000 },
				{ word: "umbrella", correct: false, mode: "cloze", genMode: "cyber", elapsedMs: 2500 },
			],
			now: NOW,
		});
		expect(result.updated.map((entry) => entry.rating)).toEqual([3, 1]);
		expect(result.progress).toMatchObject({ done: 2, correct: 1, total: 2, elapsedMs: 5500 });
		const logs = reviewStore.readLogs("b1");
		expect(logs.map((log) => log.mode)).toEqual(["cloze", "cloze"]);
		expect(logs.every((log) => log.genMode === "cyber")).toBe(true);
		expect(Object.keys(reviewStore.readCards("b1")).sort()).toEqual([
			"apple",
			"umbrella",
		]);
	});
});

describe("场次写回", () => {
	it("书写场次 items 为空也写入 sessions，且不改卡片/日志", () => {
		const { bankStore, reviewStore } = tempStores();
		bankStore.write(makeBank("b1", [["apple", 10], ["banana", 20]]));
		const result = commitReviews({
			bankStore,
			reviewStore,
			bankId: "b1",
			items: [],
			now: NOW,
			session: {
				id: "s-writing",
				genMode: "writing",
				contentMode: "word",
				words: ["apple", "banana"],
				correct: null,
				activeMs: 5000,
				wallMs: 12000,
			},
		});
		expect(result.updated).toEqual([]);
		expect(result.progress).toMatchObject({
			done: 0,
			correct: 0,
			total: 0,
			elapsedMs: 0,
		});
		const sessions = reviewStore.readSessions("b1");
		expect(sessions).toHaveLength(1);
		expect(sessions[0]).toMatchObject({
			id: "s-writing",
			genMode: "writing",
			correct: null,
			words: ["apple", "banana"],
		});
		expect(reviewStore.readCards("b1")).toEqual({});
		expect(reviewStore.readLogs("b1")).toEqual([]);
	});

	it("赛博场次给日志补 sessionId，得分以实际判定为准", () => {
		const { bankStore, reviewStore } = tempStores();
		bankStore.write(makeBank("b1", [["apple", 10], ["umbrella", 20]]));
		const result = commitReviews({
			bankStore,
			reviewStore,
			bankId: "b1",
			items: [
				{ word: "apple", correct: true, mode: "word", genMode: "cyber", elapsedMs: 2000 },
				{ word: "umbrella", correct: false, mode: "word", genMode: "cyber", elapsedMs: 3000 },
			],
			now: NOW,
			session: {
				id: "s-cyber",
				genMode: "cyber",
				contentMode: "word",
				words: ["apple", "umbrella"],
				correct: 99,
				activeMs: 5000,
				wallMs: 4000,
			},
		});
		expect(result.progress).toMatchObject({ correct: 1, total: 2, elapsedMs: 5000 });
		const sessions = reviewStore.readSessions("b1");
		expect(sessions[0]).toMatchObject({
			id: "s-cyber",
			correct: 1,
			activeMs: 5000,
			wallMs: 5000,
		});
		expect(reviewStore.readLogs("b1").every((log) => log.sessionId === "s-cyber")).toBe(true);
	});
});

describe("commitReviews", () => {
	it("新词答对：建卡 + 写日志，进度由当日日志聚合 +1", () => {
		const { bankStore, reviewStore } = tempStores();
		bankStore.write(makeBank("b1", [["apple", 10], ["banana", 20]]));
		const result = commitReviews({
			bankStore,
			reviewStore,
			bankId: "b1",
			items: [
				{ word: "apple", correct: true, mode: "definition", genMode: "cyber", elapsedMs: 4200 },
			],
			now: NOW,
		});

		expect(result.updated).toHaveLength(1);
		expect(result.updated[0]).toMatchObject({ word: "apple", rating: 3, queueKind: "new" });
		expect(result.progress).toMatchObject({ done: 1, correct: 1, total: 1, elapsedMs: 4200 });

		const cards = reviewStore.readCards("b1");
		expect(Object.keys(cards)).toEqual(["apple"]);
		expect(cards.apple.state).toBe(1); // Learning

		const logs = reviewStore.readLogs("b1");
		expect(logs).toHaveLength(1);
		expect(logs[0]).toMatchObject({
			word: "apple",
			bankId: "b1",
			rating: 3,
			correct: true,
			mode: "definition",
			genMode: "cyber",
			elapsedMs: 4200,
			queueKind: "new",
			stateBefore: 0,
			intervalBeforeDays: 0,
		});
		expect(logs[0].stabilityAfter).toBeGreaterThan(0);
	});

	it("答错记 rating=1，并在队列重算后仍然可见（学习步内会回来）", () => {
		const { bankStore, reviewStore } = tempStores();
		bankStore.write(makeBank("b1", [["apple", 10], ["banana", 20]]));
		const result = commitReviews({
			bankStore,
			reviewStore,
			bankId: "b1",
			items: [
				{ word: "apple", correct: false, mode: "word", genMode: "cyber", elapsedMs: 900 },
			],
			now: NOW,
		});
		expect(result.updated[0].rating).toBe(1);
		expect(result.progress.correct).toBe(0);

		// 立刻重算队列：刚答错的词在 1 分钟学习步内，此刻还没到点 → 不进队列
		const immediate = buildQueueForBank({
			bankStore,
			reviewStore,
			bankId: "b1",
			target: 10,
			now: NOW,
		});
		expect(immediate?.queue.words).not.toContain("apple");
		expect(immediate?.progress.done).toBe(1);

		// 2 分钟后到点 → 回到队列
		const later = buildQueueForBank({
			bankStore,
			reviewStore,
			bankId: "b1",
			target: 10,
			now: new Date(NOW.getTime() + 2 * 60 * 1000),
		});
		expect(later?.queue.reviews).toContain("apple");
	});

	it("已毕业的卡答错 → 进重学且 lapses 累计；重学卡再考时 queueKind=relearn", () => {
		const { bankStore, reviewStore } = tempStores();
		bankStore.write(makeBank("b1", [["apple", 10]]));
		// 连续答对两次让它毕业
		commitReviews({
			bankStore, reviewStore, bankId: "b1",
			items: [{ word: "apple", correct: true, mode: "word", genMode: "cyber", elapsedMs: 1 }],
			now: NOW,
		});
		commitReviews({
			bankStore, reviewStore, bankId: "b1",
			items: [{ word: "apple", correct: true, mode: "word", genMode: "cyber", elapsedMs: 1 }],
			now: new Date(NOW.getTime() + 10 * 60 * 1000),
		});
		expect(reviewStore.readCards("b1").apple.state).toBe(2); // Review

		// 队列来源看的是「进场时它是哪类卡」：这张是到期复习 → queueKind 仍是 review
		const failing = commitReviews({
			bankStore, reviewStore, bankId: "b1",
			items: [{ word: "apple", correct: false, mode: "word", genMode: "cyber", elapsedMs: 1 }],
			now: new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
		});
		expect(failing.updated[0].queueKind).toBe("review");
		expect(reviewStore.readCards("b1").apple.lapses).toBe(1);
		expect(reviewStore.readCards("b1").apple.state).toBe(3); // Relearning
		expect(reviewStore.readLogs("b1").at(-1)?.stateBefore).toBe(2);

		// 重学步内再考一次：这次进场就是重学卡 → relearn
		const relearn = commitReviews({
			bankStore, reviewStore, bankId: "b1",
			items: [{ word: "apple", correct: true, mode: "word", genMode: "cyber", elapsedMs: 1 }],
			now: new Date(NOW.getTime() + 24 * 60 * 60 * 1000 + 11 * 60 * 1000),
		});
		expect(relearn.updated[0].queueKind).toBe("relearn");
		expect(reviewStore.readLogs("b1").at(-1)?.stateBefore).toBe(3);
	});

	it("同一个词在一次提交里出现两次：卡片只推进一次，日志仍逐题", () => {
		const { bankStore, reviewStore } = tempStores();
		bankStore.write(makeBank("b1", [["apple", 10]]));
		const result = commitReviews({
			bankStore, reviewStore, bankId: "b1",
			items: [
				{ word: "apple", correct: false, mode: "cloze", genMode: "cyber", elapsedMs: 1 },
				{ word: "apple", correct: true, mode: "cloze", genMode: "cyber", elapsedMs: 1 },
			],
			now: NOW,
		});
		// 卡片：每词一场只推进一次（有一空错 → 该词记错）
		expect(result.updated).toHaveLength(1);
		expect(result.updated[0]).toMatchObject({ word: "apple", rating: 1 });
		// 日志：逐题保留，正确率/耗时按题看
		expect(result.progress.total).toBe(2);
		expect(result.progress.correct).toBe(1);
		expect(reviewStore.readLogs("b1")).toHaveLength(2);
	});

	it("同一个词两次全对：只推一次，不会当天直接毕业（旧实现会跳到 2 天后）", () => {
		const { bankStore, reviewStore } = tempStores();
		bankStore.write(makeBank("b1", [["apple", 10]]));
		commitReviews({
			bankStore, reviewStore, bankId: "b1",
			items: [
				{ word: "apple", correct: true, mode: "cloze", genMode: "cyber", elapsedMs: 1 },
				{ word: "apple", correct: true, mode: "cloze", genMode: "cyber", elapsedMs: 1 },
			],
			now: NOW,
		});
		const card = reviewStore.readCards("b1").apple;
		expect(card.state).toBe(1); // Learning（停在短暂学习步，而不是直接进 Review）
		expect(card.scheduled_days).toBe(0);
	});

	it("场次得分按题计（逐空），与结算页一致；分母由 judged（日志条数）提供", () => {
		const { bankStore, reviewStore } = tempStores();
		bankStore.write(makeBank("b1", [["apple", 10], ["banana", 20]]));
		commitReviews({
			bankStore, reviewStore, bankId: "b1",
			items: [
				{ word: "apple", correct: true, mode: "cloze", genMode: "cyber", elapsedMs: 1000 },
				{ word: "apple", correct: false, mode: "cloze", genMode: "cyber", elapsedMs: 1000 },
				{ word: "banana", correct: true, mode: "cloze", genMode: "cyber", elapsedMs: 1000 },
			],
			now: NOW,
			session: {
				id: "s-cloze",
				genMode: "cyber",
				contentMode: "cloze",
				words: ["apple", "banana"],
				correct: 99,
				activeMs: 3000,
				wallMs: 5000,
			},
		});
		const session = reviewStore.readSessions("b1")[0];
		// 3 个空对 2 个；词只有 2 个。旧实现会把 correct 夹到 word_count（变成 2/2）。
		expect(session).toMatchObject({ correct: 2, words: ["apple", "banana"] });
		const recent = reviewStore.stats?.recentSessions("b1", 3)[0];
		expect(recent).toMatchObject({ judged: 3, wordCount: 2, correct: 2 });
	});

	it("空提交不写日志，但会返回当前进度", () => {
		const { bankStore, reviewStore } = tempStores();
		bankStore.write(makeBank("b1", [["apple", 10]]));
		const result = commitReviews({
			bankStore, reviewStore, bankId: "b1", items: [], now: NOW,
		});
		expect(result.updated).toEqual([]);
		expect(reviewStore.readLogs("b1")).toEqual([]);
		expect(result.progress.done).toBe(0);
	});

	it("词库里的词与卡片 key 大小写不一致也能对上（wordKey 归一）", () => {
		const { bankStore, reviewStore } = tempStores();
		bankStore.write(makeBank("b1", [["Give Up", 10]]));
		commitReviews({
			bankStore, reviewStore, bankId: "b1",
			items: [{ word: "give up", correct: true, mode: "word", genMode: "cyber", elapsedMs: 5 }],
			now: NOW,
		});
		expect(Object.keys(reviewStore.readCards("b1"))).toEqual(["give up"]);
		const queue = buildQueueForBank({
			bankStore, reviewStore, bankId: "b1", target: 10, now: NOW,
		});
		expect(queue?.progress.done).toBe(1);
	});

	it("跨日：昨天的 done 不会算进今天", () => {
		const { bankStore, reviewStore } = tempStores();
		bankStore.write(makeBank("b1", [["apple", 10], ["banana", 20]]));
		commitReviews({
			bankStore, reviewStore, bankId: "b1",
			items: [{ word: "apple", correct: true, mode: "word", genMode: "cyber", elapsedMs: 1 }],
			now: NOW,
		});
		const nextDay = new Date(2026, 9, 13, 9, 0, 0);
		const result = buildQueueForBank({
			bankStore, reviewStore, bankId: "b1", target: 10, now: nextDay,
		});
		expect(result?.progress.date).toBe("2026-10-13");
		expect(result?.progress.done).toBe(0);
		// 昨天的判定记录仍在（统计图要用）
		expect(reviewStore.readDayStats("b1", "2026-10-12").total).toBe(1);
	});

	it("期望保持率生效：0.97 的首次间隔不长于 0.7", () => {
		const low = tempStores();
		const high = tempStores();
		low.bankStore.write(makeBank("b1", [["apple", 10]]));
		high.bankStore.write(makeBank("b1", [["apple", 10]]));
		const run = (stores: ReturnType<typeof tempStores>, retention: number) => {
			commitReviews({
				bankStore: stores.bankStore, reviewStore: stores.reviewStore, bankId: "b1",
				items: [{ word: "apple", correct: true, mode: "word", genMode: "cyber", elapsedMs: 1 }],
				now: NOW, requestRetention: retention,
			});
			return commitReviews({
				bankStore: stores.bankStore, reviewStore: stores.reviewStore, bankId: "b1",
				items: [{ word: "apple", correct: true, mode: "word", genMode: "cyber", elapsedMs: 1 }],
				now: new Date(NOW.getTime() + 10 * 60 * 1000), requestRetention: retention,
			}).updated[0].inDays;
		};
		expect(run(high, 0.97)).toBeLessThanOrEqual(run(low, 0.7));
	});
});

describe("音标写回", () => {
	it("音标轮记 phonetic，降级单词轮记 word", () => {
		const rows = buildResultRows(
			[
				{
					kind: "phonetic",
					word: "apple",
					audioName: "apple.mp3",
					expected: "ˈ æ p ə l",
					variants: ["ˈ æ p ə l"],
					source: "dict",
					answerTokens: ["ˈ", "æ", "p", "ə", "l"],
				},
				{
					kind: "word",
					word: "banana",
					audioName: "banana.mp3",
					variant: "word",
					answer: "banana",
				},
			],
			"cyber",
			"phonetic",
		);
		const items = buildCommitItems({
			rows,
			mode: "phonetic",
			genMode: "cyber",
			elapsedMs: [4000, 2000],
		});
		expect(items).toEqual([
			{
				word: "apple",
				correct: true,
				mode: "phonetic",
				genMode: "cyber",
				elapsedMs: 4000,
			},
			{
				word: "banana",
				correct: true,
				mode: "word",
				genMode: "cyber",
				elapsedMs: 2000,
			},
		]);
	});
});
