import { existsSync } from "node:fs";
import process from "node:process";
import { resolve } from "node:path";
import { fetchEnglishDefinitions } from "../src/lib/definition-provider.ts";

const projectRoot = resolve(import.meta.dirname, "..");
const envFile = resolve(projectRoot, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const words = [...new Set(process.argv.slice(2).map((word) => word.trim()).filter(Boolean))];
if (words.length === 0 || words.includes("--help")) {
	console.log("用法：pnpm get:explain word1 word2 \"a short phrase\"");
	console.log("配置：.env 中填写 MDS_AI_BASE_URL、MDS_AI_API_KEY、MDS_AI_MODEL");
	process.exit(words.includes("--help") ? 0 : 1);
}

const baseUrl = String(process.env.MDS_AI_BASE_URL ?? "").trim();
const apiKey = String(process.env.MDS_AI_API_KEY ?? "").trim();
const model = String(process.env.MDS_AI_MODEL ?? "gpt-4o-mini").trim();
if (!baseUrl || !apiKey) {
	console.error("缺少 MDS_AI_BASE_URL 或 MDS_AI_API_KEY，请在项目 .env 中配置。");
	process.exit(1);
}

const diagnosticEvents = [];
try {
	const result = await fetchEnglishDefinitions({
		words,
		baseUrl,
		apiKey,
		model,
		onDiagnostic: (event) => diagnosticEvents.push(event),
	});
	console.log(JSON.stringify({
		definitions: result.definitions,
		missing: result.missing,
		warning: result.warning,
		diagnostics: result.diagnostics,
		events: diagnosticEvents,
	}, null, 2));
	if (result.missing.length > 0) process.exitCode = 2;
} catch (error) {
	console.error(JSON.stringify({
		error: error instanceof Error ? error.name : "Error",
		code: error && typeof error === "object" && "code" in error ? error.code : undefined,
		message: error instanceof Error ? error.message : String(error),
		events: diagnosticEvents,
	}, null, 2));
	process.exitCode = 1;
}
