import { afterEach, describe, expect, it, vi } from "vitest";
import {
	clearPhonemeAudioManifestCache,
	createPhonemeAudioPlayer,
	loadPhonemeAudioManifest,
	parsePhonemeAudioManifest,
	type PhonemeAudioManifest,
} from "./phoneme-audio";

class MockAudio {
	src = "";
	preload = "";
	paused = true;
	onended: (() => void) | null = null;
	onerror: (() => void) | null = null;
	playCalls = 0;
	play() {
		this.playCalls += 1;
		this.paused = false;
		return Promise.resolve();
	}
	pause() {
		this.paused = true;
	}
	load() {}
	removeAttribute(name: string) {
		if (name === "src") this.src = "";
	}
}

const manifest: PhonemeAudioManifest = {
	version: 1,
	basePath: "/ipa/audio/v1/",
	license: "CC BY-SA 4.0",
	tokens: {
		"æ": {
			file: "ae.mp3",
			kind: "vowel",
			durationMs: 418,
			sourceIds: ["near-open-front"],
		},
		p: {
			file: "p.mp3",
			kind: "consonant",
			durationMs: 1254,
			sourceIds: ["p"],
		},
		"eɪ": {
			file: "ei.mp3",
			kind: "diphthong",
			durationMs: 653,
			sourceIds: ["close-mid-front", "near-close-near-front"],
			components: ["e", "ɪ"],
		},
	},
	sources: {
		"near-open-front": {
			title: "Near-open front unrounded vowel.ogg",
			author: "Denelson83",
			license: "CC BY-SA 3.0",
			page: "https://commons.wikimedia.org/wiki/File:Near-open_front_unrounded_vowel.ogg",
		},
		p: {
			title: "Voiceless bilabial plosive.ogg",
			author: "Peter Isotalo",
			license: "CC BY-SA 3.0",
			page: "https://commons.wikimedia.org/wiki/File:Voiceless_bilabial_plosive.ogg",
		},
		"close-mid-front": {
			title: "Close-mid front unrounded vowel.ogg",
			author: "Denelson83",
			license: "CC BY-SA 3.0",
			page: "https://commons.wikimedia.org/wiki/File:Close-mid_front_unrounded_vowel.ogg",
		},
		"near-close-near-front": {
			title: "Near-close near-front unrounded vowel.ogg",
			author: "Denelson83",
			license: "CC BY-SA 3.0",
			page: "https://commons.wikimedia.org/wiki/File:Near-close_near-front_unrounded_vowel.ogg",
		},
	},
};

function setup(overrides: Partial<Parameters<typeof createPhonemeAudioPlayer>[0]> = {}) {
	const audios: MockAudio[] = [];
	const playing: Array<[string | null, string | null]> = [];
	const errors: string[] = [];
	const player = createPhonemeAudioPlayer({
		manifest,
		audioFactory: () => {
			const audio = new MockAudio();
			audios.push(audio);
			return audio as unknown as HTMLAudioElement;
		},
		onPlayingChange: (key, token) => playing.push([key, token]),
		onError: (token) => errors.push(token),
		...overrides,
	});
	return { audios, playing, errors, player };
}

afterEach(() => {
	clearPhonemeAudioManifestCache();
	vi.restoreAllMocks();
});

