/**
 * 词库/复习功能的客户端 API 封装（浏览器侧）
 *
 * 「下载资源词表」的实现要点：内置词库是随包发布的静态资源（/banks/<id>.json），
 * 前端直接 fetch 它，再 POST 给 /api/bank-import 落到本地词库目录——
 * 这样服务端不需要知道 public 目录在 dev / .output / 打包后的位置差异。
 */
import type {
	BankEntry,
	BankSource,
	BankSummary,
	ManifestEntry,
	WordBank,
} from "./bank-types";
import type { BankStatsView } from "./bank-stats";
import { isValidBankId } from "./bank-types";
import type { ReviewMode } from "./review-types";

/** 内置词库清单（随包发布的静态资源） */
export const BUILTIN_MANIFEST_PATH = "/banks/manifest.json";

export interface BankCatalog {
	version: number;
	banks: ManifestEntry[];
}

export interface BankDetail {
	bank: {
		id: string;
		name: string;
		source: BankSource;
		count: number;
		updatedAt: number;
		note: string | null;
	};
	entries: BankEntry[];
	total: number;
	offset: number;
	limit: number;
}

/**
 * 取词队列进度：`size` = 本批实际词数（词表不足时小于请求值），
 * `done` = 本批已默几个（不是今日累计）；请求数量见 `queue.size`。
 * `correct/total/elapsedMs` 是今日逐题统计。
 */
export interface QueueProgressView {
	date: string;
	size: number;
	done: number;
	/** 今日累计练过的词数（按场次词数求和） */
	todayWords: number;
	correct: number;
	total: number;
	elapsedMs: number;
}

/** 写回一场后的今日累计进度（与批次无关） */
export interface CommitProgressView {
	date: string;
	/** 今日累计练过的词数（跨批次求和） */
	words: number;
	correct: number;
	total: number;
	elapsedMs: number;
}

export interface QueueView {
	bankId: string;
	queue: {
		date: string;
		reviews: string[];
		fresh: string[];
		words: string[];
		/** 本批取几个词（= 本次取词数量） */
		size: number;
	};
	/** 队列词的英文释义（组句出题用；词表里没有释义时缺省） */
	definitions: Record<string, string>;
	progress: QueueProgressView;
}

export interface CommitView {
	updated: {
		word: string;
		rating: number;
		due: string;
		inDays: number;
		laterToday: boolean;
		queueKind: "new" | "review" | "relearn";
	}[];
	progress: CommitProgressView;
}

export interface ReviewCommitItemInput {
	word: string;
	correct: boolean;
	/** 该轮的判定口径；短句场次里被降级为单词轮时按 word 记（逐项覆盖，见 review-service） */
	mode: ReviewMode;
	genMode: "writing" | "cyber";
	elapsedMs: number;
}

/** 一场的使用记录（书写也要记；correct 为 null） */
export interface CommitSessionInput {
	id: string;
	genMode: "writing" | "cyber";
	contentMode: ReviewMode;
	words: string[];
	correct: number | null;
	activeMs: number;
	wallMs: number;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
	const response = await fetch(url, init);
	if (!response.ok) {
		const text = await response.text().catch(() => "");
		let message = text.slice(0, 160);
		try {
			const parsed = JSON.parse(text) as { message?: unknown };
			if (typeof parsed.message === "string") message = parsed.message;
		} catch {
			// 非 JSON（HTML 错误页等）直接用原文
		}
		throw new Error(message || `请求失败（${response.status}）`);
	}
	return (await response.json()) as T;
}

