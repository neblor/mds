/**
 * 词源偏好与「水合安全」的回归测试。
 *
 * 历史事故：`useWordBanks` 曾在 createSignal 初值里直接 `loadVocabPrefs()`，
 * 服务端渲染时没有 localStorage → 渲染「录入」界面；客户端水合时读到
 * `mode:"bank"` → 首帧渲染「词表」界面。两边结构不同 → Solid 水合失败，
 * 整页变成 `Error | Uncaught Client Exception`，任何点过一次「词表」的用户重启必崩。
 *
 * 注意：Vitest（node 环境）里 `solid-js` 解析到 SSR 构建，onMount/effect 不会执行，
 * 因此这里只锁「初值不读 localStorage」这条水合契约；「挂载后恢复偏好并补拉词表/队列」
 * 由 scripts/smoke-hydration.mjs 在真实浏览器里验证（见该脚本注释）。
 */
import { createRoot } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QueueView } from "./bank-api";
import { DEFAULT_BATCH_SIZE } from "./round-queue";
import {
	VOCAB_PREFS_KEY,
	type SourceMode,
	type WordBanksApi,
	normalizeVocabPrefs,
	useWordBanks,
} from "./use-wordbanks";

function stubStorage(seed: Record<string, string>): Map<string, string> {
	const store = new Map(Object.entries(seed));
	const storage = {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => void store.set(key, value),
		removeItem: (key: string) => void store.delete(key),
		clear: () => store.clear(),
		key: (index: number) => [...store.keys()][index] ?? null,
		get length() {
			return store.size;
		},
	};
	Object.defineProperty(globalThis, "localStorage", {
		value: storage,
		configurable: true,
		writable: true,
	});
	return store;
}

/** 首帧形态：与 SSR 输出必须一致，才谈得上水合成功 */
function firstPaint(): { mode: SourceMode; bankId: string | null } {
	let snapshot!: { mode: SourceMode; bankId: string | null };
	createRoot((dispose) => {
		const api: WordBanksApi = useWordBanks({ requestRetention: () => 0.9 });
		snapshot = { mode: api.mode(), bankId: api.activeBankId() };
		dispose();
	});
	return snapshot;
}

afterEach(() => {
	vi.unstubAllGlobals();
	Reflect.deleteProperty(globalThis, "localStorage");
});

function makeQueueView(words: string[]): QueueView {
	return {
		bankId: "pet",
		queue: {
			date: "2026-10-24",
			reviews: [],
			fresh: words,
			words,
			size: DEFAULT_BATCH_SIZE,
		},
		definitions: {},
		progress: {
			date: "2026-10-24",
			size: words.length,
			done: 0,
			todayWords: 0,
			correct: 0,
			total: 0,
			elapsedMs: 0,
		},
	};
}

function queueResponse(view: QueueView): Response {
	return { ok: true, json: async () => view } as Response;
}

describe("normalizeVocabPrefs", () => {
	it("字段缺失或非法一律回落默认值", () => {
		expect(normalizeVocabPrefs(null)).toEqual({
			mode: "entry",
			bankId: null,
			batchSize: DEFAULT_BATCH_SIZE,
		});
		expect(
			normalizeVocabPrefs({ mode: "nonsense", batchSize: 9999 }),
		).toMatchObject({ mode: "entry", bankId: null });
	});

	it("旧字段 todayTarget 迁移成 batchSize（2026-10-24 语义更正）", () => {
		expect(normalizeVocabPrefs({ mode: "bank", todayTarget: 30 })).toEqual({
			mode: "bank",
			bankId: null,
			batchSize: 30,
		});
		// 新字段优先于旧字段
		expect(
			normalizeVocabPrefs({ batchSize: 15, todayTarget: 30 }),
		).toMatchObject({ batchSize: 15 });
	});

	it("合法值原样保留，bankId 去空白", () => {
		expect(
			normalizeVocabPrefs({ mode: "bank", bankId: "  pet  ", batchSize: 20 }),
		).toEqual({ mode: "bank", bankId: "pet", batchSize: 20 });
	});

	it("旧范围 5–100 的存量值迁到 5–30、步长 5", () => {
		expect(normalizeVocabPrefs({ batchSize: 100 })).toMatchObject({
			batchSize: 30,
		});
		expect(normalizeVocabPrefs({ batchSize: 30 })).toMatchObject({
			batchSize: 30,
		});
		expect(normalizeVocabPrefs({ batchSize: 23 })).toMatchObject({
			batchSize: 25,
		});
		expect(normalizeVocabPrefs({ todayTarget: 100 })).toMatchObject({
			batchSize: 30,
		});
	});
});

describe("useWordBanks 换批接线", () => {
	it("重新取词请求 no-store，并用响应替换当前队列", async () => {
		stubStorage({});
		const firstWords = ["word-001", "word-002"];
		const nextWords = ["word-002", "word-003"];
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(queueResponse(makeQueueView(firstWords)))
			.mockResolvedValueOnce(queueResponse(makeQueueView(nextWords)));
		vi.stubGlobal("fetch", fetchMock);

		let api!: WordBanksApi;
		let dispose!: () => void;
		createRoot((rootDispose) => {
			dispose = rootDispose;
			api = useWordBanks({ requestRetention: () => 0.9 });
		});
		try {
			api.selectBank("pet");
			await vi.waitFor(() => {
				expect(api.queue()?.queue.words).toEqual(firstWords);
			});
			await api.refreshQueue();

			expect(fetchMock).toHaveBeenCalledTimes(2);
			const firstUrl = new URL(
				String(fetchMock.mock.calls[0][0]),
				"http://localhost",
			);
			const nextUrl = new URL(
				String(fetchMock.mock.calls[1][0]),
				"http://localhost",
			);
			// 换批语义在服务端队列算法里，不再带 avoid 参数。
			expect(firstUrl.searchParams.has("avoid")).toBe(false);
			expect(nextUrl.searchParams.has("avoid")).toBe(false);
			expect(firstUrl.searchParams.get("size")).toBe("20");
			expect(nextUrl.searchParams.get("size")).toBe("20");
			expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
			expect(fetchMock.mock.calls[1][1]).toMatchObject({ cache: "no-store" });
			expect(api.queue()?.queue.words).toEqual(nextWords);
			expect(api.error()).toBeNull();
		} finally {
			dispose();
		}
	});
});

describe("useWordBanks 水合契约", () => {
	it("持久化偏好是 bank 时，首帧仍必须是默认的 entry 形态", () => {
		stubStorage({
			[VOCAB_PREFS_KEY]: JSON.stringify({
				mode: "bank",
				bankId: "pet",
				batchSize: 20,
			}),
		});
		expect(firstPaint()).toEqual({ mode: "entry", bankId: null });
	});

	it("没有持久化偏好时首帧同样是 entry", () => {
		stubStorage({});
		expect(firstPaint()).toEqual({ mode: "entry", bankId: null });
	});

	it("存储内容损坏时不抛错，首帧仍是默认形态", () => {
		stubStorage({ [VOCAB_PREFS_KEY]: "{不是 JSON" });
		expect(firstPaint()).toEqual({ mode: "entry", bankId: null });
	});
});
