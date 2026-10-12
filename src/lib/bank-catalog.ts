/**
 * 词库清单（内置 + 自定义远端）的解析与合并（纯逻辑，可单测）
 *
 * 清单契约（plans/wordbank-srs-cloze.md §1.1）：
 *   { "version": 1, "banks": [ { "id": "cet4", "name": "CET-4 核心词",
 *     "count": 3846, "version": 2, "url": "cet4.json" } ] }
 * - `url` 相对清单地址解析成绝对 http(s) 地址（服务端负责抓取）
 * - 增量口径：本地没有 → 下载；本地 version 更低 → 更新；否则已是最新
 */
import {
	isValidBankId,
	type ManifestEntry,
} from "./bank-types";

/** 清单条目上限（避免恶意清单塞爆界面） */
export const MAX_MANIFEST_BANKS = 200;
/** 清单响应体上限（1 MiB 足够放几万个条目） */
export const MAX_MANIFEST_BYTES = 1024 * 1024;
/** 词库文件上限（当前最大的内置词库约 1.2 MB，留足余量） */
export const MAX_BANK_FILE_BYTES = 32 * 1024 * 1024;
/** 单个字段的长度上限 */
const MAX_NAME_CHARS = 80;
const MAX_TEXT_CHARS = 200;

export type CatalogSource = "builtin" | "remote";
export type CatalogState = "download" | "update" | "latest";

export interface CatalogRow {
	entry: ManifestEntry;
	source: CatalogSource;
	state: CatalogState;
	/** 本地已有的同名词库版本（state=update/latest 时有） */
	localVersion?: number;
}

function text(value: unknown, maxChars: number): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed ? trimmed.slice(0, maxChars) : undefined;
}

function numberOr(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0
		? Math.floor(value)
		: fallback;
}

/**
 * 解析远端清单。任何形状不对的条目直接丢掉（不因一条坏数据丢整份清单）；
 * 相对 url 用清单自身地址解析成绝对地址，非 http(s) 的丢弃。
 */
export function parseBankManifest(raw: unknown, baseUrl: string): ManifestEntry[] {
	const list = Array.isArray(raw)
		? raw
		: raw && typeof raw === "object" && Array.isArray((raw as { banks?: unknown }).banks)
			? ((raw as { banks: unknown[] }).banks)
			: [];
	let base: URL | null = null;
	try {
		base = new URL(baseUrl);
	} catch {
		base = null;
	}
	const seen = new Set<string>();
	const entries: ManifestEntry[] = [];
	for (const item of list) {
		if (!item || typeof item !== "object") continue;
		const holder = item as Record<string, unknown>;
		if (!isValidBankId(holder.id) || seen.has(holder.id)) continue;
		const name = text(holder.name, MAX_NAME_CHARS);
		const rawUrl = text(holder.url, 2048);
		if (!name || !rawUrl) continue;
		let resolved: URL;
		try {
			resolved = base ? new URL(rawUrl, base) : new URL(rawUrl);
		} catch {
			continue;
		}
		if (resolved.protocol !== "https:" && resolved.protocol !== "http:") continue;
		seen.add(holder.id);
		const entry: ManifestEntry = {
			id: holder.id,
			name,
			count: numberOr(holder.count, 0),
			version: numberOr(holder.version, 1),
			url: resolved.toString(),
			...(text(holder.description, MAX_TEXT_CHARS)
				? { description: text(holder.description, MAX_TEXT_CHARS) }
				: {}),
			...(text(holder.license, MAX_TEXT_CHARS)
				? { license: text(holder.license, MAX_TEXT_CHARS) }
				: {}),
		};
		entries.push(entry);
		if (entries.length >= MAX_MANIFEST_BANKS) break;
	}
	return entries;
}

/**
 * 合并「自定义远端清单 + 随包内置清单 + 本地已下载词库」，给出每条的增量状态。
 * 远端同 id 覆盖内置（用户自己的清单优先）；按 id 去重保留第一次出现的来源。
 */
export function mergeCatalog(options: {
	builtin: ManifestEntry[];
	remote: ManifestEntry[];
	local: { id: string; version: number }[];
}): CatalogRow[] {
	const localVersion = new Map(
		options.local.map((bank) => [bank.id, bank.version]),
	);
	const rows: CatalogRow[] = [];
	const seen = new Set<string>();
	const push = (entry: ManifestEntry, source: CatalogSource) => {
		if (seen.has(entry.id)) return;
		seen.add(entry.id);
		const current = localVersion.get(entry.id);
		const state: CatalogState =
			current === undefined
				? "download"
				: current < entry.version
					? "update"
					: "latest";
		rows.push({
			entry,
			source,
			state,
			...(current === undefined ? {} : { localVersion: current }),
		});
	};
	for (const entry of options.remote) push(entry, "remote");
	for (const entry of options.builtin) push(entry, "builtin");
	return rows;
}
