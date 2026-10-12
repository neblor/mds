/**
 * 今日队列卡（词表模式）
 *
 * 结构性要点（见 .design/mds.md「伸缩与滚动」）：
 * - 这是整个界面**唯一的弹性区**：`flex-1 min-h-0`，卡片本身不随内容长高
 * - 卡头固定（队列规模 + 复习/新词徽标 + 已默进度 + 重新取词），列表体 `overflow-y-auto` 承接溢出
 * - 空态/已完成态在列表体内**居中**，避免“顶部一行字 + 底部一大片空白”
 */
import { For, Show } from "solid-js";
import { Check, RefreshCw } from "lucide-solid";
import type { QueueProgressView, QueueView } from "~/lib/bank-api";

interface Props {
	queue: QueueView | null;
	progress: QueueProgressView | null;
	hasBank: boolean;
	busy: boolean;
	onRefresh: () => void;
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
	const words = () => props.queue?.queue.words ?? [];
	const doneWords = () => new Set(props.queue?.doneWords ?? []);
	const reviewCount = () => props.queue?.queue.reviews.length ?? 0;
	const freshCount = () => props.queue?.queue.fresh.length ?? 0;
	const done = () => props.progress?.done ?? 0;
	const target = () => props.progress?.target ?? props.queue?.queue.target ?? 0;

	return (
		<div class="flex min-h-0 flex-1 flex-col gap-3 rounded-2xl bg-surface p-4 shadow-sm">
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-2.5">
					<span class="text-[13px] text-ink-soft">
						今日队列 · {words().length} 词
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
						已默 {done()} / {target()}
					</span>
					<button
						type="button"
						class="flex items-center gap-1 rounded-full px-2 py-1 text-[12px] text-ink-faint transition hover:bg-soft hover:text-ink disabled:opacity-40"
						onClick={props.onRefresh}
						disabled={props.busy}
					>
						<RefreshCw class="h-4 w-4" />
						重新取词
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
								<p class="text-center text-[13px] text-ink-faint">
									{target() > 0 && done() >= target()
										? `今天的 ${target()} 个已经默完了，明天见 ✨`
										: "这个词表暂时没有要默的词：可以先加点词，或把数量调大一点。"}
								</p>
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
