/**
 * 剑桥 B1 Preliminary 官方词表（Vocabulary List PDF）的解析（纯逻辑，可单测）。
 *
 * 三种文本口径：
 *  1. {@link parsePetVocabularyList} —— 字母表正文（2025-08 版 PDF 第 4–40 页，每行 `word (pos)`）
 *  2. {@link parsePetTopicWordList} —— 附录 2 主题表（第 42–53 页，每行一个词/词组，部分带词性）
 *  3. {@link parsePetWordSetsText} —— 附录 1「词套」（第 41 页）里**印出来**的条目
 *     （季节、大洲、举例的国家/国籍；数字/星期/月份原文只写 etc.，由 scripts/data/pet-word-sets.txt 补）
 *
 * 版面注意：PDF 是多栏排版，`pdftotext` 直出会把同行不同栏的词粘在一起
 * （例如 `dinner (n) dinosaur`），因此调用方**必须**先按栏还原（见 scripts/fetch-pet-words.mjs
 * 的 `reconstructColumns`）；本模块只负责「一行一条（或换行拆开的一条）」的语义解析。
 *
 * 行的处理口径：
 *  - 以 `(` 开头的行＝上一条被换行拆出的续行 → 先并回上一行
 *  - 行尾括号组全部剥掉（词性、地区注记、缩写说明）；其中短的纯小写字母片段（1–4 个字母、
 *    且不是词性/占位符）视为「可选片段」，两种写法都收：`blond(e)` → blond / blonde
 *  - 斜杠表示「或」：两段时两段都收（`centre/center`、`lots / a lot`）；
 *    三段及以上属于整句替换（`made of/from/out of`），只取第一段
 *  - 去掉 sb / sth 占位与首尾标点（`congratulations!` → congratulations），缩写内的点保留（`a.m.`）
 *  - 去重（大小写不敏感，保留首次出现的写法）
 *  - 过滤：必须含字母、≤ 40 字符、≤ 4 个词、字符集受限、不是 etc./eg./ie. 这类缩写
 */
export const PET_MAX_WORD_CHARS = 40;
export const PET_MAX_WORD_TOKENS = 4;

