import { describe, expect, it } from "vitest";
import { sentenceRefreshMessage } from "./mode-actions";

describe("更新短句的提示文案", () => {
	it("清掉若干条时说明会重新生成", () => {
		expect(sentenceRefreshMessage(20, 20)).toBe(
			"已清掉 20 个词的短句，下次准备会重新生成",
		);
	});

	it("本来就没缓存时说明准备时会直接生成", () => {
		expect(sentenceRefreshMessage(0, 20)).toBe(
			"这些词还没有短句缓存，准备时会直接生成",
		);
	});

	it("队列为空时提示没有可更新的词", () => {
		expect(sentenceRefreshMessage(0, 0)).toBe("还没有可用的词");
	});
});
