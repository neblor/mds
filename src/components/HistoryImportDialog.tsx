/**
 * 从历史默写记录导入词汇（词表详情页的入口）
 *
 * 每场记录一行：时间 + 模式 + 词数 + 「导入」；导入的词会自动去重。
 * 键盘：打开即聚焦首个可交互项，Esc 关闭。
 */
import { For, Show, onMount } from "solid-js";
import { X } from "lucide-solid";
import type { HistoryEntry } from "~/lib/history-storage";
import { formatHistoryTime } from "~/lib/history-dialog";
import { extractHistoryWords } from "~/lib/history-screen";
import { CONTENT_MODE_LABELS } from "~/lib/results";
import { isSettingsBackdropClick } from "~/lib/settings-panel";

interface Props {
	entries: HistoryEntry[];
	busy: boolean;
	onImport: (words: string[]) => void;
	onClose: () => void;
}

export default function HistoryImportDialog(props: Props) {
	let firstButton: HTMLButtonElement | undefined;
	onMount(() => requestAnimationFrame(() => firstButton?.focus()));

	const rows = () =>
		props.entries
			.map((entry) => ({ entry, words: extractHistoryWords(entry) }))
			.filter((row) => row.words.length > 0);

	return (
		<div
			class="absolute inset-0 z-40 flex items-center justify-center bg-ink/30 backdrop-blur-sm"
			role="dialog"
			aria-modal="true"
			aria-label="从历史记录导入"
			onClick={(event) => {
				if (isSettingsBackdropClick(event)) props.onClose();
			}}
			onKeyDown={(event) => {
				if (event.key === "Escape") {
					event.preventDefault();
					props.onClose();
				}
			}}
		>
			<div class="flex max-h-[80%] w-[560px] flex-col gap-3.5 rounded-2xl bg-surface p-7 shadow-xl">
				<div class="flex items-center justify-between">
					<h2 class="font-heading text-2xl text-ink">从历史记录导入</h2>
					<button
						type="button"
						class="rounded-full p-2 text-ink-faint transition hover:bg-soft hover:text-ink"
						onClick={props.onClose}
						aria-label="关闭"
					>
						<X class="h-[22px] w-[22px]" />
					</button>
				</div>

				<Show
					when={rows().length > 0}
					fallback={
						<p class="py-6 text-center text-[13px] text-ink-faint">
							还没有可导入的默写记录
						</p>
					}
				>
					<div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
						<For each={rows()}>
							{(row, index) => (
								<div class="flex items-center gap-3 rounded-xl bg-canvas px-3.5 py-2.5">
									<span class="font-data text-[13px] text-ink">
										{formatHistoryTime(row.entry.finishedAt)}
									</span>
									<span class="rounded-full bg-soft px-2.5 py-[2px] text-[12px] text-ink-soft">
										{row.entry.mode === "writing" ? "书写" : "赛博"} ·{" "}
										{CONTENT_MODE_LABELS[row.entry.contentMode]}
									</span>
									<span class="text-[12px] text-ink-faint">
										{row.words.length} 词
									</span>
									<span class="flex-1" />
									<button
										type="button"
										ref={(el) => {
											if (index() === 0) firstButton = el;
										}}
										class="rounded-[10px] bg-brand px-3.5 py-1.5 text-[12px] font-semibold text-white transition hover:brightness-105 disabled:opacity-45"
										disabled={props.busy}
										onClick={() => props.onImport(row.words)}
									>
										导入
									</button>
								</div>
							)}
						</For>
					</div>
					<p class="text-right text-xs text-ink-faint">
						导入的词会自动去重；可在词表里再删
					</p>
				</Show>
			</div>
		</div>
	);
}