/** 词头可用字符：字母（含重音）、撇号、连字符、点（缩写）、空格 */
const WORD_SHAPE = /^[A-Za-z\u00C0-\u024F'’. -]+$/u;
const HAS_LETTER = /[A-Za-z\u00C0-\u024F]/u;
/** 单字母括号组里这些不是「可选片段」而是词性/占位符/地区缩写 */
const POS_OR_PLACEHOLDER = new Set([
	"n",
	"v",
	"adj",
	"adv",
	"pron",
	"det",
	"prep",
	"conj",
	"exclam",
	"num",
	"phr",
	"pl",
	"av",
	"mv",
	"sb",
	"sth",
	"etc",
	"am",
	"br",
	"eng",
	"uk",
	"us",
]);
/** 这些候选不是词（原文里的缩写与页眉页脚，误收会让词库出现假词） */
const NON_WORDS = new Set(["etc", "eg", "ie", "list", "vocabulary"]);

/**
 * 附录 2 的小标题及其页眉页脚：这些行不是词条，按整行折叠匹配后跳过。
 * 标题来自 2025-08 版 PDF，版式更新时连同页范围一起核对。
 */
export const PET_TOPIC_SKIP_LINES = new Set([
	"topic lists",
	"clothes and accessories",
	"colours",
	"communications and technology",
	"education",
	"entertainment and media",
	"food and drink",
	"health, medicine and exercise",
	"hobbies and leisure",
	"house and home",
	"personal feelings, opinions and experiences (adjectives)",
	"places: buildings",
	"places: countryside",
	"places: town and city",
	"services",
	"shopping",
	"sport",
	"the natural world",
	"travel and transport",
	"work and jobs",
	// 页眉页脚（pdftotext 会把它们排进栏里）
	"appendix 1",
	"appendix 2",
	"word sets",
	"for schools vocabulary",
	"b1 preliminary and preliminary",
	"preliminary and preliminary for",
	"schools vocabulary list",
]);

/** 短小写字母片段（`(e)` / `(h)` / `(me)`）才是可选片段；词性不算 */
function isOptionalFragment(text: string): boolean {
	return /^[a-z]{1,4}$/.test(text) && !POS_OR_PLACEHOLDER.has(text);
}

/** 剥掉行尾括号组；遇到可选片段就停手，留给 optionalVariants 展开 */
function stripTrailingGroups(line: string): string {
	let head = line.trim();
	for (;;) {
		const match = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(head);
		if (!match) return head;
		if (isOptionalFragment(match[2])) return head;
		head = match[1].trim();
	}
}

/** 去掉 sb / sth 占位（含 `(sth/sb)` 与行尾裸词） */
function stripPlaceholders(text: string): string {
	return text
		.replace(/\((?:sb|sth|sb\/sth|sth\/sb)\)/giu, " ")
		.replace(/\s+(?:sb|sth)(?:\/(?:sb|sth))?$/iu, "")
		.replace(/\s+/gu, " ")
		.trim();
}

/** 展开词内可选片段：`yog(h)urt` → [yogurt, yoghurt]（多个片段递推） */
function optionalVariants(head: string): string[] {
	const match = /^(.*?)\(([^()]*)\)(.*)$/.exec(head);
	if (!match || !isOptionalFragment(match[2])) return [head];
	const before = match[1];
	const fragment = match[2];
	const after = match[3];
	return [
		...optionalVariants(`${before}${after}`),
		...optionalVariants(`${before}${fragment}${after}`),
	];
}

/** 归一候选词；不像词就返回 null */
function cleanCandidate(raw: string): string | null {
	let word = raw.replace(/\s+/gu, " ").trim();
	word = word.replace(/[!?,;:]+$/u, "").trim();
	// 句点结尾的普通词去掉点；缩写（内部还有点，如 a.m.）保留
	if (word.endsWith(".") && !word.slice(0, -1).includes(".")) {
		word = word.slice(0, -1).trim();
	}
	if (!word || word.length > PET_MAX_WORD_CHARS) return null;
	// 单字符只接受 ASCII 字母（`a` / `I` / `v`），字母上的重音碎片（`é`）是排版产生的垃圾
	if (word.length === 1 && !/[A-Za-z]/.test(word)) return null;
	if (!WORD_SHAPE.test(word) || !HAS_LETTER.test(word)) return null;
	if (word.split(" ").length > PET_MAX_WORD_TOKENS) return null;
	const key = word.toLowerCase();
	if (NON_WORDS.has(key)) return null;
	return word;
}

/** 一段（可能含斜杠/可选片段/占位符/逗号并列）文本 → 候选词列表 */
function candidatesOf(fragment: string): string[] {
	const head = stripPlaceholders(stripTrailingGroups(fragment));
	if (!head) return [];
	const parts = head.split("/").map((part) => part.trim());
	// 两段＝同位置的两种写法；三段及以上＝整句替换，只取第一段
	const variants = parts.length === 2 ? parts : [parts[0] ?? ""];
	// 逗号也是「或」（附录里的 `wet suit, wetsuit`、国家列表等）
	return variants
		.flatMap((variant) => variant.split(",").map((part) => part.trim()))
		.flatMap((part) => (part ? optionalVariants(part) : []));
}

/** 词头形态（与 WORD_SHAPE 同口径，用于分条时判断括号组前面那截是不是词头） */
const HEAD_SHAPE = /^[A-Za-z\u00C0-\u024F'’. -]+$/u;
/** 括号组形态：词性、地区注记、缩写说明（`n & v`、`adj, adv & det & pron`、`Am Eng: fall`） */
const GROUP_SHAPE = /^[A-Za-z][A-Za-z ,&'’.\-/]*$/u;

/**
 * 把一栏的文本流重新分成一条条「词头 (组)」。
 *
 * 为什么需要它：窄栏版式会把两条词条排在同一视觉行上（`dinner (n) dinosaur`），
 * 而长词条的词性又会掉到下一行（`direction` / `(n) directly (adv)`）。
 * 这里按「词头 + 括号组」的边界重新配对：一条 = 第一个括号组前面的词头，
 * 剩下的尾巴留给下一行接着拼（所以调用方要按栏分别调用，别把两栏混成一条流）。
 */
export function reflowEntryLines(text: string): string[] {
	const lines: string[] = [];
	let pending = "";
	for (const rawLine of text.split(/\r?\n/u)) {
		const line = rawLine.trim();
		if (!line) continue;
		pending = pending ? `${pending} ${line}` : line;
		for (;;) {
			const match = /\(([^()]*)\)/u.exec(pending);
			if (!match) break;
			const head = pending.slice(0, match.index).trim();
			if (
				head &&
				HEAD_SHAPE.test(head) &&
				match[1].trim().length > 0 &&
				GROUP_SHAPE.test(match[1].trim())
			) {
				lines.push(`${head} (${match[1].trim()})`);
			}
			pending = pending.slice(match.index + match[0].length).trim();
		}
		// 兜底：没等到括号组的脏文本不带进下一条
		if (pending.length > 120) pending = "";
	}
	return lines;
}

/** 以 `(` 开头的行是上一条被换行拆出的续行 */
export function joinWrappedLines(lines: string[]): string[] {
	const merged: string[] = [];
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		if (trimmed.startsWith("(") && merged.length > 0) {
			merged[merged.length - 1] = `${merged[merged.length - 1]} ${trimmed}`;
			continue;
		}
		merged.push(trimmed);
	}
	return merged;
}

function collectLines(
	lines: string[],
	options: { requireTrailingGroup: boolean; skipLines?: Set<string> },
): string[] {
	const seen = new Set<string>();
	const words: string[] = [];
	const push = (candidate: string | null) => {
		if (!candidate) return;
		const key = candidate.toLowerCase();
		if (seen.has(key)) return;
		seen.add(key);
		words.push(candidate);
	};

	for (const line of joinWrappedLines(lines)) {
		if (line.startsWith("•")) continue;
		if (options.skipLines?.has(line.toLowerCase())) continue;
		if (options.requireTrailingGroup && !line.endsWith(")")) continue;
		for (const candidate of candidatesOf(line)) push(cleanCandidate(candidate));
	}
	return words;
}

/** 1. 字母表正文（第 4–40 页）：只认「词头 + 行尾括号组」的行 */
export function parsePetVocabularyList(text: string): string[] {
	return collectLines(text.split(/\r?\n/u), { requireTrailingGroup: true });
}

/** 1b. 字母表的元素流（每行一个词头，无词性也算；不做主题表小标题过滤） */
export function parsePetWordList(text: string): string[] {
	return collectLines(text.split(/\r?\n/u), { requireTrailingGroup: false });
}

/** 2. 附录 2 主题表（第 42–53 页）：同上，但跳掉小标题与页眉页脚 */
export function parsePetTopicWordList(text: string): string[] {
	return collectLines(text.split(/\r?\n/u), {
		requireTrailingGroup: false,
		skipLines: PET_TOPIC_SKIP_LINES,
	});
}

/** 按逗号切一条列表行，逐个过候选词口径 */
function pushCommaList(words: string[], line: string): void {
	for (const fragment of line.split(",")) {
		for (const candidate of candidatesOf(fragment)) {
			const word = cleanCandidate(candidate);
			if (word) words.push(word);
		}
	}
}

/**
 * 3. 附录 1「词套」里**印出来**的条目：季节、大洲、举例的国家/国籍。
 * 数字/星期/月份原文只有 `etc.`，不在这里（补全见 scripts/data/pet-word-sets.txt）。
 */
export function parsePetWordSetsText(text: string): string[] {
	const words: string[] = [];
	const seasons = /Seasons of the year\s*\n+([^\n]+)/u.exec(text);
	if (seasons) pushCommaList(words, seasons[1]);
	// 国家/国籍：正文是「Names of countries, … for example, Brazil/Brazilian, …」可跨行
	const countries = /Countries, languages and nationalities\s*\n+([\s\S]*?)Continents/u.exec(text);
	if (countries) {
		const body = countries[1].replace(/\s*\n\s*/gu, " ");
		const exampleStart = body.lastIndexOf("for example,");
		pushCommaList(
			words,
			exampleStart >= 0 ? body.slice(exampleStart + "for example,".length) : body,
		);
	}
	const continents = /Continents\s*\n+([^\n]+)/u.exec(text);
	if (continents) pushCommaList(words, continents[1]);
	const seen = new Set<string>();
	return words.filter((word) => {
		const key = word.toLowerCase();
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}
