/**
 * `pdftohtml -xml` 解析的口径测试：用的是真实输出的元素形态
 * （词头与词性是两个元素、例句是「•」+正文两个元素、页眉页脚各占一个元素）。
 */
import { describe, expect, it } from "vitest";
import { cleanXmlText, pageWordCandidates, parsePdf2Xml } from "./pet-pdfxml";

const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<pdf2xml producer="poppler" version="24.02.0">
<page number="11" position="absolute" top="0" left="0" height="1263" width="893">
	<fontspec id="3" size="17" family="BCDHEE+ArialMT" color="#000000"/>
	<text top="1165" left="403" width="87" height="15" font="0">Page 11 of 53 </text>
	<text top="1164" left="108" width="89" height="15" font="0">© CUPA 2025 </text>
	<text top="67" left="110" width="8" height="20" font="2">•</text>
	<text top="69" left="119" width="303" height="18" font="3">  She cut up the cake into small pieces.  </text>
	<text top="88" left="93" width="164" height="18" font="3">CV (Curriculum Vitae) </text>
	<text top="88" left="257" width="21" height="18" font="4"><b>(n)</b></text>
	<text top="107" left="93" width="42" height="18" font="3">cycle </text>
	<text top="107" left="135" width="62" height="18" font="4"><b>(n &amp; v)  </b></text>
	<text top="543" left="318" width="33" height="18" font="3">dinner </text>
	<text top="543" left="351" width="21" height="18" font="4"><b>(n)</b></text>
	<text top="543" left="369" width="60" height="18" font="3">dinosaur </text>
	<text top="555" left="318" width="21" height="18" font="4"><b>(n)</b></text>
	<text top="555" left="336" width="55" height="18" font="3">diploma </text>
	<text top="555" left="377" width="21" height="18" font="4"><b>(n)</b></text>
	<text top="551" left="110" width="8" height="20" font="2">•</text>
	<text top="553" left="119" width="180" height="18" font="3">too dear to buy (adj) </text>
</page>
</pdf2xml>`;

describe("cleanXmlText", () => {
	it("去掉内联标签、反转义实体、折叠空白", () => {
		expect(cleanXmlText("<b>(n &amp; v)  </b>")).toBe("(n & v)");
		expect(cleanXmlText("  She   cut up  the cake. ")).toBe("She cut up the cake.");
	});
});

describe("parsePdf2Xml", () => {
	it("逐页取 (top, left, text)，空文本元素丢掉", () => {
		const pages = parsePdf2Xml(FIXTURE);
		expect(pages).toHaveLength(1);
		expect(pages[0].page).toBe(11);
		const dinner = pages[0].elements.filter((element) => element.text.startsWith("dinner"));
		expect(dinner).toEqual([
			{ top: 543, left: 318, text: "dinner", bold: false },
		]);
		expect(pages[0].elements.every((element) => element.text.trim().length > 0)).toBe(true);
	});
});

describe("pageWordCandidates", () => {
	it("只取非加粗元素：词头留下、加粗词性丢掉、页眉页脚丢掉、• 例句丢掉", () => {
		const words = pageWordCandidates(parsePdf2Xml(FIXTURE)[0].elements);
		expect(words).toEqual(["CV (Curriculum Vitae)", "cycle", "dinner", "dinosaur", "diploma"]);
	});

	it("例句被字体切换拆成多个元素时整条视觉行都丢掉", () => {
		const words = pageWordCandidates([
			{ top: 200, left: 512, text: "•", bold: false },
			{ top: 202, left: 520, text: "a", bold: false },
			{ top: 202, left: 553, text: "bird’s", bold: false },
			{ top: 202, left: 593, text: "wing", bold: false },
			{ top: 240, left: 485, text: "winner", bold: false },
			{ top: 240, left: 538, text: "(n)", bold: true },
		]);
		expect(words).toEqual(["winner"]);
	});

	it("同一视觉行里右栏的真词条不会被例句误吃", () => {
		const words = pageWordCandidates([
			{ top: 143, left: 129, text: "•", bold: false },
			{ top: 144, left: 137, text: "a birthday party", bold: false },
			{ top: 143, left: 498, text: "perhaps", bold: false },
			{ top: 143, left: 562, text: "(adv)", bold: true },
		]);
		expect(words).toEqual(["perhaps"]);
	});

	it("「•」单独占一行时，下一行的正文也算例句", () => {
		const words = pageWordCandidates([
			{ top: 100, left: 110, text: "•", bold: false },
			{ top: 112, left: 118, text: "air temperature", bold: false },
			{ top: 130, left: 110, text: "temporary", bold: false },
			{ top: 130, left: 186, text: "(adj)", bold: true },
		]);
		expect(words).toEqual(["temporary"]);
	});

	it("字母分区标题（单个大写字母）不是词条", () => {
		const words = pageWordCandidates([
			{ top: 10, left: 248, text: "D", bold: false },
			{ top: 30, left: 102, text: "dad", bold: false },
			{ top: 30, left: 134, text: "(n)", bold: true },
		]);
		expect(words).toEqual(["dad"]);
	});
});
