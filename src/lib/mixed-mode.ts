/**
 * 混合模式（mixed）的轮次计划（纯逻辑，可单测）
 *
 * 口径（崔总 2026-10-29 拍板）：
 * - 每个词在「释义 / 中文词 / 短句」里**随机取 2 种**，各默一遍 → n 词 = 2n 轮
 * - 整场 2n 轮打乱，同一个词的两轮**至少隔 mixedMinGap(n) 轮**（不做两遍制）
 * - 第 1 次出现的释义/中文词轮是两段式；第 2 次出现只写第二步（见 roundAskOf）
 * - 某个模式的数据不可用（AI 没返回 / 短句没有音频）→ 改配到该词另一种可用模式，
 *   仍保持 2 轮/词；两种都不可用才降级为普通单词轮
 *
 * 顺序构造：种子布局（前 n 轮是各词第 1 次、后 n 轮是第 2 次，间隔恒为 n）
 * 再做随机换位，只接受不破坏间隔下限的交换 —— 因此下限是**构造性保证**，不靠重试。
 */
import type { ContentMode } from "./state";

export const MIXED_BASE_MODES = ["definition", "chinese", "sentence"] as const;
export type MixedBaseMode = (typeof MIXED_BASE_MODES)[number];
/** 混合轮实际使用的模式（降级时可能是普通单词轮） */
export type MixedRoundMode = MixedBaseMode | "word";

export interface MixedRoundSlot {
	word: string;
	mode: MixedRoundMode;
	/** 该词在本场第几次出现（按最终顺序判定：先出现的为 1） */
	pass: 1 | 2;
}

export type MixedRandom = () => number;

/** 同词两轮的间隔下限：10 词→3、20 词→6、30 词→9（上限恒 ≤ 词数） */
export function mixedMinGap(wordCount: number): number {
	const n = Math.max(0, Math.floor(wordCount));
	if (n < 2) return 0;
	return Math.max(3, Math.round(n * 0.3));
}

function wordKeyOf(word: string): string {
	return word.trim().toLowerCase();
}

/** 去重（大小写/首尾空格视为同词，保留首次出现的拼写与顺序） */
export function uniqueMixedWords(words: string[]): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const raw of words) {
		if (typeof raw !== "string") continue;
		const word = raw.trim();
		const key = wordKeyOf(word);
		if (!key || seen.has(key)) continue;
		seen.add(key);
		out.push(word);
	}
	return out;
}

