import { describe, expect, it } from "vitest";
import {
	type ArchiveEntry,
	type ReleaseRemoteState,
	parseStagingName,
	planArchivePrune,
	tagVersion,
} from "./release-prune";

const entry = (version: string, bytes = 100): ArchiveEntry => ({
	tag: `v${version}`,
	version,
	bytes,
});

const states = (
	pairs: Record<string, ReleaseRemoteState>,
): Record<string, ReleaseRemoteState> => pairs;

describe("release archive prune plan", () => {
	it("保留本次发布，删除更旧且已公开的归档", () => {
		const plan = planArchivePrune({
			currentTag: "v1.1.0",
			entries: [entry("1.0.0", 10), entry("1.0.1", 20), entry("1.1.0", 30)],
			remoteStates: states({
				"v1.0.0": "public",
				"v1.0.1": "public",
				"v1.1.0": "public",
			}),
		});

		expect(plan.remove.map((item) => item.tag)).toEqual(["v1.0.1", "v1.0.0"]);
		expect(plan.freedBytes).toBe(30);
		expect(plan.keep).toEqual([
			{ entry: entry("1.1.0", 30), reason: "本次发布" },
		]);
	});

	it("远端还是草稿/缺失/未知时保留，绝不能删掉唯一续跑依据", () => {
		const plan = planArchivePrune({
			currentTag: "v1.2.0",
			entries: [entry("1.0.0"), entry("1.1.0"), entry("1.2.0")],
			remoteStates: states({
				"v1.0.0": "draft",
				"v1.1.0": "missing",
				"v1.2.0": "public",
			}),
		});

		expect(plan.remove).toEqual([]);
		expect(plan.freedBytes).toBe(0);
		expect(plan.keep.map((item) => item.entry.tag)).toEqual([
			"v1.2.0",
			"v1.1.0",
			"v1.0.0",
		]);
		expect(plan.keep[1]?.reason).toContain("找不到对应 Release");
		expect(plan.keep[2]?.reason).toContain("草稿");
	});

	it("状态表里没有的 tag 按未知处理（保守保留）", () => {
		const plan = planArchivePrune({
			currentTag: "v2.0.0",
			entries: [entry("1.9.0"), entry("2.0.0")],
			remoteStates: states({ "v2.0.0": "public" }),
		});

		expect(plan.remove).toEqual([]);
		expect(plan.keep[1]?.reason).toContain("远端状态未知");
	});

	it("比本次发布更新的归档不动，且占用保留名额", () => {
		const plan = planArchivePrune({
			currentTag: "v1.0.0",
			entries: [entry("1.0.0"), entry("1.1.0"), entry("0.9.0")],
			remoteStates: states({
				"v1.0.0": "public",
				"v1.1.0": "public",
				"v0.9.0": "public",
			}),
		});

		expect(plan.keep.map((item) => item.entry.tag)).toEqual([
			"v1.1.0",
			"v1.0.0",
		]);
		expect(plan.remove.map((item) => item.tag)).toEqual(["v0.9.0"]);
	});

	it("retention 放大后按版本从新到旧保留更多份", () => {
		const plan = planArchivePrune({
			currentTag: "v1.2.0",
			entries: [entry("1.2.0"), entry("1.1.0"), entry("1.0.0"), entry("0.9.0")],
			remoteStates: states({
				"v1.2.0": "public",
				"v1.1.0": "public",
				"v1.0.0": "public",
				"v0.9.0": "public",
			}),
			retention: 2,
		});

		expect(plan.keep.map((item) => item.entry.tag)).toEqual([
			"v1.2.0",
			"v1.1.0",
		]);
		expect(plan.remove.map((item) => item.tag)).toEqual(["v1.0.0", "v0.9.0"]);
	});

	it("版本号按数值比较，不按字符串（1.10.0 比 1.9.0 新）", () => {
		const plan = planArchivePrune({
			currentTag: "v1.10.0",
			entries: [entry("1.9.0"), entry("1.10.0")],
			remoteStates: states({ "v1.9.0": "public", "v1.10.0": "public" }),
		});

		expect(plan.remove.map((item) => item.tag)).toEqual(["v1.9.0"]);
	});

	it("没有更旧归档时什么都不删", () => {
		const plan = planArchivePrune({
			currentTag: "v1.0.0",
			entries: [entry("1.0.0")],
			remoteStates: {},
		});

		expect(plan.remove).toEqual([]);
		expect(plan.freedBytes).toBe(0);
	});
});

describe("release staging names", () => {
	it("解析合法的 .staging-<tag>-<pid>", () => {
		expect(parseStagingName(".staging-v1.0.0-12345")).toEqual({
			name: ".staging-v1.0.0-12345",
			tag: "v1.0.0",
			pid: 12345,
		});
	});

	it("异常命名一律不认（宁可留给人工）", () => {
		expect(parseStagingName(".staging-v1.0.0-not-a-pid")).toBeNull();
		expect(parseStagingName(".staging-v1.0.0-0")).toBeNull();
		expect(parseStagingName(".staging-v1.0.0")).toBeNull();
		expect(parseStagingName("v1.0.0")).toBeNull();
		expect(parseStagingName(".staging-v1-123")).toBeNull();
	});

	it("tagVersion 去掉 v 前缀", () => {
		expect(tagVersion("v3.2.1")).toBe("3.2.1");
	});
});
