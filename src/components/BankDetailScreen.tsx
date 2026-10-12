/**
 * 词表详情（对应设计稿 22 自建 / 23 资源）
 *
 * - 自建词表：可改名、可删词表、可加词（回车）、可批量导入、可从录入的词/历史记录导入
 * - 资源词表：只读，顶部提示条 + 「复制为自建词表」
 * - 词表几千词不可能一次全给前端：按 limit 分页，「加载更多」继续取
 * - 结构性要点：词列表是弹性区（flex-1 min-h-0 + 内部滚动），页脚提示始终贴底
 */
import { For, Show, createEffect, createSignal, onMount } from "solid-js";
import { ArrowLeft, Copy, Info, PenLine, Pencil, Plus, Trash2, Upload, X } from "lucide-solid";
import type { BankDetail } from "~/lib/bank-api";
import { loadHistory, type HistoryEntry } from "~/lib/history-storage";
import type { WordBanksApi } from "~/lib/use-wordbanks";
import { isEditableSource } from "~/lib/bank-types";
import HistoryImportDialog from "~/components/HistoryImportDialog";

const PAGE_SIZE = 300;

interface Props {
	bankId: string;
	api: WordBanksApi;
	/** 录入模式当前的词（「从录入的词加入」用） */
	entryWords: string[];
	onBack: () => void;
}

