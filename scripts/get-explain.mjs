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

const args = process.argv.slice(2);
const grade = args.includes("--grade");
const gradeDef = args.includes("--grade-def");
const chinese = args.includes("--chinese");
const rest = args.filter(
	(a) => a !== "--grade" && a !== "--grade-def" && a !== "--chinese",
);

if (grade || gradeDef) {
	// 用法：pnpm get:explain --grade "hello=你好"（中文词）/ --grade-def "apple=a round fruit"（释义）
	const items = rest.map((pair) => {
		const sep = pair.includes("=") ? "=" : ":";
		const [word, ...answerParts] = pair.split(sep);
		return {
			word: word.trim(),
			expected: "",
			answer: answerParts.join(sep).trim(),
		};
	}).filter((i) => i.word && i.answer);
	if (items.length === 0) {
		console.log('用法：pnpm get:explain --grade "hello=你好"  # 中文词批改');
		console.log('      pnpm get:explain --grade-def "apple=a round fruit"  # 释义批改');
		process.exit(1);
	}
	runGrade(items, gradeDef ? "definition" : "chinese");
} else if (chinese) {
	const words = [...new Set(rest.map((word) => word.trim()).filter(Boolean))];
	if (words.length === 0) {
		console.log('用法：pnpm get:explain --chinese hello world');
		process.exit(1);
	}
	runPairs(words, true);
} else {
	const words = [...new Set(rest.map((word) => word.trim()).filter(Boolean))];
	if (words.length === 0 || args.includes("--help")) {
		console.log("用法：pnpm get:explain word1 word2 \"a short phrase\"");
		console.log("      pnpm get:explain --chinese hello world   # 抓中文对应词");
		console.log('      pnpm get:explain --grade "hello=你好"    # AI 批改中文词作答');
		console.log('      pnpm get:explain --grade-def "apple=a fruit"  # AI 批改释义作答');
		console.log("配置：.env 中填写 MDS_AI_BASE_URL、MDS_AI_API_KEY、MDS_AI_MODEL");
		process.exit(args.includes("--help") ? 0 : 1);
	}
	runPairs(words, false);
}

const baseUrl = String(process.env.MDS_AI_BASE_URL ?? "").trim();
const apiKey = String(process.env.MDS_AI_API_KEY ?? "").trim();
const model = String(process.env.MDS_AI_MODEL ?? "gpt-4o-mini").trim();
if (!baseUrl || !apiKey) {
	console.error("缺少 MDS_AI_BASE_URL 或 MDS_AI_API_KEY，请在项目 .env 中配置。");
	process.exit(1);
}

function report(result) {
	console.log(JSON.stringify(result, null, 2));
	if (result.missing?.length > 0) process.exitCode = 2;
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

function reportError(error, diagnosticEvents) {
	console.error(JSON.stringify({
		error: error instanceof Error ? error.name : "Error",
		code: error && typeof error === "object" && "code" in error ? error.code : undefined,
		message: error instanceof Error ? error.message : String(error),
		events: diagnosticEvents,
	}, null, 2));
	process.exitCode = 1;
}
