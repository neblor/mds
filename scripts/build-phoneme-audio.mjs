/**
 * 生成音素独立发音的静态音频：Wikimedia Commons → public/ipa/audio/v1/*.mp3
 *
 * 用法：
 *   pnpm build:phoneme-audio
 *   pnpm build:phoneme-audio -- --sources scripts/data/phoneme-audio-sources.json
 *
 * 说明：
 * - 源表在 scripts/data/phoneme-audio-sources.json（token → Commons 文件/作者/许可）；
 * - 单元音/辅音：下载 OGG → 去静音/trim/响度归一 → MP3 64k mono；
 * - 8 个双元音：用同一说话人的两个单元音拼接（0.3s + 0.3s，6ms 交叉淡化）；
 * - 生成 manifest.json + LICENSE.md；生成物提交仓库，pnpm check 不联网。
 * - 音频目录整体 CC BY-SA 4.0（源文件各自 CC BY-SA 3.0/4.0、CC0 或公有领域），
 *   逐文件作者/来源/许可/修改写在 LICENSE.md。
 */
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { register } from "node:module";

register("./ts-resolve-hook.mjs", import.meta.url);
const { PHONEME_AUDIO_VERSION, IPA_SYMBOLS, IPA_STRESS } = await import(
	"../src/lib/phonetic-symbols.ts"
);

const projectRoot = resolve(import.meta.dirname, "..");
const sourceFile = resolve(
	process.argv.includes("--sources")
		? process.argv[process.argv.indexOf("--sources") + 1]
		: join(projectRoot, "scripts", "data", "phoneme-audio-sources.json"),
);
const version = PHONEME_AUDIO_VERSION;
const outDir = join(projectRoot, "public", "ipa", "audio", `v${version}`);
const tmpRoot = join(projectRoot, ".tmp", "phoneme-audio");
const srcDir = join(tmpRoot, "src");
const partsDir = join(tmpRoot, "parts");

const spec = readSpec(sourceFile);
const commons = String(spec.commons);
const tokens = spec.tokens;
const sources = spec.sources;
const components = spec.components ?? {};

