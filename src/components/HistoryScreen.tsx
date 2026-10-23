import { For, Show, createSignal, onMount } from "solid-js";
import { RotateCcw, ScrollText, X } from "lucide-solid";
import ResultsView from "~/components/ResultsView";
import { createResultAudioPlayer } from "~/lib/result-audio";
import { loadHistory, type HistoryEntry } from "~/lib/history-storage";
import { CONTENT_MODE_LABELS } from "~/lib/results";
import { formatHistoryTime, historyEscapeAction } from "~/lib/history-dialog";
import {
	HISTORY_PREVIEW_MAX,
	canRetryHistory,
	extractHistoryWords,
} from "~/lib/history-screen";

interface Props {
	onClose: () => void;
	/** 再次默写：回传该场历史提取出的词汇列表，由外层覆盖当前词表 */
	onRetry: (words: string[]) => void;
}

/**
 * 默写记录全屏界面（列表 ⇄ 详情两级）：
 * - 取代旧弹窗，占满 1120px 应用框；Esc 分层：详情返回列表、列表关闭
 * - 书写与赛博都记录；书写条目无评分（结算回看仅对照，无对错提示）
 * - 列表条目：日期时间 + 模式徽标 + 词汇胶囊预览（上限截断 + 渐变淡出）
 *   + 正确率（书写显示「— / N」），右侧「结算画面」「再次默写」两个入口；
 *   无可提取词汇的老数据不显示词汇区、也不提供再次默写
 */
export default function HistoryScreen(props: Props) {
	const [selected, setSelected] = createSignal<HistoryEntry | null>(null);
	const entries = loadHistory();
	const audio = createResultAudioPlayer();

	let container: HTMLDivElement | undefined;
	onMount(() => container?.focus());
	/** 视图切换会卸载刚点击的按钮，焦点会回落 body 导致 Esc 收不到；拉回容器 */
	const refocus = () => requestAnimationFrame(() => container?.focus());

	const close = () => {
		audio.stop();
		props.onClose();
	};
	const back = () => {
		audio.stop();
		setSelected(null);
		refocus();
	};
	const openDetail = (entry: HistoryEntry) => {
		setSelected(entry);
		refocus();
	};
	const retry = (entry: HistoryEntry) => {
		audio.stop();
		const words = extractHistoryWords(entry);
		if (words.length === 0) return;
		props.onRetry(words);
	};

	return (
		<div
			ref={container}
			tabIndex={-1}
			class="absolute inset-0 z-30 flex flex-col bg-canvas p-7 outline-none"
			role="dialog"
			aria-modal="true"
			aria-label="默写记录"
			onKeyDown={(event) => {
				if (event.key === "Escape") {
					event.preventDefault();
					if (historyEscapeAction(selected() !== null) === "back") back();
					else close();
				}
			}}
		>
			<Show
				when={selected()}
				fallback={
					<div class="flex min-h-0 flex-1 flex-col gap-5">
						<div class="flex shrink-0 items-center justify-between">
							<div class="flex flex-col gap-0.5">
								<h2 class="font-heading text-2xl text-ink">默写记录</h2>
								<p class="text-[13px] text-ink-faint">
									最近几场的战绩 · 可回看结算或用当时的词表再默一次
								</p>
							</div>
							<button
								type="button"
								class="rounded-full p-2 text-ink-faint transition hover:bg-soft hover:text-ink"
								onClick={close}
								aria-label="关闭默写记录"
							>
								<X class="h-[22px] w-[22px]" />
							</button>
						</div>

						<Show
							when={entries.length > 0}
							fallback={
								<div class="flex flex-1 flex-col items-center justify-center gap-2">
									<p class="py-6 text-center text-[13px] leading-relaxed text-ink-faint">
										还没有默写记录
										<br />
										完成一场默写后，这里会保留最近 5 场的记录
									</p>
									<p class="text-xs text-ink-faint">Esc 关闭</p>
								</div>
							}
						>
							<div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
								<For each={entries}>
									{(e) => {
										const words = extractHistoryWords(e);
										const preview = words.slice(0, HISTORY_PREVIEW_MAX);
										return (
											<article class="flex flex-col gap-3 rounded-2xl bg-surface p-4 shadow-sm">
												<div class="flex items-center justify-between gap-3">
													<div class="flex min-w-0 items-center gap-2.5">
														<span class="font-data text-sm text-ink">
															{formatHistoryTime(e.finishedAt)}
														</span>
														<span class="rounded-full bg-soft px-2.5 py-[3px] text-xs text-ink-soft">
															{e.mode === "writing" ? "书写" : "赛博"} ·{" "}
															{CONTENT_MODE_LABELS[e.contentMode]}
														</span>
													</div>
													<Show
														when={e.mode === "cyber"}
														fallback={
															<span
																class="shrink-0 font-data text-base text-ink-faint"
																title="书写模式不评分"
															>
																— / {e.wordCount}
															</span>
														}
													>
														<span
															class="shrink-0 font-data text-base text-ink"
															aria-label={`正确率 ${e.correctCount} / ${e.wordCount}`}
														>
															{e.correctCount} / {e.wordCount}
														</span>
													</Show>
												</div>

												<Show when={preview.length > 0}>
													<div class="relative overflow-hidden">
														<div class="flex max-h-[74px] flex-wrap gap-1.5">
															<For each={preview}>
																{(w) => (
																	<span class="rounded-full bg-[#EDF3F2] px-3 py-1 text-[13px] text-ink">
																		{w}
																	</span>
																)}
															</For>
														</div>
														<Show
															when={words.length > HISTORY_PREVIEW_MAX}
														>
															<div class="pointer-events-none absolute inset-x-0 bottom-0 h-7 bg-gradient-to-t from-surface to-transparent" />
														</Show>
													</div>
												</Show>

												<div class="flex items-center justify-end gap-2">
													<button
														type="button"
														class="flex items-center gap-1.5 rounded-xl border-[1.5px] border-soft bg-canvas px-3 py-2 text-[13px] font-semibold text-ink-soft transition hover:border-brand/40 hover:text-ink active:scale-[0.98]"
														onClick={() => openDetail(e)}
													>
														<ScrollText class="h-4 w-4 text-brand" />
														结算画面
													</button>
													<Show when={canRetryHistory(e)}>
														<button
															type="button"
															class="flex items-center gap-1.5 rounded-xl bg-brand px-3 py-2 text-[13px] font-semibold text-white shadow-sm transition hover:brightness-105 active:scale-[0.98]"
															onClick={() => retry(e)}
														>
															<RotateCcw class="h-4 w-4" />
															再次默写
														</button>
													</Show>
												</div>
											</article>
										);
									}}
								</For>
							</div>
							<p class="shrink-0 text-right text-xs text-ink-faint">
								Esc 关闭 · 再次默写会把当时的词表回填到主界面
							</p>
						</Show>
					</div>
				}
			>
				{(entry) => (
					<div class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-surface shadow-sm">
						<ResultsView
							rows={entry().rows}
							mode={entry().mode}
							contentMode={entry().contentMode}
							gradeNote={entry().gradeNote}
							playingAudioName={audio.playingName()}
							onPlayAudio={audio.play}
							onStopAudio={audio.stop}
							onClose={back}
							title={`默写结果 · ${entry().mode === "writing" ? "书写" : "赛博"} · ${CONTENT_MODE_LABELS[entry().contentMode]}`}
							footerHint="Esc 或关闭按钮返回默写记录"
							class="flex-1"
						/>
					</div>
				)}
			</Show>
		</div>
	);
}
