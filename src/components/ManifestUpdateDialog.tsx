/**
 * 检查清单更新弹层（对应设计稿 29）
 *
 * 用途：填自定义词库清单地址 → 检查增量 → 一次性更新有变化的词库。
 * 地址留空则只用随包内置清单；服务端会拒绝非 http(s) 与本机/内网地址（见 lib/remote-fetch）。
 * 键盘：打开即聚焦地址输入框（带内容则全选），Esc 关闭，Ctrl/Cmd+Enter 立即检查。
 */
import { For, Show, createSignal, onMount } from "solid-js";
import { Check, Download, RefreshCw, X } from "lucide-solid";
import type { CatalogRow } from "~/lib/bank-catalog";
import { isSettingsBackdropClick } from "~/lib/settings-panel";

interface Props {
	/** 当前保存的清单地址（来自设置） */
	manifestUrl: string;
	busy: boolean;
	onSaveUrl: (url: string) => void;
	/** 检查清单（返回带下载/更新/已是最新状态的条目） */
	onCheck: (url: string) => Promise<CatalogRow[]>;
	/** 下载/更新单个条目 */
	onDownload: (row: CatalogRow) => Promise<unknown>;
	onClose: () => void;
}

function stateLabel(row: CatalogRow): string {
	if (row.state === "latest") return "已是最新";
	return row.state === "update" ? "可更新" : "未下载";
}

