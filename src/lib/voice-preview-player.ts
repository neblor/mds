/**
 * 设置面板音色试听的状态编排（生产实现，可注入 driver 单测）
 *
 * - 合成/播放都归同一个 AbortController；停止、换音色、卸载都会中止当前任务
 * - 迟到回调按 controller 身份失效，不会污染新任务状态
 * - 媒体失败淘汰对应缓存，失败不写负缓存，下一次试听仍会重新合成
 */
import { createSignal, onCleanup } from "solid-js";
import {
	audioUrl,
	invalidateCacheFile,
	playWithIntervals,
	requestTtsAll,
	type PlayOutcome,
} from "./api";
import {
	pickPreviewSentence,
	type PreviewPhase,
} from "./voice-preview";

/** 只把网络与媒体边界抽象出来；状态切换仍是这里被测试的生产代码 */
export interface VoicePreviewDriver {
	synthesize: (
		sentence: string,
		voice: string,
		signal: AbortSignal,
	) => Promise<string>;
	play: (name: string, signal: AbortSignal) => Promise<PlayOutcome>;
	invalidate: (name: string) => void;
}

const productionDriver: VoicePreviewDriver = {
	async synthesize(sentence, voice, signal) {
		const items = await requestTtsAll([sentence], voice, signal, () => {});
		return items[0]?.name ?? "";
	},
	play(name, signal) {
		return playWithIntervals({
			items: [{ url: audioUrl(name) }],
			gapsMs: [0],
			signal,
			onPlay: () => {},
			onAudioState: () => {},
		});
	},
	invalidate(name) {
		void invalidateCacheFile(name);
	},
};

export interface VoicePreviewPlayer {
	phase: () => PreviewPhase;
	sentence: () => string | null;
	error: () => string;
	toggle: () => void;
	/** 设置面板切换音色时调用；只停止，不自动开播 */
	voiceChanged: (nextVoice: string) => void;
	stop: () => void;
}

/**
 * 创建试听播放器。`voice` 是设置里的当前音色访问器；切换时由调用方显式调用
 * `voiceChanged`，只停止、不自动用新音色开播，避免连续切换时连珠炮。
 */
export function createVoicePreviewPlayer(
	voice: () => string,
	driver: VoicePreviewDriver = productionDriver,
	pickSentence: (previous: string | null) => string = pickPreviewSentence,
): VoicePreviewPlayer {
	const [phase, setPhase] = createSignal<PreviewPhase>("idle");
	const [sentence, setSentence] = createSignal<string | null>(null);
	const [error, setError] = createSignal("");
	let current: AbortController | null = null;
	let lastSentence: string | null = null;
	let lastVoice = voice();

	const stop = () => {
		const controller = current;
		current = null;
		controller?.abort();
		setPhase("idle");
		setSentence(null);
		setError("");
	};

	const run = async (text: string, selectedVoice: string) => {
		const controller = new AbortController();
		current = controller;
		setError("");
		setSentence(text);
		setPhase("synthesizing");
		try {
			const name = await driver.synthesize(
				text,
				selectedVoice,
				controller.signal,
			);
			if (current !== controller || controller.signal.aborted) return;
			if (!name) throw new Error("试听服务没有返回音频");
			setPhase("playing");
			const outcome = await driver.play(name, controller.signal);
			// 失败文件即使用过/停止后才迟到返回，也不能让它继续命中缓存
			if (outcome === "media-error" || outcome === "play-rejected") {
				driver.invalidate(name);
			}
			if (current !== controller) return;
			current = null;
			if (outcome === "completed") {
				setPhase("idle");
				setSentence(null);
			} else if (outcome !== "aborted") {
				setPhase("error");
				setError(
					outcome === "media-error"
						? "试听音频无法播放，已清理缓存，请再试一次"
						: "浏览器阻止了音频播放，请再点一次",
				);
			}
		} catch {
			if (current !== controller) return;
			current = null;
			if (controller.signal.aborted) return;
			setPhase("error");
			setError("试听失败：语音服务暂时不可用，请再试一次");
		}
	};

	const toggle = () => {
		if (phase() === "playing") {
			stop();
			return;
		}
		if (phase() === "synthesizing") return;
		const text = pickSentence(lastSentence);
		lastSentence = text;
		void run(text, voice());
	};

	const voiceChanged = (nextVoice: string) => {
		if (lastVoice === nextVoice) return;
		lastVoice = nextVoice;
		stop();
	};

	onCleanup(stop);

	return { phase, sentence, error, toggle, voiceChanged, stop };
}
