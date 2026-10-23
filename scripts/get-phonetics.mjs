/**
 * 音标 AI 兜底诊断：直接调用生产 provider，不读写业务缓存。
 * 用法：pnpm get:phonetics apple water
 * 配置：项目 .env 的 MDS_AI_BASE_URL / MDS_AI_API_KEY / MDS_AI_MODEL。
 * 输出逐词读音、缺失、耗时、兼容降级与诊断事件；不打印 Key。
 */
import { existsSync } from "node:fs";
import { register } from "node:module";
import process from "node:process";
import { resolve } from "node:path";

register("./ts-resolve-hook.mjs", import.meta.url);
const { fetchPhonetics } = await import("../src/lib/phonetic-provider.ts");
const { phoneticDisplay } = await import("../src/lib/phonetic-parse.ts");

const projectRoot = resolve(import.meta.dirname, "..");
const envFile = resolve(projectRoot, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const baseUrl = String(process.env.MDS_AI_BASE_URL ?? "").trim();
const apiKey = String(process.env.MDS_AI_API_KEY ?? "").trim();
const model = String(process.env.MDS_AI_MODEL ?? "gpt-4o-mini").trim();
const words = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));

if (words.length === 0) {
	console.log("用法：pnpm get:phonetics word1 word2 ...");
	console.log("配置：.env 中填写 MDS_AI_BASE_URL、MDS_AI_API_KEY、MDS_AI_MODEL");
	process.exitCode = 1;
} else if (!baseUrl || !apiKey) {
	console.error("缺少 MDS_AI_BASE_URL 或 MDS_AI_API_KEY，请在项目 .env 中配置。");
	process.exitCode = 1;
} else {
	const events = [];
	try {
		const result = await fetchPhonetics({
			words,
			baseUrl,
			apiKey,
			model,
			onDiagnostic: (event) => events.push(event),
		});
		for (const [word, variants] of Object.entries(result.phonetics)) {
			console.log(
				`✓ ${word.padEnd(20)} ${variants.map(phoneticDisplay).join(" / ")}`,
			);
		}
		for (const word of result.missing) console.log(`✗ ${word.padEnd(20)} 缺失`);
		const d = result.diagnostics;
		console.log(
			`\n完成：${words.length - result.missing.length}/${words.length}；耗时=${d.elapsedMs}ms；兼容降级=${d.fallbackUsed}；finish=${d.finishReason ?? "-"}`,
		);
		if (result.warning) console.log(`warning: ${result.warning}`);
		if (events.length > 0) console.log(JSON.stringify(events, null, 2));
		if (result.missing.length > 0) process.exitCode = 2;
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
