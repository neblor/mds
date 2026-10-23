/**
 * 生成音标模式的随包词典：Britfone CSV → public/ipa/en-gb.v1.json
 *
 * 用法：
 *   pnpm build:phonetics                    # 用 .tmp/phonetics-src/，缺了就下载
 *   pnpm build:phonetics -- --csv /tmp/britfone.csv
 *   pnpm build:phonetics -- --out public/ipa
 *
 * 说明：
 * - 数据源 Britfone 3.0.1，MIT（https://github.com/JoseLlarena/Britfone）
 * - 只保留单条英文词；词组/缩写跳过（运行时降级为单词轮）
 * - 符号归一化与重音归位复用 src/lib/phonetic-parse.ts（与客户端/AI 共用）
 * - 未知符号直接报错，不允许静默丢音；生成物提交仓库，check 不联网
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { register } from "node:module";

register("./ts-resolve-hook.mjs", import.meta.url);
const {
	normalizeSourceToken,
	parsePhoneticVariants,
} = await import("../src/lib/phonetic-parse.ts");
const {
	IPA_SYMBOLS,
	PHONETIC_DICT_FILE,
	PHONETIC_DICT_VERSION,
} = await import("../src/lib/phonetic-symbols.ts");

const BRITFONE_URL =
	"https://raw.githubusercontent.com/JoseLlarena/Britfone/master/britfone.main.3.0.1.csv";
const BRITFONE_LICENSE_URL =
	"https://raw.githubusercontent.com/JoseLlarena/Britfone/master/LICENSE.txt";
const BRITFONE_LICENSE_FALLBACK = `The MIT License (MIT)

Copyright (c) by 2017 Jose Llarena

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

const projectRoot = resolve(import.meta.dirname, "..");

function argValue(name) {
	const index = process.argv.indexOf(name);
	if (index < 0) return undefined;
	const value = process.argv[index + 1];
	return value && !value.startsWith("--") ? value : undefined;
}

const csvPath = resolve(
	argValue("--csv") ??
		process.env.MDS_BRITFONE_CSV ??
		join(projectRoot, ".tmp", "phonetics-src", "britfone.main.3.0.1.csv"),
);
const outDir = resolve(argValue("--out") ?? join(projectRoot, "public", "ipa"));
const jsonPath = join(outDir, PHONETIC_DICT_FILE);

function kb(bytes) {
	return `${(bytes / 1024).toFixed(1)} KB`;
}

async function ensureCsv(path) {
	if (existsSync(path) && statSync(path).size > 100_000) return;
	mkdirSync(join(path, ".."), { recursive: true });
	console.log(`下载 Britfone CSV → ${path}`);
	const response = await fetch(BRITFONE_URL, {
		headers: { "user-agent": "mds-build-phonetics/1.0" },
	});
	if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`);
	const buffer = Buffer.from(await response.arrayBuffer());
	writeFileSync(path, buffer);
	console.log(`下载完成：${kb(buffer.length)}`);
}

async function ensureLicense(path) {
	mkdirSync(join(path, ".."), { recursive: true });
	let text = BRITFONE_LICENSE_FALLBACK;
	try {
		const response = await fetch(BRITFONE_LICENSE_URL, {
			headers: { "user-agent": "mds-build-phonetics/1.0" },
		});
		if (response.ok) {
			const remote = await response.text();
			if (remote.includes("MIT License")) text = remote;
		}
	} catch {
		// 网络不可用时用内置 MIT 文本
	}
	writeFileSync(path, text, "utf8");
}

/** 单个源词条 → 归一化 token 数组；任一部分不认识就整条跳过 */
function parseSourceVariant(ipaText, unknown, rejected) {
	const rawTokens = ipaText.split(/\s+/).filter(Boolean);
	if (rawTokens.length === 0) return null;
	const tokens = [];
	for (const raw of rawTokens) {
		const normalized = normalizeSourceToken(raw);
		if (!normalized) {
			unknown.add(raw);
			rejected.variants += 1;
			return null;
		}
		tokens.push(...normalized);
	}
	return tokens;
}

