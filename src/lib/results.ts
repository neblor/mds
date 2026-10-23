/**
 * 默写结果通用模型（纯逻辑，可单测）
 *
 * 结果行由“判定字段”（参与批改）与“参考字段”（只对照不批改）组成，按内容模式组装：
 * - word 模式：判定 = 单词（严格匹配）
 * - definition 模式（赛博）：判定 = 英文单词（严格匹配）+ 英文释义（AI 批改，
 *   可用 grades 覆盖；无 AI 结果时回退本地归一化匹配；书写模式只展示参考）
 * - chinese 模式（赛博）：判定 = 英文单词（严格匹配）+ 中文词（AI 批改，同上）
 * - sentence 模式：判定 = **整句归一化后全等**（小写 + 去标点 + 压空白），不做 AI 批改
 * - phonetic 模式：判定 = 音素序列（重音归位；主重音严格、次重音忽略；多读音任一）
 */
import {
	isChineseMatch,
	isDefinitionMatch,
	isSentenceMatch,
	isStrictMatch,
} from "./match";
import { inflectedForms } from "./sentence-provider";
import { sentenceOfBlank } from "./cloze-parse";
import { bestVariantIndex, matchVariant, normalizeForGrading } from "./phonetic-match";
import { phoneticToString, tokensFromString } from "./phonetic-parse";
import type { ContentMode } from "./state";

export type ResultFieldKind =
	| "word"
	| "definition"
	| "chinese"
	| "sentence"
	| "phonetic";

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
	/**
	 * 这一行来自第几轮（组句一轮多个空 → 多行同轮）。
	 * 复习日志的每轮耗时是按**轮**记的，写回时靠它把耗时对到行上。
	 */
	roundIndex?: number;
	/** 组句模式的句子上下文（答案已填入）；短句模式为标准整句 */
	context?: string;
	/** 展示用备注（如「本词无合格短句，按单词默写」） */
	note?: string;
	fields: ResultField[];
}

/** 结果行所需的最少轮次数据（use-dictation 的 DictRound 满足该形状） */
export interface WordRoundLike {
	kind?: "word";
	word: string;
	audioName: string;
	definition?: string;
	chineseWord?: string;
	answer?: string;
	answerDef?: string;
	/** 短句模式：作答形态（缺省按普通单词轮处理） */
	variant?: "word" | "sentence";
	/** 短句模式：标准整句 */
	sentence?: string;
	/** 音标模式：该轮要拼音标时携带标准读音与池子来源 */
	phonetic?: {
		expected: string;
		variants: string[];
		source: "dict" | "ai";
	};
}

/** 组句轮（一题一段短文 + 若干个空）的结果行所需数据 */
export interface ClozeRoundLike {
	kind: "cloze";
	sentences: string[];
	blanks: { index: number; answer: string; chosen?: string }[];
	/** 答案词 → 音频文件名（只为答案词生成，缺省时结果页发音按钮置灰） */
	audioNames?: Record<string, string>;
}

/** 音标轮：看词拼音标，answerTokens 为提交后的 token 序列 */
export interface PhoneticRoundLike {
	kind: "phonetic";
	word: string;
	audioName: string;
	/** 标准音标（token 字符串，空格分隔） */
	expected: string;
	/** 全部可接受读音（token 字符串） */
	variants: string[];
	source: "dict" | "ai";
	answerTokens?: string[];
}

export type RoundLike = WordRoundLike | ClozeRoundLike | PhoneticRoundLike;

function isClozeRound(round: RoundLike): round is ClozeRoundLike {
	return round.kind === "cloze";
}

