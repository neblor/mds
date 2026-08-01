/**
 * 设置存储（localStorage）
 * AI 配置：标准 OpenAI 兼容 baseUrl + key（+ model 以便兼容各服务商）
 * 倍率调整默认 1；倒计时数字显示开关默认开
 */

export interface AppSettings {
	aiBaseUrl: string;
	aiApiKey: string;
	aiModel: string;
	multiplier: number;
	showCountdownNumber: boolean;
	/** 语音音色（edge-tts 角色） */
	voice: string;
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
];

export const DEFAULT_SETTINGS: AppSettings = {
	aiBaseUrl: "",
	aiApiKey: "",
	aiModel: "gpt-4o-mini",
	multiplier: 1,
	showCountdownNumber: true,
	voice: "en-US-AvaNeural",
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
			voice:
				typeof parsed.voice === "string" &&
				VOICES.some((v) => v.id === parsed.voice)
					? parsed.voice
					: DEFAULT_SETTINGS.voice,
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

export function isAiConfigured(s: AppSettings): boolean {
	return s.aiBaseUrl.trim().length > 0 && s.aiApiKey.trim().length > 0;
}
