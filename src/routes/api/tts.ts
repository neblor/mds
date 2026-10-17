/**
 * POST /api/tts — 合成单词语音并缓存到 word-cache/
 * 请求：{ words: string[] }
 * 返回：{ items: [{ word, name, cached }] }
 * 语音文件名按单词转义（见 lib/tts-filename），命中缓存则跳过合成（增量缓存）。
 *
 * 合成走项目内的 Edge TTS 客户端（lib/edge-tts-client）：它自带连接/回合超时与
 * 端点回退，任何失败都会抛错而不是悬挂——旧库在握手失败时会让请求永远不返回，
 * 界面就一直停在「正在生成语音」。降级与失败在这里落诊断日志（Client 模式生效）。
 */
import { HTTPError } from "h3";
import { EdgeTtsError, edgeTts } from "~/lib/edge-tts-client";
import { runtimeCache } from "~/lib/cache-storage";
import { runtimeDiagnosticLogger } from "~/lib/runtime-logger";
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

function abortedError(): HTTPError {
	return new HTTPError({
		status: 499,
		statusText: "aborted",
		message: "aborted",
	});
}

async function synthOne(
	word: string,
	voice: string,
	isAborted: () => boolean,
	signal?: AbortSignal,
): Promise<void> {
	const name = cacheFileName(word, voice);
	let audio: Uint8Array;
	try {
		const result = await edgeTts.synthesize({ text: word, voice, signal });
		if (isAborted()) throw abortedError();
		audio = result.audio;
		if (result.fallback) {
			// 自动降级必须留痕：主端点失败换到了备用端点
			runtimeDiagnosticLogger.write({
				event: "tts.endpoint-fallback",
				level: "warning",
				details: {
					word,
					voice,
					endpoint: result.endpoint,
					elapsedMs: result.elapsedMs,
				},
			});
		}
	} catch (error) {
		if (
			isAborted() ||
			(error instanceof EdgeTtsError && error.code === "aborted")
		) {
			throw abortedError();
		}
		const detail = error instanceof Error ? error.message : String(error);
		runtimeDiagnosticLogger.write({
			event: "tts.synth-failed",
			level: "error",
			details: {
				word,
				voice,
				detail,
				code: error instanceof EdgeTtsError ? error.code : undefined,
				statusCode: error instanceof EdgeTtsError ? error.statusCode : undefined,
				attempts:
					error instanceof EdgeTtsError ? error.attempts : undefined,
			},
		});
		throw new HTTPError({
			status: 502,
			statusText: "TTS Failed",
			message: `语音合成失败：${detail}`,
		});
	}
	if (!hasMp3Header(audio)) {
		throw new HTTPError({
			status: 502,
			statusText: "Invalid Audio",
			message: `语音合成结果无效：${word}`,
		});
	}
	runtimeCache.writeAudio(name, audio, () => !isAborted());
	if (isAborted()) {
		throw abortedError();
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
		if (isAborted()) throw abortedError();
		await synthOne(word, voice, isAborted, signal);
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
