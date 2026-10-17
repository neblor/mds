/**
 * v2 令牌单测：期望值来自上游修复 PR（rany2/edge-tts#492）的 Python 参考实现，
 * 在固定时间戳上跑出来后再固化到这里，等价于逐字节对拍。
 */
import { describe, expect, it } from "vitest";
import {
	SEC_MS_GEC_VERSION,
	clockSkewFromServerDate,
	generateSecMsGecV2,
	gecTicks,
} from "./edge-tts-token";

/** [Unix 秒, Python 参考实现输出] */
const REFERENCE_TOKENS: [number, string][] = [
	[
		1759400000,
		"FFCFE5272B896C4B-DCA588D9E8C8C0EC3D0F8D8253E156C7BF7C155E2596FFE8DBAB226FF706B41F",
	],
	[
		1759420800,
		"D456F6EDBA2C0D68-FFD2A60E261E0D8A20785E2C507058F93307D87A1EB33C8994E87274F439B0F9",
	],
	[
		1760700000,
		"CF13759BA0B77A18-D322BD7241343C37E258AF0ECB9BCB2B3F00FC12BCF6DF0A95AD973B0FB5D323",
	],
];

describe("generateSecMsGecV2", () => {
	it("与上游 Python 参考实现逐字节一致", () => {
		for (const [timestamp, expected] of REFERENCE_TOKENS) {
			expect(generateSecMsGecV2(timestamp)).toBe(expected);
		}
	});

	it("形如 <16 位 CS64>-<64 位 SHA-256>，全大写十六进制", () => {
		expect(generateSecMsGecV2(1760700000)).toMatch(
			/^[0-9A-F]{16}-[0-9A-F]{64}$/,
		);
	});

	it("同一 5 分钟窗口内令牌稳定，跨窗口改变", () => {
		const start = 1760700000; // 恰好是窗口起点
		expect(generateSecMsGecV2(start)).toBe(generateSecMsGecV2(start + 299.9));
		expect(generateSecMsGecV2(start)).not.toBe(
			generateSecMsGecV2(start + 300),
		);
	});

	it("版本串以 2- 开头（旧端点要求 v2 令牌与 2- 版本配对）", () => {
		expect(SEC_MS_GEC_VERSION).toMatch(/^2-\d+\.\d+\.\d+\.\d+$/);
	});
});

describe("gecTicks", () => {
	it("向下取整到 5 分钟并换算成 100ns（对上 Python 值）", () => {
		expect(gecTicks(1760700123.456)).toBe("134051736000000000");
		expect(gecTicks(1759400000)).toBe("134038734000000000");
	});

	it("时钟偏移参与计算", () => {
		expect(gecTicks(1760700000, 600)).toBe("134051742000000000");
	});
});

describe("clockSkewFromServerDate", () => {
	it("缺少或无法解析的 Date 头返回 null", () => {
		expect(clockSkewFromServerDate(null)).toBeNull();
		expect(clockSkewFromServerDate("not-a-date")).toBeNull();
	});

	it("秒级抖动忽略，明显偏差才返回修正值", () => {
		expect(
			clockSkewFromServerDate(
				new Date(1760700004_000).toUTCString(),
				1760700000,
			),
		).toBe(0);
		expect(
			clockSkewFromServerDate(
				new Date(1760700300_000).toUTCString(),
				1760700000,
			),
		).toBe(300);
	});
});
