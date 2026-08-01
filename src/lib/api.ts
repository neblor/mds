/**
 * 客户端 API 辅助：TTS 合成（分块进度 + 中止）、AI 释义、音频时长探测、重复播报
 */
import type { AppSettings } from "./settings";

export interface TtsItem {
	word: string;
	name: string;
	cached: boolean;
}

export const audioUrl = (name: string): string =>
	`/word-cache/${encodeURIComponent(name)}`;

/** 分块请求 TTS，逐块上报进度；支持 AbortSignal 中止。voice 为空用服务端默认 */
export async function requestTtsAll(
	words: string[],
	voice: string,
	signal: AbortSignal,
	onProgress: (done: number, total: number) => void,
): Promise<TtsItem[]> {
	if (words.length === 0) return [];
	const items: TtsItem[] = [];
	const CHUNK = 4;
	const chunks: string[][] = [];
	for (let i = 0; i < words.length; i += CHUNK) {
		chunks.push(words.slice(i, i + CHUNK));
	}
	// 顺序逐块请求（进度上报 + 中止粒度）；用递归替代 for 循环避免 await-in-loop
	const fetchChunk = async (index: number): Promise<void> => {
		if (index >= chunks.length) return;
		const chunk = chunks[index];
		const res = await fetch("/api/tts", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ words: chunk, voice }),
			signal,
		});
		if (!res.ok) {
			const text = await res.text().catch(() => "");
			throw new Error(
				text.includes("aborted")
					? "aborted"
					: `语音生成失败（${res.status}）${text.slice(0, 100)}`,
			);
		}
		// 保护：服务端异常时可能返回 HTML/空体（如 dev 热更新解析失败），避免原始 JSON.parse 报错
		const data = (await res.json().catch(() => null)) as {
			items?: TtsItem[];
		} | null;
		if (!data || !Array.isArray(data.items)) {
			throw new Error("语音服务返回了无法解析的内容，请重试");
		}
		items.push(...data.items);
		onProgress(Math.min((index + 1) * CHUNK, words.length), words.length);
		await fetchChunk(index + 1);
	};
	await fetchChunk(0);
	return items;
}

/** 一次请求获取全部单词英文释义 */
export async function requestDefinitions(
	words: string[],
	settings: AppSettings,
	signal: AbortSignal,
): Promise<Record<string, string>> {
	try {
		const res = await fetch("/api/definitions", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				words,
				baseUrl: settings.aiBaseUrl,
				apiKey: settings.aiApiKey,
				model: settings.aiModel,
			}),
			signal,
		});
		const data = (await res.json().catch(() => null)) as {
			definitions?: Record<string, string>;
			error?: string;
			message?: string;
		} | null;
		if (!data) {
			throw new Error(
				res.ok
					? "释义服务返回了无法解析的内容，请重试"
					: `释义请求失败（${res.status}）`,
			);
		}
		if (!res.ok || data.error) {
			throw new Error(
				data.message || data.error || `释义请求失败（${res.status}）`,
			);
		}
		return data.definitions ?? {};
	} catch (err) {
		if (err instanceof Error) throw err;
		throw new Error("释义请求失败");
	}
}

export interface PlayOptions {
	url: string;
	count: number;
	gapsMs: number[];
	signal: AbortSignal;
	onPlay: (i: number) => void;
	onAudioState: (playing: boolean) => void;
	/** 媒体或播放失败一发生就通知；调用方可在快速推进前淘汰损坏缓存 */
	onPlaybackFailure?: (failure: PlaybackFailure) => void;
}

/**
 * 播音流程结果分类：
 * - completed：自然播完
 * - aborted：被中止（用户跳轮/清理）
 * - media-error：音频解码/加载失败（缓存可能损坏，应失效淘汰）
 * - play-rejected：play() 被拒绝（非自动播放策略类错误；NotAllowedError 不计）
 * 无论错误与否都允许当前轮继续（不卡死整场默写）
 */
export type PlayOutcome =
	| "completed"
	| "aborted"
	| "media-error"
	| "play-rejected";
export type PlaybackFailure = Extract<
	PlayOutcome,
	"media-error" | "play-rejected"
>;

/**
 * 自然播音流程：逐遍播放，每遍结束后等待该遍的间隔（含最后一遍）
 * 完全不干涉音频播放；onPlay(i) 每遍开始、onAudioState(true/false) 标记是否正在发声
 */
export function playWithIntervals(opts: PlayOptions): Promise<PlayOutcome> {
	const {
		url,
		count,
		gapsMs,
		signal,
		onPlay,
		onAudioState,
		onPlaybackFailure,
	} = opts;
	return new Promise((resolve) => {
		const audio = new Audio();
		let stopped = false;
		let mediaError = false;
		let playRejected = false;
		let failureNotified = false;
		const notifyFailure = (failure: PlaybackFailure) => {
			if (failureNotified) return;
			failureNotified = true;
			onPlaybackFailure?.(failure);
		};
		const stop = () => {
			stopped = true;
			onAudioState(false);
			audio.pause();
			audio.removeAttribute("src");
			audio.load();
		};
		const onAbort = () => stop();
		signal.addEventListener("abort", onAbort);
		const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
		const playOnce = () =>
			new Promise<void>((res) => {
				if (stopped) return res();
				onAudioState(true);
				audio.src = url;
				audio.onended = () => {
					onAudioState(false);
					res();
				};
				audio.onerror = () => {
					// 媒体加载/解码失败：缓存文件可能损坏
					mediaError = true;
					notifyFailure("media-error");
					onAudioState(false);
					res();
				};
				void audio.play().catch((err) => {
					// NotAllowedError=自动播放策略，文件本身正常，不算媒体错误
					if (
						!(err instanceof DOMException && err.name === "NotAllowedError")
					) {
						playRejected = true;
						notifyFailure("play-rejected");
					}
					onAudioState(false);
					res();
				});
			});
		void (async () => {
			for (let i = 0; i < count && !stopped; i++) {
				onPlay(i);
				await playOnce();
				if (stopped) break;
				// 每遍后的间隔（含最后一遍，供学生作答）
				await sleep(gapsMs[i] ?? 0);
			}
			// 正常走完或中止后的统一清理（不设 stopped，保证正常完成 resolve 非 aborted）
			onAudioState(false);
			audio.pause();
			audio.removeAttribute("src");
			audio.load();
			signal.removeEventListener("abort", onAbort);
			resolve(
				stopped
					? "aborted"
					: mediaError
						? "media-error"
						: playRejected
							? "play-rejected"
							: "completed",
			);
		})();
	});
}

/** 失效单个缓存音频（服务端受文件名白名单保护）；失败不影响主流程 */
export async function invalidateCacheFile(name: string): Promise<void> {
	if (!name) return;
	try {
		await fetch("/api/cache-invalidate", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name }),
		});
	} catch {
		// 失效失败忽略（下次准备仍会重新生成判断）
	}
}
