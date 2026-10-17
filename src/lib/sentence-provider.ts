/**
 * 短句（sentence 模式）生句 provider
 *
 * 崔总的核心要求是「短句要短」：默写材料要靠手写，句子不能长。
 * 因此这里把「短」做成硬约束而不是只写在提示词里：
 * - 目标 3–6 词，**硬上限 8 词**，超过直接判不合格（由 service 触发一次收紧重试）
 * - **允许片段/词组**（`a bright sunny morning` 也算合格），不校验句号与动词
 * - 必须包含目标词；允许屈折变化（`go` → `went`、`apple` → `apples`）
 *
 * 与释义 provider 同一套调用约定（`callChatCompletion` / JSON 候选提取 / 诊断事件）。
 */
import {
	DEFAULT_CONTENT_LEVEL,
	type ContentLevel,
	CONTENT_LEVEL_PROMPTS,
} from "./content-level";
import {
	DefinitionProviderError,
	callChatCompletion,
	extractJsonCandidates,
	readChatSources,
	type DefinitionProviderDiagnosticEvent,
	type DefinitionProviderDiagnostics,
} from "./definition-provider";

/** 词数硬上限：超过即判不合格（崔总 2026-10-17 定） */
export const SENTENCE_MAX_WORDS = 8;
/** 理想区间下限（低于它不算错：词组本来就短） */
export const SENTENCE_MIN_WORDS = 3;
/** 理想区间上限 */
export const SENTENCE_TARGET_MAX_WORDS = 6;
/** 超长重试时收紧到的上限 */
export const SENTENCE_RETRY_MAX_WORDS = 5;
/** 单句字符上限（防御性：8 词不可能到这个长度） */
export const SENTENCE_MAX_CHARS = 120;

