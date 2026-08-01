/**
 * POST /api/tts — 合成单词语音并缓存到 word-cache/
 * 请求：{ words: string[] }
 * 返回：{ items: [{ word, name, cached }] }
 * 语音文件名按单词转义（见 lib/tts-filename），命中缓存则跳过合成（增量缓存）。
 * 服务端运行在 Deno（deno desktop）或 Node（vite dev）下，node:fs 两者兼容。
 */
import { HTTPError } from "h3";
import { existsSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { EdgeTTS } from "edge-tts-universal";
import { cacheFileName } from "~/lib/tts-filename";
import { VOICE, cacheDir } from "~/lib/word-cache";
import { readJsonBody, extractWords, type RouteEvent } from "~/lib/server-body";

export interface TtsItem {
	word: string;
	name: string;
	cached: boolean;
}

/** 校验 mp3 具有合理媒体头（ID3 标签或帧同步），避免空/损坏字节入缓存 */
function hasMp3Header(bytes: Uint8Array): boolean {
	if (bytes.length < 2) return false;
	// ID3 标签：'ID3'
	if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return true;
	// MPEG 帧同步：0xFF 0xEx
	return bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
}

async function synthOne(
	word: string,
	voice: string,
	isAborted: () => boolean,
): Promise<void> {
	const tts = new EdgeTTS(word, voice);
	const result = await tts.synthesize();
	const buf = await result.audio.arrayBuffer();
	// 合成返回后检查中止：已中止则丢弃结果、不写缓存（不污染缓存也不消耗后续流程）
	if (isAborted()) return;
	const bytes = new Uint8Array(buf);
	if (!hasMp3Header(bytes)) {
		throw new Error(`语音合成结果无效：${word}`);
	}
	// 原子写：临时文件 + rename，避免进程中断留下半文件
	const target = join(cacheDir, cacheFileName(word, voice));
	const tmp = join(cacheDir, `.tmp-${process.pid}-${randomUUID()}`);
	try {
		writeFileSync(tmp, bytes);
		if (isAborted()) return;
		try {
			renameSync(tmp, target);
		} catch (err) {
			// 两个请求可能同时为同一单词合成：另一请求已先完成时，当前结果可直接丢弃。
			// Windows rename 不会像 POSIX 一样稳定覆盖已存在目标，因此显式处理该竞争。
			if (!existsSync(target)) throw err;
		}
	} finally {
		if (existsSync(tmp)) rmSync(tmp, { force: true });
	}
}

/** 简单并发池 */
async function mapPool<T, R>(
	items: T[],
	limit: number,
	fn: (item: T) => Promise<R>,
): Promise<R[]> {
	const results: R[] = [];
	let i = 0;
	const workers: Promise<void>[] = [];
	const n = Math.min(limit, items.length);
	for (let w = 0; w < n; w++) {
		workers.push(
			(async () => {
				while (i < items.length) {
					const idx = i++;
					results[idx] = await fn(items[idx]);
				}
			})(),
		);
	}
	await Promise.all(workers);
	return results;
}

export async function POST(event: RouteEvent) {
	const body = await readJsonBody(event);
	const raw = body as { words?: unknown[]; voice?: string };
	const words = extractWords(raw);
	const voice = String(raw?.voice ?? "").trim() || VOICE;
	if (words.length === 0) {
		throw new HTTPError({
			status: 400,
			statusText: "Bad Request",
			message: "words 不能为空",
		});
	}

	const signal: AbortSignal | undefined = event.request?.signal;
	const isAborted = () => signal?.aborted === true;

	const items = await mapPool(words, 2, async (word) => {
		const name = cacheFileName(word, voice);
		if (existsSync(join(cacheDir, name))) {
			return { word, name, cached: true } satisfies TtsItem;
		}
		if (isAborted())
			throw new HTTPError({
				status: 499,
				statusText: "aborted",
				message: "aborted",
			});
		await synthOne(word, voice, isAborted);
		return { word, name, cached: false } satisfies TtsItem;
	});

	return { items };
}
