/**
 * 默写结果通用模型（纯逻辑，可单测）
 *
 * 结果行由“判定字段”（参与批改）与“参考字段”（只对照不批改）组成，按内容模式组装：
 * - word 模式：判定 = 单词（严格匹配）
 * - definition 模式：判定 = 单词（严格匹配）；参考 = 释义 + 我的释义
 * - chinese 模式（赛博）：判定 = 英文单词（严格匹配）+ 中文词（AI 批改，可用 grades 覆盖；
 *   无 AI 结果时回退本地归一化匹配）；书写模式只展示参考
 */
import { isChineseMatch, isStrictMatch } from "./match";
import type { ContentMode } from "./state";

export type ResultFieldKind = "word" | "definition" | "chinese";

export interface ResultField {
	kind: ResultFieldKind;
	/** 标准内容（答案或对照文本） */
	expected: string;
	/** 用户输入（仅赛博模式有） */
	userValue?: string;
	/** 是否参与批改 */
	graded: boolean;
	/** 批改结果（graded 时有效） */
	correct?: boolean;
	/** AI 批改备注（可选） */
	note?: string;
}

export interface ResultRow {
	word: string;
	audioName: string;
	fields: ResultField[];
}

/** 结果行所需的最少轮次数据（use-dictation 的 DictRound 满足该形状） */
export interface RoundLike {
	word: string;
	audioName: string;
	definition?: string;
	chineseWord?: string;
	answer?: string;
	answerDef?: string;
}

/** AI 批改覆盖：按单词给出的中文词判定结果 */
export interface GradeOverride {
	correct: boolean;
	note?: string;
}

export function buildResultRows(
	rounds: RoundLike[],
	mode: "writing" | "cyber",
	contentMode: ContentMode,
	grades?: Record<string, GradeOverride>,
): ResultRow[] {
	return rounds.map((r) => ({
		word: r.word,
		audioName: r.audioName,
		fields: buildFields(r, mode, contentMode, grades),
	}));
}

function buildFields(
	r: RoundLike,
	mode: "writing" | "cyber",
	contentMode: ContentMode,
	grades?: Record<string, GradeOverride>,
): ResultField[] {
	if (mode === "cyber") {
		if (contentMode === "chinese") {
			// 两段式：英文单词（严格）+ 中文词（AI 批改，无结果回退本地匹配）
			const expected = r.chineseWord?.trim() ?? "";
			const graded = expected.length > 0;
			const override = grades?.[r.word];
			return [
				{
					kind: "word",
					expected: r.word,
					userValue: r.answer,
					graded: true,
					correct: isStrictMatch(r.answer ?? "", r.word),
				},
				{
					kind: "chinese",
					expected,
					userValue: r.answerDef,
					graded,
					correct: graded
						? (override?.correct ??
							isChineseMatch(r.answerDef ?? "", expected))
						: undefined,
					...(override?.note ? { note: override.note } : {}),
				},
			];
		}
		const fields: ResultField[] = [
			{
				kind: "word",
				expected: r.word,
				userValue: r.answer,
				graded: true,
				correct: isStrictMatch(r.answer ?? "", r.word),
			},
		];
		if (contentMode === "definition") {
			fields.push({
				kind: "definition",
				expected: r.definition?.trim() ?? "",
				userValue: r.answerDef,
				graded: false,
			});
		}
		return fields;
	}

	// 书写模式：无批改，参考字段供学生自检
	if (contentMode === "definition" && r.definition?.trim()) {
		return [
			{ kind: "definition", expected: r.definition.trim(), graded: false },
		];
	}
	if (contentMode === "chinese" && r.chineseWord?.trim()) {
		return [
			{ kind: "chinese", expected: r.chineseWord.trim(), graded: false },
		];
	}
	return [];
}

/** 行的整体判定：有判定字段时全部正确才算对；无判定字段返回 undefined */
export function rowJudgement(row: ResultRow): boolean | undefined {
	const graded = row.fields.filter((f) => f.graded);
	if (graded.length === 0) return undefined;
	return graded.every((f) => f.correct === true);
}

export function correctCount(rows: ResultRow[]): number {
	return rows.filter((r) => rowJudgement(r) === true).length;
}

export function isAllCorrectRows(rows: ResultRow[]): boolean {
	return rows.length > 0 && rows.every((r) => rowJudgement(r) === true);
}

/** 各内容模式在结果页的判定说明 */
export const JUDGEMENT_NOTES: Record<ContentMode, string> = {
	word: "单词判定：大小写与标点需完全一致",
	definition: "单词判定：大小写与标点需完全一致 · 释义不批改",
	chinese:
		"中文词由 AI 批改，常见同义词也算对 · 英文单词大小写与标点需完全一致",
};

/** 内容模式的中文名（供界面标签复用） */
export const CONTENT_MODE_LABELS: Record<ContentMode, string> = {
	word: "单词",
	definition: "释义",
	chinese: "中文词",
};
