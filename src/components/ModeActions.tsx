/**
 * 模式操作区：主界面「默写内容」滑块右侧，按当前模式显示对应的操作。
 *
 * 目前只有短句模式有操作——`更新短句`：清掉当前这批词的短句缓存
 * （`sentences.json` 里的对应条目），下次准备时重新向 AI 生句。
 * 以后哪个模式要加操作，就在这里加分支，不要再往控制条上堆按钮。
 */
import { Show, createEffect, createSignal } from "solid-js";
import { LayoutGrid, Loader2, RefreshCw } from "lucide-solid";
import { refreshSentences } from "~/lib/api";
import { sentenceRefreshMessage } from "~/lib/mode-actions";
import type { ContentMode } from "~/lib/state";

interface Props {
	contentMode: ContentMode;
	/** 本次默写要用的词（词表模式 = 本次取的词）；为空表示还没有可更新的词 */
	queueWords: string[];
	/** 音标模式：打开全屏音标表 */
	onOpenChart?: () => void;
}

export default function ModeActions(props: Props) {
	const [busy, setBusy] = createSignal(false);
	const [note, setNote] = createSignal<{
		text: string;
		error: boolean;
	} | null>(null);

	// 离开短句模式就清掉上次的提示，避免下次切回来看到过期结果
	createEffect(() => {
		if (props.contentMode !== "sentence") setNote(null);
	});

	const canRefresh = () => !busy() && props.queueWords.length > 0;

	const refresh = async () => {
		if (!canRefresh()) return;
		const words = props.queueWords;
		setBusy(true);
		setNote(null);
		try {
			const removed = await refreshSentences(words);
			setNote({
				text: sentenceRefreshMessage(removed, words.length),
				error: false,
			});
		} catch (error) {
			setNote({
				text: error instanceof Error ? error.message : "清短句缓存失败，请重试",
				error: true,
			});
		} finally {
			setBusy(false);
		}
	};

	return (
		<>
			<Show when={props.contentMode === "phonetic"}>
				<div class="flex min-w-0 flex-1 items-center gap-2">
					<button
						type="button"
						class="flex shrink-0 items-center gap-1.5 rounded-xl border-[1.5px] border-soft bg-surface px-3 py-2 text-[13px] font-semibold text-ink-soft shadow-sm transition hover:border-brand/40 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
						onClick={() => props.onOpenChart?.()}
						title="全屏查看音标表（F1）"
					>
						<LayoutGrid class="h-4 w-4" />
						音标表
					</button>
					<span class="shrink-0 rounded-md bg-soft px-1.5 py-0.5 font-data text-[11px] text-ink-faint">
						F1
					</span>
				</div>
			</Show>
			<Show when={props.contentMode === "sentence"}>
				<div class="flex min-w-0 flex-1 items-center gap-3">
				<button
					type="button"
					class="flex shrink-0 items-center gap-1.5 rounded-xl border-[1.5px] border-soft bg-surface px-3 py-2 text-[13px] font-semibold text-ink-soft shadow-sm transition hover:border-brand/40 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-45"
					disabled={!canRefresh()}
					title={
						props.queueWords.length === 0
							? "还没有可用的词：先选好词表，或把「本次默」的数量调大后重新取词"
							: "清掉队列里这些词的短句缓存，下次准备时生成新短句"
					}
					onClick={() => void refresh()}
				>
					<Show when={busy()} fallback={<RefreshCw class="h-4 w-4" />}>
						<Loader2 class="h-4 w-4 animate-spin" />
					</Show>
					更新短句
				</button>
				<Show when={note()}>
					{(value) => (
						<span
							class={`min-w-0 flex-1 truncate text-[12px] ${
								value().error ? "text-err" : "text-ink-faint"
							}`}
							title={value().text}
						>
							{value().text}
						</span>
					)}
				</Show>
				</div>
			</Show>
		</>
	);
}
