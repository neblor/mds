/**
 * 本次取词卡（词表模式）
 *
 * 语义（2026-10-24 更正）：上方的数字是**这一批取几个词**，不是「今天一共默几个」。
 * 所以「重新取词」= 按当前数字再取一批；跨批次不设「今日额度」。
 * 进度 `已默 x / N` 的两个数必须来自**同一批**（`progress.size` / `progress.done`）。
 *
 * 结构性要点（见 .design/mds.md「伸缩与滚动」）：
 * - 这是整个界面**唯一的弹性区**：`flex-1 min-h-0`，卡片本身不随内容长高
 * - 卡头固定（本批规模 + 复习/新词徽标 + 已默进度 + 重新取词），列表体 `overflow-y-auto` 承接溢出
 * - 空态/已完成态在列表体内**居中**，避免“顶部一行字 + 底部一大片空白”
 */
import { For, Show, createSignal, onCleanup } from "solid-js";
import { Check, RefreshCw } from "lucide-solid";
import type { QueueProgressView, QueueView } from "~/lib/bank-api";

interface Props {
	queue: QueueView | null;
	progress: QueueProgressView | null;
	/** 本批已默词（与 daily 统计无关） */
	batchDone: string[];
	hasBank: boolean;
	busy: boolean;
	onRefresh: () => void | Promise<void>;
	onOpenPicker: () => void;
	onNewBank: () => void;
}

function QueueChip(props: { word: string; done: boolean }) {
	return (
		<span
			class={`flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm ${
				props.done
					? "bg-soft text-ink-faint"
					: "bg-[#EDF3F2] text-ink"
			}`}
		>
			<Show when={props.done}>
				<Check class="h-3 w-3 text-ok" />
			</Show>
			{props.word}
		</span>
	);
}

export default function TodayQueueCard(props: Props) {
	const [refreshing, setRefreshing] = createSignal(false);
	const [justRefreshed, setJustRefreshed] = createSignal(false);
	let refreshedTimer: number | undefined;
	onCleanup(() => {
		if (refreshedTimer !== undefined) window.clearTimeout(refreshedTimer);
	});
	const refresh = async () => {
		if (props.busy || refreshing()) return;
		setRefreshing(true);
		try {
			await props.onRefresh();
			setJustRefreshed(true);
			if (refreshedTimer !== undefined) window.clearTimeout(refreshedTimer);
			refreshedTimer = window.setTimeout(() => {
				setJustRefreshed(false);
				refreshedTimer = undefined;
			}, 1500);
		} finally {
			setRefreshing(false);
		}
	};

	const refreshLabel = () => {
		if (refreshing()) return "刷新中…";
		return justRefreshed() ? "已刷新" : "重新取词";
	};
	const words = () => props.queue?.queue.words ?? [];
	const doneWords = () => new Set(props.batchDone);
	const reviewCount = () => props.queue?.queue.reviews.length ?? 0;
	const freshCount = () => props.queue?.queue.fresh.length ?? 0;
	/** 本批已默（与 size 同一批） */
	const done = () => props.progress?.done ?? 0;
	const size = () => props.progress?.size ?? props.queue?.queue.size ?? 0;
	/** 今天累计练过多少词（统计侧：按场次词数求和，可跨批次） */
	const todayDone = () => props.progress?.todayWords ?? 0;

	return (
		<div class="flex min-h-0 flex-1 flex-col gap-3 rounded-2xl bg-surface p-4 shadow-sm">
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-2.5">
					<span class="text-[13px] text-ink-soft">
						本次取词 · {words().length} 词
					</span>
					<Show when={reviewCount() > 0}>
						<span class="rounded-full bg-brand/10 px-2.5 py-[2px] text-[12px] text-brand">
							复习 {reviewCount()}
						</span>
					</Show>
					<Show when={freshCount() > 0}>
						<span class="rounded-full bg-gold/25 px-2.5 py-[2px] text-[12px] text-[#8A6410]">
							新词 {freshCount()}
						</span>
					</Show>
				</div>
				<div class="flex items-center gap-1">
					<span class="font-data text-[13px] text-ink-soft tabular-nums">
						已默 {done()} / {size()}
					</span>
					<button
						type="button"
						class="flex items-center gap-1 rounded-full px-2 py-1 text-[12px] text-ink-faint transition hover:bg-soft hover:text-ink disabled:opacity-40"
						onClick={() => void refresh()}
						disabled={props.busy || refreshing() || !props.hasBank}
						title={
							!props.hasBank
								? "先选择一个词表"
								: "按「本次默」的数量再取一批词：必默词保留，其余随机更换；候选不足时全取（不改卡片状态）"
						}
						aria-busy={refreshing()}
					>
						<RefreshCw
							class={`h-4 w-4 ${refreshing() ? "animate-spin" : ""}`}
						/>
						{refreshLabel()}
					</button>
				</div>
			</div>

			<div class="min-h-0 flex-1 overflow-y-auto">
				<Show
					when={words().length > 0}
					fallback={
						<div class="flex h-full flex-col items-center justify-center gap-3">
							<Show
								when={props.hasBank}
								fallback={
									<>
										<p class="text-center text-[13px] text-ink-faint">
											还没有词表：先新建一个自建词表，或从资源词表里下载一个。
										</p>
										<div class="flex items-center gap-2">
											<button
												type="button"
												class="rounded-xl bg-brand px-4 py-2 text-[13px] font-semibold text-white transition hover:brightness-105"
												onClick={props.onNewBank}
											>
												新建词表
											</button>
											<button
												type="button"
												class="rounded-xl border-[1.5px] border-soft px-4 py-2 text-[13px] font-semibold text-ink-soft transition hover:border-brand/40 hover:text-ink"
												onClick={props.onOpenPicker}
											>
												选择词表
											</button>
										</div>
									</>
								}
							>
								{/* 跨批次累计只在这里说明，不参与上面的 x / N */}
								<p class="text-center text-[13px] text-ink-faint">
									这个词表暂时没有可取的词了：新词已经取完，学过的词还没到复习时间。
								</p>
								<Show when={todayDone() > 0}>
									<p class="text-center text-[12px] text-ink-faint/80">
										今天已经练了 {todayDone()} 个词
									</p>
								</Show>
							</Show>
						</div>
					}
				>
					<div class="flex flex-wrap gap-2">
						<For each={words()}>
							{(word) => <QueueChip word={word} done={doneWords().has(word)} />}
						</For>
					</div>
				</Show>
			</div>
		</div>
	);
}