describe("createPhonemeAudioPlayer", () => {
	it("播放/切换/结束：单例 Audio，状态回调正确", () => {
		const { audios, playing, player } = setup();
		expect(player.play("æ", "pick-1")).toBe(true);
		expect(audios[0].src).toBe("/ipa/audio/v1/ae.mp3");
		expect(audios[0].preload).toBe("auto");
		expect(player.playingKey()).toBe("pick-1");
		expect(playing.at(-1)).toEqual(["pick-1", "æ"]);

		// 换一个 token：仍然用同一个 Audio
		expect(player.play("p")).toBe(true);
		expect(player.playingKey()).toBe("p");
		expect(audios[0].src).toBe("/ipa/audio/v1/p.mp3");
		expect(playing.at(-1)).toEqual(["p", "p"]);

		audios[0].onended?.();
		expect(player.playingKey()).toBeNull();
		expect(playing.at(-1)).toEqual([null, null]);
	});

	it("stop 清空状态；重音/未知 token 返回 false 且不播放", () => {
		const { audios, playing, player } = setup();
		player.play("æ", "k");
		player.stop();
		expect(player.playingKey()).toBeNull();
		expect(audios[0].paused).toBe(true);
		expect(audios[0].src).toBe("");
		expect(playing.at(-1)).toEqual([null, null]);

		expect(player.play("ˈ")).toBe(false);
		expect(player.play("unknown")).toBe(false);
		expect(player.playingKey()).toBeNull();
	});

	it("媒体错误：回到空闲并通知 onError", () => {
		const { audios, errors, playing, player } = setup();
		player.play("æ", "k");
		audios[0].onerror?.();
		expect(player.playingKey()).toBeNull();
		expect(errors).toEqual(["æ"]);
		expect(playing.at(-1)).toEqual([null, null]);
	});

	it("preload 只预热可播放的 token 且不改变播放状态", () => {
		const { audios, player } = setup();
		player.preload(["æ", "p", "ˈ", "æ"]);
		expect(audios).toHaveLength(3); // 1 个播放器 + 2 个预热
		expect(audios[1].src).toBe("/ipa/audio/v1/ae.mp3");
		expect(audios[2].src).toBe("/ipa/audio/v1/p.mp3");
		expect(audios[1].preload).toBe("auto");
		expect(player.playingKey()).toBeNull();
	});

	it("baseUrl 覆盖 manifest.basePath", () => {
		const { audios, player } = setup({ baseUrl: "/ipa/audio/custom" });
		player.play("æ");
		expect(audios[0].src).toBe("/ipa/audio/custom/ae.mp3");
	});
});

describe("parsePhonemeAudioManifest", () => {
	it("接受合法 manifest", () => {
		const parsed = parsePhonemeAudioManifest(manifest);
		expect(parsed?.tokens["æ"].file).toBe("ae.mp3");
		expect(parsed?.tokens["eɪ"].components).toEqual(["e", "ɪ"]);
		expect(parsed?.sources.p.author).toBe("Peter Isotalo");
	});

	it("拒绝非法形状", () => {
		expect(parsePhonemeAudioManifest(null)).toBeNull();
		expect(parsePhonemeAudioManifest({ ...manifest, version: 2 })).toBeNull();
		expect(
			parsePhonemeAudioManifest({ ...manifest, basePath: "" }),
		).toBeNull();
		expect(
			parsePhonemeAudioManifest({
				...manifest,
				tokens: { "æ": { file: "", kind: "vowel" } },
			}),
		).toBeNull();
		expect(
			parsePhonemeAudioManifest({
				...manifest,
				tokens: { "æ": { file: "ae.mp3", kind: "weird" } },
			}),
		).toBeNull();
	});
});

describe("loadPhonemeAudioManifest", () => {
	it("缓存成功结果（只 fetch 一次）", async () => {
		const fetchMock = vi.fn(async () => ({
			ok: true,
			json: async () => manifest,
		})) as unknown as typeof fetch;
		const first = await loadPhonemeAudioManifest(fetchMock);
		const second = await loadPhonemeAudioManifest(fetchMock);
		expect(first?.version).toBe(1);
		expect(second?.tokens["æ"].file).toBe("ae.mp3");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("失败返回 null，且允许下次重试", async () => {
		const bad = vi.fn(async () => ({
			ok: true,
			json: async () => ({ ...manifest, version: 2 }),
		})) as unknown as typeof fetch;
		expect(await loadPhonemeAudioManifest(bad)).toBeNull();

		const good = vi.fn(async () => ({
			ok: true,
			json: async () => manifest,
		})) as unknown as typeof fetch;
		expect(await loadPhonemeAudioManifest(good)).not.toBeNull();
		expect(bad).toHaveBeenCalledTimes(1);
		expect(good).toHaveBeenCalledTimes(1);
	});

	it("网络/非 200 返回 null", async () => {
		const failed = vi.fn(async () => {
			throw new Error("network");
		}) as unknown as typeof fetch;
		expect(await loadPhonemeAudioManifest(failed)).toBeNull();

		const notOk = vi.fn(async () => ({
			ok: false,
			json: async () => manifest,
		})) as unknown as typeof fetch;
		expect(await loadPhonemeAudioManifest(notOk)).toBeNull();
	});
});
