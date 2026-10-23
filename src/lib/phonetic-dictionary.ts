/**
 * 音标词典懒加载（客户端）
 *
 * 生成物 `public/ipa/en-gb.v1.json` 约 715 KB，只在首次进入音标模式时拉取一次；
 * 后续轮次/结果页复用同一 Promise。失败会清掉缓存，下次重新尝试。
 *
 * 词典是外部输入边界：这里只做「顶层形状」校验；逐 token 的合法性由
 * `phonetic-parse` / `buildPhoneticPool` 与数据测试保证。查找时再逐读音过滤，
 * 避免坏条目把整场准备拖死。
 */
import {
	isPhoneticToken,
	PHONETIC_DICT_URL,
} from "./phonetic-symbols";

export interface PhoneticDictionarySource {
	name: string;
	version: string;
	url: string;
	license: string;
	normalization?: string;
}

export interface PhoneticDictionary {
	version: number;
	source: PhoneticDictionarySource;
	symbols: string[];
	/** 小写单词 → 可接受读音（token 数组）；多读音最多 3 条 */
	words: Record<string, string[][]>;
}

let cached: Promise<PhoneticDictionary> | null = null;

export function parsePhoneticDictionary(value: unknown): PhoneticDictionary {
	if (typeof value !== "object" || value === null) {
		throw new Error("音标词典格式不正确");
	}
	const record = value as Record<string, unknown>;
	const words = record.words;
	if (typeof words !== "object" || words === null || Array.isArray(words)) {
		throw new Error("音标词典缺少 words");
	}
	return {
		version: typeof record.version === "number" ? record.version : 1,
		source:
			typeof record.source === "object" && record.source !== null
				? (record.source as PhoneticDictionarySource)
				: { name: "", version: "", url: "", license: "" },
		symbols: Array.isArray(record.symbols)
			? record.symbols.filter((token): token is string => typeof token === "string")
			: [],
		words: words as Record<string, string[][]>,
	};
}

/** 载入内置词典（全应用共享一次；测试可用 reset 清理） */
export function loadPhoneticDictionary(
	fetchImpl: typeof fetch = fetch,
	url: string = PHONETIC_DICT_URL,
): Promise<PhoneticDictionary> {
	if (cached) return cached;
	cached = (async () => {
		const response = await fetchImpl(url);
		if (!response.ok) {
			throw new Error(`音标词典加载失败（HTTP ${response.status}）`);
		}
		return parsePhoneticDictionary(await response.json());
	})().catch((error) => {
		cached = null;
		throw error;
	});
	return cached;
}

export function resetPhoneticDictionaryCache(): void {
	cached = null;
}

/**
 * 查词：大小写不敏感，保留词典里的多读音顺序。
 * 词组/带空格/词典未收录返回 null（调用方降级为单词轮）。
 */
export function lookupPhonetic(
	dictionary: PhoneticDictionary,
	word: string,
): string[][] | null {
	const key = word.trim().toLowerCase();
	if (!key || !Object.hasOwn(dictionary.words, key)) return null;
	const raw = dictionary.words[key];
	if (!Array.isArray(raw)) return null;
	const variants = raw
		.filter((tokens): tokens is string[] => Array.isArray(tokens))
		.map((tokens) => tokens.filter(isPhoneticToken))
		.filter((tokens) => tokens.length > 0);
	return variants.length > 0 ? variants : null;
}
