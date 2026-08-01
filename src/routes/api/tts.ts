/**
 * POST /api/tts — 合成单词语音并缓存到 word-cache/
 * 请求：{ words: string[] }
 * 返回：{ items: [{ word, name, cached }] }
 * 语音文件名按单词转义（见 lib/tts-filename），命中缓存则跳过合成（增量缓存）。
 * 服务端运行在 Deno（deno desktop）或 Node（vite dev）下，node:fs 两者兼容。
 */
import { HTTPError } from "h3";
import { existsSync, writeFileSync } from "node:fs";
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

async function synthOne(word: string, voice: string): Promise<void> {
	const tts = new EdgeTTS(word, voice);
	const result = await tts.synthesize();
	const buf = await result.audio.arrayBuffer();
	writeFileSync(
		join(cacheDir, cacheFileName(word, voice)),
		new Uint8Array(buf),
	);
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
		await synthOne(word, voice);
		return { word, name, cached: false } satisfies TtsItem;
	});

	return { items };
}
