/**
 * 组句（范例组句）出题诊断 / 端到端回归脚本
 *
 * 用法：
 *   pnpm get:cloze word1 word2 word3 ...        # 候选词（也支持词组，引号包起来）
 *   pnpm get:cloze -- --count 8 word1 ...       # 只取前 8 个候选词
 *
 * 说明：
 * - 走**生产 provider**（src/lib/cloze-provider.ts），一次请求生成本场全部题目
 * - 打印题目、答案词覆盖率、耗时与降级诊断；**不打印 API Key**（诊断里只有 endpoint/model）
 * - 契约校验不过时按「AI 当前不可用」口径输出错误原因（与界面一致）
 * - 配置读项目 .env：MDS_AI_BASE_URL / MDS_AI_API_KEY / MDS_AI_MODEL
 */
import { existsSync } from "node:fs";
import { register } from "node:module";
import { resolve } from "node:path";
import process from "node:process";

// 项目源码用无扩展名的相对导入（Vite 风格），Node 需要这个钩子才能解析
register("./ts-resolve-hook.mjs", import.meta.url);

const projectRoot = resolve(import.meta.dirname, "..");
const envFile = resolve(projectRoot, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const { fetchClozeItems } = await import("../src/lib/cloze-provider.ts");

const baseUrl = String(process.env.MDS_AI_BASE_URL ?? "").trim();
const apiKey = String(process.env.MDS_AI_API_KEY ?? "").trim();
const model = String(process.env.MDS_AI_MODEL ?? "gpt-4o-mini").trim();

function printUsage() {
	console.log("用法：pnpm get:cloze word1 word2 word3 …（可加 -- --count N 限制候选数）");
	console.log("配置：.env 中填写 MDS_AI_BASE_URL、MDS_AI_API_KEY、MDS_AI_MODEL");
}

function parseArgs(args) {
	const words = [];
	let count = 24;
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (arg === "--count") {
			const value = Number(args[++index]);
			if (Number.isFinite(value) && value > 0) count = Math.min(24, Math.floor(value));
			continue;
		}
		const word = String(arg).trim();
		if (word) words.push(word);
	}
	return { words: [...new Set(words)], count };
}

async function main() {
	const { words, count } = parseArgs(process.argv.slice(2));
	if (words.length === 0 || process.argv.includes("--help")) {
		printUsage();
		process.exitCode = process.argv.includes("--help") ? 0 : 1;
		return;
	}
	if (!baseUrl || !apiKey) {
		console.error("缺少 MDS_AI_BASE_URL 或 MDS_AI_API_KEY，请在项目 .env 中配置。");
		process.exitCode = 1;
		return;
	}

	const candidates = words.slice(0, count).map((word) => ({ word }));
	const events = [];
	try {
		const result = await fetchClozeItems({
			candidates,
			baseUrl,
			apiKey,
			model,
			onDiagnostic: (event) => events.push(event),
		});
		const answerWords = [
			...new Set(result.items.flatMap((item) => item.blanks.map((blank) => blank.answer))),
		];
		console.log(
			JSON.stringify(
				{
					candidates: candidates.map((candidate) => candidate.word),
					items: result.items,
					summary: {
						itemCount: result.items.length,
						blankCount: result.items.reduce((sum, item) => sum + item.blanks.length, 0),
						answerCount: answerWords.length,
						answerWords,
						candidateCoverage: `${answerWords.length}/${candidates.length}`,
					},
					diagnostics: result.diagnostics,
					events,
				},
				null,
				2,
			),
		);
	} catch (error) {
		console.error(
			JSON.stringify(
				{
					error: error instanceof Error ? error.name : "Error",
					code:
						error && typeof error === "object" && "code" in error
							? error.code
							: undefined,
					message: error instanceof Error ? error.message : String(error),
					events,
				},
				null,
				2,
			),
		);
		process.exitCode = 1;
	}
}

await main();