function postJson<T>(url: string, body: unknown): Promise<T> {
	return requestJson<T>(url, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

/* ---------- 词表 ---------- */

export async function fetchBanks(): Promise<BankSummary[]> {
	const data = await requestJson<{ banks: BankSummary[] }>("/api/banks");
	return data.banks;
}

export function fetchBankDetail(
	bankId: string,
	options: { offset?: number; limit?: number; q?: string } = {},
): Promise<BankDetail> {
	const params = new URLSearchParams({ bankId });
	if (options.offset) params.set("offset", String(options.offset));
	if (options.limit) params.set("limit", String(options.limit));
	if (options.q) params.set("q", options.q);
	return requestJson<BankDetail>(`/api/bank-detail?${params.toString()}`);
}

export function createBank(
	name: string,
	words?: string[],
): Promise<{ bank: BankSummary }> {
	return postJson("/api/banks", { name, words });
}

export function updateBank(payload: {
	bankId: string;
	name?: string;
	add?: string | string[];
	remove?: string[];
}): Promise<{
	bank: BankSummary;
	added: number;
	duplicated: number;
	removed: number;
	overflow: number;
}> {
	return postJson("/api/bank-update", payload);
}

export function removeBank(bankId: string): Promise<{ ok: boolean }> {
	return postJson("/api/bank-remove", { bankId });
}

export function importBank(
	bank: unknown,
	options: { rename?: string } = {},
): Promise<{ bank: BankSummary }> {
	return postJson("/api/bank-import", { bank, rename: options.rename });
}

/** 服务端复制为自建词表（资源词表只读 → 想要自己的版本就用这个） */
export function copyBankAsCustom(
	copyOf: string,
	options: { rename?: string } = {},
): Promise<{ bank: BankSummary }> {
	return postJson("/api/bank-import", { copyOf, rename: options.rename });
}

/* ---------- 资源词表（静态清单 + 静态词库文件） ---------- */

/** 读取随包发布的内置词库清单；离线环境或文件缺失时返回空清单（不抛错） */
export async function fetchBuiltinCatalog(): Promise<ManifestEntry[]> {
	try {
		const data = await requestJson<BankCatalog>(BUILTIN_MANIFEST_PATH);
		return (Array.isArray(data.banks) ? data.banks.filter((entry) => isValidBankId(entry.id)) : []);
	} catch {
		return [];
	}
}

/**
 * 导入一个清单条目：拉静态词库文件 → 落本地库。
 *
 * **不做任意 URL 抓取**：路径前缀固定为 /banks/，id 先过 BANK_ID_PATTERN 白名单
 * （^[a-z0-9][a-z0-9-]{1,39}$，不可能拼出 ../ 或跨域地址）。
 * 未来若支持「自定义远端清单」，那要单独走服务端路由 + 主机白名单，不在这里放开口子。
 */
export async function downloadCatalogBank(
	entry: ManifestEntry,
	options: { rename?: string } = {},
): Promise<BankSummary> {
	if (!isValidBankId(entry.id)) {
		throw new Error("词库 id 非法，已拒绝下载");
	}
	const response = await fetch(`/banks/${entry.id}.json`);
	if (!response.ok) {
		throw new Error(`下载「${entry.name}」失败（${response.status}）`);
	}
	const payload = await response.json();
	const result = await importBank(payload, options);
	return result.bank;
}

export type { BankEntry, BankSummary, ManifestEntry, WordBank };

/* ---------- 自定义远端清单（服务端拉取 + SSRF 防护） ---------- */

/** 拉取并解析远端清单；失败抛错（message 已是用户可读文案） */
export async function fetchRemoteManifest(url: string): Promise<ManifestEntry[]> {
	const params = new URLSearchParams({ url });
	const data = await requestJson<{
		banks?: ManifestEntry[];
		error?: string;
		message?: string;
	}>(`/api/bank-manifest?${params.toString()}`);
	if (data.error) throw new Error(data.message || data.error);
	return Array.isArray(data.banks)
		? data.banks.filter((entry) => isValidBankId(entry.id))
		: [];
}

/** 下载远端清单里的词库文件并导入为本地词库（走服务端拉取） */
export async function downloadRemoteBank(
	entry: ManifestEntry,
	options: { rename?: string } = {},
): Promise<BankSummary> {
	const params = new URLSearchParams({ url: entry.url });
	const data = await requestJson<{
		bank?: unknown;
		error?: string;
		message?: string;
	}>(`/api/bank-remote?${params.toString()}`);
	if (data.error) throw new Error(data.message || data.error);
	if (!data.bank) throw new Error("远端词库文件为空");
	const result = await importBank(data.bank, options);
	return result.bank;
}

/* ---------- 复习 ---------- */

export function fetchReviewQueue(
	bankId: string,
	size: number,
): Promise<QueueView> {
	const params = new URLSearchParams({ bankId, size: String(size) });
	return requestJson<QueueView>(`/api/review-queue?${params.toString()}`);
}

export function commitReview(
	bankId: string,
	items: ReviewCommitItemInput[],
	requestRetention?: number,
	session?: CommitSessionInput,
): Promise<CommitView> {
	return postJson("/api/review-commit", {
		bankId,
		items,
		requestRetention,
		...(session ? { session } : {}),
	});
}

/** 学习档案（只读；兼容模式会收到 503） */
export function fetchBankStats(
	bankId: string,
	days = 180,
): Promise<BankStatsView> {
	const params = new URLSearchParams({
		bankId,
		days: String(days),
	});
	return requestJson<BankStatsView>(`/api/bank-stats?${params.toString()}`);
}

export type { BankStatsView };
