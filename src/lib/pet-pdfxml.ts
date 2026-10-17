/**
 * `pdftohtml -xml` 输出的解析（纯逻辑，可单测）。
 *
 * 为什么不用 `pdftotext`：这份官方词表是多栏排版，直出会把同一行不同栏的内容粘起来
 * （`dinner (n) dinosaur`、`milk piece of cake`），而按坐标切栏又会栽在「栏内还嵌窄栏」
 * 的版式上。`pdftohtml -xml` 会把**每个单元格/词条单独**输出成 `<text top=.. left=..>…</text>`，
 * 于是只需要按 (top, left) 排好序，再用 {@link reflowEntryLines} 按括号组重新分条即可。
 *
 * 本模块只做「XML → 元素列表 → 每页一行的文本流」：
 *  - 去掉元素里的 `<b>/<i>` 等内联标签，反转义实体
 *  - 丢掉页眉页脚（`Page 11 of 53` 之类）与「•」例句：`•` 与其紧跟着的正文元素一起跳过
 */
export interface PdfTextElement {
	top: number;
	left: number;
	text: string;
	/** 原文里是否带加粗标记：这份 PDF 的词性括号是加粗的，例句不是 */
	bold: boolean;
}

export interface PdfPageText {
	/** 页码（XML 里的 number；缺失则按顺序补） */
	page: number;
	elements: PdfTextElement[];
}

const ENTITIES = new Map([
	["&amp;", "&"],
	["&lt;", "<"],
	["&gt;", ">"],
	["&quot;", '"'],
	["&apos;", "'"],
	["&#39;", "'"],
	["&nbsp;", " "],
]);

/** 反转义 + 去内联标签 + 折叠空白 */
export function cleanXmlText(raw: string): string {
	return raw
		.replace(/<[^>]*>/gu, "")
		.replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/gu, (e) => ENTITIES.get(e) ?? e)
		.replace(/\s+/gu, " ")
		.trim();
}

/**
 * 例句正文的横向范围：`•` 右侧的多少 pt 之内算例句。
 * 取 120pt：够装下一句例句（含字体切换拆出的尾巴），又不会伸出本栏去吃掉邻栏词条
 * （正文两栏间距约 250pt，主题表窄栏没有例句）。
 */
const BULLET_BAND_PT = 120;

const BULLET_WRAP_PT = 20;

/** 页眉页脚：不是词条，读的时候直接跳过 */
export function isPageFurniture(text: string): boolean {
	return (
		/^Page \d+ of \d+$/u.test(text) ||
		text.startsWith("© CUPA") ||
		text === "B1 Preliminary and Preliminary" ||
		text === "for Schools Vocabulary" ||
		text === "Preliminary and Preliminary for" ||
		text === "Schools Vocabulary List" ||
		text === "List" ||
		text === "Vocabulary"
	);
}

/** `pdftohtml -xml` 输出 → 逐页文本元素 */
export function parsePdf2Xml(xml: string): PdfPageText[] {
	const pages: PdfPageText[] = [];
	for (const [index, pageXml] of [...xml.matchAll(/<page[\s\S]*?<\/page>/gu)].entries()) {
		const pageNumber = Number(/<page[^>]*number="(\d+)"/u.exec(pageXml[0])?.[1] ?? index + 1);
		const elements: PdfTextElement[] = [];
		for (const match of pageXml[0].matchAll(
			/<text[^>]*top="(-?\d+)"[^>]*left="(-?\d+)"[^>]*>([\s\S]*?)<\/text>/gu,
		)) {
			const text = cleanXmlText(match[3]);
			if (!text) continue;
			elements.push({
				top: Number(match[1]),
				left: Number(match[2]),
				text,
				bold: /<(?:b|strong)[\s>]/iu.test(match[3]),
			});
		}
		pages.push({ page: pageNumber, elements });
	}
	return pages;
}

/**
 * 一页元素 → 词头候选（每个元素本身就是一条词条）。
 *
 * 关键观察：`pdftohtml -xml` 把**词头**和**加粗的词性括号**输出成两个元素，
 * 而例句正文既不单独成元素、也不加粗——于是「取所有非加粗、非页眉、非例句的元素」
 * 就是词表，不再需要跨元素拼接（拼接正是跨栏串词的根源：`dinosaur` + `defeat (n & v)`）。
 * 词性括号不参与词库数据（词库只存词、释义、音标、词频），所以这里直接丢掉加粗元素。
 *
 * 例句的消除：`•` 标记所在视觉行、其右侧 {@link BULLET_BAND_PT} 内的元素；
 * `•` 单独占一行时（正文在下一行），再放宽一行（{@link BULLET_WRAP_PT} 之内）。
 */
export function pageWordCandidates(elements: PdfTextElement[]): string[] {
	const sorted = [...elements].sort((a, b) => a.top - b.top || a.left - b.left);
	const bullets = sorted.filter((element) => element.text.startsWith("•"));
	const isExample = (element: PdfTextElement): boolean =>
		bullets.some((marker) => {
			const inBand =
				element.left >= marker.left - 5 &&
				element.left <= marker.left + BULLET_BAND_PT;
			if (!inBand) return false;
			const sameLine = element.top >= marker.top && element.top <= marker.top + 2;
			// 「•」单独占一行时，正文掉到下一行
			const nextLine =
				marker.text.replace(/^•+\s*/u, "").length === 0 &&
				element.top > marker.top &&
				element.top <= marker.top + BULLET_WRAP_PT;
			return sameLine || nextLine;
		});
	const words: string[] = [];
	for (const element of sorted) {
		if (element.bold) continue;
		if (element.text.startsWith("•")) continue;
		if (isPageFurniture(element.text)) continue;
		if (isExample(element)) continue;
		// 字母分区标题（单个大写字母）不是词条
		if (/^[A-Z]$/u.test(element.text)) continue;
		words.push(element.text);
	}
	return words;
}
