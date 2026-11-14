/**
 * 发布产物的纯逻辑：校验和文本、发布说明草稿、归档清单校验。
 * 与 `release-plan.ts` 一样不得 import `node:*`，由脚本负责读写文件。
 */

export const RELEASE_MANIFEST_SCHEMA = 1;
export const RELEASE_NOTES_COMMIT_LIMIT = 60;

export type ReleaseNotesSource = "handwritten" | "custom" | "draft";

export interface ReleaseManifest {
	schema: number;
	version: string;
	/** 构建时所在的提交；发布时 HEAD 必须是它或它的直接子提交 */
	baseCommit: string;
	builtAt: string;
	notesSource: ReleaseNotesSource;
	artifact: { name: string; bytes: number; sha256: string };
}

export interface ChecksumEntry {
	sha256: string;
	name: string;
}

/** GNU `sha256sum` 格式（`<hash>␠␠<name>`），按文件名排序保证可重复。 */
export function sha256SumsText(entries: readonly ChecksumEntry[]): string {
	return (
		[...entries]
			.sort((left, right) => left.name.localeCompare(right.name))
			.map((entry) => `${entry.sha256}  ${entry.name}`)
			.join("\n") + "\n"
	);
}

/** 归档里的校验和文件必须与安装包的实际摘要逐字一致，避免上传失效的校验文件。 */
export function validateChecksumsText(
	text: string,
	entries: readonly ChecksumEntry[],
): void {
	if (text !== sha256SumsText(entries)) {
		throw new Error("SHA256SUMS.txt 与安装包摘要不一致（文件被修改或损坏）");
	}
}

export interface GitCommitEntry {
	hash: string;
	date: string;
	subject: string;
}

/** 解析 `git log --pretty=format:%h%x09%ad%x09%s --date=short` 的输出。 */
export function parseGitLog(text: string): GitCommitEntry[] {
	return String(text)
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.map((line) => {
			const [hash = "", date = "", ...rest] = line.split("\t");
			return { hash, date, subject: rest.join("\t") };
		});
}

export interface ReleaseNotesDraftInput {
	version: string;
	previousTag: string | null;
	commits: readonly GitCommitEntry[];
	limit?: number;
}

/** 从 git log 生成发布说明草稿；措辞面向用户，草稿需人工改写。 */
export function releaseNotesDraft(input: ReleaseNotesDraftInput): string {
	const { version, previousTag, commits } = input;
	const limit = input.limit ?? RELEASE_NOTES_COMMIT_LIMIT;
	const range = previousTag ? `${previousTag}..HEAD` : "HEAD";
	const lines = [
		`# 默点啥 v${version}`,
		"",
		previousTag
			? `> 草稿：由 \`git log ${range}\` 自动生成，请按用户视角改写后保存到 \`docs/release-notes/${version}.md\`。`
			: `> 草稿：本版之前没有 tag，按全部提交生成。请按用户视角改写后保存到 \`docs/release-notes/${version}.md\`。`,
		"",
		"## 变更",
		"",
	];
	if (commits.length === 0) {
		lines.push(`- 与 ${previousTag ?? "初始提交"} 相比没有新提交。`);
	} else {
		for (const commit of commits.slice(0, limit)) {
			lines.push(`- ${commit.subject}（${commit.hash}）`);
		}
		if (commits.length > limit) {
			lines.push(`- …… 另有 ${commits.length - limit} 条提交未列出`);
		}
	}
	lines.push("");
	return lines.join("\n");
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const COMMIT_PATTERN = /^[a-f0-9]{7,40}$/;

/**
 * 归档清单必须自洽，否则不允许上传：版本、提交、时间、产物摘要任何一项对不上都直接抛。
 */
export function validateManifest(
	manifest: ReleaseManifest,
	expected: { version: string; bytes: number; sha256: string },
): void {
	if (manifest?.schema !== RELEASE_MANIFEST_SCHEMA) {
		throw new Error(`归档清单 schema 非法：${String(manifest?.schema)}`);
	}
	if (manifest.version !== expected.version) {
		throw new Error(
			`归档版本 ${manifest.version} 与目标版本 ${expected.version} 不一致`,
		);
	}
	if (!COMMIT_PATTERN.test(String(manifest.baseCommit))) {
		throw new Error(`归档 baseCommit 非法：${String(manifest.baseCommit)}`);
	}
	if (!Number.isFinite(Date.parse(manifest.builtAt))) {
		throw new Error(`归档 builtAt 非法：${String(manifest.builtAt)}`);
	}
	if (!["handwritten", "custom", "draft"].includes(manifest.notesSource)) {
		throw new Error(`归档 notesSource 非法：${String(manifest.notesSource)}`);
	}
	if (manifest.artifact?.name !== `mds-${expected.version}-setup.exe`) {
		throw new Error(`归档产物名非法：${String(manifest.artifact?.name)}`);
	}
	if (manifest.artifact.bytes !== expected.bytes) {
		throw new Error(
			`归档产物大小不符：清单 ${manifest.artifact.bytes} / 实际 ${expected.bytes}`,
		);
	}
	if (
		!SHA256_PATTERN.test(String(manifest.artifact.sha256)) ||
		manifest.artifact.sha256 !== expected.sha256
	) {
		throw new Error("归档产物 sha256 与清单不符（产物被替换或损坏）");
	}
}