/** 注入随机源的 Fisher–Yates（测试可锁序） */
function shuffleWith<T>(list: T[], random: MixedRandom): T[] {
	const a = [...list];
	for (let i = a.length - 1; i > 0; i -= 1) {
		const j = Math.min(i, Math.max(0, Math.floor(random() * (i + 1))));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

function gapOk(slots: { word: string }[], word: string, gap: number): boolean {
	let first = -1;
	for (let i = 0; i < slots.length; i += 1) {
		if (slots[i].word !== word) continue;
		if (first < 0) {
			first = i;
			continue;
		}
		return i - first >= gap;
	}
	return true;
}

export interface BuildMixedPlanOptions {
	words: string[];
	/** 注入随机源（0..1）；默认 Math.random */
	random?: MixedRandom;
}

/**
 * 生成混合场次的轮次计划（按最终播放顺序，pass 已按位置判定）。
 * 空词表返回空数组；同词重复项按 wordKey 去重。
 */
export function buildMixedPlan(options: BuildMixedPlanOptions): MixedRoundSlot[] {
	const words = uniqueMixedWords(options.words);
	const n = words.length;
	if (n === 0) return [];
	const random = options.random ?? Math.random;
	const randIndex = (bound: number): number =>
		Math.min(bound - 1, Math.max(0, Math.floor(random() * bound)));

	// 1) 每词取 2 种（等概率省略一种），再随机决定先后
	const pairs = shuffleWith(words, random).map((word) => {
		const omit = randIndex(MIXED_BASE_MODES.length);
		const kept = MIXED_BASE_MODES.filter((_, i) => i !== omit);
		const modes =
			random() < 0.5 ? [kept[0], kept[1]] : [kept[1], kept[0]];
		return { word, first: modes[0], second: modes[1] };
	});

	// 2) 种子布局：前 n 轮为各词第 1 次，后 n 轮为第 2 次
	const slots: { word: string; mode: MixedRoundMode }[] = [];
	for (const pair of pairs) slots.push({ word: pair.word, mode: pair.first });
	for (const pair of pairs) slots.push({ word: pair.word, mode: pair.second });

	// 3) 随机换位：只接受不破坏任何受影响词间隔的交换
	const gap = mixedMinGap(n);
	if (gap > 0) {
		const total = slots.length;
		const target = total * 3;
		let accepted = 0;
		let attempts = 0;
		const maxAttempts = Math.max(60, total * 10);
		while (accepted < target && attempts < maxAttempts) {
			attempts += 1;
			const a = randIndex(total);
			const b = randIndex(total);
			if (a === b || slots[a].word === slots[b].word) continue;
			[slots[a], slots[b]] = [slots[b], slots[a]];
			if (gapOk(slots, slots[a].word, gap) && gapOk(slots, slots[b].word, gap)) {
				accepted += 1;
				continue;
			}
			[slots[a], slots[b]] = [slots[b], slots[a]];
		}
	}

	// 4) pass 按最终位置重算（先出现 = 1）
	const seen = new Set<string>();
	return slots.map((slot) => {
		const key = wordKeyOf(slot.word);
		const pass: 1 | 2 = seen.has(key) ? 2 : 1;
		seen.add(key);
		return { word: slot.word, mode: slot.mode, pass };
	});
}

export interface MixedDegradation {
	word: string;
	pass: 1 | 2;
	from: MixedBaseMode;
	to: MixedRoundMode;
}

/**
 * 按「数据是否可用」改配轮次模式，**保持顺序与 pass 不变**（不缩短场次）。
 *
 * 规则：该词另一种可用模式优先；两种都不可用 → 普通单词轮（word）。
 * 例：短句生成失败时，`释义+短句` 的词变成 `释义+中文词`（中文词可用的话）。
 */
export function applyMixedAvailability(
	rounds: MixedRoundSlot[],
	isAvailable: (word: string, mode: MixedBaseMode) => boolean,
): { rounds: MixedRoundSlot[]; degraded: MixedDegradation[] } {
	const used = new Map<string, Set<string>>();
	for (const round of rounds) {
		if (round.mode === "word") continue;
		const key = wordKeyOf(round.word);
		const set = used.get(key) ?? new Set<string>();
		set.add(round.mode);
		used.set(key, set);
	}
	const degraded: MixedDegradation[] = [];
	const next = rounds.map((round) => {
		if (round.mode === "word" || isAvailable(round.word, round.mode)) {
			return round;
		}
		const key = wordKeyOf(round.word);
		const usedByWord = used.get(key) ?? new Set<string>();
		const candidate = MIXED_BASE_MODES.find(
			(mode) =>
				mode !== round.mode && !usedByWord.has(mode) && isAvailable(round.word, mode),
		);
		const to: MixedRoundMode = candidate ?? "word";
		degraded.push({ word: round.word, pass: round.pass, from: round.mode, to });
		usedByWord.delete(round.mode);
		usedByWord.add(to);
		return { ...round, mode: to };
	});
	return { rounds: next, degraded };
}

/**
 * 本轮要写什么（作答形态的唯一真源）
 * - `word`：只听写单词（普通单词轮 / 音标轮 / 降级轮）
 * - `word+second`：两段式（先单词，再释义/中文词）——第 1 次出现的释义/中文词轮
 * - `second`：只写第二步——第 2 次出现的释义/中文词轮
 * - `sentence`：整句默写
 */
export type RoundAsk = "word" | "word+second" | "second" | "sentence";

export interface RoundAskInput {
	/** 轮级模式（混合场次必填；单一模式场次缺省） */
	mode?: string;
	/** 该词第几次出现（混合场次） */
	pass?: 1 | 2;
	/** 短句场次里没有合格短句的降级轮为 "word" */
	variant?: "word" | "sentence";
}

export function roundAskOf(
	round: RoundAskInput,
	sessionMode: ContentMode,
): RoundAsk {
	const mode = (round.mode ?? sessionMode) as string;
	if (mode === "sentence") {
		// 短句场次的降级轮（variant=word）按单词轮渲染
		return round.variant === "word" ? "word" : "sentence";
	}
	if (mode === "definition" || mode === "chinese") {
		return round.pass === 2 ? "second" : "word+second";
	}
	return "word";
}

/** 混合场次里「第 2 次出现的释义/中文词轮」= 只写第二步 */
export function isSecondStepOnly(round: RoundAskInput): boolean {
	return round.pass === 2 && (round.mode === "definition" || round.mode === "chinese");
}

/** 第二轮/单步轮的中文名（界面提示用） */
export function secondStepLabel(round: RoundAskInput): "释义" | "中文词" {
	return round.mode === "chinese" ? "中文词" : "释义";
}