export default function ManifestUpdateDialog(props: Props) {
	let input!: HTMLInputElement;
	const [url, setUrl] = createSignal(props.manifestUrl);
	const [rows, setRows] = createSignal<CatalogRow[] | null>(null);
	const [checking, setChecking] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);

	const remoteRows = () => (rows() ?? []).filter((row) => row.source === "remote");
	const pending = () =>
		remoteRows().filter((row) => row.state !== "latest");

	const check = async (target = url()) => {
		const trimmed = target.trim();
		props.onSaveUrl(trimmed);
		if (!trimmed) {
			// 留空：只用内置清单，不需要远端检查
			setRows([]);
			setError(null);
			return;
		}
		setChecking(true);
		setError(null);
		try {
			setRows(await props.onCheck(trimmed));
		} catch (err) {
			setRows(null);
			setError(err instanceof Error ? err.message : "检查清单失败，请重试");
		} finally {
			setChecking(false);
		}
	};

	const updateAll = async () => {
		setChecking(true);
		setError(null);
		try {
			for (const row of pending()) {
				await props.onDownload(row);
			}
			await check();
		} catch (err) {
			setError(err instanceof Error ? err.message : "更新词库失败，请重试");
		} finally {
			setChecking(false);
		}
	};

	/** 单条下载/更新（与批量入口同一套错误提示） */
	const downloadOne = async (row: CatalogRow) => {
		setChecking(true);
		setError(null);
		try {
			await props.onDownload(row);
			await check();
		} catch (err) {
			setError(err instanceof Error ? err.message : "下载词库失败，请重试");
		} finally {
			setChecking(false);
		}
	};

	onMount(() => {
		input.focus();
		input.select();
		if (props.manifestUrl.trim()) void check(props.manifestUrl);
	});

	return (
		<div
			class="absolute inset-0 z-40 flex items-center justify-center bg-ink/30 backdrop-blur-sm"
			role="dialog"
			aria-modal="true"
			aria-label="检查清单更新"
			onClick={(event) => {
				if (isSettingsBackdropClick(event)) props.onClose();
			}}
			onKeyDown={(event) => {
				if (event.key === "Escape") {
					event.preventDefault();
					props.onClose();
					return;
				}
				if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
					event.preventDefault();
					void check();
				}
			}}
		>
			<div class="flex max-h-[88%] w-[720px] flex-col gap-3.5 rounded-2xl bg-surface p-7 shadow-xl">
				<div class="flex items-center justify-between">
					<h2 class="font-heading text-2xl text-ink">检查清单更新</h2>
					<button
						type="button"
						class="rounded-full p-2 text-ink-faint transition hover:bg-soft hover:text-ink"
						onClick={props.onClose}
						aria-label="关闭检查清单更新"
					>
						<X class="h-[22px] w-[22px]" />
					</button>
				</div>

				<div class="flex flex-col gap-1.5">
					<span class="text-[13px] text-ink-soft">词库清单地址</span>
					<div class="flex h-10 items-center gap-2 rounded-xl bg-canvas px-3.5">
						<input
							ref={input}
							class="w-full bg-transparent font-data text-[13px] text-ink outline-none placeholder:text-ink-faint"
							placeholder="https://example.com/banks/manifest.json"
							value={url()}
							onInput={(event) => setUrl(event.currentTarget.value)}
						/>
					</div>
					<span class="text-[12px] text-ink-faint">
						留空则只用随包发布的内置清单；自定义地址需为 http(s)，且不能指向本机或内网。
						浏览器端不会直接访问该地址，由本地服务代取。
					</span>
				</div>

				<div class="flex items-center justify-between">
					<span class="text-[13px] text-ink-soft">检查结果</span>
					<Show when={rows()}>
						<span class="text-[12px] text-ink-faint">
							共 {remoteRows().length} 条 · 可更新 {pending().length} 条
						</span>
					</Show>
				</div>

				<div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
					<Show when={error()}>
						<p class="rounded-xl bg-err-bg px-4 py-3 text-[13px] text-err">
							{error()}
						</p>
					</Show>
					<Show
						when={remoteRows().length > 0}
						fallback={
							<p class="rounded-xl bg-canvas px-4 py-3 text-[13px] text-ink-faint">
								{rows() === null
									? "填好地址后点「检查更新」，这里会列出可下载与可更新的词表。"
									: "这个清单里没有可用的词表（或地址留空，只用内置清单）。"}
							</p>
						}
					>
						<For each={remoteRows()}>
							{(row) => (
								<div class="flex items-center gap-3 rounded-xl bg-canvas px-4 py-3">
									<div class="flex min-w-0 flex-1 flex-col">
										<span class="truncate text-[15px] font-semibold text-ink">
											{row.entry.name}
										</span>
										<span class="font-data text-[12px] text-ink-faint">
											{row.entry.count.toLocaleString()} 词 · 远端 v
											{row.entry.version}
											{row.localVersion !== undefined
												? ` · 本地 v${row.localVersion}`
												: ""}
											{row.entry.license ? ` · ${row.entry.license}` : ""}
										</span>
									</div>
									<Show
										when={row.state === "latest"}
										fallback={
											<button
												type="button"
												class="flex items-center gap-1.5 rounded-[10px] bg-brand px-3.5 py-1.5 text-[13px] font-semibold text-white transition hover:brightness-105 disabled:opacity-50"
												disabled={checking() || props.busy}
												onClick={() => void downloadOne(row)}
											>
												<Download class="h-3.5 w-3.5" />
												{row.state === "update" ? "更新" : "下载"}
											</button>
										}
									>
										<span class="flex items-center gap-1 text-[12px] font-semibold text-ok">
											<Check class="h-3.5 w-3.5" />
											{stateLabel(row)}
										</span>
									</Show>
								</div>
							)}
						</For>
					</Show>
				</div>

				<div class="flex items-center justify-between">
					<button
						type="button"
						class="flex items-center gap-1.5 rounded-[10px] bg-canvas px-3.5 py-2 text-[13px] font-semibold text-ink-soft transition hover:text-ink disabled:opacity-50"
						disabled={checking()}
						onClick={() => void check()}
					>
						<RefreshCw class={`h-3.5 w-3.5 ${checking() ? "animate-spin" : ""}`} />
						{checking() ? "检查中…" : "重新检查"}
					</button>
					<button
						type="button"
						class="rounded-[10px] bg-brand px-4 py-2 text-[14px] font-semibold text-white transition hover:brightness-105 disabled:opacity-45"
						disabled={checking() || pending().length === 0}
						onClick={() => void updateAll()}
					>
						更新可用的 {pending().length} 个
					</button>
				</div>

				<p class="text-[12px] text-ink-faint">
					同 id 的资源词表会被整份替换；自建词表不受影响，复习进度也不会丢失。
				</p>
			</div>
		</div>
	);
}