function sleep(ms) {
	return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function readSpec(path) {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		throw new Error(
			`无法读取音源表 ${path}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function kb(bytes) {
	return `${(bytes / 1024).toFixed(1)} KB`;
}

function ensureFfmpeg() {
	try {
		execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
		execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
	} catch {
		throw new Error("缺少 ffmpeg/ffprobe，无法生成音素音频");
	}
}

function sourceById(id) {
	const source = sources[id];
	if (!source) throw new Error(`未知音源 id：${id}`);
	return source;
}

function downloadUrl(source) {
	return `${commons}${encodeURIComponent(source.title.replace(/ /g, "_"))}`;
}

async function ensureSource(id) {
	const source = sourceById(id);
	const path = join(srcDir, `${id}.ogg`);
	if (existsSync(path) && statSync(path).size > 1000) return path;
	mkdirSync(srcDir, { recursive: true });
	let lastError;
	for (let attempt = 0; attempt < 3; attempt += 1) {
		try {
			const response = await fetch(downloadUrl(source), {
				headers: { "user-agent": "mds-build-phoneme-audio/1.0" },
			});
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			writeFileSync(path, Buffer.from(await response.arrayBuffer()));
			console.log(`下载 ${id}: ${kb(statSync(path).size)}`);
			await sleep(120);
			return path;
		} catch (error) {
			lastError = error;
			await sleep(400);
		}
	}
	throw new Error(`下载音源失败 ${source.title}: ${lastError}`);
}

function runFfmpeg(args) {
	execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], {
		stdio: ["ignore", "ignore", "pipe"],
	});
}

function outputFade(duration) {
	const fade = Math.min(0.01, duration / 4);
	return {
		fade,
		fadeOutStart: Math.max(0, duration - fade - 0.01),
	};
}

function convertSource(sourcePath, outPath, duration) {
	const { fade, fadeOutStart } = outputFade(duration);
	const filter = [
		"silenceremove=start_periods=1:start_duration=0.02:start_threshold=-45dB",
		"loudnorm=I=-16:TP=-1.5:LRA=11",
		`afade=t=in:st=0:d=${fade}`,
		`afade=t=out:st=${fadeOutStart}:d=${fade}`,
	].join(",");
	runFfmpeg([
		"-i",
		sourcePath,
		"-t",
		String(duration),
		"-af",
		filter,
		"-ac",
		"1",
		"-ar",
		"22050",
		"-b:a",
		"64k",
		outPath,
	]);
}

function probeDurationMs(path) {
	const text = execFileSync(
		"ffprobe",
		[
			"-v",
			"error",
			"-show_entries",
			"format=duration",
			"-of",
			"csv=p=0",
			path,
		],
		{ encoding: "utf8" },
	).trim();
	const seconds = Number.parseFloat(text);
	return Number.isFinite(seconds) ? Math.round(seconds * 1000) : 0;
}

function componentFile(component) {
	if (components[component]) {
		return join(partsDir, `_${component}.mp3`);
	}
	const entry = tokens[component];
	if (!entry?.file) throw new Error(`双元音组件缺失：${component}`);
	return join(outDir, entry.file);
}

function componentSourceIds(component) {
	if (components[component]) return [components[component].source];
	const entry = tokens[component];
	if (!entry) throw new Error(`双元音组件缺失：${component}`);
	if (entry.source) return [entry.source];
	if (entry.components) return entry.components.flatMap(componentSourceIds);
	throw new Error(`双元音组件没有音源：${component}`);
}

function concatDiphthong(entry, outPath) {
	const [first, second] = entry.components.map(componentFile);
	const duration = 0.3;
	const fade = 0.06;
	const filter =
		`[0:a]atrim=0:${duration},asetpts=PTS-STARTPTS,afade=t=out:st=${duration - fade}:d=${fade}[a];` +
		`[1:a]atrim=0:${duration},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${fade},afade=t=out:st=${duration - fade}:d=${fade}[b];` +
		"[a][b]concat=n=2:v=0:a=1[out]";
	runFfmpeg([
		"-i",
		first,
		"-i",
		second,
		"-filter_complex",
		filter,
		"-map",
		"[out]",
		"-ac",
		"1",
		"-ar",
		"22050",
		"-b:a",
		"64k",
		outPath,
	]);
}

function licenseMarkdown(manifest) {
	const lines = [
		"# 音素音频许可（v1）",
		"",
		"本目录的 MP3 是音素示范音频，整体以 CC BY-SA 4.0 发布（公有领域/CC0 的源除外）；",
		"App 代码保持 MIT。下表逐文件列出源、作者、许可与修改。",
		"",
		"| 文件 | token | 源 | 作者 | 许可 | 修改 |",
		"| --- | --- | --- | --- | --- | --- |",
	];
	for (const [token, entry] of Object.entries(manifest.tokens)) {
		const sourceList = entry.sourceIds
			.map((id) => manifest.sources[id])
			.filter(Boolean)
			.map((source) => `[${source.title}](${source.page})`)
			.join(" + ");
		const authors = [
			...new Set(
				entry.sourceIds
					.map((id) => manifest.sources[id]?.author)
					.filter(Boolean),
			),
		].join(", ");
		const licenses = [
			...new Set(
				entry.sourceIds
					.map((id) => manifest.sources[id]?.license)
					.filter(Boolean),
			),
		].join(", ");
		const modification =
			entry.kind === "diphthong"
				? `由 ${entry.components.join(" + ")} 拼接（CC BY-SA 4.0）`
				: "去静音、trim、loudnorm、转 MP3 64k mono";
		lines.push(
			`| ${entry.file} | ${token} | ${sourceList} | ${authors} | ${licenses} | ${modification} |`,
		);
	}
	lines.push(
		"",
		"## 说明",
		"",
		"- 源文件来自 Wikimedia Commons；原始文件与作者页见上表链接。",
		"- 双元音不是某位发音人的真实录音，而是两个单元音的拼接示范。",
		"- 辅音源多为「辅音 + 元音」示范，不是严格隔离的单音；UI 标「音素示范」。",
		"- 音频的转换/trim/拼接属于改编，按 CC BY-SA 4.0 发布；源文件仍按各自许可。",
		"",
	);
	return lines.join("\n");
}

async function main() {
	ensureFfmpeg();
	mkdirSync(outDir, { recursive: true });
	mkdirSync(partsDir, { recursive: true });

	// 1) 下载所有被引用的源
	const neededSources = new Set();
	for (const entry of Object.values(tokens)) {
		if (entry.source) neededSources.add(entry.source);
		if (entry.components) {
			for (const component of entry.components) {
				for (const id of componentSourceIds(component)) neededSources.add(id);
			}
		}
	}
	for (const [, entry] of Object.entries(components)) {
		neededSources.add(entry.source);
	}
	for (const id of [...neededSources].sort()) await ensureSource(id);

	// 2) 单元音/辅音
	for (const [token, entry] of Object.entries(tokens)) {
		if (!entry.source) continue;
		const src = join(srcDir, `${entry.source}.ogg`);
		const out = join(outDir, entry.file);
		convertSource(src, out, entry.duration ?? 0.35);
		console.log(`${token} → ${entry.file} (${probeDurationMs(out)} ms)`);
	}

	// 3) 双元音的额外组件（a）
	for (const [component, entry] of Object.entries(components)) {
		const src = join(srcDir, `${entry.source}.ogg`);
		const out = join(partsDir, `_${component}.mp3`);
		convertSource(src, out, entry.duration ?? 0.3);
	}

	// 4) 双元音拼接
	for (const [token, entry] of Object.entries(tokens)) {
		if (!entry.components) continue;
		const out = join(outDir, entry.file);
		concatDiphthong(entry, out);
		console.log(`${token} → ${entry.file} (${probeDurationMs(out)} ms)`);
	}

	// 5) manifest
	const manifest = {
		version,
		basePath: `/ipa/audio/v${version}/`,
		license: "CC BY-SA 4.0 (see LICENSE.md)",
		tokens: {},
		sources: {},
	};
	for (const [id, source] of Object.entries(sources)) {
		manifest.sources[id] = {
			title: source.title,
			author: source.author,
			license: source.license,
			page: source.page,
			download: downloadUrl(source),
		};
	}
	for (const [token, entry] of Object.entries(tokens)) {
		const out = join(outDir, entry.file);
		const sourceIds = entry.source
			? [entry.source]
			: entry.components.flatMap(componentSourceIds);
		manifest.tokens[token] = {
			file: entry.file,
			kind: entry.kind,
			durationMs: probeDurationMs(out),
			sourceIds: [...new Set(sourceIds)],
			...(entry.components ? { components: entry.components } : {}),
		};
	}
	writeFileSync(
		join(outDir, "manifest.json"),
		`${JSON.stringify(manifest, null, 2)}\n`,
		"utf8",
	);
	writeFileSync(join(outDir, "LICENSE.md"), licenseMarkdown(manifest), "utf8");
	writeFileSync(
		join(outDir, "README.md"),
		`# 音素音频 v${version}\n\n` +
			"由 `pnpm build:phoneme-audio` 从 Wikimedia Commons 生成；\n" +
			"token → 文件见 manifest.json；许可见 LICENSE.md。\n" +
			"音频目录整体 CC BY-SA 4.0；App 代码保持 MIT。\n",
		"utf8",
	);

	// 6) 校验：45 个音素（除去重音）齐全
	const missing = IPA_SYMBOLS.filter(
		(token) => !IPA_STRESS.includes(token) && !manifest.tokens[token],
	);
	if (missing.length > 0) {
		throw new Error(`音素音频缺少 token：${missing.join(" ")}`);
	}
	const totalBytes = Object.keys(manifest.tokens).reduce(
		(sum, token) =>
			sum + statSync(join(outDir, manifest.tokens[token].file)).size,
		0,
	);
	console.log(
		`完成：${Object.keys(manifest.tokens).length} 个音素，音频 ${kb(totalBytes)}；` +
			`manifest/LICENSE 已写入 ${outDir}`,
	);
}

await main();
