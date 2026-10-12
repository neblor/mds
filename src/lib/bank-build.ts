/**
 * 内置词库的生成规则（纯逻辑，可单测）
 *
 * 数据源：ECDICT（MIT，https://github.com/skywind3000/ECDICT）
 * 构建脚本 scripts/build-banks.mjs 只负责「读 CSV → 调这里 → 写 JSON」。
 *
 * 为什么在构建期生成而不是运行时抓：
 * 生成结果随包发布（离线可用），运行时只需「导入本地」一个动作；
 * 远端清单只是给了「以后加新词库」的通道，不是首次可用的前提。
 */
import type { BankEntry, BankManifest, ManifestEntry, WordBank } from "./bank-types";
import { BANK_STORE_VERSION } from "./bank-types";

export interface BankSpec {
	/** 英文 id（会成为文件名，必须符合 BANK_ID_PATTERN） */
	id: string;
	name: string;
	/** 取材说明（描述前缀） */
	note: string;
	/** ECDICT tag 过滤（如 ["cet4"]） */
	tags?: string[];
	/** 按词频取前 N 个（与 tags 互斥使用） */
	topByFrq?: number;
}

/** 随包发布的内置词库（数量与体积见实施报告；合计约 6–8 MB） */
export const BUILTIN_BANK_SPECS: BankSpec[] = [
	{ id: "core3000", name: "高频核心 3000", note: "按语料词频取前 3000", topByFrq: 3000 },
	{ id: "zk", name: "中考核心词", note: "中考考纲", tags: ["zk"] },
	{ id: "gk", name: "高考核心词", note: "高考考纲", tags: ["gk"] },
	{ id: "cet4", name: "CET-4 核心词", note: "大学英语四级考纲", tags: ["cet4"] },
	{ id: "cet6", name: "CET-6 核心词", note: "大学英语六级考纲", tags: ["cet6"] },
	{ id: "ky", name: "考研核心词", note: "考研英语大纲", tags: ["ky"] },
	{ id: "ielts", name: "IELTS 核心词", note: "雅思核心词汇", tags: ["ielts"] },
	{ id: "toefl", name: "TOEFL 核心词", note: "托福核心词汇", tags: ["toefl"] },
	{ id: "gre", name: "GRE 核心词", note: "GRE 核心词汇", tags: ["gre"] },
];

export const BUILTIN_LICENSE = "ECDICT (MIT)";
export const BUILTIN_SOURCE_URL = "https://github.com/skywind3000/ECDICT";

/** 判断某词条是否属于该词库规格 */
export function specMatchesEntry(spec: BankSpec, entry: BankEntry): boolean {
	if (spec.tags && spec.tags.length > 0) {
		const tags = entry.tags ?? [];
		return spec.tags.some((tag) => tags.includes(tag));
	}
	return entry.frq !== undefined && entry.frq > 0;
}

/**
 * 取该词库的词条：
 * - tag 类词库：按 tag 命中，按词频升序（高频在前）排序，无词频的排在后面保持原顺序
 * - 词频类词库：按词频升序取前 N
 * 词频缺失（无 frq）的词条保留在末尾，不因为缺字段就丢词。
 */
export function selectSpecEntries(spec: BankSpec, entries: BankEntry[]): BankEntry[] {
	const matched = entries.filter((entry) => specMatchesEntry(spec, entry));
	const sorted = matched
		.map((entry, index) => ({ entry, index }))
		.sort((a, b) => {
			const frqA = a.entry.frq ?? Number.MAX_SAFE_INTEGER;
			const frqB = b.entry.frq ?? Number.MAX_SAFE_INTEGER;
			return frqA - frqB || a.index - b.index;
		})
		.map((item) => item.entry);
	return spec.topByFrq ? sorted.slice(0, spec.topByFrq) : sorted;
}

/** 由词条构造词库文件对象（与运行时 WordBank 完全同构，导入时无需转换） */
export function buildBank(
	spec: BankSpec,
	entries: BankEntry[],
	now: number,
): WordBank {
	return {
		id: spec.id,
		name: spec.name,
		source: "builtin",
		version: BANK_STORE_VERSION,
		entries,
		createdAt: now,
		updatedAt: now,
		note: `${spec.note} · ${entries.length} 词 · ${BUILTIN_LICENSE} · ${BUILTIN_SOURCE_URL}`,
	};
}

function manifestEntryOf(bank: WordBank, bundled: boolean): ManifestEntry {
	return {
		id: bank.id,
		name: bank.name,
		description: bank.note ?? undefined,
		count: bank.entries.length,
		version: bank.version,
		url: `./${bank.id}.json`,
		bundled,
		license: BUILTIN_LICENSE,
	};
}

/**
 * 生成清单：bundled=true 的条目表示随包发布（无需联网即可导入）。
 * 顺序与传入顺序一致（保持「高频核心 → 考纲由易到难」的展示顺序）。
 */
export function buildManifest(
	banks: WordBank[],
	options: { bundled?: boolean } = {},
): BankManifest {
	const bundled = options.bundled !== false;
	return {
		version: BANK_STORE_VERSION,
		banks: banks.map((bank) => manifestEntryOf(bank, bundled)),
	};
}
