/**
 * 客户端 API 辅助：TTS 合成（分块进度 + 中止）、AI 释义、音频时长探测、重复播报
 */
import type { AppSettings } from "./settings";
import type { ClozeCandidate } from "./cloze-provider";
import type { ClozeItem } from "./cloze-parse";

export interface TtsItem {
	word: string;
	name: string;
	cached: boolean;
}

export const audioUrl = (name: string): string =>
	`/api/audio?name=${encodeURIComponent(name)}`;

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
				contentLevel: settings.contentLevel,
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

/** 一次请求获取全部单词的常用中文对应词 */
export async function requestChineseWords(
	words: string[],
	settings: AppSettings,
	signal: AbortSignal,
): Promise<Record<string, string>> {
	try {
		const res = await fetch("/api/chinese-words", {
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
			words?: Record<string, string>;
			error?: string;
			message?: string;
		} | null;
		if (!data) {
			throw new Error(
				res.ok
					? "中文词服务返回了无法解析的内容，请重试"
					: `中文词请求失败（${res.status}）`,
			);
		}
		if (!res.ok || data.error) {
			throw new Error(
				data.message || data.error || `中文词请求失败（${res.status}）`,
			);
		}
		return data.words ?? {};
	} catch (err) {
		if (err instanceof Error) throw err;
		throw new Error("中文词请求失败");
	}
}

/**
 * 一次请求生成全部短句（sentence 模式）。
 * 返回 `missing` 表示这些词没拿到合格短句（超长/缺词），调用方把它们降级为单词轮，
 * 而不是中止整场；只有网络/配置级失败才抛错。
 */
export async function requestSentences(
	words: string[],
	settings: AppSettings,
	signal: AbortSignal,
): Promise<{ sentences: Record<string, string>; missing: string[] }> {
	try {
		const res = await fetch("/api/sentences", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				words,
				baseUrl: settings.aiBaseUrl,
				apiKey: settings.aiApiKey,
				model: settings.aiModel,
				contentLevel: settings.contentLevel,
			}),
			signal,
		});
		const data = (await res.json().catch(() => null)) as {
			sentences?: Record<string, string>;
			missing?: string[];
			error?: string;
			message?: string;
		} | null;
		if (!data) {
			throw new Error(
				res.ok
					? "短句服务返回了无法解析的内容，请重试"
					: `短句请求失败（${res.status}）`,
			);
		}
		if (!res.ok || data.error) {
			throw new Error(
				data.message || data.error || `短句请求失败（${res.status}）`,
			);
		}
		const sentences =
			data.sentences && typeof data.sentences === "object" ? data.sentences : {};
		const missing = Array.isArray(data.missing)
			? data.missing.filter((word): word is string => typeof word === "string")
			: [];
		return { sentences, missing };
	} catch (err) {
		if (err instanceof Error) throw err;
		throw new Error("短句请求失败");
	}
}

/**
 * 失效默写队列中这些词的短句缓存（主界面「更新短句」）：下次准备会重新生成短句。
 * 返回真正清掉的条数；失败抛错（由调用方展示）。
 */
export async function refreshSentences(words: string[]): Promise<number> {
	if (words.length === 0) return 0;
	const res = await fetch("/api/sentence-cache", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ words }),
	});
	const data = (await res.json().catch(() => null)) as {
		removed?: number;
		message?: string;
	} | null;
	if (!res.ok) {
		throw new Error(data?.message || `清短句缓存失败（${res.status}）`);
	}
	return typeof data?.removed === "number" ? data.removed : 0;
}

/** 一次请求生成本场全部组句题（失败即抛错，调用方按「AI 当前不可用」结束本场） */
export async function requestClozeQuestions(
	candidates: ClozeCandidate[],
	settings: AppSettings,
	signal: AbortSignal,
): Promise<ClozeItem[]> {
	try {
		const res = await fetch("/api/cloze", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				candidates,
				baseUrl: settings.aiBaseUrl,
				apiKey: settings.aiApiKey,
				model: settings.aiModel,
				contentLevel: settings.contentLevel,
			}),
			signal,
		});
		const data = (await res.json().catch(() => null)) as {
			items?: ClozeItem[];
			error?: string;
			message?: string;
		} | null;
		if (!data) {
			throw new Error(
				res.ok
					? "组句服务返回了无法解析的内容，请重试"
					: `组句请求失败（${res.status}）`,
			);
		}
		if (!res.ok || data.error) {
			throw new Error(
				data.message || data.error || `组句请求失败（${res.status}）`,
			);
		}
		if (!Array.isArray(data.items) || data.items.length === 0) {
			throw new Error("AI 没有返回任何题目");
		}
		return data.items;
	} catch (err) {
		if (err instanceof Error) throw err;
		throw new Error("组句请求失败");
	}
}

