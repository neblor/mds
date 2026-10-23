/**
 * 音素试听 hook（Solid 生命周期 + 懒加载）
 *
 * 与 `phoneme-audio.ts` 的分工：
 * - 本文件只管理「什么时候创建播放器、什么时候销毁、给 UI 哪些信号」；
 * - 音频元素与单例互斥逻辑仍由纯 DOM 边界的播放器负责，便于单测。
 *
 * 结果页与默写中各自持有一个实例：结果页的实例只服务结算/历史，
 * 不会和默写中的单词音频编排互相干扰；两者的互斥由调用方在点击时 stop 对方。
 */
import { createSignal, onCleanup } from "solid-js";
import {
	createPhonemeAudioPlayer,
	loadPhonemeAudioManifest,
	type PhonemeAudioPlayer,
} from "./phoneme-audio";
import { isStressToken } from "./phonetic-symbols";

export interface PhonemeAudioHandlers {
	/** key 为调用方传入的稳定键（chip/pool/结果行），token 为实际音素 */
	onPlayingChange?: (key: string | null, token: string | null) => void;
	onError?: (token: string) => void;
}

export interface PhonemeAudioApi {
	/** 正在播放的调用方 key（无则 null） */
	playingKey: () => string | null;
	/** 播放；重音/未知符号直接返回 false，不创建播放器 */
	play: (token: string, key?: string) => boolean;
	stop: () => void;
	/** 加载/播放失败过的音素（UI 可置灰） */
	isFailed: (token: string) => boolean;
}

export function createPhonemeAudio(
	handlers: PhonemeAudioHandlers = {},
): PhonemeAudioApi {
	const [playingKey, setPlayingKey] = createSignal<string | null>(null);
	const failed = new Set<string>();
	let player: PhonemeAudioPlayer | null = null;
	let loading: Promise<PhonemeAudioPlayer> | null = null;

	const ensure = (): Promise<PhonemeAudioPlayer> => {
		if (player) return Promise.resolve(player);
		if (!loading) {
			loading = loadPhonemeAudioManifest()
				.then((manifest) => {
					if (!manifest) throw new Error("音素音频清单不可用");
					player = createPhonemeAudioPlayer({
						manifest,
						onPlayingChange: (key, token) => {
							setPlayingKey(key);
							handlers.onPlayingChange?.(key, token);
						},
						onError: (token) => {
							failed.add(token);
							setPlayingKey(null);
							handlers.onError?.(token);
						},
					});
					return player;
				})
				.catch((error) => {
					// 失败后允许下次重试（本地静态文件一般不会失败）
					loading = null;
					throw error;
				});
		}
		return loading;
	};

	const play = (token: string, key?: string): boolean => {
		if (isStressToken(token) || !token) return false;
		void ensure()
			.then((instance) => {
				instance.play(token, key);
			})
			.catch(() => {
				// 音频清单加载失败：保持静默，不阻塞默写；结果页会显示不可用
			});
		return true;
	};

	const stop = () => {
		player?.stop();
		setPlayingKey(null);
	};

	onCleanup(() => {
		player?.stop();
	});

	return {
		playingKey,
		play,
		stop,
		isFailed: (token) => failed.has(token),
	};
}