function isPhoneticRound(round: RoundLike): round is PhoneticRoundLike {
	return round.kind === "phonetic";
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
	const rows: ResultRow[] = [];
	for (const [roundIndex, round] of rounds.entries()) {
		// 组句轮：每个空一行（同一题可能出现同一个词两次，各自独立判定）
		if (isClozeRound(round)) {
			rows.push(...buildClozeRows(round, mode, roundIndex));
			continue;
		}
		if (isPhoneticRound(round)) {
			rows.push(buildPhoneticRow(round, mode, roundIndex));
			continue;
		}
		// 音标场次里的普通 WordRound：带了 phonetic 说明这一轮要拼音标；
		// 没带就是词典未收录的降级轮，走下面的单词字段并标注。
		if (round.phonetic) {
			rows.push(
				buildPhoneticRow(
					{
						kind: "phonetic",
						word: round.word,
						audioName: round.audioName,
						expected: round.phonetic.expected,
						variants: round.phonetic.variants,
						source: round.phonetic.source,
						...(round.answer !== undefined
							? { answerTokens: tokensFromString(round.answer) }
							: {}),
					},
					mode,
					roundIndex,
				),
			);
			continue;
		}
		const sentence = round.sentence?.trim();
		rows.push({
			word: round.word,
			audioName: round.audioName,
			roundIndex,
			// 标准整句进 context：结果页据此高亮目标词并与用户整句并排对照
			...(contentMode === "sentence" && sentence ? { context: sentence } : {}),
			...(contentMode === "sentence" && !sentence
				? { note: "本词没有合格短句，按单词默写" }
				: {}),
			...(contentMode === "phonetic"
				? { note: "本词没有可用音标，按单词默写" }
				: {}),
			fields: buildFields(round, mode, contentMode, grades),
		});
	}
	return rows;
}

/** 音标轮 → 结果行：expected 取匹配/最接近的变体，userValue 存归位后的序列 */
function buildPhoneticRow(
	round: PhoneticRoundLike,
	mode: "writing" | "cyber",
	roundIndex: number,
): ResultRow {
	const user = round.answerTokens ?? [];
	const variants = round.variants.map((variant) => tokensFromString(variant));
	const matched = matchVariant(user, variants);
	const displayIndex = matched >= 0 ? matched : bestVariantIndex(user, variants);
	const expected =
		round.variants[displayIndex >= 0 ? displayIndex : 0] ?? round.expected;
	const normalizedUser = normalizeForGrading(user);
	const graded = mode === "cyber" && round.answerTokens !== undefined;
	return {
		word: round.word,
		audioName: round.audioName,
		roundIndex,
		fields: [
			{
				kind: "phonetic",
				expected,
				...(round.answerTokens !== undefined
					? {
							userValue: normalizedUser
								? phoneticToString(normalizedUser)
								: phoneticToString(user),
						}
					: {}),
				graded,
				...(graded ? { correct: matched >= 0 } : {}),
				...(round.source === "ai"
					? { note: "AI 生成，仅供参考" }
					: {}),
			},
		],
	};
}

/** 组句轮 → 结果行：每空一行，带该空所在句（答案已填入） */
function buildClozeRows(
	round: ClozeRoundLike,
	mode: "writing" | "cyber",
	roundIndex: number,
): ResultRow[] {
	return round.blanks.map((blank) => {
		const expected = blank.answer;
		const graded = mode === "cyber";
		const correct = graded ? isStrictMatch(blank.chosen ?? "", expected) : undefined;
		return {
			word: expected,
			audioName: round.audioNames?.[expected] ?? "",
			roundIndex,
			context: sentenceOfBlank(round.sentences, round.blanks, blank.index),
			fields: [
				{
					kind: "word",
					expected,
					...(blank.chosen !== undefined ? { userValue: blank.chosen } : {}),
					graded,
					...(correct !== undefined ? { correct } : {}),
				},
			],
		};
	});
}

