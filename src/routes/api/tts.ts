/**
 * POST /api/tts — 合成单词语音并缓存到 word-cache/
 * 请求：{ words: string[] }
 * 返回：{ items: [{ word, name, cached }] }
 * 语音文件名按单词转义（见 lib/tts-filename），命中缓存则跳过合成（增量缓存）。
 * 服务端运行在 Deno（deno desktop）或 Node（vite dev）下，node:fs 两者兼容。
 */
import { HTTPError } from "h3";
import { EdgeTTS } from "edge-tts-universal";
import { runtimeCache } from "~/lib/cache-storage";
import { cacheFileName } from "~/lib/tts-filename";
import { VOICE } from "~/lib/word-cache";
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
	// 合成返回后检查中止：已中止则丢弃结果，并让路由明确失败，不能返回不存在的文件名。
	if (isAborted()) {
		throw new HTTPError({
			status: 499,
			statusText: "aborted",
			message: "aborted",
		});
	}
	const bytes = new Uint8Array(buf);
	if (!hasMp3Header(bytes)) {
		throw new Error(`语音合成结果无效：${word}`);
	}
	runtimeCache.writeAudio(cacheFileName(word, voice), bytes, () => !isAborted());
	if (isAborted()) {
		throw new HTTPError({
			status: 499,
			statusText: "aborted",
			message: "aborted",
		});
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
		if (runtimeCache.hasAudio(name)) {
			return { word, name, cached: true } satisfies TtsItem;
		}
		if (isAborted())
			throw new HTTPError({
				status: 499,
				statusText: "aborted",
				message: "aborted",
			});
		await synthOne(word, voice, isAborted);
		// 路由返回 200 的强不变量：响应里的每个音频名都必须已经可以读取。
		if (!runtimeCache.hasAudio(name)) {
			throw new HTTPError({
				status: 500,
				statusText: "Cache Write Failed",
				message: `语音缓存写入失败：${word}`,
			});
		}
		return { word, name, cached: false } satisfies TtsItem;
	});

	return { items };
}