/** 词组/句子里的「词」：字母起头，允许撇号与连字符（don't / well-known） */
const WORD_TOKEN = /[A-Za-z][A-Za-z'’-]*/g;

export function sentenceWordCount(text: string): number {
	return (text.match(WORD_TOKEN) ?? []).length;
}

/** 只接受英文短句：含 CJK 等非 ASCII 字符直接不合格（引号统一成 ASCII 后再判断） */
export function isAsciiEnglish(text: string): boolean {
	// 允许常见的排版引号/破折号，其它非 ASCII（中日韩、全角标点）一律拒
	const normalized = text.replace(/[‘’“”–—]/g, "'");
	return /^[\x20-\x7E\n\r\t]+$/.test(normalized) && /[A-Za-z]/.test(normalized);
}

/**
 * 常见屈折变化（够覆盖小学到大学的常规词形；判不出就当缺句，宁缺勿错）。
 * 只用于「句子是否包含目标词」的本地校验，不参与任何批改。
 */
const IRREGULAR_FORMS: Record<string, string[]> = {
	go: ["went", "gone", "goes", "going"],
	do: ["did", "done", "does", "doing"],
	have: ["had", "has", "having"],
	be: ["am", "is", "are", "was", "were", "been", "being"],
	see: ["saw", "seen", "sees", "seeing"],
	come: ["came", "coming", "comes"],
	get: ["got", "gotten", "gets", "getting"],
	give: ["gave", "given", "gives", "giving"],
	take: ["took", "taken", "takes", "taking"],
	make: ["made", "makes", "making"],
	say: ["said", "says", "saying"],
	tell: ["told", "tells", "telling"],
	think: ["thought", "thinks", "thinking"],
	find: ["found", "finds", "finding"],
	feel: ["felt", "feels", "feeling"],
	leave: ["left", "leaves", "leaving"],
	meet: ["met", "meets", "meeting"],
	run: ["ran", "runs", "running"],
	write: ["wrote", "written", "writes", "writing"],
	read: ["reads", "reading"],
	speak: ["spoke", "spoken", "speaks", "speaking"],
	break: ["broke", "broken", "breaks", "breaking"],
	buy: ["bought", "buys", "buying"],
	teach: ["taught", "teaches", "teaching"],
	catch: ["caught", "catches", "catching"],
	bring: ["brought", "brings", "bringing"],
	begin: ["began", "begun", "begins", "beginning"],
	child: ["children"],
	man: ["men"],
	woman: ["women"],
	person: ["people"],
	mouse: ["mice"],
	foot: ["feet"],
	tooth: ["teeth"],
	good: ["better", "best"],
	bad: ["worse", "worst"],
	many: ["more", "most"],
	much: ["more", "most"],
};

/** 生成常见屈折候选（规则形 + 不规则表） */
export function inflectedForms(word: string): string[] {
	const base = word.trim().toLowerCase();
	if (!base) return [];
	const forms = new Set<string>([base]);
	for (const form of IRREGULAR_FORMS[base] ?? []) forms.add(form);

	// -s / -es
	if (/(s|x|z|ch|sh|o)$/.test(base)) forms.add(`${base}es`);
	forms.add(`${base}s`);
	if (/[^aeiou]y$/.test(base)) {
		forms.add(`${base.slice(0, -1)}ies`);
		forms.add(`${base.slice(0, -1)}ied`);
	}
	// -ed
	if (base.endsWith("e")) {
		forms.add(`${base}d`);
	} else {
		forms.add(`${base}ed`);
		if (/[^aeiou][aeiou][bdgklmnprt]$/.test(base)) {
			// 双写辅音：stop → stopped / run → running
			forms.add(`${base}${base.at(-1)}ed`);
			forms.add(`${base}${base.at(-1)}ing`);
		}
	}
	// -ing
	if (base.endsWith("ie")) forms.add(`${base.slice(0, -2)}ying`);
	else if (base.endsWith("e") && !base.endsWith("ee")) forms.add(`${base.slice(0, -1)}ing`);
	else forms.add(`${base}ing`);
	// 比较级/最高级（短形容词）
	if (/[^aeiou]y$/.test(base)) {
		forms.add(`${base.slice(0, -1)}ier`);
		forms.add(`${base.slice(0, -1)}iest`);
	} else if (base.length <= 6 && /[^aeiou][aeiou][bdgklmnprt]$/.test(base)) {
		forms.add(`${base}${base.at(-1)}er`);
		forms.add(`${base}${base.at(-1)}est`);
	} else {
		forms.add(`${base}er`);
		forms.add(`${base}est`);
	}
	return [...forms];
}

/** 句子是否包含目标词（含屈折变化；大小写不敏感） */
export function containsWordForm(sentence: string, word: string): boolean {
	const tokens = (sentence.match(WORD_TOKEN) ?? []).map((token) =>
		token.toLowerCase().replace(/[’]/g, "'"),
	);
	if (tokens.length === 0) return false;
	const forms = new Set(inflectedForms(word));
	return tokens.some((token) => forms.has(token));
}

/** 提示词：短是首要要求，并显式允许片段 */
export function buildSentenceSystemPrompt(
	contentLevel: ContentLevel = DEFAULT_CONTENT_LEVEL,
	options: { strict?: boolean } = {},
): string {
	const level = CONTENT_LEVEL_PROMPTS[contentLevel];
	const strictRules = `The previous attempt was too long. This time the sentence MUST be at most ${SENTENCE_RETRY_MAX_WORDS} words (prefer 3-5).`;
	return (
		"You write dictation material for an English vocabulary exercise. " +
		"Reply with STRICT JSON only (no markdown fences, no extra text) using this shape: " +
		'{"sentences":[{"word":"<exact original word>","sentence":"<one short sentence or phrase>"}]}. ' +
		"For every given word, write ONE natural English representation. " +
		"BREVITY IS THE PRIMARY REQUIREMENT: keep it as short as possible — usually " +
		`${SENTENCE_MIN_WORDS}-${SENTENCE_TARGET_MAX_WORDS} words, and NEVER more than ${SENTENCE_MAX_WORDS} words. ` +
		"Do not pad it with clauses, adverbs, or extra details just to make it longer. " +
		"A phrase or fragment is completely fine — it does NOT have to be a complete sentence, " +
		"as long as it reads naturally on its own (e.g. \"a bright sunny morning\", \"at the end of the day\"). " +
		`Use wording and syntax at this level: ${level}. ` +
		"The sentence must contain the given word itself (an inflected form such as a plural or past tense is fine). " +
		"Output one sentence per word, on a single line, without quotes, without explanation, " +
		`and include every requested word exactly once. ${options.strict ? strictRules : ""}`.trimEnd()
	);
}

/** 单条校验结果 */
export type SentenceRejectionReason =
	| "empty"
	| "not-english"
	| "too-long"
	| "missing-word"
	| "unknown-word";

export interface SentenceRejection {
	word: string;
	sentence: string;
	reason: SentenceRejectionReason;
	wordCount: number;
}

export interface ParsedSentenceResponse {
	sentences: Record<string, string>;
	rejected: SentenceRejection[];
	finishReason?: string;
	usage?: Record<string, unknown>;
}

/** 归一化：去引号/首尾空白/压缩空白（保留内部空格） */
export function normalizeSentence(raw: string): string {
	return raw
		.replace(/^[\s"'`]+|[\s"'`]+$/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

/** 逐条校验单句（供解析与测试复用） */
export function validateSentence(
	word: string,
	rawSentence: string,
): { ok: true; sentence: string } | { ok: false; rejection: SentenceRejection } {
	const sentence = normalizeSentence(rawSentence);
	const wordCount = sentenceWordCount(sentence);
	const reject = (reason: SentenceRejectionReason) => ({
		ok: false as const,
		rejection: { word, sentence, reason, wordCount },
	});
	if (!sentence) return reject("empty");
	if (sentence.length > SENTENCE_MAX_CHARS) return reject("too-long");
	if (!isAsciiEnglish(sentence)) return reject("not-english");
	if (wordCount > SENTENCE_MAX_WORDS) return reject("too-long");
	if (!containsWordForm(sentence, word)) return reject("missing-word");
	return { ok: true, sentence };
}

/** 从模型响应的所有内容块里抽出 [{word, sentence}]（兼容 JSON 字符串/对象/嵌套数组） */
function collectEntries(value: unknown, out: { word: string; sentence: string }[]): void {
	if (typeof value === "string") {
		for (const candidate of extractJsonCandidates(value)) collectEntries(candidate, out);
		return;
	}
	if (Array.isArray(value)) {
		for (const item of value) collectEntries(item, out);
		return;
	}
	if (!value || typeof value !== "object") return;
	pushEntry(value, out);
	const holder = value as Record<string, unknown>;
	for (const key of ["sentences", "items", "results", "data"]) {
		const nested = holder[key];
		if (Array.isArray(nested)) for (const item of nested) collectEntries(item, out);
	}
}

function pushEntry(value: unknown, out: { word: string; sentence: string }[]): void {
	if (!value || typeof value !== "object") return;
	const entry = value as Record<string, unknown>;
	const word = typeof entry.word === "string" ? entry.word.trim() : "";
	const raw =
		typeof entry.sentence === "string"
			? entry.sentence
			: typeof entry.text === "string"
				? entry.text
				: "";
	if (!word || !raw) return;
	out.push({ word, sentence: raw });
}

export interface FetchSentencesOptions {
	words: string[];
	baseUrl: string;
	apiKey: string;
	model: string;
	contentLevel?: ContentLevel;
	/** 收紧重试：提示词要求 ≤{SENTENCE_RETRY_MAX_WORDS} 词 */
	strict?: boolean;
	/** 重试时的上一版超长句子，帮助模型理解「再短一点」 */
	previous?: Record<string, string>;
	timeoutMs?: number;
	signal?: AbortSignal;
	fetchImpl?: typeof fetch;
	onDiagnostic?: (event: DefinitionProviderDiagnosticEvent) => void;
}

export interface FetchSentencesResult {
	sentences: Record<string, string>;
	missing: string[];
	rejected: SentenceRejection[];
	warning?: string;
	diagnostics: DefinitionProviderDiagnostics;
}

export async function fetchShortSentences(
	options: FetchSentencesOptions,
): Promise<FetchSentencesResult> {
	const startedAt = performance.now();
	const endpoint = `${options.baseUrl.replace(/\/+$/, "")}/chat/completions`;
	const fetchImpl = options.fetchImpl ?? fetch;
	const timeoutMs = options.timeoutMs ?? 60_000;
	const timeoutSignal = AbortSignal.timeout(timeoutMs);
	const signal = options.signal
		? AbortSignal.any([options.signal, timeoutSignal])
		: timeoutSignal;
	const previous = options.previous ?? {};
	const userContent = options.strict
		? JSON.stringify(
				options.words.map((word) => ({
					word,
					previous_too_long: previous[word] ?? undefined,
				})),
			)
		: JSON.stringify(options.words);
	const baseBody = {
		model: options.model,
		temperature: 0,
		max_tokens: 4096,
		messages: [
			{
				role: "system",
				content: buildSentenceSystemPrompt(
					options.contentLevel ?? DEFAULT_CONTENT_LEVEL,
					{ strict: options.strict },
				),
			},
			{ role: "user", content: userContent },
		],
	};
	const { response, fallbackUsed } = await callChatCompletion({
		endpoint,
		model: options.model,
		fetchImpl,
		apiKey: options.apiKey,
		baseBody,
		signal,
		timeoutSec: Math.round(timeoutMs / 1000),
		onDiagnostic: options.onDiagnostic,
	});

	let finishReason: string | undefined;
	let usage: DefinitionProviderDiagnostics["usage"];
	const entries: { word: string; sentence: string }[] = [];
	try {
		const sources = await readChatSources(response);
		finishReason = sources.finishReason;
		usage = sources.usage;
		for (const source of sources.sources) collectEntries(source, entries);
		if (entries.length === 0) {
			throw new DefinitionProviderError(
				"invalid-response",
				"AI 响应中没有可识别的短句条目",
				response.status,
			);
		}
	} catch (error) {
		options.onDiagnostic?.({
			event: "response-invalid",
			level: "error",
			details: {
				endpoint,
				model: options.model,
				code: error instanceof DefinitionProviderError ? error.code : "unknown",
				message: error instanceof Error ? error.message : String(error),
				fallbackUsed,
			},
		});
		throw error;
	}

	const requested = new Set(options.words);
	const sentences: Record<string, string> = {};
	const rejected: SentenceRejection[] = [];
	for (const entry of entries) {
		if (!requested.has(entry.word) || Object.hasOwn(sentences, entry.word)) continue;
		if (rejected.some((item) => item.word === entry.word)) continue;
		const verdict = validateSentence(entry.word, entry.sentence);
		if (verdict.ok) sentences[entry.word] = verdict.sentence;
		else rejected.push(verdict.rejection);
	}

	const missing = options.words.filter((word) => !Object.hasOwn(sentences, word));
	let warning: string | undefined;
	if (missing.length > 0) {
		warning = `AI 仅返回 ${options.words.length - missing.length}/${options.words.length} 个合格短句`;
	}
	if (finishReason === "length") {
		warning = `${warning ? `${warning}；` : ""}响应因输出长度限制被截断`;
	}
	if (warning) {
		options.onDiagnostic?.({
			event: "response-incomplete",
			level: "warning",
			details: {
				endpoint,
				model: options.model,
				requestedCount: options.words.length,
				returnedCount: Object.keys(sentences).length,
				missing,
				rejectedReasons: rejected.map((item) => `${item.word}:${item.reason}`),
				finishReason,
				fallbackUsed,
			},
		});
	}

	return {
		sentences,
		missing,
		rejected,
		warning,
		diagnostics: {
			endpoint,
			model: options.model,
			requestedCount: options.words.length,
			returnedCount: Object.keys(sentences).length,
			finishReason,
			fallbackUsed,
			elapsedMs: Math.round(performance.now() - startedAt),
			usage,
		},
	};
}
