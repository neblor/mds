/**
 * 结果发音试听播放器（结算页与历史回看共用）
 *
 * - 同一时间只播一个：play 前先 stop 旧任务；迟到回调按 controller 身份失效
 * - 播放失败淘汰对应音频缓存，避免坏文件被持续命中
 * - canPlay 由调用方注入（结算页限定 results 阶段，历史弹窗随弹窗生命周期）
 */
import { createSignal, onCleanup } from "solid-js";
import { audioUrl, invalidateCacheFile, playWithIntervals } from "./api";

export interface ResultAudioPlayer {
	/** 正在试听的音频名（无则 null），供按钮做播放中视觉反馈 */
	playingName: () => string | null;
	play: (audioName: string) => void;
	stop: () => void;
}

export function createResultAudioPlayer(
	canPlay: () => boolean = () => true,
): ResultAudioPlayer {
	const [playingName, setPlayingName] = createSignal<string | null>(null);
	let current: AbortController | null = null;

	const stop = () => {
		current?.abort();
		current = null;
		setPlayingName(null);
	};
	onCleanup(stop);

	const play = (audioName: string) => {
		if (!canPlay() || !audioName) return;
		stop();
		const controller = new AbortController();
		current = controller;
		void playWithIntervals({
			url: audioUrl(audioName),
			count: 1,
			gapsMs: [0],
			signal: controller.signal,
			onPlay: () => {},
			onAudioState: (playing) => {
				if (current !== controller) return;
				setPlayingName(playing ? audioName : null);
			},
			onPlaybackFailure: () => {
				if (current !== controller) return;
				void invalidateCacheFile(audioName);
			},
		}).then(() => {
			if (current !== controller) return;
			current = null;
			setPlayingName(null);
		});
	};

	return { playingName, play, stop };
}