/** 只保留单条英文词（不含空格/下划线/缩写/纯符号） */
function normalizeWord(raw) {
	const word = raw.trim().toLowerCase();
	if (!/^[a-z][a-z'’-]*$/.test(word)) return null;
	return word;
}

async function main() {
	await ensureCsv(csvPath);
	mkdirSync(outDir, { recursive: true });
	await ensureLicense(join(outDir, "LICENSE-britfone.txt"));

	const csv = readFileSync(csvPath, "utf8");
	const lines = csv.split(/\r?\n/);
	const unknown = new Set();
	const rejected = { words: 0, variants: 0 };
	const rawByWord = new Map();
	let sourceLines = 0;
	let skippedWords = 0;

	for (const line of lines) {
		if (!line.trim()) continue;
		const comma = line.indexOf(",");
		if (comma < 0) continue;
		sourceLines += 1;
		const rawWord = line.slice(0, comma);
		const ipaText = line.slice(comma + 1).trim();
		const word = normalizeWord(rawWord.replace(/\(\d+\)$/, ""));
		if (!word || !ipaText) {
			skippedWords += 1;
			continue;
		}
		const tokens = parseSourceVariant(ipaText, unknown, rejected);
		if (!tokens) continue;
		const list = rawByWord.get(word) ?? [];
		if (list.length < 6) list.push(tokens);
		rawByWord.set(word, list);
	}

	if (unknown.size > 0) {
		console.error(
			`未知源符号（${unknown.size} 种）：${[...unknown].slice(0, 80).join(" ")}`,
		);
		console.error("不允许静默丢弃符号；请补 phonetic-parse 的归一化规则后重跑。");
		process.exitCode = 1;
		return;
	}

	const words = {};
	let totalVariants = 0;
	for (const [word, rawVariants] of rawByWord) {
		const variants = parsePhoneticVariants(rawVariants, "dict");
		if (variants.length === 0) {
			rejected.words += 1;
			continue;
		}
		words[word] = variants;
		totalVariants += variants.length;
	}

	const data = {
		version: PHONETIC_DICT_VERSION,
		source: {
			name: "Britfone",
			version: "3.0.1",
			url: "https://github.com/JoseLlarena/Britfone",
			license: "MIT",
			normalization:
				"British IPA symbols normalized to the 44-sound chart + /i/; stress moved to maximal onset; see public/ipa/README.md",
		},
		symbols: IPA_SYMBOLS,
		words,
	};
	writeFileSync(jsonPath, `${JSON.stringify(data)}\n`, "utf8");

	console.log(`源行：${sourceLines}；跳过词条：${skippedWords}`);
	console.log(
		`保留：${Object.keys(words).length} 个词 / ${totalVariants} 个读音；被拒变体：${rejected.variants}；被拒词：${rejected.words}`,
	);
	console.log(`输出：${jsonPath}（${kb(statSync(jsonPath).size)}）`);

	// 内置词库覆盖率（只统计单条英文词；词组/专名本来就会降级）
	const banksDir = join(projectRoot, "public", "banks");
	if (existsSync(banksDir)) {
		const files = readdirSync(banksDir)
			.filter((file) => file.endsWith(".json") && file !== "manifest.json")
			.sort();
		console.log("\n内置词库覆盖率：");
		for (const file of files) {
			let bank;
			try {
				bank = JSON.parse(readFileSync(join(banksDir, file), "utf8"));
			} catch {
				continue;
			}
			const entries = Array.isArray(bank.entries) ? bank.entries : [];
			const single = entries.filter((entry) =>
				/^[a-zA-Z][a-zA-Z'’-]*$/.test(String(entry.word ?? "").trim()),
			);
			const hit = single.filter((entry) =>
				Object.hasOwn(words, String(entry.word).trim().toLowerCase()),
			).length;
			const pct = single.length ? ((hit / single.length) * 100).toFixed(1) : "—";
			console.log(
				`  ${file.replace(/\.json$/, "").padEnd(10)} ${String(hit).padStart(5)}/${String(single.length).padEnd(5)} ${pct}%`,
			);
		}
	}

	const readme = `# 音标资源

## 音标表

- 文件：phonetic-symbols.png（3600×2400，源自 ~/repos/andares/clocktower/cheat-sheets/phonetic-symbols.png）
- 用途：音标模式中按 F1/按钮全屏查看；构建期只复制，不修改。

## 音标词典

- 文件：${PHONETIC_DICT_FILE}
- 源：Britfone 3.0.1（MIT）
  https://github.com/JoseLlarena/Britfone
- 许可：见 LICENSE-britfone.txt
- 生成：\`pnpm build:phonetics\`（默认下载到 .tmp/phonetics-src；可用 --csv 指定本地文件）
- 归一化：
  - ɹ→r、ɛ→e、ɛə→eə、ɐ→ʌ、g→ɡ、iə/uə→ɪə/ʊə、oʊ→əʊ；
  - 长元音/双元音/塞擦音各为一个 token，不拆 ː；
  - Britfone 的重音挂在元音前，构建期按「最大音节首」移到音节首前；
  - happy 尾音 i 单列（音标表 44 音之外的第 45 个 token）。
- 只保留单条英文词；词组/缩写/专名跳过，运行时降级为单词轮。

## 音素音频

见 audio/v1/ 与 plans/phonetic-audio-research.md（构建脚本 pnpm build:phoneme-audio）。
`;
	writeFileSync(join(outDir, "README.md"), readme, "utf8");
	console.log(`说明：${join(outDir, "README.md")}`);
}

await main();
