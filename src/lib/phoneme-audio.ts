/**
 * 音素独立发音播放器（单例，纯 DOM 边界）
 *
 * 与单词 TTS 的关系：
 * - 播放器本身只负责「一次只播一个音素」；
 * - 与本轮单词音频的中止/恢复由 use-dictation 编排（见 plans/phonetic-mode.md §3.10）；
 * - 结果页的单词发音与音素喇叭互斥也由调用方在 play 前 stop 对方。
 *
 * 静态文件来自 public/ipa/audio/v1（由 pnpm build:phoneme-audio 生成）。
 */
import {
	PHONEME_AUDIO_BASE,
	PHONEME_AUDIO_MANIFEST_URL,
} from "./phonetic-symbols";

export type PhonemeAudioKind = "vowel" | "consonant" | "diphthong";

export interface PhonemeAudioTokenEntry {
	file: string;
	kind: PhonemeAudioKind;
	durationMs: number;
	sourceIds: string[];
	components?: string[];
}

export interface PhonemeAudioSourceEntry {
	title: string;
	author: string;
	license: string;
	page: string;
	download?: string;
}

export interface PhonemeAudioManifest {
	version: number;
	basePath: string;
	license: string;
	tokens: Record<string, PhonemeAudioTokenEntry>;
	sources: Record<string, PhonemeAudioSourceEntry>;
}

export interface PhonemeAudioPlayerOptions {
	manifest: PhonemeAudioManifest;
	/** 测试注入；生产用 new Audio() */
	audioFactory?: () => HTMLAudioElement;
	/** 覆盖 manifest.basePath */
	baseUrl?: string;
	onPlayingChange?: (key: string | null, token: string | null) => void;
	/** 音频加载/解码失败；调用方可把喇叭置灰 */
	onError?: (token: string) => void;
}

export interface PhonemeAudioPlayer {
	/** 播放成功入队返回 true；未知 token/重音符号返回 false */
	play(token: string, key?: string): boolean;
	stop(): void;
	/** 预热本轮池子里的文件（不播放） */
	preload(tokens: string[]): void;
	playingKey(): string | null;
}

const KINDS: ReadonlySet<string> = new Set([
	"vowel",
	"consonant",
	"diphthong",
]);

function joinBase(baseUrl: string): string {
	return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

export function createPhonemeAudioPlayer(
	options: PhonemeAudioPlayerOptions,
): PhonemeAudioPlayer {
	const baseUrl = joinBase(
		options.baseUrl ?? options.manifest.basePath ?? PHONEME_AUDIO_BASE,
	);
	const audio = options.audioFactory?.() ?? new Audio();
	audio.preload = "auto";
	let key: string | null = null;
	let token: string | null = null;

	const emit = () => options.onPlayingChange?.(key, token);
	const clear = () => {
		key = null;
		token = null;
		emit();
	};
	const stop = () => {
		audio.pause();
		audio.removeAttribute("src");
		audio.load();
		clear();
	};
	const handleError = () => {
		const failed = token;
		audio.onerror = null;
		stop();
		audio.onerror = handleError;
		if (failed) options.onError?.(failed);
	};
	audio.onended = () => clear();
	audio.onerror = handleError;

	const urlFor = (value: string): string | null => {
		const entry = options.manifest.tokens[value];
		if (!entry?.file) return null;
		return `${baseUrl}${entry.file}`;
	};

	return {
		play(value, playKey) {
			const url = urlFor(value);
			if (!url) return false;
			audio.pause();
			audio.src = url;
			key = playKey ?? value;
			token = value;
			emit();
			void audio.play().catch(() => {
				// 自动播放策略/加载失败：回到空闲；媒体错误由 onerror 额外通知
				if (token === value) stop();
			});
			return true;
		},
		stop,
		preload(values) {
			for (const value of new Set(values)) {
				const url = urlFor(value);
				if (!url) continue;
				const warm = options.audioFactory?.() ?? new Audio();
				warm.preload = "auto";
				warm.src = url;
			}
		},
		playingKey: () => key,
	};
}

/** 把外部 JSON 归一成 manifest；形状不对返回 null（不信任静态文件的未来版本） */
export function parsePhonemeAudioManifest(
	value: unknown,
): PhonemeAudioManifest | null {
	if (typeof value !== "object" || value === null) return null;
	const holder = value as Record<string, unknown>;
	if (holder.version !== 1) return null;
	if (typeof holder.basePath !== "string" || !holder.basePath) return null;
	if (typeof holder.license !== "string") return null;
	if (
		typeof holder.tokens !== "object" ||
		holder.tokens === null ||
		Array.isArray(holder.tokens) ||
		typeof holder.sources !== "object" ||
		holder.sources === null ||
		Array.isArray(holder.sources)
	) {
		return null;
	}

	const tokens: Record<string, PhonemeAudioTokenEntry> = {};
	for (const [token, raw] of Object.entries(
		holder.tokens as Record<string, unknown>,
	)) {
		if (typeof raw !== "object" || raw === null) return null;
		const entry = raw as Record<string, unknown>;
		if (typeof entry.file !== "string" || !entry.file) return null;
		if (typeof entry.kind !== "string" || !KINDS.has(entry.kind)) return null;
		if (
			entry.sourceIds !== undefined &&
			(!Array.isArray(entry.sourceIds) ||
				entry.sourceIds.some((id) => typeof id !== "string"))
		) {
			return null;
		}
		if (
			entry.components !== undefined &&
			(!Array.isArray(entry.components) ||
				entry.components.some((id) => typeof id !== "string"))
		) {
			return null;
		}
		tokens[token] = {
			file: entry.file,
			kind: entry.kind as PhonemeAudioKind,
			durationMs:
				typeof entry.durationMs === "number" ? entry.durationMs : 0,
			sourceIds: (entry.sourceIds as string[] | undefined) ?? [],
			...(entry.components
				? { components: entry.components as string[] }
				: {}),
		};
	}

	const sources: Record<string, PhonemeAudioSourceEntry> = {};
	for (const [id, raw] of Object.entries(
		holder.sources as Record<string, unknown>,
	)) {
		if (typeof raw !== "object" || raw === null) return null;
		const entry = raw as Record<string, unknown>;
		if (
			typeof entry.title !== "string" ||
			typeof entry.author !== "string" ||
			typeof entry.license !== "string" ||
			typeof entry.page !== "string"
		) {
			return null;
		}
		sources[id] = {
			title: entry.title,
			author: entry.author,
			license: entry.license,
			page: entry.page,
			...(typeof entry.download === "string"
				? { download: entry.download }
				: {}),
		};
	}

	return {
		version: 1,
		basePath: holder.basePath,
		license: holder.license,
		tokens,
		sources,
	};
}

let manifestPromise: Promise<PhonemeAudioManifest | null> | null = null;

/** 只在测试里重置；生产进程只加载一次 */
export function clearPhonemeAudioManifestCache(): void {
	manifestPromise = null;
}

/** 懒加载 manifest；失败返回 null 且下次允许重试 */
export function loadPhonemeAudioManifest(
	fetchImpl: typeof fetch = fetch,
	signal?: AbortSignal,
): Promise<PhonemeAudioManifest | null> {
	if (!manifestPromise) {
		manifestPromise = (async () => {
			try {
				const response = await fetchImpl(PHONEME_AUDIO_MANIFEST_URL, {
					signal,
				});
				if (!response.ok) return null;
				return parsePhonemeAudioManifest(await response.json());
			} catch {
				return null;
			}
		})().then((value) => {
			if (!value) manifestPromise = null;
			return value;
		});
	}
	return manifestPromise;
}
