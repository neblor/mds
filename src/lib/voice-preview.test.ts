import { describe, expect, it } from "vitest";
import {
	PREVIEW_IDLE_HINT,
	PREVIEW_SENTENCES,
	pickPreviewSentence,
	previewButtonLabel,
	previewHintText,
} from "~/lib/voice-preview";

describe("试听台词", () => {
	it("台词逐字保留（崔总提供的 5 句）", () => {
		expect([...PREVIEW_SENTENCES]).toEqual([
			"May the force be with you.",
			"Everything that has a beginning, has an end.",
			"You want a piece of me, boy?",
			"Greetings, my friend. Stay awhile and listen!",
			"A woman's heart is a deep ocean of secrets.",
		]);
	});

	it("取到的句一定来自台词表", () => {
		for (let i = 0; i < 50; i++) {
			expect(PREVIEW_SENTENCES).toContain(pickPreviewSentence(null));
		}
	});

	it("不与上一句重复（连点试听换句）", () => {
		const previous = PREVIEW_SENTENCES[2];
		for (let i = 0; i < 200; i++) {
			expect(pickPreviewSentence(previous)).not.toBe(previous);
		}
	});

	it("随机源越界/NaN 时仍返回台词，不抛错", () => {
		expect(PREVIEW_SENTENCES).toContain(pickPreviewSentence(null, () => 1));
		expect(PREVIEW_SENTENCES).toContain(pickPreviewSentence(null, () => -3));
		expect(PREVIEW_SENTENCES).toContain(
			pickPreviewSentence(null, () => Number.NaN),
		);
		expect(PREVIEW_SENTENCES).toContain(pickPreviewSentence(null, () => 0));
	});

	it("确定性随机源下走过滤器后的下标（跳过上一句后依然在范围内）", () => {
		const previous = PREVIEW_SENTENCES[0];
		const picked = pickPreviewSentence(previous, () => 0);
		expect(picked).toBe(PREVIEW_SENTENCES[1]);
		expect(picked).not.toBe(previous);
	});
});

describe("试听按钮与提示行文案", () => {
	it("按阶段给按钮文案", () => {
		expect(previewButtonLabel("idle")).toBe("试听");
		expect(previewButtonLabel("error")).toBe("试听");
		expect(previewButtonLabel("synthesizing")).toBe("合成中");
		expect(previewButtonLabel("playing")).toBe("停止");
	});

	it("空闲回到缓存说明（原文案不变）", () => {
		expect(previewHintText("idle", null, "")).toBe(PREVIEW_IDLE_HINT);
		expect(PREVIEW_IDLE_HINT).toBe("不同音色缓存互不冲突");
	});

	it("合成中提示正在生成", () => {
		expect(previewHintText("synthesizing", "May the force be with you.", "")).toBe(
			"正在生成试听音频…",
		);
	});

	it("播放中显示正在念的这句原文", () => {
		const sentence = "Greetings, my friend. Stay awhile and listen!";
		expect(previewHintText("playing", sentence, "")).toBe(sentence);
	});

	it("播放中发现没有句子时退回缓存说明（不出现空白行）", () => {
		expect(previewHintText("playing", null, "")).toBe(PREVIEW_IDLE_HINT);
	});

	it("失败显示具体原因，没有原因时给兜底文案", () => {
		expect(previewHintText("error", null, "试听失败：语音服务暂时不可用")).toBe(
			"试听失败：语音服务暂时不可用",
		);
		expect(previewHintText("error", null, "")).toBe("试听失败，请再试一次");
	});
});
