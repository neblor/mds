/**
 * 音标池（纯逻辑，可单测）
 *
 * 池子 = 答案所需的 token 多重集合（同词多读音按 token 取最大重数的并集）
 *      + 4–6 个易混干扰项（排除答案已有符号；不含重音）。
 *
 * 重复 token 是**不同的池内下标**，UI 按 index 记录选择/置灰，
 * 避免「点了一个 ə 两块都变灰」。
 */
import {
	IPA_SYMBOLS,
	isStressToken,
	phoneticTokenKind,
	type PhoneticTokenKind,
} from "./phonetic-symbols";

/** 默认池子上限（答案本身超限时以答案完整为先） */
export const PHONETIC_POOL_MAX = 20;

/**
 * 池子按固定 tile 宽度自动换行时，一行放得下几个。
 *
 * 池子不是等宽行列，方向键 ↑/↓ 的步长必须跟着实际列数走，
 * 否则窄窗口（5 列）按 8 列跳会越过真实邻居。
 */
export function columnsForWidth(
	width: number,
	tileWidth: number,
	gap: number,
): number {
	if (!(tileWidth > 0) || !(width > 0)) return 1;
	const safeGap = Math.max(0, gap);
	return Math.max(
		1,
		Math.floor((width + safeGap) / (tileWidth + safeGap)),
	);
}

export interface PhoneticPoolItem {
	/** 池内下标（唯一；重复 token 也是不同下标） */
	index: number;
	token: string;
	kind: PhoneticTokenKind;
}

export interface BuildPhoneticPoolOptions {
	/** 干扰项数量；默认按答案唯一 token 数取 4–6 */
	decoyCount?: number;
	shuffleFn?: <T>(list: T[]) => T[];
	maxPool?: number;
}

/** 易混音素表：只用于挑干扰项，不参与判定 */
export const PHONETIC_CONFUSABLE: Record<string, string[]> = {
	"iː": ["ɪ", "i"],
	"i": ["iː", "ɪ"],
	"ɪ": ["iː", "i", "e"],
	e: ["æ", "ɪ"],
	"æ": ["e", "ʌ"],
	"ɑː": ["ʌ", "ɒ"],
	"ɒ": ["ɔː", "ʌ"],
	"ɔː": ["ɒ", "əʊ"],
	"ʊ": ["uː", "ə"],
	"uː": ["ʊ", "ɔː"],
	"ʌ": ["ɑː", "æ", "ɒ"],
	"ɜː": ["ə", "ɔː"],
	"ə": ["ʌ", "ɪ", "ɜː"],
	"eɪ": ["aɪ", "e"],
	"aɪ": ["eɪ", "ɔɪ"],
	"ɔɪ": ["aɪ", "əʊ"],
	"əʊ": ["ɔː", "aʊ"],
	"aʊ": ["əʊ", "ɔː"],
	"ɪə": ["eə", "iː"],
	"eə": ["ɪə", "æ"],
	"ʊə": ["ɔː", "uː"],
	p: ["b", "t"],
	b: ["p", "d"],
	t: ["d", "k"],
	d: ["t", "ɡ"],
	k: ["ɡ", "t"],
	"ɡ": ["k", "d"],
	"tʃ": ["dʒ", "ʃ"],
	"dʒ": ["tʃ", "ʒ"],
	f: ["v", "θ"],
	v: ["f", "ð"],
	"θ": ["ð", "s"],
	"ð": ["θ", "z"],
	s: ["z", "ʃ"],
	z: ["s", "ʒ"],
	"ʃ": ["ʒ", "s"],
	"ʒ": ["ʃ", "z"],
	h: ["w", "f"],
	m: ["n", "ŋ"],
	n: ["m", "ŋ"],
	"ŋ": ["n", "m"],
	l: ["r", "n"],
	r: ["l", "w"],
	w: ["v", "r"],
	j: ["i", "dʒ"],
};

function defaultShuffle<T>(list: T[]): T[] {
	const copy = [...list];
	for (let index = copy.length - 1; index > 0; index -= 1) {
		const swap = Math.floor(Math.random() * (index + 1));
		[copy[index], copy[swap]] = [copy[swap], copy[index]];
	}
	return copy;
}

function defaultDecoyCount(uniqueAnswerCount: number): number {
	return Math.min(6, Math.max(4, Math.ceil(uniqueAnswerCount / 2)));
}

export function buildPhoneticPool(
	variants: string[][],
	options: BuildPhoneticPoolOptions = {},
): PhoneticPoolItem[] {
	const counts = new Map<string, number>();
	for (const variant of variants) {
		const local = new Map<string, number>();
		for (const token of variant) {
			local.set(token, (local.get(token) ?? 0) + 1);
		}
		for (const [token, count] of local) {
			counts.set(token, Math.max(counts.get(token) ?? 0, count));
		}
	}
	const answer = [...counts].flatMap(([token, count]) =>
		Array.from({ length: count }, () => token),
	);
	if (answer.length === 0) return [];
	const answerSet = new Set(answer);
	const maxPool = Math.max(1, options.maxPool ?? PHONETIC_POOL_MAX);
	const desired = options.decoyCount ?? defaultDecoyCount(answerSet.size);
	const decoyCount = Math.max(0, Math.min(desired, maxPool - answer.length));

	const candidates = new Set<string>();
	for (const token of answerSet) {
		for (const confusable of PHONETIC_CONFUSABLE[token] ?? []) {
			if (!answerSet.has(confusable) && !isStressToken(confusable)) {
				candidates.add(confusable);
			}
		}
	}
	const decoys = defaultShuffle([...candidates]).slice(0, decoyCount);
	if (decoys.length < decoyCount) {
		const fillers = defaultShuffle(
			IPA_SYMBOLS.filter(
				(token) =>
					!isStressToken(token) &&
					!answerSet.has(token) &&
					!decoys.includes(token),
			),
		);
		for (const token of fillers) {
			if (decoys.length >= decoyCount) break;
			decoys.push(token);
		}
	}

	const shuffle = options.shuffleFn ?? defaultShuffle;
	return shuffle([...answer, ...decoys]).map((token, index) => {
		const kind = phoneticTokenKind(token);
		if (!kind) throw new Error(`非法音素 token：${token}`);
		return { index, token, kind };
	});
}