export type { GradeKind } from "./definition-provider";
import type { GradeKind } from "./definition-provider";

export interface GradeItem {
	word: string;
	expected: string;
	answer: string;
}

export interface GradeResult {
	word: string;
	correct: boolean;
	note?: string;
}

export interface GradeResponse {
	grades: GradeResult[];
	missing?: string[];
	warning?: string;
}

/** 一次请求批改全部作答（中文词/英文释义按 kind 选择判定口径） */
export async function requestAnswerGrades(
	kind: GradeKind,
	items: GradeItem[],
	settings: AppSettings,
	signal: AbortSignal,
): Promise<GradeResponse> {
	try {
		const res = await fetch("/api/answer-grade", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				kind,
				items,
				baseUrl: settings.aiBaseUrl,
				apiKey: settings.aiApiKey,
				model: settings.aiModel,
			}),
			signal,
		});
		const data = (await res.json().catch(() => null)) as {
			grades?: GradeResult[];
			missing?: string[];
			warning?: string;
			error?: string;
			message?: string;
		} | null;
		if (!data) {
			throw new Error(
				res.ok
					? "批改服务返回了无法解析的内容，请重试"
					: `批改请求失败（${res.status}）`,
			);
		}
		if (!res.ok || data.error) {
			throw new Error(
				data.message || data.error || `批改请求失败（${res.status}）`,
			);
		}
		return {
			grades: Array.isArray(data.grades) ? data.grades : [],
			...(typeof data.missing === "undefined" ? {} : { missing: data.missing }),
			...(typeof data.warning === "undefined" ? {} : { warning: data.warning }),
		};
	} catch (err) {
		if (err instanceof Error) throw err;
		throw new Error("批改请求失败");
	}
}

/** 播放序列里的一项：一个音频文件 + 状态行上显示的名字 */
export interface PlayItem {
	url: string;
	/** 状态行标签，如「单词」「整句 1」；缺省时按序号显示 */
	label?: string;
}

export interface PlayOptions {
	/**
	 * 播放序列。单词轮 = 同一音频重复 N 遍；短句轮 = 目标词 1 遍 + 整句 2 遍。
	 * 数组长度即总遍数，`gapsMs[i]` 是第 i 项播完后的间隔。
	 */
	items: PlayItem[];
	gapsMs: number[];
	signal: AbortSignal;
	onPlay: (i: number) => void;
	onAudioState: (playing: boolean) => void;
	/** 媒体或播放失败一发生就通知；调用方可在快速推进前淘汰损坏缓存 */
	onPlaybackFailure?: (failure: PlaybackFailure, failedUrl?: string) => void;
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
 * 自然播音流程：按序列逐项播放，每项结束后等待该项的间隔（含最后一项）
 * 完全不干涉音频播放；onPlay(i) 每项开始、onAudioState(true/false) 标记是否正在发声
 * 序列里可以是不同音频（短句轮：目标词 + 整句 ×2），失败时回调会带上出错的 URL
 */
export function playWithIntervals(opts: PlayOptions): Promise<PlayOutcome> {
	const { items, gapsMs, signal, onPlay, onAudioState, onPlaybackFailure } = opts;
	return new Promise((resolve) => {
		const audio = new Audio();
		let stopped = false;
		let mediaError = false;
		let playRejected = false;
		let failureNotified = false;
		// 当前正在播的那一项：失败时要把「是哪一条音频坏了」交给调用方去淘汰缓存
		let currentUrl = "";
		const notifyFailure = (failure: PlaybackFailure) => {
			if (failureNotified) return;
			failureNotified = true;
			onPlaybackFailure?.(failure, currentUrl || undefined);
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
		const playOnce = (item: PlayItem) =>
			new Promise<void>((res) => {
				if (stopped) return res();
				currentUrl = item.url;
				onAudioState(true);
				audio.src = item.url;
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
			for (let i = 0; i < items.length && !stopped; i++) {
				const item = items[i];
				if (!item) continue;
				onPlay(i);
				await playOnce(item);
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
