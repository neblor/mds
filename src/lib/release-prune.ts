/**
 * 发版收尾的本机产物清理（纯逻辑）：哪些归档该删、哪些必须留。
 *
 * 背景：归档从 `dist/electron` 搬到 `release-out/v<版本>/` 之后，`client-package` 的
 * 「输出目录只留本次产物」扫不到它了，旧版本会无限累积（每版约 100 MB）。这里的判定把
 * 那条保证补回到归档层：**发版成功后本机只保留最近 N 个归档**（N 默认 1）。
 *
 * 安全边界（宁可留也不误删）：
 * 1. 本次发布的归档永远保留；
 * 2. 版本号比本次更新的一律保留；
 * 3. 更旧的归档只有在 GitHub Release **已公开**且资产核对通过（发布流程走完）后才删 ——
 *    否则它是 `pnpm release:publish <tag> --execute` 的唯一续跑依据，删掉就得重新构建；
 * 4. 远端状态未知（gh 不可用 / 网络失败）时按「未公开」处理。
 *
 * 本模块**不得 import `node:*`**（与 `release-plan.ts`、`release-artifacts.ts` 同一约定）。
 */
import { compareVersions } from "./client-package-version.ts";

/** 本机保留的归档份数（含本次发布）。改大即可多留几版。 */
export const RELEASE_ARCHIVE_RETENTION = 1;

/** 远端 Release 的三种可判定状态 + 查询失败。 */
export type ReleaseRemoteState = "public" | "draft" | "missing" | "unknown";

export interface ArchiveEntry {
	/** 归档目录名，即 tag：`v1.2.3` */
	tag: string;
	/** 清单里的版本：`1.2.3` */
	version: string;
	/** 归档目录字节数，仅用于汇报释放量 */
	bytes: number;
}

export interface ArchiveKeepItem {
	entry: ArchiveEntry;
	reason: string;
}

export interface ArchivePrunePlan {
	keep: ArchiveKeepItem[];
	remove: ArchiveEntry[];
	/** 预计释放字节数（删除项之和） */
	freedBytes: number;
}

/** 归档相对本次发布的三种位置关系。 */
function versionRelation(
	entry: ArchiveEntry,
	currentTag: string,
	currentVersion: string,
): "current" | "newer" | "older" {
	if (entry.tag === currentTag) return "current";
	return compareVersions(entry.version, currentVersion) > 0 ? "newer" : "older";
}

function remoteStateText(state: ReleaseRemoteState): string {
	switch (state) {
		case "draft":
			return "GitHub Release 还是草稿";
		case "missing":
			return "GitHub 上找不到对应 Release";
		case "unknown":
			return "远端状态未知";
		default:
			return "已公开";
	}
}

/**
 * 计算归档清理计划。`entries` 必须已经过 tag 格式过滤（只含 `vX.Y.Z` 目录）。
 * 判定顺序：本次发布 → 比本次更新 → 保留名额 → 远端未公开 → 删除。
 */
export function planArchivePrune(input: {
	currentTag: string;
	entries: readonly ArchiveEntry[];
	remoteStates: Readonly<Record<string, ReleaseRemoteState>>;
	retention?: number;
}): ArchivePrunePlan {
	const retention = Math.max(1, Math.trunc(input.retention ?? RELEASE_ARCHIVE_RETENTION));
	const remote = (tag: string): ReleaseRemoteState =>
		input.remoteStates[tag] ?? "unknown";

	// 按版本从新到旧；同版本按 tag 稳定排序，保证输出可预测。
	const ordered = [...input.entries].sort((left, right) => {
		const byVersion = compareVersions(right.version, left.version);
		return byVersion !== 0 ? byVersion : left.tag.localeCompare(right.tag);
	});

	const keep: ArchiveKeepItem[] = [];
	const remove: ArchiveEntry[] = [];
	// 比本次发布更新的归档同样占用保留名额：正常情况下不存在，出现即说明本机版本比目标新。
	let occupied = 0;

	const currentVersion = tagVersion(input.currentTag);
	for (const entry of ordered) {
		const relation = versionRelation(entry, input.currentTag, currentVersion);

		if (relation === "current") {
			occupied += 1;
			keep.push({ entry, reason: "本次发布" });
			continue;
		}
		if (relation === "newer") {
			occupied += 1;
			keep.push({ entry, reason: "版本比本次发布更新，保守保留" });
			continue;
		}
		if (occupied < retention) {
			occupied += 1;
			keep.push({ entry, reason: `保留最近 ${retention} 个归档` });
			continue;
		}
		const state = remote(entry.tag);
		if (state !== "public") {
			keep.push({ entry, reason: `${remoteStateText(state)}，留作续跑依据` });
			continue;
		}
		remove.push(entry);
	}

	return {
		keep,
		remove,
		freedBytes: remove.reduce((total, entry) => total + entry.bytes, 0),
	};
}

/** `v1.2.3` → `1.2.3`（调用方已用 RELEASE_TAG_PATTERN 过滤过）。 */
export function tagVersion(tag: string): string {
	return String(tag).replace(/^v/i, "");
}

export const RELEASE_TAG_PATTERN = /^v\d+\.\d+\.\d+$/;

export interface StagingEntry {
	name: string;
	tag: string;
	pid: number;
}

/** 解析 `.staging-<tag>-<pid>`；异常命名返回 null（一律不动，交给人工）。 */
export function parseStagingName(name: string): StagingEntry | null {
	const match = /^\.staging-(v\d+\.\d+\.\d+)-(\d+)$/.exec(String(name));
	if (!match) return null;
	const pid = Number(match[2]);
	if (!Number.isSafeInteger(pid) || pid <= 0) return null;
	return { name, tag: match[1] as string, pid };
}
