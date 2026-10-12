import { existsSync } from "node:fs";
import process from "node:process";
import { resolve } from "node:path";
import {
	fetchEnglishDefinitions,
	fetchChineseWords,
	fetchAnswerGrades,
} from "../src/lib/definition-provider.ts";

const projectRoot = resolve(import.meta.dirname, "..");
const envFile = resolve(projectRoot, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

/**
 * 配置解析必须早于任何 provider 调用。
 *
 * 历史 bug：顶层 dispatch 写在 `const baseUrl` 之前，凡是要真正调用 AI 的命令
 * （任意单词 / --chinese / --grade）都会命中 TDZ：
 *   ReferenceError: Cannot access 'baseUrl' before initialization
 * 只有 --help 与空参数分支侥幸不触发，所以这问题一直藏到有人真跑一次才暴露。
 * 现在结构固定为：读配置 →（按分支）校验 → dispatch，全部收进 main() 并由文件末尾 await。
 * 回归测试见 src/lib/explain-cli.test.ts。
 */
const baseUrl = String(process.env.MDS_AI_BASE_URL ?? "").trim();
const apiKey = String(process.env.MDS_AI_API_KEY ?? "").trim();
const model = String(process.env.MDS_AI_MODEL ?? "gpt-4o-mini").trim();

function printUsage() {
	console.log('用法：pnpm get:explain word1 word2 "a short phrase"');
	console.log("      pnpm get:explain --chinese hello world   # 抓中文对应词");
	console.log('      pnpm get:explain --grade "hello=你好"    # AI 批改中文词作答');
	console.log('      pnpm get:explain --grade-def "apple=a fruit"  # AI 批改释义作答');
	console.log("配置：.env 中填写 MDS_AI_BASE_URL、MDS_AI_API_KEY、MDS_AI_MODEL");
}

/** 需要真正调用 AI 的分支才校验配置（--help / 空参数只打用法） */
function ensureConfig() {
	if (baseUrl && apiKey) return true;
	console.error("缺少 MDS_AI_BASE_URL 或 MDS_AI_API_KEY，请在项目 .env 中配置。");
	process.exitCode = 1;
	return false;
}

function report(result) {
	console.log(JSON.stringify(result, null, 2));
	if (result.missing?.length > 0) process.exitCode = 2;
}

function reportError(error, diagnosticEvents) {
	console.error(JSON.stringify({
		error: error instanceof Error ? error.name : "Error",
		code: error && typeof error === "object" && "code" in error ? error.code : undefined,
		message: error instanceof Error ? error.message : String(error),
		events: diagnosticEvents,
	}, null, 2));
	process.exitCode = 1;
}

async function runPairs(words, isChinese) {
	const diagnosticEvents = [];
	try {
		const result = isChinese
			? await fetchChineseWords({ words, baseUrl, apiKey, model, onDiagnostic: (event) => diagnosticEvents.push(event) })
			: await fetchEnglishDefinitions({ words, baseUrl, apiKey, model, onDiagnostic: (event) => diagnosticEvents.push(event) });
		report({
			...(isChinese ? { words: result.words } : { definitions: result.definitions }),
			missing: result.missing,
			warning: result.warning,
			diagnostics: result.diagnostics,
			events: diagnosticEvents,
		});
	} catch (error) {
		reportError(error, diagnosticEvents);
	}
}

async function runGrade(items, kind) {
	const diagnosticEvents = [];
	try {
		const result = await fetchAnswerGrades({ kind, items, baseUrl, apiKey, model, onDiagnostic: (event) => diagnosticEvents.push(event) });
		report({
			grades: result.grades,
			missing: result.missing,
			warning: result.warning,
			diagnostics: result.diagnostics,
			events: diagnosticEvents,
		});
	} catch (error) {
		reportError(error, diagnosticEvents);
	}
}

/** 收集词汇参数：去空白、去重、丢弃空项 */
function collectWords(args) {
	return [...new Set(args.map((word) => word.trim()).filter(Boolean))];
}

/** 解析 `word=答案` / `word:答案` 形式（批量批改用） */
function collectGradeItems(args) {
	return args.map((pair) => {
		const sep = pair.includes("=") ? "=" : ":";
		const [word, ...answerParts] = pair.split(sep);
		return {
			word: word.trim(),
			expected: "",
			answer: answerParts.join(sep).trim(),
		};
	}).filter((item) => item.word && item.answer);
}

async function main() {
	const args = process.argv.slice(2);
	const grade = args.includes("--grade");
	const gradeDef = args.includes("--grade-def");
	const chinese = args.includes("--chinese");
	const rest = args.filter(
		(arg) => arg !== "--grade" && arg !== "--grade-def" && arg !== "--chinese",
	);

	if (grade || gradeDef) {
		// 用法：pnpm get:explain --grade "hello=你好"（中文词）/ --grade-def "apple=a round fruit"（释义）
		const items = collectGradeItems(rest);
		if (items.length === 0) {
			console.log('用法：pnpm get:explain --grade "hello=你好"  # 中文词批改');
			console.log('      pnpm get:explain --grade-def "apple=a round fruit"  # 释义批改');
			process.exitCode = 1;
			return;
		}
		if (!ensureConfig()) return;
		await runGrade(items, gradeDef ? "definition" : "chinese");
		return;
	}

	if (chinese) {
		const words = collectWords(rest);
		if (words.length === 0) {
			console.log("用法：pnpm get:explain --chinese hello world");
			process.exitCode = 1;
			return;
		}
		if (!ensureConfig()) return;
		await runPairs(words, true);
		return;
	}

	const words = collectWords(rest);
	if (words.length === 0 || args.includes("--help")) {
		printUsage();
		process.exitCode = args.includes("--help") ? 0 : 1;
		return;
	}
	if (!ensureConfig()) return;
	await runPairs(words, false);
}

await main();