export default function BankDetailScreen(props: Props) {
	const [detail, setDetail] = createSignal<BankDetail | null>(null);
	const [loadError, setLoadError] = createSignal<string | null>(null);
	const [limit, setLimit] = createSignal(PAGE_SIZE);
	const [addInput, setAddInput] = createSignal("");
	const [hint, setHint] = createSignal<string | null>(null);
	const [renaming, setRenaming] = createSignal(false);
	const [nameDraft, setNameDraft] = createSignal("");
	const [confirmDelete, setConfirmDelete] = createSignal(false);
	const [historyOpen, setHistoryOpen] = createSignal(false);
	// 历史记录从 localStorage 现取（仅用户点开导入弹层时读一次，避免 SSR 首帧不一致）
	const [historyEntries, setHistoryEntries] = createSignal<HistoryEntry[]>([]);

	const load = async (nextLimit = limit()) => {
		try {
			const data = await props.api.loadDetail(props.bankId, {
				limit: nextLimit,
			});
			setDetail(data);
			setLoadError(null);
			setLimit(nextLimit);
		} catch (error) {
			setDetail(null);
			setLoadError(error instanceof Error ? error.message : "无法读取词表");
		}
	};

	onMount(() => void load());
	// 切换词表（例如复制为自建后）重新拉取
	createEffect(() => {
		const id = props.bankId;
		if (id) void load(PAGE_SIZE);
	});

	const editable = () =>
		detail() ? isEditableSource(detail()!.bank.source) : false;

	async function addWords(words: string[], successText: string) {
		if (words.length === 0) {
			setHint("没有可加入的词");
			return;
		}
		try {
			const result = await props.api.editWords({
				bankId: props.bankId,
				add: words,
			});
			setHint(
				`${successText}：新增 ${result.added} 个${
					result.duplicated > 0 ? `，重复 ${result.duplicated} 个已忽略` : ""
				}`,
			);
			await load();
		} catch (error) {
			setHint(error instanceof Error ? error.message : "加入失败");
		}
	}

	const removeWord = async (word: string) => {
		try {
			await props.api.editWords({ bankId: props.bankId, remove: [word] });
			await load();
		} catch (error) {
			setHint(error instanceof Error ? error.message : "删除失败");
		}
	};

	const submitName = async () => {
		const name = nameDraft().trim();
		setRenaming(false);
		if (!name || name === detail()?.bank.name) return;
		try {
			await props.api.editWords({ bankId: props.bankId, name });
			await load();
		} catch (error) {
			setHint(error instanceof Error ? error.message : "改名失败");
		}
	};

	const copyAsCustom = async () => {
		try {
			const bank = await props.api.copyAsCustom(props.bankId);
			setHint(`已复制为自建词表「${bank.name}」`);
		} catch (error) {
			setHint(error instanceof Error ? error.message : "复制失败");
		}
	};

	const destroy = async () => {
		setConfirmDelete(false);
		try {
			await props.api.deleteBank(props.bankId);
			props.onBack();
		} catch (error) {
			setHint(error instanceof Error ? error.message : "删除失败");
		}
	};

	return (
		<div
			class="flex h-full flex-col gap-4 bg-canvas p-7"
			tabIndex={-1}
			onKeyDown={(event) => {
				if (event.key === "Escape" && !historyOpen()) {
					event.preventDefault();
					props.onBack();
				}
			}}
		>
			{/* 头部 */}
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-3">
					<button
						type="button"
						class="rounded-full p-1.5 text-ink-soft transition hover:bg-soft hover:text-ink"
						onClick={props.onBack}
						aria-label="返回"
					>
						<ArrowLeft class="h-[22px] w-[22px]" />
					</button>
					<div class="flex flex-col gap-0.5">
						<Show
							when={renaming()}
							fallback={
								<h2 class="font-heading text-2xl text-ink">
									{detail()?.bank.name ?? "词表"}
								</h2>
							}
						>
							<input
								ref={(el) => requestAnimationFrame(() => el.focus())}
								class="rounded-lg border border-brand bg-surface px-2.5 py-1 font-heading text-xl text-ink outline-none"
								value={nameDraft()}
								onInput={(event) => setNameDraft(event.currentTarget.value)}
								onBlur={submitName}
								onKeyDown={(event) => {
									if (event.key === "Enter") {
										event.preventDefault();
										void submitName();
									} else if (event.key === "Escape") {
										event.stopPropagation();
										setRenaming(false);
									}
								}}
							/>
						</Show>
						<p class="text-[13px] text-ink-faint">
							{editable() ? "自建词表 · 可编辑" : "资源词表 · 只读"} ·{" "}
							{detail()?.bank.count ?? 0} 词
						</p>
					</div>
				</div>
				<div class="flex items-center gap-2">
					<Show
						when={editable()}
						fallback={
							<>
								<span class="rounded-full bg-soft px-3 py-1 text-[12px] text-ink-soft">
									只读
								</span>
								<button
									type="button"
									class="flex items-center gap-1.5 rounded-xl bg-brand px-3.5 py-2 text-[13px] font-semibold text-white transition hover:brightness-105 disabled:opacity-45"
									disabled={props.api.busy()}
									onClick={copyAsCustom}
								>
									<Copy class="h-4 w-4" />
									复制为自建词表
								</button>
							</>
						}
					>
						<button
							type="button"
							class="flex items-center gap-1.5 rounded-xl border-[1.5px] border-soft bg-surface px-3 py-2 text-[13px] font-semibold text-ink-soft transition hover:border-brand/40 hover:text-ink"
							onClick={() => {
								setNameDraft(detail()?.bank.name ?? "");
								setRenaming(true);
							}}
						>
							<Pencil class="h-4 w-4" />
							改名
						</button>
						<Show
							when={confirmDelete()}
							fallback={
								<button
									type="button"
									class="flex items-center gap-1.5 rounded-xl bg-err-bg px-3 py-2 text-[13px] font-semibold text-err transition hover:brightness-95"
									onClick={() => setConfirmDelete(true)}
								>
									<Trash2 class="h-4 w-4" />
									删除词表
								</button>
							}
						>
							<span class="text-[12px] text-err">同时清除复习进度，确定？</span>
							<button
								type="button"
								class="rounded-xl bg-err px-3 py-2 text-[13px] font-semibold text-white"
								onClick={destroy}
							>
								确定删除
							</button>
							<button
								type="button"
								class="rounded-xl border-[1.5px] border-soft px-3 py-2 text-[13px] text-ink-soft"
								onClick={() => setConfirmDelete(false)}
							>
								取消
							</button>
						</Show>
					</Show>
				</div>
			</div>

			{/* 只读提示 */}
			<Show when={!editable() && detail()}>
				<div class="flex items-center gap-2 rounded-xl bg-brand/10 px-4 py-3">
					<Info class="h-4 w-4 shrink-0 text-brand" />
					<p class="text-[13px] text-ink">
						资源词表随包提供，不能编辑或删词；想要自己的版本，请先「复制为自建词表」。
					</p>
				</div>
			</Show>

			{/* 加词（仅自建） */}
			<Show when={editable()}>
				<div class="flex items-center gap-2.5 rounded-2xl bg-surface px-4 py-3.5 shadow-sm">
					<PenLine class="h-5 w-5 shrink-0 text-brand" />
					<input
						class="w-full bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-faint"
						placeholder="输入单词或词组，回车添加…"
						value={addInput()}
						onInput={(event) => setAddInput(event.currentTarget.value)}
						onKeyDown={(event) => {
							if (event.key !== "Enter") return;
							event.preventDefault();
							const word = addInput().trim();
							if (!word) return;
							setAddInput("");
							void addWords([word], "已加入");
						}}
					/>
					<button
						type="button"
						class="flex shrink-0 items-center gap-1.5 rounded-xl bg-brand px-3 py-2 text-[13px] font-semibold text-white transition hover:brightness-105"
						onClick={() => {
							const word = addInput().trim();
							if (!word) return;
							setAddInput("");
							void addWords([word], "已加入");
						}}
					>
						<Plus class="h-4 w-4" />
						添加
					</button>
				</div>
			</Show>

			{/* 导入入口（仅自建） */}
			<Show when={editable()}>
				<div class="flex items-center gap-2.5">
					<button
						type="button"
						class="flex items-center gap-1.5 rounded-xl bg-brand/10 px-3.5 py-2 text-[13px] font-semibold text-brand transition hover:bg-brand/20 disabled:opacity-45"
						disabled={props.entryWords.length === 0 || props.api.busy()}
						onClick={() => void addWords(props.entryWords, "已从录入的词加入")}
					>
						<Plus class="h-4 w-4" />
						从录入的词加入（{props.entryWords.length}）
					</button>
					<button
						type="button"
						class="flex items-center gap-1.5 rounded-xl bg-brand/10 px-3.5 py-2 text-[13px] font-semibold text-brand transition hover:bg-brand/20 disabled:opacity-45"
						disabled={props.api.busy()}
						onClick={() => {
							setHistoryEntries(loadHistory());
							setHistoryOpen(true);
						}}
					>
						<Upload class="h-4 w-4" />
						从历史记录导入
					</button>
					<Show when={hint()}>
						<span class="truncate text-[12px] text-ink-soft">{hint()}</span>
					</Show>
				</div>
			</Show>

			{/* 词列表（弹性区） */}
			<div class="flex min-h-0 flex-1 flex-col gap-3 rounded-2xl bg-surface p-4 shadow-sm">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-2.5">
						<span class="text-[13px] text-ink-soft">
							{editable()
								? `${detail()?.bank.count ?? 0} 词`
								: `${detail()?.bank.count ?? 0} 词 · 按词频排序`}
						</span>
						<Show when={editable()}>
							<span class="text-[12px] text-ink-faint">点右侧 × 删除</span>
						</Show>
					</div>
					<span class="text-[12px] text-ink-faint">
						已显示 {detail()?.entries.length ?? 0} 个
					</span>
				</div>
				<div class="min-h-0 flex-1 overflow-y-auto">
					<Show
						when={(detail()?.entries.length ?? 0) > 0}
						fallback={
							<div class="flex h-full items-center justify-center">
								<p class="text-center text-[13px] text-ink-faint">
									{loadError() ?? "这个词表还没有词：用上面的输入框加几个吧"}
								</p>
							</div>
						}
					>
						<div class="flex flex-wrap gap-2">
							<For each={detail()?.entries ?? []}>
								{(entry) => (
									<span class="flex items-center gap-1.5 rounded-full bg-[#EDF3F2] px-3.5 py-2 text-sm text-ink">
										{entry.word}
										<Show when={editable()}>
											<button
												type="button"
												class="text-ink-faint transition hover:text-err"
												onClick={() => void removeWord(entry.word)}
												aria-label={`删除 ${entry.word}`}
											>
												<X class="h-3 w-3" />
											</button>
										</Show>
									</span>
								)}
							</For>
						</div>
						<Show when={(detail()?.entries.length ?? 0) < (detail()?.total ?? 0)}>
							<button
								type="button"
								class="mt-3 w-full rounded-xl border-[1.5px] border-soft py-2 text-[13px] text-ink-soft transition hover:border-brand/40 hover:text-ink"
								onClick={() => void load(limit() + PAGE_SIZE)}
							>
								加载更多（还有{" "}
								{(detail()?.total ?? 0) - (detail()?.entries.length ?? 0)} 个）
							</button>
						</Show>
					</Show>
				</div>
			</div>

			<p class="text-[12px] text-ink-faint">
				{editable()
					? "自建词表里的词会进入每日复习队列（按 FSRS-6 算法排期）"
					: "选定该词表后，默写内容由 FSRS-6 排期决定，你只需定「今天默几个」"}
			</p>

			<Show when={historyOpen()}>
				<HistoryImportDialog
					entries={historyEntries()}
					busy={props.api.busy()}
					onImport={(words) => {
						setHistoryOpen(false);
						void addWords(words, "已从历史记录加入");
					}}
					onClose={() => setHistoryOpen(false)}
				/>
			</Show>
		</div>
	);
}
