/**
 * 设置存储（localStorage）
 * AI 配置：标准 OpenAI 兼容 baseUrl + key（+ model 以便兼容各服务商）
 * 倍率调整默认 1；倒计时数字显示开关默认开；生成级别默认初中
 */
import {
	DEFAULT_CONTENT_LEVEL,
	parseContentLevel,
	type ContentLevel,
} from "./content-level";

export interface AppSettings {
	aiBaseUrl: string;
	aiApiKey: string;
	aiModel: string;
	multiplier: number;
	showCountdownNumber: boolean;
	/** 语音音色（edge-tts 角色） */
	voice: string;
	/** 复习期望保持率（FSRS，0.7–0.97，默认 0.9；越高复习越频繁） */
	requestRetention: number;
	/** 自定义词库清单地址（留空只用随包内置清单）；在「选择词表 → 检查清单更新」里编辑 */
	bankManifestUrl: string;
	/** AI 生成内容的难度级别（小学/初中/高中/大学；默认初中） */
	contentLevel: ContentLevel;
}

/** 可选音色（edge-tts 标准 voice 参数，如命令行 `--voice en-US-AvaNeural`） */
export const VOICES: { id: string; label: string }[] = [
	{ id: "en-US-AvaNeural", label: "Ava（女声，清晰自然）" },
	{ id: "en-US-JennyNeural", label: "Jenny（女声，温暖）" },
	{ id: "en-US-EmmaNeural", label: "Emma（女声，柔和）" },
	{ id: "en-US-BrianNeural", label: "Brian（男声，沉稳）" },
	{ id: "en-US-AndrewNeural", label: "Andrew（男声，年轻）" },
	{ id: "en-US-AriaNeural", label: "Aria（女声，活泼）" },
	{ id: "en-US-GuyNeural", label: "Guy（男声，阳光）" },
	{ id: "en-US-ChristopherNeural", label: "Christopher（男声，浑厚）" },
	{ id: "en-US-MichelleNeural", label: "Michelle（女声，亲切）" },
	// 音标模式是英式音标：优先 en-GB；这里也允许用户主动全局切英式
	{ id: "en-GB-SoniaNeural", label: "Sonia（女声，英式）" },
	{ id: "en-GB-RyanNeural", label: "Ryan（男声，英式）" },
	{ id: "en-GB-LibbyNeural", label: "Libby（女声，英式）" },
];

/** 音标轮的默认英式音色；音标数据是 RP，用美式音色会与答案不一致 */
export const PHONETIC_DEFAULT_VOICE = "en-GB-SoniaNeural";

/**
 * 音标模式选音色：用户当前本来就是 en-GB 就尊重；否则固定用英式默认。
 * 其它模式完全不动用户的选择。
 */
export function phoneticVoice(voice: string): string {
	return voice.startsWith("en-GB-") ? voice : PHONETIC_DEFAULT_VOICE;
}

export const DEFAULT_SETTINGS: AppSettings = {
	aiBaseUrl: "",
	aiApiKey: "",
	aiModel: "gpt-4o-mini",
	multiplier: 1,
	showCountdownNumber: true,
	voice: "en-US-AvaNeural",
	requestRetention: 0.9,
	bankManifestUrl: "",
	contentLevel: DEFAULT_CONTENT_LEVEL,
};

const KEY = "mds.settings.v1";

export function loadSettings(): AppSettings {
	if (typeof localStorage === "undefined") return { ...DEFAULT_SETTINGS };
	try {
		const raw = localStorage.getItem(KEY);
		if (!raw) return { ...DEFAULT_SETTINGS };
		const parsed = JSON.parse(raw) as Partial<AppSettings>;
		return {
			...DEFAULT_SETTINGS,
			...parsed,
			multiplier:
				typeof parsed.multiplier === "number"
					? clampMultiplier(parsed.multiplier)
					: 1,
			requestRetention: clampRequestRetentionSetting(parsed.requestRetention),
			bankManifestUrl:
				typeof parsed.bankManifestUrl === "string"
					? parsed.bankManifestUrl.trim()
					: "",
			voice:
				typeof parsed.voice === "string" &&
				VOICES.some((v) => v.id === parsed.voice)
					? parsed.voice
					: DEFAULT_SETTINGS.voice,
			// 旧版本存下的设置没有 contentLevel；未知/非法值一律回落初中
			contentLevel: parseContentLevel(parsed.contentLevel),
		};
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
}

export function saveSettings(s: AppSettings): void {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(KEY, JSON.stringify(s));
	} catch {
		// 存储失败静默（如隐私模式）
	}
}

export function clampMultiplier(v: number): number {
	return Math.min(3, Math.max(0.3, Math.round(v * 10) / 10));
}

/** 期望保持率：与 srs.ts 的口径保持一致（0.7–0.97，非法回落 0.9） */
export function clampRequestRetentionSetting(v: unknown): number {
	const num = typeof v === "number" ? v : Number.NaN;
	if (!Number.isFinite(num)) return 0.9;
	const rounded = Math.round(num * 100) / 100;
	return Math.min(0.97, Math.max(0.7, rounded));
}

export function isAiConfigured(s: AppSettings): boolean {
	return s.aiBaseUrl.trim().length > 0 && s.aiApiKey.trim().length > 0;
}
