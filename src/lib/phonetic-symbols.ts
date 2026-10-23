/**
 * 音标模式的符号表（纯常量，客户端/服务端/构建脚本共用）
 *
 * 与 .design / clocktower 的 44 音标表保持一致：
 * - 12 单母音 + 8 双母音 + 24 辅音 = 44；
 * - `i`（happy 尾音）不在 44 音标表内，作为第 45 个可点 token 单列；
 * - 长音 `ː`、双母音、塞擦音都是**单个 token**，不拆成更小的字符；
 * - `ˈ` / `ˌ` 是独立 token（可点、可判定），本身不发音；
 * - 图表/DNA 里的 `a` 只作为双元音合成的源音，不进入可点符号集。
 */

export const IPA_MONOPHTHONGS = [
	"iː",
	"ɪ",
	"e",
	"æ",
	"ɑː",
	"ɒ",
	"ɔː",
	"ʊ",
	"uː",
	"ʌ",
	"ɜː",
	"ə",
] as const;

export const IPA_DIPHTHONGS = [
	"eɪ",
	"aɪ",
	"ɔɪ",
	"əʊ",
	"aʊ",
	"ɪə",
	"eə",
	"ʊə",
] as const;

export const IPA_CONSONANTS = [
	"p",
	"b",
	"t",
	"d",
	"k",
	"ɡ",
	"tʃ",
	"dʒ",
	"f",
	"v",
	"θ",
	"ð",
	"s",
	"z",
	"ʃ",
	"ʒ",
	"h",
	"m",
	"n",
	"ŋ",
	"l",
	"r",
	"w",
	"j",
] as const;

/** happy 尾音（如 happy /ˈhæpi/），音标表 44 音未单列 */
export const IPA_HAPPY = ["i"] as const;

/** 主重音 / 次重音；本身不是音素，不提供发音 */
export const IPA_STRESS = ["ˈ", "ˌ"] as const;

/** 全部可点 token（45 个音素 + 2 个重音符号） */
export const IPA_SYMBOLS = [
	...IPA_MONOPHTHONGS,
	...IPA_DIPHTHONGS,
	...IPA_CONSONANTS,
	...IPA_HAPPY,
	...IPA_STRESS,
] as const;

export type IpaToken = (typeof IPA_SYMBOLS)[number];

export const IPA_VOWELS: ReadonlySet<string> = new Set([
	...IPA_MONOPHTHONGS,
	...IPA_DIPHTHONGS,
	...IPA_HAPPY,
]);

export const IPA_CONSONANT_SET: ReadonlySet<string> = new Set(IPA_CONSONANTS);

export const IPA_STRESS_SET: ReadonlySet<string> = new Set(IPA_STRESS);

export const IPA_TOKEN_SET: ReadonlySet<string> = new Set(IPA_SYMBOLS);

/** 按长度降序：tokenizer 最长匹配用（`tʃ` 必须先于 `t`，`iː` 先于 `i`） */
export const IPA_TOKENS_BY_LENGTH = [...IPA_SYMBOLS].sort(
	(a, b) => b.length - a.length || a.localeCompare(b),
);

export function isPhoneticToken(value: unknown): value is IpaToken {
	return typeof value === "string" && IPA_TOKEN_SET.has(value);
}

export function isVowelToken(token: string): boolean {
	return IPA_VOWELS.has(token);
}

export function isConsonantToken(token: string): boolean {
	return IPA_CONSONANT_SET.has(token);
}

export function isStressToken(token: string): boolean {
	return IPA_STRESS_SET.has(token);
}

export type PhoneticTokenKind = "vowel" | "consonant" | "stress";

export function phoneticTokenKind(token: string): PhoneticTokenKind | null {
	if (IPA_VOWELS.has(token)) return "vowel";
	if (IPA_CONSONANT_SET.has(token)) return "consonant";
	if (IPA_STRESS_SET.has(token)) return "stress";
	return null;
}

/**
 * 词典文件版本：归一化/重音归位规则变化时递增，
 * 客户端 URL 也随之变化，浏览器缓存自然失效。
 */
export const PHONETIC_DICT_VERSION = 1;
export const PHONETIC_DICT_FILE = `en-gb.v${PHONETIC_DICT_VERSION}.json`;
export const PHONETIC_DICT_URL = `/ipa/${PHONETIC_DICT_FILE}`;

/** 音素音频目录版本（与词典版本独立） */
export const PHONEME_AUDIO_VERSION = 1;
export const PHONEME_AUDIO_BASE = `/ipa/audio/v${PHONEME_AUDIO_VERSION}/`;
export const PHONEME_AUDIO_MANIFEST_URL = `${PHONEME_AUDIO_BASE}manifest.json`;
