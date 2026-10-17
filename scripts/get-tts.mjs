#!/usr/bin/env node
/**
 * 语音合成诊断脚本：pnpm get:tts word1 word2 ...
 *
 * 用生产同一套 provider（src/lib/edge-tts-client）真连一次，逐词输出：
 * 命中端点 / 是否走了回退端点 / 耗时 / 音频字节数 / mp3 头是否合法 / 失败原因。
 * 只读不写：不落业务缓存，也不打印任何密钥（Edge 的客户端令牌是公开常量，不在此列）。
 * 失败（任一词失败）退出码非 0，便于脚本/CI 判读。
 */
import { register } from "node:module";
import process from "node:process";

register("./ts-resolve-hook.mjs", import.meta.url);

const { createEdgeTtsClient, getEdgeTtsClockSkew } = await import(
	"../src/lib/edge-tts-client.ts"
);
const { SEC_MS_GEC_VERSION } = await import("../src/lib/edge-tts-token.ts");

const words = process.argv.slice(2).filter((word) => word.trim().length > 0);
if (words.length === 0) {
	console.error("用法：pnpm get:tts <word> [word...]");
	console.error("例：  pnpm get:tts apple banana \"ice cream\"");
	process.exit(2);
}

if (words.includes("--help") || words.includes("-h")) {
	console.log("用法：pnpm get:tts <word> [word...]");
	process.exit(0);
}

const client = createEdgeTtsClient();
const VOICE = process.env.MDS_TTS_VOICE?.trim() || "en-US-AvaNeural";

/** 与路由同口径的 mp3 头判定 */
function mp3HeaderKind(bytes) {
	if (bytes.length < 2) return "too-short";
	if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return "id3";
	if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return "frame-sync";
	return "invalid";
}

console.log(`音色: ${VOICE}`);
console.log(`令牌版本: ${SEC_MS_GEC_VERSION}`);
console.log(`时钟偏移: ${getEdgeTtsClockSkew()} s`);
console.log("");

let failed = 0;
for (const word of words) {
	const startedAt = Date.now();
	try {
		const result = await client.synthesize({ text: word, voice: VOICE });
		const kind = mp3HeaderKind(result.audio);
		const ok = kind !== "invalid" && kind !== "too-short";
		console.log(
			`${ok ? "✓" : "✗"} ${word.padEnd(16)} ` +
				`端点=${result.endpoint}${result.fallback ? "（回退）" : ""} ` +
				`耗时=${result.elapsedMs}ms 字节=${result.audio.length} mp3头=${kind}`,
		);
		if (!ok) failed += 1;
	} catch (error) {
		failed += 1;
		const code = error?.code ? ` [${error.code}]` : "";
		const status = error?.statusCode ? ` HTTP ${error.statusCode}` : "";
		console.log(
			`✗ ${word.padEnd(16)} 耗时=${Date.now() - startedAt}ms 失败${code}${status}: ${error?.message ?? error}`,
		);
		for (const attempt of error?.attempts ?? []) {
			console.log(`    · 尝试：${attempt}`);
		}
	}
}

console.log("");
if (failed > 0) {
	console.log(
		`完成：${words.length - failed}/${words.length} 成功。失败排查建议：\n` +
			"  · HTTP 403：令牌版本或本机时钟偏移过大（可对照系统时间与时区）\n" +
			"  · 连接超时/连不上：网络到 api.msedgeservices.com 是否可达（代理/防火墙）\n" +
			"  · no-audio：文本被服务端判定为空或含不可合成内容",
	);
	process.exit(1);
}
console.log(`完成：${words.length}/${words.length} 成功`);
