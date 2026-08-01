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
}

/**
 * 自然播音流程：逐遍播放，每遍结束后等待该遍的间隔（含最后一遍）
 * 完全不干涉音频播放；onPlay(i) 每遍开始、onAudioState(true/false) 标记是否正在发声
 * resolve(true)=流程自然走完，false=被中止
 */
export function playWithIntervals(opts: PlayOptions): Promise<boolean> {
	const { url, count, gapsMs, signal, onPlay, onAudioState } = opts;
	return new Promise((resolve) => {
		const audio = new Audio();
		let stopped = false;
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
					onAudioState(false);
					res();
				};
				void audio.play().catch(() => {
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
			// 正常走完或中止后的统一清理（不设 stopped，保证正常完成 resolve(true)）
			onAudioState(false);
			audio.pause();
			audio.removeAttribute("src");
			audio.load();
			signal.removeEventListener("abort", onAbort);
			resolve(!stopped);
		})();
	});
}
