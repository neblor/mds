/**
 * 音标文本解析与重音归位（纯逻辑，客户端/服务端/构建脚本共用）
 *
 * 关键约定：
 * - 内部统一用 **token 数组**；长元音、双元音、塞擦音都是单个 token；
 * - Britfone 的 `ˈ`/`ˌ` 挂在重读元音上（`w ˈɔː t ə`），标准 IPA 写在音节首
 *   （`ˈ w ɔː t ə`）。这里用「最大音节首」规则把重音归位到音节第一个音素前；
 * - 判定时两端都先归位，所以用户把 `ˈ` 点在元音前或音节首前，只要重读元音相同就等价；
 * - AI 输出可能带斜杠/方括号/音节点/`:`` 等非标准写法，先清洗再最长匹配；
 * - 不对 `i` / `iː` / `ɪ` 做互相宽容（音标表上是不同的音）。
 */
import {
	IPA_CONSONANTS,
	IPA_TOKEN_SET,
	IPA_TOKENS_BY_LENGTH,
	isConsonantToken,
	isStressToken,
	isVowelToken,
} from "./phonetic-symbols";

/** 每个词最多保留几个读音变体（判定接受全部） */
export const PHONETIC_VARIANT_MAX = 3;

export interface PhoneticAnswer {
	/** 规范读音（第一个变体） */
	canonical: string[];
	/** 全部可接受读音 */
	variants: string[][];
	source: "dict" | "ai";
}

export interface ParsePhoneticOptions {
	/** dict 允许罕见的双主重音；ai 只允许一个 */
	source?: "dict" | "ai";
}

/** 英式音节首（用于把重音从元音前挪到音节首前；按 token 数组匹配） */
const ONSET_CLUSTERS: string[][] = [
	// 单辅音（ŋ 不能作音节首）
	...IPA_CONSONANTS.filter((token) => token !== "ŋ").map((token) => [token]),
	// 塞音/擦音 + 流音/滑音
	["p", "l"], ["p", "r"], ["p", "j"],
	["b", "l"], ["b", "r"], ["b", "j"],
	["t", "r"], ["t", "w"], ["t", "j"],
	["d", "r"], ["d", "w"], ["d", "j"],
	["k", "l"], ["k", "r"], ["k", "w"], ["k", "j"],
	["ɡ", "l"], ["ɡ", "r"], ["ɡ", "w"], ["ɡ", "j"],
	["f", "l"], ["f", "r"], ["f", "j"],
	["v", "j"],
	["θ", "r"], ["θ", "w"],
	["ʃ", "r"], ["ʃ", "w"], ["ʃ", "m"], ["ʃ", "n"], ["ʃ", "t"],
	["h", "j"], ["h", "w"],
	["m", "j"], ["n", "j"], ["l", "j"],
	// s + 塞音/鼻音/流音/擦音/滑音
	["s", "p"], ["s", "t"], ["s", "k"], ["s", "m"], ["s", "n"],
	["s", "l"], ["s", "w"], ["s", "f"], ["s", "v"], ["s", "j"],
	["t", "s"],
	// 三辅音
	["s", "p", "l"], ["s", "p", "r"], ["s", "t", "r"], ["s", "k", "r"],
	["s", "k", "w"], ["s", "k", "l"], ["s", "p", "j"], ["s", "t", "j"],
	["s", "k", "j"], ["s", "m", "j"],
];

const ONSET_KEYS = new Set(
	ONSET_CLUSTERS.map((cluster) => cluster.join("|")),
);

/**
 * 源文本清洗（只处理“另一种写法”，不改变音素本身）：
 * - 去掉可选括注、斜杠、方括号、音节点、逗号/分号、连字符；
 * - `:` → `ː`，`ә`（西里尔 schwa）→ `ə`，`ʧ/ʤ` → `tʃ/dʒ`；
 * - `ɹ → r`、`ɛ → e`、`ɛə → eə`、`ɐ → ʌ`、`g → ɡ`、`oʊ → əʊ`、`ɚ → ə`、`ɝ → ɜː`；
 * - 裸 `ɑ/ɜ/u` 视为长元音；`iə/uə` 视为 `ɪə/ʊə`；
 * - `'`/`’` 视为主重音。
 */
