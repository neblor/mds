/**
 * 词库与复习的数据模型（纯类型 + 少量纯判定，无副作用）
 *
 * 概念区分：
 * - 词库（WordBank）：长期资产，几千词，带释义/音标/词频/来源标签，落盘在 mds-data/banks/<id>.json
 * - 本次词表 / 取词队列：一批默写要用的词，由 SRS 排序计算得出，不落盘（见 round-queue）
 *
 * 来源三分：
 * - builtin：随包发布的考纲词库（构建期由 ECDICT 生成，见 scripts/build-banks.mts）
 * - remote：从在线清单下载的词库
 * - custom：用户自建（可编辑增删）
 * 只有 custom 可编辑；builtin/remote 只读，需要改就先「复制为自建词表」。
 */

export const BANK_SOURCES = ["builtin", "remote", "custom"] as const;
export type BankSource = (typeof BANK_SOURCES)[number];

export function isBankSource(value: unknown): value is BankSource {
	return (
		typeof value === "string" &&
		(BANK_SOURCES as readonly string[]).includes(value)
	);
}

/** 是否可编辑（只有自建词表可以增删词） */
export function isEditableSource(source: BankSource): boolean {
	return source === "custom";
}

export interface BankEntry {
	/** 词或词组（原样保留大小写，去首尾空白） */
	word: string;
	/** 英文释义（本项目的「释义」只支持英文） */
	definition?: string;
	/** 中文释义（暂未使用，预留给「中文词」模式免 AI 抓取） */
	translation?: string;
	phonetic?: string;
	/** 词频序号（越小越高频；0 视为未知，归一为 undefined） */
	frq?: number;
	/** 考纲标签，如 cet4 / cet6 / gk / ky / ielts / toefl / gre */
	tags?: string[];
}

export interface WordBank {
	id: string;
	name: string;
	source: BankSource;
	/** 内容版本（内置/远端用于比对增量） */
	version: number;
	entries: BankEntry[];
	createdAt: number;
	updatedAt: number;
	/** 备注（来源说明等） */
	note?: string;
	/** 数据许可（如 ECDICT (MIT)；随包词库各自不同，清单里会展示） */
	license?: string;
}

/** 列表视图用的轻量摘要（不含 entries，避免整库读进前端） */
export interface BankSummary {
	id: string;
	name: string;
	source: BankSource;
	count: number;
	version: number;
	updatedAt: number;
}

/** 在线清单条目 */
export interface ManifestEntry {
	id: string;
	name: string;
	description?: string;
	count: number;
	version: number;
	/** 词库 JSON 地址（相对清单或绝对 URL） */
	url: string;
	/** 是否已随包内置（内置的不需要联网） */
	bundled?: boolean;
	license?: string;
}

export interface BankManifest {
	version: number;
	banks: ManifestEntry[];
}

/** 落盘格式版本（字段只增不改，读旧数据永远兼容） */
export const BANK_STORE_VERSION = 1;

/** 词库 id 规则：小写字母/数字/连字符，2–40 位，且必须以字母或数字开头 */
export const BANK_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,39}$/;

export function isValidBankId(id: unknown): id is string {
	return typeof id === "string" && BANK_ID_PATTERN.test(id);
}