function buildFields(
	r: WordRoundLike,
	mode: "writing" | "cyber",
	contentMode: ContentMode,
	grades?: Record<string, GradeOverride>,
): ResultField[] {
	// 短句模式：只有拿到合格短句的轮次才是「整句」形态；降级轮按普通单词轮处理
	const sentence = r.sentence?.trim();
	if (contentMode === "sentence" && r.variant === "sentence" && sentence) {
		if (mode === "writing") {
			// 书写模式无作答记录：只展示标准整句供自检
			return [{ kind: "sentence", expected: sentence, graded: false }];
		}
		// 判分口径（崔总 2026-10-17）：**整句归一化后全等**——
		// 小写、去标点、压空白后比较，大小写/标点/空格多少都不影响；不做 AI 批改。
		return [
			{
				kind: "sentence",
				expected: sentence,
				userValue: r.answer ?? "",
				graded: true,
				correct: isSentenceMatch(r.answer ?? "", sentence),
			},
		];
	}
	if (mode === "cyber") {
		if (contentMode === "chinese" || contentMode === "definition") {
			// 两段式：英文单词（严格）+ 第二步作答（AI 批改，无结果回退本地匹配）
			// 中文词与释义同构：expected 取对应标准内容，answerDef 是学生第二步作答
			const secondKind = contentMode === "chinese" ? "chinese" : "definition";
			const expected =
				contentMode === "chinese"
					? (r.chineseWord?.trim() ?? "")
					: (r.definition?.trim() ?? "");
			const graded = expected.length > 0;
			const override = grades?.[r.word];
			const localMatch =
				contentMode === "chinese"
					? isChineseMatch(r.answerDef ?? "", expected)
					: isDefinitionMatch(r.answerDef ?? "", expected);
			return [
				{
					kind: "word",
					expected: r.word,
					userValue: r.answer,
					graded: true,
					correct: isStrictMatch(r.answer ?? "", r.word),
				},
				{
					kind: secondKind,
					expected,
					userValue: r.answerDef,
					graded,
					correct: graded ? (override?.correct ?? localMatch) : undefined,
					...(override?.note ? { note: override.note } : {}),
				},
			];
		}
		return [
			{
				kind: "word",
				expected: r.word,
				userValue: r.answer,
				graded: true,
				correct: isStrictMatch(r.answer ?? "", r.word),
			},
		];
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
	definition: "英文单词大小写与标点需完全一致 · 释义由 AI 批改，意思相同即算对",
	chinese:
		"中文词由 AI 批改，常见同义词也算对 · 英文单词大小写与标点需完全一致",
	sentence: "整句匹配：忽略大小写与标点，空格按单个空格比较（词序写错才算错）",
	phonetic:
		"音标判定：按音素序列比对，主重音必须正确，次重音不参与判定；同词多读音任一匹配即算对",
	cloze: "组句判定：每个空独立比对，选中与正确词完全一致才算对（忽略首尾空格）",
};

/** 内容模式的中文名（供界面标签复用） */
export const CONTENT_MODE_LABELS: Record<ContentMode, string> = {
	word: "单词",
	definition: "释义",
	chinese: "中文词",
	sentence: "短句",
	phonetic: "音标",
	cloze: "组句",
};

/** 整句里目标词的高亮分段（含屈折变化），供结果页渲染 */
export function highlightWordSegments(
	sentence: string,
	word: string,
): { text: string; hit: boolean }[] {
	const forms = new Set(inflectedForms(word));
	const segments: { text: string; hit: boolean }[] = [];
	const re = /[A-Za-z][A-Za-z'’-]*/g;
	let cursor = 0;
	let match: RegExpExecArray | null;
	while ((match = re.exec(sentence)) !== null) {
		const token = match[0];
		const normalized = token.toLowerCase().replace(/[’]/g, "'");
		if (!forms.has(normalized)) continue;
		if (match.index > cursor) {
			segments.push({ text: sentence.slice(cursor, match.index), hit: false });
		}
		segments.push({ text: token, hit: true });
		cursor = match.index + token.length;
	}
	if (cursor < sentence.length) {
		segments.push({ text: sentence.slice(cursor), hit: false });
	}
	return segments;
}
