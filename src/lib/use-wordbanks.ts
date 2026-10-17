/**
 * 词库/复习的前端状态层（浏览器）
 *
 * 职责：
 * - 词源模式（录入 / 词表）+ 当前词表 + 「今天默几个」的持久化（localStorage）
 * - 本地词表列表 + 内置资源清单 + 今日队列的拉取与重算
 * - 词表增删改、资源词表下载、默写结束后的复习写回
 *
 * 与 use-dictation 的分工：这里只决定「词从哪来」，默写流程与计时仍在 use-dictation。
 */
import { createSignal, onMount } from "solid-js";
import {
	type CommitView,
	type QueueView,
	commitReview,
	createBank,
	copyBankAsCustom,
	downloadCatalogBank,
	downloadRemoteBank,
	fetchBankDetail,
	fetchBanks,
	fetchBuiltinCatalog,
	fetchRemoteManifest,
	fetchReviewQueue,
	importBank,
	removeBank,
	updateBank,
} from "./bank-api";
import { mergeCatalog, type CatalogRow } from "./bank-catalog";
import type { BankSummary, ManifestEntry } from "./bank-types";
import { clampTodayTarget, DEFAULT_TODAY_TARGET } from "./daily-queue";
import {
	buildCommitItems,
	type ResultRowLike,
	type ReviewCommitItem,
} from "./review-service";
import type { ReviewMode } from "./review-store";

export type SourceMode = "entry" | "bank";

export interface VocabPrefs {
	mode: SourceMode;
	bankId: string | null;
	todayTarget: number;
}

export const VOCAB_PREFS_KEY = "mds.vocab.v1";

const DEFAULT_PREFS: VocabPrefs = {
	mode: "entry",
	bankId: null,
	todayTarget: DEFAULT_TODAY_TARGET,
};

/** 归一偏好设置：字段缺失/非法一律回落默认值 */
export function normalizeVocabPrefs(raw: unknown): VocabPrefs {
	const holder =
		typeof raw === "object" && raw !== null
			? (raw as Record<string, unknown>)
			: {};
	return {
		mode: holder.mode === "bank" ? "bank" : "entry",
		bankId:
			typeof holder.bankId === "string" && holder.bankId.trim()
				? holder.bankId.trim()
				: null,
		todayTarget: clampTodayTarget(holder.todayTarget),
	};
}

export function loadVocabPrefs(): VocabPrefs {
	if (typeof localStorage === "undefined") return { ...DEFAULT_PREFS };
	try {
		const raw = localStorage.getItem(VOCAB_PREFS_KEY);
		return raw ? normalizeVocabPrefs(JSON.parse(raw)) : { ...DEFAULT_PREFS };
	} catch {
		return { ...DEFAULT_PREFS };
	}
}

export function saveVocabPrefs(prefs: VocabPrefs): void {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(VOCAB_PREFS_KEY, JSON.stringify(prefs));
	} catch {
		// 存储失败静默（隐私模式等）
	}
}

export interface WordBanksApi {
	mode: () => SourceMode;
	setMode: (mode: SourceMode) => void;
	activeBankId: () => string | null;
	activeBank: () => BankSummary | null;
	todayTarget: () => number;
	setTodayTarget: (value: number) => void;
	banks: () => BankSummary[];
	/** 资源词表清单（内置 + 自定义远端）并带增量状态（下载/更新/已是最新） */
	catalog: () => CatalogRow[];
	/** 自定义清单地址（持久化在设置里） */
	manifestUrl: () => string;
	setManifestUrl: (url: string) => void;
	/** 拉取指定的（或当前配置的）清单并返回带状态的条目，供「检查清单更新」展示 */
	checkManifest: (url?: string) => Promise<CatalogRow[]>;
	queue: () => QueueView | null;
	busy: () => boolean;
	error: () => string | null;
	setError: (message: string | null) => void;
	/** 只改模式/选库，不立刻请求队列（调用方按需 refreshQueue） */
	selectBank: (bankId: string | null) => void;
	refresh: () => Promise<void>;
	refreshQueue: () => Promise<void>;
	loadDetail: (
		bankId: string,
		options?: { offset?: number; limit?: number; q?: string },
	) => Promise<Awaited<ReturnType<typeof fetchBankDetail>>>;
	createNew: (name: string, words?: string[]) => Promise<BankSummary>;
	download: (row: CatalogRow) => Promise<BankSummary>;
	importFromFile: (payload: unknown, rename?: string) => Promise<BankSummary>;
	editWords: (payload: {
		bankId: string;
		name?: string;
		add?: string | string[];
		remove?: string[];
	}) => Promise<{ added: number; duplicated: number; removed: number }>;
	deleteBank: (bankId: string) => Promise<void>;
	/** 资源词表 → 复制为自建词表（服务端复制，不搬数据） */
	copyAsCustom: (bankId: string, rename?: string) => Promise<BankSummary>;
	/** 记录本场的词表（结算写回时用） */
	beginSession: (bankId: string) => void;
	sessionBankId: () => string | null;
	lastCommit: () => CommitView | null;
	commitSession: (input: {
		rows: ResultRowLike[];
		mode: ReviewMode;
		genMode: "writing" | "cyber";
		elapsedMs?: number[];
	}) => Promise<CommitView | null>;
}

