/**
 * AI 生成内容的难度级别（客观口径，不给内容贴「儿童」这类主观标签）。
 *
 * 用途：设置里可选，随请求带给 /api/cloze、/api/definitions；
 * 提示词按 CONTENT_LEVEL_PROMPTS 的英文描述约束词汇量与句法复杂度。
 * 参考国内英语教学的常规分档：小学＝最常用基础词与单句，初中＝常用词与基本时态，
 * 高中＝高中词汇与从句，大学＝CET-4/6 词汇与复杂结构。
 */
export const CONTENT_LEVELS = ["primary", "junior", "senior", "college"] as const;
export type ContentLevel = (typeof CONTENT_LEVELS)[number];

export const DEFAULT_CONTENT_LEVEL: ContentLevel = "junior";

/** 设置界面用：中文级别名（默认初中） */
export const CONTENT_LEVEL_OPTIONS: { value: ContentLevel; label: string }[] = [
	{ value: "primary", label: "小学" },
	{ value: "junior", label: "初中" },
	{ value: "senior", label: "高中" },
	{ value: "college", label: "大学" },
];

/** 提示词里使用的英文描述（只描述难度本身） */
export const CONTENT_LEVEL_PROMPTS: Record<ContentLevel, string> = {
	primary:
		"primary-school English: the most common everyday words, one-clause sentences, simple present and past",
	junior:
		"junior-high English: common everyday words, basic tenses, simple compound sentences",
	senior:
		"senior-high English: senior-high vocabulary, common subordinate clauses and phrasal verbs",
	college: "college English: CET-4 and CET-6 vocabulary, complex sentence structures",
};

export function isContentLevel(value: unknown): value is ContentLevel {
	return (
		typeof value === "string" &&
		(CONTENT_LEVELS as readonly string[]).includes(value)
	);
}

/** 宽容解析：未知或缺失一律回落默认级别（设置迁移与请求体都用它） */
export function parseContentLevel(value: unknown): ContentLevel {
	return isContentLevel(value) ? value : DEFAULT_CONTENT_LEVEL;
}