function cleanIpaText(text: string): string {
	return text
		.replace(/\([^)]*\)/g, " ")
		.replace(/:/g, "ː")
		.replace(/ә/g, "ə")
		.replace(/ʧ/g, "tʃ")
		.replace(/ʤ/g, "dʒ")
		.replace(/ɹ/g, "r")
		.replace(/ɛə/g, "eə")
		.replace(/ɛ/g, "e")
		.replace(/ɐ/g, "ʌ")
		.replace(/g/g, "ɡ")
		.replace(/oʊ/g, "əʊ")
		.replace(/ɚ/g, "ə")
		.replace(/ɝ/g, "ɜː")
		.replace(/iə/g, "ɪə")
		.replace(/uə/g, "ʊə")
		.replace(/ɜ(?!ː)/g, "ɜː")
		.replace(/ɑ(?!ː)/g, "ɑː")
		.replace(/u(?!ː)/g, "uː")
		.replace(/['’]/g, "ˈ")
		.replace(/[/[\]().,;]/g, " ")
		.replace(/-/g, " ");
}

/** 最长匹配切 token；无法识别返回 null（不静默丢符号） */
export function tokenizeIpa(text: string): string[] | null {
	const cleaned = cleanIpaText(String(text));
	const tokens: string[] = [];
	for (let index = 0; index < cleaned.length; ) {
		const char = cleaned[index];
		if (/\s/.test(char)) {
			index += 1;
			continue;
		}
		let matched: string | undefined;
		for (const token of IPA_TOKENS_BY_LENGTH) {
			if (cleaned.startsWith(token, index)) {
				matched = token;
				break;
			}
		}
		if (!matched) return null;
		tokens.push(matched);
		index += matched.length;
	}
	return tokens.length > 0 ? tokens : null;
}

/**
 * Britfone 的单个源 token → 内部 token 数组。
 * 源 token 可能带一个前缀重音（`ˈeɪ`/`ˌəʊ`），其余部分必须恰好是一个合法音素。
 */
export function normalizeSourceToken(raw: string): string[] | null {
	const tokens = tokenizeIpa(raw);
	if (!tokens) return null;
	const phonemes = tokens.filter((token) => !isStressToken(token));
	if (phonemes.length !== 1) return null;
	return tokens;
}

/**
 * 把每个重音标记移到「其后第一个元音所属音节」的最大合法音节首之前。
 * 例：`w ˈɔː t ə` → `ˈ w ɔː t ə`；`ɪ m p ˈɔː...` → `ɪ m ˈ p ɔː...`。
 * 重音后没有元音 → 返回 null（该变体不可用）。
 */
export function normalizeStressPlacement(tokens: string[]): string[] | null {
	if (tokens.some((token) => !IPA_TOKEN_SET.has(token))) return null;
	const stressIndices: number[] = [];
	tokens.forEach((token, index) => {
		if (isStressToken(token)) stressIndices.push(index);
	});
	if (stressIndices.length === 0) return [...tokens];

	const out = [...tokens];
	// 从右往左处理，左侧下标不会被右侧的插入/删除影响
	for (const stressIndex of stressIndices.sort((a, b) => b - a)) {
		const insertAtOriginal = onsetInsertIndex(out, stressIndex);
		if (insertAtOriginal === null) return null;
		const stress = out[stressIndex];
		out.splice(stressIndex, 1);
		const insertAt =
			insertAtOriginal > stressIndex
				? insertAtOriginal - 1
				: insertAtOriginal;
		out.splice(insertAt, 0, stress);
	}
	return out;
}

/**
 * 返回重音应插入的原始下标（音节首第一个辅音；无辅音则元音下标）。
 * 从元音向左收集连续辅音（跳过重音 token），取最长的合法音节首后缀。
 */
function onsetInsertIndex(
	tokens: string[],
	stressIndex: number,
): number | null {
	let vowelIndex = -1;
	for (let index = stressIndex + 1; index < tokens.length; index += 1) {
		if (isVowelToken(tokens[index])) {
			vowelIndex = index;
			break;
		}
	}
	if (vowelIndex < 0) return null;

	const consonantIndices: number[] = [];
	for (let index = vowelIndex - 1; index >= 0; index -= 1) {
		const token = tokens[index];
		if (isStressToken(token)) continue;
		if (isVowelToken(token)) break;
		if (isConsonantToken(token)) {
			consonantIndices.unshift(index);
			continue;
		}
		break;
	}

	const maxLen = Math.min(3, consonantIndices.length);
	for (let len = maxLen; len >= 1; len -= 1) {
		const suffix = consonantIndices.slice(-len);
		const key = suffix.map((index) => tokens[index]).join("|");
		if (ONSET_KEYS.has(key)) return suffix[0];
	}
	// 没有合法音节首（例如词尾 ŋ）：重音直接放在元音前
	return vowelIndex;
}

/** 校验 token 数组：全部合法、至少 1 个元音、主重音不超过上限 */
export function isValidPhoneticTokens(
	tokens: string[],
	options: { maxPrimary?: number } = {},
): boolean {
	if (tokens.length === 0) return false;
	let vowels = 0;
	let primary = 0;
	for (const token of tokens) {
		if (!IPA_TOKEN_SET.has(token)) return false;
		if (isVowelToken(token)) vowels += 1;
		if (token === "ˈ") primary += 1;
	}
	return vowels > 0 && primary <= (options.maxPrimary ?? 1);
}

/**
 * 解析一个读音（字符串或已切好的 token 数组）：切分 → 重音归位 → 校验。
 * 词典允许极少数双主重音；AI 只允许一个主重音。
 */
export function parsePhoneticVariant(
	value: string | string[],
	options: ParsePhoneticOptions = {},
): string[] | null {
	const source = options.source ?? "ai";
	const tokens = Array.isArray(value) ? [...value] : tokenizeIpa(value);
	if (!tokens || tokens.length === 0) return null;
	const normalized = normalizeStressPlacement(tokens);
	if (!normalized) return null;
	if (
		!isValidPhoneticTokens(normalized, {
			maxPrimary: source === "dict" ? 2 : 1,
		})
	) {
		return null;
	}
	return normalized;
}

/** 解析多个读音变体：去重、最多 PHONETIC_VARIANT_MAX 个 */
export function parsePhoneticVariants(
	values: Array<string | string[]>,
	source: "dict" | "ai",
): string[][] {
	const out: string[][] = [];
	const seen = new Set<string>();
	for (const value of values) {
		const tokens = parsePhoneticVariant(value, { source });
		if (!tokens) continue;
		const key = phoneticToString(tokens);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(tokens);
		if (out.length >= PHONETIC_VARIANT_MAX) break;
	}
	return out;
}

export function phoneticAnswerFromVariants(
	variants: string[][],
	source: "dict" | "ai",
): PhoneticAnswer | null {
	if (variants.length === 0) return null;
	return {
		canonical: variants[0],
		variants,
		source,
	};
}

/** 可存储/可比较的字符串：token 之间用单个空格（不是最终展示形态） */
export function phoneticToString(tokens: string[]): string {
	return tokens.join(" ");
}

/** 从存储字符串恢复 token 数组（历史/结果字段用） */
export function tokensFromString(value: string): string[] {
	const trimmed = value.trim();
	return trimmed ? trimmed.split(/\s+/) : [];
}

/** 最终展示：`/ˈæpəl/`；token 之间不插空格 */
export function phoneticDisplay(tokens: string[]): string {
	return `/${tokens.join("")}/`;
}