export function useWordBanks(options: {
	requestRetention: () => number;
	/** 自定义清单地址（来自设置） */
	manifestUrl?: () => string;
	/** 写回自定义清单地址（来自设置） */
	onManifestUrl?: (url: string) => void;
}): WordBanksApi {
	// 水合安全：初值必须是「服务端也能渲染出」的默认形态，**不能**在这里读 localStorage。
	// 否则服务端渲染「录入」界面、客户端水合时按持久化偏好渲染「词表」界面，
	// 两边结构不一致会让 Solid 水合直接失败（整页 Error | Uncaught Client Exception），
	// 历史上只要点过一次「词表」的用户重启必崩。持久化偏好一律等挂载后再恢复。
	const [prefs, setPrefs] = createSignal<VocabPrefs>({ ...DEFAULT_PREFS });
	const [banks, setBanks] = createSignal<BankSummary[]>([]);
	const [catalog, setCatalog] = createSignal<CatalogRow[]>([]);
	const [queue, setQueue] = createSignal<QueueView | null>(null);
	const [busy, setBusy] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);
	const [sessionBankId, setSessionBankId] = createSignal<string | null>(null);
	const [lastCommit, setLastCommit] = createSignal<CommitView | null>(null);

	const patchPrefs = (patch: Partial<VocabPrefs>) => {
		const next = { ...prefs(), ...patch };
		setPrefs(next);
		saveVocabPrefs(next);
		return next;
	};

	const activeBank = () =>
		banks().find((bank) => bank.id === prefs().bankId) ?? null;

	const withBusy = async <T,>(task: () => Promise<T>): Promise<T> => {
		setBusy(true);
		setError(null);
		try {
			return await task();
		} finally {
			setBusy(false);
		}
	};

	const refreshQueue = async (): Promise<void> => {
		const bankId = prefs().bankId;
		if (!bankId) {
			setQueue(null);
			return;
		}
		try {
			const view = await fetchReviewQueue(bankId, prefs().todayTarget);
			// 服务端可能夹取过目标值（5–100），回写本地保持一致
			if (view.progress.target !== prefs().todayTarget) {
				patchPrefs({ todayTarget: view.progress.target });
			}
			setQueue(view);
		} catch (err) {
			setQueue(null);
			setError(err instanceof Error ? err.message : "无法获取今日队列");
		}
	};

	const refreshCatalog = async (): Promise<CatalogRow[]> => {
		const builtin = await fetchBuiltinCatalog();
		const manifestUrl = options.manifestUrl?.() ?? "";
		let remote: ManifestEntry[] = [];
		if (manifestUrl) {
			try {
				remote = await fetchRemoteManifest(manifestUrl);
			} catch (err) {
				// 自定义清单不可用不阻塞本地词表使用，仅提示（内置清单照常工作）
				setError(
					err instanceof Error
						? `自定义清单不可用：${err.message}`
						: "自定义清单不可用",
				);
			}
		}
		const rows = mergeCatalog({ builtin, remote, local: banks() });
		setCatalog(rows);
		return rows;
	};

	const refresh = async (): Promise<void> => {
		await withBusy(async () => {
			const list = await fetchBanks();
			setBanks(list);
			await refreshCatalog();
		}).catch((err: unknown) => {
			setError(err instanceof Error ? err.message : "无法读取词表列表");
		});
		await refreshQueue();
	};

	// 挂载后恢复持久化偏好；词表模式下还要把词表列表与今日队列拉回来，
	// 否则重启后只会看到「词表名空白 + 队列为空」的空壳界面。
	onMount(() => {
		const saved = loadVocabPrefs();
		setPrefs(saved);
		if (saved.mode === "bank") void refresh();
	});

	return {
		mode: () => prefs().mode,
		setMode: (mode) => {
			patchPrefs({ mode });
			if (mode === "bank") void refresh();
		},
		activeBankId: () => prefs().bankId,
		activeBank,
		todayTarget: () => prefs().todayTarget,
		setTodayTarget: (value) => {
			patchPrefs({ todayTarget: clampTodayTarget(value) });
			if (prefs().mode === "bank") void refreshQueue();
		},
		banks,
		catalog,
		manifestUrl: () => options.manifestUrl?.() ?? "",
		setManifestUrl: (url) => options.onManifestUrl?.(url.trim()),
		checkManifest: async (url) => {
			const target = (url ?? options.manifestUrl?.() ?? "").trim();
			if (!target) return [];
			const remote = await fetchRemoteManifest(target);
			const rows = mergeCatalog({
				builtin: await fetchBuiltinCatalog(),
				remote,
				local: banks(),
			});
			setCatalog(rows);
			return rows;
		},
		queue,
		busy,
		error,
		setError,

		selectBank: (bankId) => {
			patchPrefs({ bankId });
			setQueue(null);
			setLastCommit(null);
			if (bankId) void refreshQueue();
		},

		refresh,
		refreshQueue,

		loadDetail: (bankId, detailOptions) =>
			fetchBankDetail(bankId, detailOptions),

		createNew: (name, words) =>
			withBusy(async () => {
				const { bank } = await createBank(name, words);
				await refresh();
				selectBankById(bank.id);
				return bank;
			}),

		download: (row) =>
			withBusy(async () => {
				const bank =
					row.source === "remote"
						? await downloadRemoteBank(row.entry)
						: await downloadCatalogBank(row.entry);
				await refresh();
				selectBankById(bank.id);
				return bank;
			}),

		importFromFile: (payload, rename) =>
			withBusy(async () => {
				const { bank } = await importBank(payload, { rename });
				await refresh();
				selectBankById(bank.id);
				return bank;
			}),

		editWords: (payload) =>
			withBusy(async () => {
				const result = await updateBank(payload);
				await refresh();
				return {
					added: result.added,
					duplicated: result.duplicated,
					removed: result.removed,
				};
			}),

		deleteBank: (bankId) =>
			withBusy(async () => {
				await removeBank(bankId);
				if (prefs().bankId === bankId) patchPrefs({ bankId: null });
				await refresh();
			}),

		copyAsCustom: (bankId, rename) =>
			withBusy(async () => {
				const { bank } = await copyBankAsCustom(bankId, { rename });
				await refresh();
				selectBankById(bank.id);
				return bank;
			}),

		beginSession: (bankId) => {
			setLastCommit(null);
			setSessionBankId(bankId);
		},
		sessionBankId,
		lastCommit,

		commitSession: async (input) => {
			const bankId = sessionBankId();
			if (!bankId) return null;
			const items: ReviewCommitItem[] = buildCommitItems({
				rows: input.rows,
				mode: input.mode,
				genMode: input.genMode,
				elapsedMs: input.elapsedMs,
			});
			// 书写模式没有判定字段 → items 为空，不写回（也不清空 session，便于复查）
			if (items.length === 0) return null;
			try {
				const view = await commitReview(
					bankId,
					items,
					options.requestRetention(),
				);
				setLastCommit(view);
				await refreshQueue();
				return view;
			} catch (err) {
				setError(err instanceof Error ? err.message : "复习计划写回失败");
				return null;
			}
		},
	};

	/** 内部：选中词表（createXxx/download 之后直接切过去） */
	function selectBankById(bankId: string): void {
		patchPrefs({ bankId, mode: "bank" });
		setQueue(null);
		void refreshQueue();
	}
}
