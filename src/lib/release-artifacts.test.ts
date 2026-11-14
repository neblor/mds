import { describe, expect, it } from "vitest";
import {
	type ReleaseManifest,
	parseGitLog,
	releaseNotesDraft,
	sha256SumsText,
	validateChecksumsText,
	validateManifest,
} from "./release-artifacts";

const sha = (char: string) => char.repeat(64);

const manifest = (
	overrides: Partial<ReleaseManifest> = {},
): ReleaseManifest => ({
	schema: 1,
	version: "1.0.0",
	baseCommit: "a".repeat(40),
	builtAt: "2026-11-14T12:00:00.000Z",
	notesSource: "handwritten",
	artifact: {
		name: "mds-1.0.0-setup.exe",
		bytes: 107232342,
		sha256: sha("c"),
	},
	...overrides,
});

const expected = {
	version: "1.0.0",
	bytes: 107232342,
	sha256: sha("c"),
};

describe("sha256 sums", () => {
	it("输出 GNU 格式并按文件名排序", () => {
		expect(
			sha256SumsText([
				{ sha256: sha("b"), name: "b.exe" },
				{ sha256: sha("a"), name: "a.exe" },
			]),
		).toBe(`${sha("a")}  a.exe\n${sha("b")}  b.exe\n`);
	});

	it("单个文件也以换行结尾", () => {
		expect(sha256SumsText([{ sha256: sha("a"), name: "mds-1.0.0-setup.exe" }])).toBe(
			`${sha("a")}  mds-1.0.0-setup.exe\n`,
		);
	});

	it("归档校验和必须与实际产物一致", () => {
		const entries = [{ sha256: sha("a"), name: "mds-1.0.0-setup.exe" }];
		expect(() =>
			validateChecksumsText(sha256SumsText(entries), entries),
		).not.toThrow();
		expect(() =>
			validateChecksumsText(`${sha("b")}  mds-1.0.0-setup.exe\n`, entries),
		).toThrow("摘要不一致");
	});
});

describe("git log 解析与发布说明草稿", () => {
	it("按 tab 拆出 hash/日期/主题", () => {
		expect(
			parseGitLog(
				[
					"f102c76\t2026-11-14\tfeat: 新增混合默写模式",
					"3f1b095\t2026-11-13\tfix(queue): 重新取词改为必默前缀",
					"",
				].join("\n"),
			),
		).toEqual([
			{ hash: "f102c76", date: "2026-11-14", subject: "feat: 新增混合默写模式" },
			{
				hash: "3f1b095",
				date: "2026-11-13",
				subject: "fix(queue): 重新取词改为必默前缀",
			},
		]);
	});

	it("有上一个 tag 时标明区间", () => {
		const text = releaseNotesDraft({
			version: "1.0.1",
			previousTag: "v1.0.0",
			commits: [{ hash: "abc1234", date: "2026-11-14", subject: "fix: 修个 bug" }],
		});
		expect(text).toContain("# 默点啥 v1.0.1");
		expect(text).toContain("git log v1.0.0..HEAD");
		expect(text).toContain("docs/release-notes/1.0.1.md");
		expect(text).toContain("- fix: 修个 bug（abc1234）");
	});

	it("没有 tag 时说明按全部提交生成，并截断超长列表", () => {
		const commits = Array.from({ length: 5 }, (_, index) => ({
			hash: `h${index}`,
			date: "2026-11-14",
			subject: `commit ${index}`,
		}));
		const text = releaseNotesDraft({
			version: "1.0.0",
			previousTag: null,
			commits,
			limit: 2,
		});
		expect(text).toContain("本版之前没有 tag");
		expect(text).toContain("另有 3 条提交未列出");
		expect(text.split("\n").filter((line) => line.startsWith("- commit"))).toHaveLength(
			2,
		);
	});

	it("空提交列表也生成可读草稿", () => {
		expect(
			releaseNotesDraft({ version: "1.0.0", previousTag: "v0.9.0", commits: [] }),
		).toContain("没有新提交");
	});
});

describe("归档清单校验", () => {
	it("自洽的清单通过", () => {
		expect(() => validateManifest(manifest(), expected)).not.toThrow();
	});

	it("schema / 版本 / 提交 / 时间 / 来源不合法时拒绝", () => {
		expect(() => validateManifest(manifest({ schema: 2 }), expected)).toThrow(
			"schema",
		);
		expect(() => validateManifest(manifest({ version: "0.9.0" }), expected)).toThrow(
			"不一致",
		);
		expect(() => validateManifest(manifest({ baseCommit: "zzz" }), expected)).toThrow(
			"baseCommit",
		);
		expect(() =>
			validateManifest(manifest({ builtAt: "not-a-date" }), expected),
		).toThrow("builtAt");
		expect(() =>
			validateManifest(
				manifest({ notesSource: "auto" as ReleaseManifest["notesSource"] }),
				expected,
			),
		).toThrow("notesSource");
	});

	it("产物名 / 大小 / 摘要不符时拒绝（防止上传被替换的包）", () => {
		expect(() =>
			validateManifest(
				manifest({
					artifact: { ...manifest().artifact, name: "mds-0.9.0-setup.exe" },
				}),
				expected,
			),
		).toThrow("产物名");
		expect(() =>
			validateManifest(
				manifest({ artifact: { ...manifest().artifact, bytes: 1 } }),
				expected,
			),
		).toThrow("大小不符");
		expect(() =>
			validateManifest(
				manifest({ artifact: { ...manifest().artifact, sha256: sha("d") } }),
				expected,
			),
		).toThrow("sha256");
	});
});
