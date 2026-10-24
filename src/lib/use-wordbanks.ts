/**
 * 词库/复习的前端状态层（浏览器）
 *
 * 职责：
 * - 词源模式（录入 / 词表）+ 当前词表 + 「本次取几个词」的持久化（localStorage）
 * - 本地词表列表 + 内置资源清单 + 取词队列的拉取与重算
 * - 词表增删改、资源词表下载、默写结束后的复习写回
 *
 * 数字语义（2026-10-24 更正）：界面上只有一个数字 = **本次取几个词**。
 * 「重新取词」= 按这个数字再取一批，不是「今天额度用完了就不能取」。
 *
 * 与 use-dictation 的分工：这里只决定「词从哪来」，默写流程与计时仍在 use-dictation。
 */
import { createSignal, onMount } from "solid-js";
import {
	type BankStatsView,
	type CommitSessionInput,
	type CommitView,
	type QueueView,
	commitReview,
	createBank,
	copyBankAsCustom,
	downloadCatalogBank,
	downloadRemoteBank,
	fetchBankDetail,
	fetchBankStats,
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
import { clampBatchSize, DEFAULT_BATCH_SIZE } from "./round-queue";
import {
	buildCommitItems,
	type ResultRowLike,
	type ReviewCommitItem,
} from "./review-service";
import { wordKey } from "./bank-parse";
import type { ReviewMode } from "./review-types";

export type SourceMode = "entry" | "bank";

export interface VocabPrefs {
	mode: SourceMode;
	bankId: string | null;
	/** 本次取几个词（不是今日总量） */
	batchSize: number;
}

export const VOCAB_PREFS_KEY = "mds.vocab.v1";

const DEFAULT_PREFS: VocabPrefs = {
	mode: "entry",
	bankId: null,
	batchSize: DEFAULT_BATCH_SIZE,
};

/** 场次幂等键；浏览器/Electron 都有 crypto.randomUUID，旧环境回退时间戳 */
function createSessionId(): string {
	if (typeof globalThis.crypto?.randomUUID === "function") {
		return globalThis.crypto.randomUUID();
	}
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 归一偏好设置：字段缺失/非法一律回落默认值。
 *
 * `todayTarget` 是 2026-10-24 之前的旧字段名（当时误当「今日总量」），
 * 读取时按 `batchSize` 兼容迁移，下次保存即写新字段。
 */
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
		batchSize: clampBatchSize(holder.batchSize ?? holder.todayTarget),
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
	batchSize: () => number;
	/** 只改数字并持久化；不自动重新取词（下一次点「重新取词」才按新数字取） */
	setBatchSize: (value: number) => void;
	banks: () => BankSummary[];
	/** 资源词表清单（内置 + 自定义远端）并带增量状态（下载/更新/已是最新） */
	catalog: () => CatalogRow[];
	/** 自定义清单地址（持久化在设置里） */
	manifestUrl: () => string;
	setManifestUrl: (url: string) => void;
	/** 拉取指定的（或当前配置的）清单并返回带状态的条目，供「检查清单更新」展示 */
	checkManifest: (url?: string) => Promise<CatalogRow[]>;
	queue: () => QueueView | null;
	/** 本批已默词（当前这批；与每日统计无关） */
	batchDone: () => string[];
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
	/** 学习档案（兼容模式会抛出 503 文案） */
	loadStats: (bankId: string, days?: number) => Promise<BankStatsView>;
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
	/** 记录本场的词表与起始时间（结算写回时用） */
	beginSession: (bankId: string, words: string[]) => void;
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
	/** 本批已默词（仅当前这批；换批清零）；与 daily 统计无关 */
	const [batchDone, setBatchDone] = createSignal<string[]>([]);
	const [busy, setBusy] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);
	const [sessionBankId, setSessionBankId] = createSignal<string | null>(null);
	const [lastCommit, setLastCommit] = createSignal<CommitView | null>(null);
	let sessionId = "";
	let sessionStartedAt = 0;
	let sessionWords: string[] = [];

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
			const view = await fetchReviewQueue(bankId, prefs().batchSize);
			// 服务端可能夹取过请求数量（5–100），回写本地保持一致；
			// progress.size 是本批实际词数（词表不足时更小），不能拿来回写偏好。
			if (view.queue.size !== prefs().batchSize) {
				patchPrefs({ batchSize: view.queue.size });
			}
			setQueue(view);
			setBatchDone([]);
		} catch (err) {
			setQueue(null);
			setError(err instanceof Error ? err.message : "无法取词");
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

	// 挂载后恢复持久化偏好；词表模式下还要把词表列表与当前这批词拉回来，
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
		batchSize: () => prefs().batchSize,
		setBatchSize: (value) => {
			// 只存数字：当前这批词保持原样，避免调步进器时列表在脚下反复换批
			patchPrefs({ batchSize: clampBatchSize(value) });
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
		batchDone,
		busy,
		error,
		setError,

		selectBank: (bankId) => {
			patchPrefs({ bankId });
			setQueue(null);
			setBatchDone([]);
			setLastCommit(null);
			if (bankId) void refreshQueue();
		},

		refresh,
		refreshQueue,

		loadDetail: (bankId, detailOptions) =>
			fetchBankDetail(bankId, detailOptions),

		loadStats: (bankId, days) => fetchBankStats(bankId, days),

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

		beginSession: (bankId, words) => {
			sessionId = createSessionId();
			sessionStartedAt = Date.now();
			sessionWords = Array.from(
				new Set(
					words
						.map((word) => word.trim())
						.filter((word) => word.length > 0),
				),
			);
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
			const activeMs = (input.elapsedMs ?? []).reduce(
				(sum, ms) => sum + Math.max(0, Math.round(ms)),
				0,
			);
			const fallbackWords = input.rows
				.map((row) => row.word.trim())
				.filter(Boolean);
			// 优先用结果行里的实际作答词：组句场次里队列候选词 ≠ 本场挖空的词，
			// 用候选词会把 recent 的得分分母（词数）放大。
			const words =
				fallbackWords.length > 0 ? fallbackWords : sessionWords;
			const session: CommitSessionInput = {
				id: sessionId || createSessionId(),
				genMode: input.genMode,
				contentMode: input.mode,
				words,
				correct:
					input.genMode === "writing"
						? null
						: items.filter((item) => item.correct).length,
				activeMs,
				wallMs: Math.max(
					activeMs,
					sessionStartedAt > 0 ? Date.now() - sessionStartedAt : activeMs,
				),
			};
			// 书写模式 items 为空，但场次仍要记（使用频率统计）；
			// 没有词也没有判定时没有什么可记的。
			if (items.length === 0 && words.length === 0) return null;
			try {
				const view = await commitReview(
					bankId,
					items,
					options.requestRetention(),
					session,
				);
				setLastCommit(view);
				// 结算后**不重新取词**：本批词面保持不动（进度变成 x / N），
				// 用户点「重新取词」时才按当前数字取下一批。
				// 否则列表会在结算瞬间自动换成下一批，看不出本批已经做完。
				applyCommitToQueue(view);
				return view;
			} catch (err) {
				setError(err instanceof Error ? err.message : "复习计划写回失败");
				return null;
			}
		},
	};

	/**
	 * 把刚写回的一场合并进当前这批的已默集合（不重新请求队列）。
	 * 只影响展示：`doneWords` 去重合并，`progress.done` 按本批重算。
	 */
	function applyCommitToQueue(view: CommitView): void {
		setBatchDone((prev) => {
			const merged = [...prev];
			const seen = new Set(prev.map(wordKey));
			for (const item of view.updated) {
				const key = wordKey(item.word);
				if (!key || seen.has(key)) continue;
				seen.add(key);
				merged.push(item.word);
			}
			return merged;
		});
		setQueue((prev) => {
			if (!prev) return prev;
			const doneKeys = new Set(
				[...batchDone(), ...view.updated.map((item) => item.word)].map(wordKey),
			);
			return {
				...prev,
				progress: {
					...prev.progress,
					done: prev.queue.words.filter((word) => doneKeys.has(wordKey(word)))
						.length,
					todayWords: view.progress.words,
					correct: view.progress.correct,
					total: view.progress.total,
					elapsedMs: view.progress.elapsedMs,
				},
			};
		});
	}

	/** 内部：选中词表（createXxx/download 之后直接切过去） */
	function selectBankById(bankId: string): void {
		patchPrefs({ bankId, mode: "bank" });
		setQueue(null);
		setBatchDone([]);
		void refreshQueue();
	}
}
