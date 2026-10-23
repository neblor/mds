/**
 * settings.ts 单元测试：配置读写、异常回退、边界校验
 * 重点：配置损坏/缺字段/无效值时都必须安全回退默认，不抛错
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	loadSettings,
	phoneticVoice,
	PHONETIC_DEFAULT_VOICE,
	saveSettings,
	clampMultiplier,
	isAiConfigured,
	DEFAULT_SETTINGS,
	type AppSettings,
} from "./settings";

const KEY = "mds.settings.v1";

function mockStorage(): {
	getItem: ReturnType<typeof vi.fn>;
	setItem: ReturnType<typeof vi.fn>;
} {
	const store = new Map<string, string>();
	const getItem = vi.fn((k: string) => store.get(k) ?? null);
	const setItem = vi.fn((k: string, v: string) => void store.set(k, v));
	vi.stubGlobal("localStorage", {
		getItem,
		setItem,
		removeItem: () => {},
		clear: () => {},
	});
	return { getItem, setItem };
}

describe("loadSettings", () => {
	beforeEach(() => {
		vi.stubGlobal("localStorage", undefined);
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("无 localStorage（SSR）返回默认", () => {
		expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
	});

	it("无存储内容返回默认", () => {
		mockStorage();
		expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
	});

	it("自定义清单地址：缺省为空串，非字符串回退，首尾空白去掉", () => {
		mockStorage();
		expect(loadSettings().bankManifestUrl).toBe("");

		const { setItem } = mockStorage();
		saveSettings({ ...DEFAULT_SETTINGS, bankManifestUrl: " https://example.test/m.json " });
		expect(setItem).toHaveBeenCalled();
		const stored = JSON.parse(
			String((setItem.mock.calls.at(-1)?.[1] as string) ?? "{}"),
		) as AppSettings;
		expect(stored.bankManifestUrl).toBe(" https://example.test/m.json ");

		mockStorage();
		localStorage.setItem(KEY, JSON.stringify({ bankManifestUrl: 42 }));
		expect(loadSettings().bankManifestUrl).toBe("");
	});

	it("JSON 损坏回退默认不抛错", () => {
		mockStorage().getItem.mockReturnValue("{broken json!!");
		expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
	});

	it("部分字段合并默认值", () => {
		mockStorage().getItem.mockReturnValue(
			JSON.stringify({ aiModel: "my-model" }),
		);
		const s = loadSettings();
		expect(s.aiModel).toBe("my-model");
		expect(s.aiBaseUrl).toBe("");
		expect(s.multiplier).toBe(1);
		expect(s.voice).toBe(DEFAULT_SETTINGS.voice);
	});

	it("multiplier 越界被 clamp 到 [0.3, 3]", () => {
		mockStorage().getItem.mockReturnValue(
			JSON.stringify({ multiplier: 99, voice: "en-US-AvaNeural" }),
		);
		expect(loadSettings().multiplier).toBe(3);
		mockStorage().getItem.mockReturnValue(
			JSON.stringify({ multiplier: 0.01, voice: "en-US-AvaNeural" }),
		);
		expect(loadSettings().multiplier).toBe(0.3);
	});

	it("multiplier 非数字回退 1", () => {
		mockStorage().getItem.mockReturnValue(
			JSON.stringify({ multiplier: "abc", voice: "en-US-AvaNeural" }),
		);
		expect(loadSettings().multiplier).toBe(1);
	});

	it("无效 voice 回退默认音色", () => {
		mockStorage().getItem.mockReturnValue(
			JSON.stringify({ voice: "en-US-NoSuchVoice" }),
		);
		expect(loadSettings().voice).toBe(DEFAULT_SETTINGS.voice);
	});

	it("有效 voice 保留", () => {
		mockStorage().getItem.mockReturnValue(
			JSON.stringify({ voice: "en-US-ChristopherNeural" }),
		);
		expect(loadSettings().voice).toBe("en-US-ChristopherNeural");
	});

	it("生成级别：缺省/非法回落初中，合法值保留", () => {
		mockStorage().getItem.mockReturnValue(JSON.stringify({ aiModel: "my-model" }));
		expect(DEFAULT_SETTINGS.contentLevel).toBe("junior");
		expect(loadSettings().contentLevel).toBe("junior");

		mockStorage().getItem.mockReturnValue(
			JSON.stringify({ contentLevel: "college" }),
		);
		expect(loadSettings().contentLevel).toBe("college");

		mockStorage().getItem.mockReturnValue(
			JSON.stringify({ contentLevel: "大学" }),
		);
		expect(loadSettings().contentLevel).toBe("junior");
	});
});

describe("saveSettings", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("写入完整 JSON", () => {
		const { setItem } = mockStorage();
		const s: AppSettings = { ...DEFAULT_SETTINGS, aiModel: "x" };
		saveSettings(s);
		expect(setItem).toHaveBeenCalledWith(
			KEY,
			JSON.stringify({ ...DEFAULT_SETTINGS, aiModel: "x" }),
		);
	});

	it("localStorage 抛错时静默", () => {
		vi.stubGlobal("localStorage", {
			setItem: () => {
				throw new Error("quota");
			},
		});
		expect(() => saveSettings({ ...DEFAULT_SETTINGS })).not.toThrow();
	});
});

describe("clampMultiplier", () => {
	it("边界值", () => {
		expect(clampMultiplier(0.3)).toBe(0.3);
		expect(clampMultiplier(3)).toBe(3);
		expect(clampMultiplier(0.29)).toBe(0.3);
		expect(clampMultiplier(3.01)).toBe(3);
		expect(clampMultiplier(1)).toBe(1);
	});
});

describe("isAiConfigured", () => {
	it("两端都填才为 true", () => {
		expect(
			isAiConfigured({
				...DEFAULT_SETTINGS,
				aiBaseUrl: "http://x",
				aiApiKey: "k",
			}),
		).toBe(true);
		expect(
			isAiConfigured({
				...DEFAULT_SETTINGS,
				aiBaseUrl: "http://x",
				aiApiKey: "",
			}),
		).toBe(false);
		expect(
			isAiConfigured({ ...DEFAULT_SETTINGS, aiBaseUrl: "", aiApiKey: "k" }),
		).toBe(false);
		expect(
			isAiConfigured({ ...DEFAULT_SETTINGS, aiBaseUrl: "  ", aiApiKey: "  " }),
		).toBe(false);
	});
});

describe("phoneticVoice", () => {
	it("已是 en-GB 时尊重用户选择，否则用英式默认", () => {
		expect(phoneticVoice("en-GB-RyanNeural")).toBe("en-GB-RyanNeural");
		expect(phoneticVoice("en-US-AvaNeural")).toBe(PHONETIC_DEFAULT_VOICE);
		expect(phoneticVoice("")).toBe(PHONETIC_DEFAULT_VOICE);
	});
});
