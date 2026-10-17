#!/usr/bin/env node
/**
 * 短句生成诊断：pnpm get:sentences word1 word2 ...
 *
 * 复用生产链路（sentence-service → sentence-provider），逐词输出：
 * 句子内容 / 词数 / 是否走了收紧重试 / 缺项 / 耗时。
 * 只读不写：缓存用内存替身，不落业务缓存；不打印任何密钥。
 *
 * 重点看「短」这一条：崔总要求句子尽量短（目标 3–6 词，硬上限 8 词），
 * 因此脚本会汇总长度分布，并对「贴着上限（7–8 词）」占比过高给出提示。
 */
import { existsSync } from "node:fs";
import { register } from "node:module";
import process from "node:process";
import { resolve } from "node:path";

register("./ts-resolve-hook.mjs", import.meta.url);

const { getShortSentences } = await import("../src/lib/sentence-service.ts");
const { sentenceWordCount, SENTENCE_MAX_WORDS } = await import(
	"../src/lib/sentence-provider.ts"
);

const projectRoot = resolve(import.meta.dirname, "..");
const envFile = resolve(projectRoot, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const baseUrl = String(process.env.MDS_AI_BASE_URL ?? "").trim();
const apiKey = String(process.env.MDS_AI_API_KEY ?? "").trim();
const model = String(process.env.MDS_AI_MODEL ?? "").trim() || "gpt-4o-mini";

const words = process.argv.slice(2).filter((word) => word.trim().length > 0);
if (words.length === 0 || words.includes("--help") || words.includes("-h")) {
	console.log("用法：pnpm get:sentences <word> [word...]");
	console.log('例：  pnpm get:sentences apple go happy book');
	process.exit(words.length === 0 ? 2 : 0);
}
if (!baseUrl || !apiKey) {
	console.error("缺少 MDS_AI_BASE_URL / MDS_AI_API_KEY（写在项目 .env 里）");
	process.exit(2);
}

console.log(`模型: ${model}`);
console.log(`级别: 由 contentLevel 决定（脚本默认 junior；可在设置里改）`);
console.log(`词数上限: ${SENTENCE_MAX_WORDS}（目标 3–6）`);
console.log("");

const startedAt = Date.now();
let result;
try {
	result = await getShortSentences({
		words,
		baseUrl,
		apiKey,
		model,
		// 与设置默认一致；要试别的级别改这里
		contentLevel: "junior",
		// 内存缓存：诊断不写业务缓存
		storage: { readSentences: () => undefined, writeSentences: () => {} },
	});
} catch (error) {
	console.error(`失败：${error?.message ?? error}`);
	process.exit(1);
}
const elapsedMs = Date.now() - startedAt;

const counts = [];
for (const word of words) {
	const sentence = result.sentences[word];
	if (!sentence) {
		console.log(`✗ ${word.padEnd(18)} 未通过（缺句或超过上限）`);
		continue;
	}
	const count = sentenceWordCount(sentence);
	counts.push(count);
	const flag = count > 6 ? "  ← 偏长" : "";
	console.log(`✓ ${word.padEnd(18)} ${String(count).padStart(2)} 词  ${sentence}${flag}`);
}

const longCount = counts.filter((count) => count >= 7).length;
const distribution = new Map();
for (const count of counts) distribution.set(count, (distribution.get(count) ?? 0) + 1);
const distText = [...distribution.entries()]
	.sort((a, b) => a[0] - b[0])
	.map(([count, n]) => `${count}词×${n}`)
	.join(" · ");

console.log("");
console.log(`耗时: ${elapsedMs} ms`);
console.log(`结果: ${counts.length}/${words.length} 拿到合格短句`);
if (counts.length > 0) {
	const avg = (counts.reduce((a, b) => a + b, 0) / counts.length).toFixed(1);
	console.log(`长度分布: ${distText}（平均 ${avg} 词）`);
	if (longCount / counts.length > 0.3) {
		console.log(
			`提示: 7–8 词的句子占 ${longCount}/${counts.length}，超过 30%——提示词的「短」可能需要再收紧`,
		);
	}
}
if (result.rejected.length > 0) {
	console.log(
		`被拒明细: ${result.rejected
			.map((item) => `${item.word}:${item.reason}(${item.wordCount}词)`)
			.join(" · ")}`,
	);
}
if (result.missing.length > 0) {
	console.log(`缺项（生产里会降级为单词默写）: ${result.missing.join("、")}`);
}
process.exit(result.missing.length > 0 ? 1 : 0);
