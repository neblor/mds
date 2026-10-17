/**
 * 从剑桥官方词表 PDF 生成 PET 词表文件（构建期脚本，产物入库）
 *
 * 用法：pnpm build:pet-words        （依赖 poppler-utils：pdftohtml + pdftotext）
 * 产物：scripts/data/pet-b1-words.txt（每行一个词，带来源注释；由 build-banks 读取）
 *
 * 说明：
 * - 数据来源：Cambridge《B1 Preliminary / B1 Preliminary for Schools Vocabulary List》
 *   （2025-08 版）：字母表第 4–40 页、附录 1「词套」第 41 页、附录 2「主题表」第 42–53 页
 * - **版面**：这是 2–4 栏排版，且栏内还嵌窄栏，直接用 pdftotext 会串行
 *   （`dinner (n) dinosaur` / `milk piece of cake`）。这里改用 `pdftohtml -xml`：
 *   词头与加粗的词性括号是两个带坐标的元素，于是「取非加粗元素 + 丢掉 `•` 例句」就够了
 *   （见 src/lib/pet-pdfxml.ts 的 pageWordCandidates）。
 * - 附录 1 是单栏表格，用 pdftotext 直出即可（标签与内容各占一行）。
 * - 附录 1 里数字 / 星期 / 月份原文只写 `etc.`，补全在 scripts/data/pet-word-sets.txt（人工整理）
 * - 版权归 Cambridge University Press & Assessment，仅作个人学习用途；下载的 PDF 落在
 *   .tmp/（已忽略）不入库，仓库里只留解析后的词表
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { register } from "node:module";
import { join, resolve } from "node:path";
import process from "node:process";

register("./ts-resolve-hook.mjs", import.meta.url);
const { pageWordCandidates, parsePdf2Xml } = await import("../src/lib/pet-pdfxml.ts");
const {
	parsePetTopicWordList,
	parsePetWordList,
	parsePetWordSetsText,
} = await import("../src/lib/pet-wordlist.ts");

const PDF_URL =
	"https://www.cambridgeenglish.org/Images/506887-b1-preliminary-vocabulary-list.pdf";
/** 页范围（2025-08 版）；换了版本就先改这里再跑 */
const MAIN_FIRST_PAGE = 4;
const MAIN_LAST_PAGE = 40;
const WORD_SETS_PAGE = 41;
const TOPIC_FIRST_PAGE = 42;
const TOPIC_LAST_PAGE = 53;

const projectRoot = resolve(import.meta.dirname, "..");
const pdfPath = join(
	projectRoot,
	".tmp",
	"banks-src",
	"pet-b1-vocabulary-list-2025-08.pdf",
);
const outPath = join(projectRoot, "scripts", "data", "pet-b1-words.txt");

function ensureTools() {
	for (const tool of ["pdftohtml", "pdftotext"]) {
		try {
			execFileSync(tool, ["-v"], { stdio: "ignore" });
		} catch {
			console.error(`缺少 ${tool}（poppler-utils）。Debian/Ubuntu：apt install poppler-utils`);
			process.exit(1);
		}
	}
}

async function ensurePdf() {
	if (existsSync(pdfPath)) return;
	mkdirSync(join(pdfPath, ".."), { recursive: true });
	console.log(`下载官方词表 PDF → ${pdfPath}`);
	const response = await fetch(PDF_URL);
	if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`);
	writeFileSync(pdfPath, Buffer.from(await response.arrayBuffer()));
}

/** `pdftohtml -xml` 指定页范围 → 逐页元素 */
function pdfPages(first, last) {
	const xml = execFileSync(
		"pdftohtml",
		["-xml", "-i", "-f", String(first), "-l", String(last), "-stdout", pdfPath],
		{ encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] },
	);
	return parsePdf2Xml(xml);
}

await ensureTools();
await ensurePdf();

// 字母表：每个非加粗元素就是一条词条（词性括号是加粗元素，不参与词库数据）
const mainWords = parsePetWordList(
	pdfPages(MAIN_FIRST_PAGE, MAIN_LAST_PAGE)
		.flatMap((page) => pageWordCandidates(page.elements))
		.join("\n"),
);

// 附录 1（词套里印出来的条目）：单栏表格，pdftotext 直出
const wordSetsText = execFileSync(
	"pdftotext",
	["-f", String(WORD_SETS_PAGE), "-l", String(WORD_SETS_PAGE), pdfPath, "-"],
	{ encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
);
const wordSetsWords = parsePetWordSetsText(wordSetsText);

// 附录 2（主题表）：每个词条一个元素，直接按行解析
const topicWords = parsePetTopicWordList(
	pdfPages(TOPIC_FIRST_PAGE, TOPIC_LAST_PAGE)
		.flatMap((page) => pageWordCandidates(page.elements))
		.join("\n"),
);

// 合并且去重（大小写不敏感，保留首次写法），再按字母序排便于人工 review
const seen = new Set();
const words = [];
for (const word of [...mainWords, ...wordSetsWords, ...topicWords]) {
	const key = word.toLowerCase();
	if (seen.has(key)) continue;
	seen.add(key);
	words.push(word);
}
words.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase(), "en") || a.localeCompare(b));

if (words.length < 1000) {
	throw new Error(`解析出的词条只有 ${words.length} 条，明显不对，先检查 PDF 版式`);
}

const header = [
	"# 剑桥 B1 Preliminary / B1 Preliminary for Schools Vocabulary List（2025-08 版）",
	`# 来源：${PDF_URL}`,
	"# 版权：© Cambridge University Press & Assessment，仅供个人学习使用",
	"# 生成：pnpm build:pet-words（scripts/fetch-pet-words.mjs）→ src/lib/pet-wordlist.ts 解析",
	`# 页范围：字母表 ${MAIN_FIRST_PAGE}–${MAIN_LAST_PAGE} 页 · 词套 ${WORD_SETS_PAGE} 页 · 主题表 ${TOPIC_FIRST_PAGE}–${TOPIC_LAST_PAGE} 页`,
	`# 共 ${words.length} 条（字母表 ${mainWords.length} · 词套印出 ${wordSetsWords.length} · 主题表 ${topicWords.length}，合并去重后）`,
	"# 注：词套里数字/星期/月份原文只写 etc.，其补全见同目录 pet-word-sets.txt",
];
mkdirSync(join(outPath, ".."), { recursive: true });
writeFileSync(outPath, `${[...header, ...words].join("\n")}\n`);

const single = words.filter((word) => !word.includes(" ")).length;
console.log(
	`已写入 ${outPath}\n` +
		`字母表 ${mainWords.length} · 词套（印出）${wordSetsWords.length} · 主题表 ${topicWords.length} → 合并去重 ${words.length} 条` +
		`（单词 ${single} · 词组 ${words.length - single}）\n` +
		`样例：${words.slice(0, 6).join(", ")} … ${words.slice(-4).join(", ")}`,
);
