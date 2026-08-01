import { For, Show, createMemo } from "solid-js";
import { Check, X, Sparkles, Star } from "lucide-solid";

export interface ResultRow {
	word: string;
	definition?: string;
	answer?: string;
	answerDef?: string;
	/** 仅赛博模式有判断 */
	correct?: boolean;
}

interface Props {
	rows: ResultRow[];
	mode: "writing" | "cyber";
	withDefinition: boolean;
	onClose: () => void;
}

export default function ResultsView(props: Props) {
	const correctCount = createMemo(
		() => props.rows.filter((r) => r.correct === true).length,
	);
	const allCorrect = createMemo(
		() => props.mode === "cyber" && correctCount() === props.rows.length,
	);

	return (
		<div class="flex h-full flex-col gap-4 p-7">
			{/* 头部：标题 + 得分 + 关闭（结果页只有一个关闭动作，回车也可关闭） */}
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-4">
					<h2 class="font-heading text-2xl text-ink">默写结果</h2>
					<Show when={props.mode === "cyber"}>
						<span class="rounded-full bg-soft px-4 py-2 font-data text-xl text-ink">
							{correctCount()} / {props.rows.length}
						</span>
					</Show>
				</div>
				<button type="button"
					class="flex items-center gap-1 rounded-full bg-surface px-4 py-2 text-sm text-ink-soft shadow-sm transition hover:text-ink"
					onClick={props.onClose}
					aria-label="关闭"
				>
					关闭
					<X class="h-[18px] w-[18px]" />
				</button>
			</div>

			{/* 全对庆祝 */}
			<Show when={allCorrect()}>
				<div class="pointer-events-none absolute inset-0 z-10 flex items-start justify-center overflow-hidden">
					{[0, 1, 2, 3, 4, 5].map((i) => (
						<span
							class="celebrate-star absolute text-gold"
							style={{
								left: `${12 + i * 15}%`,
								top: "38%",
								"animation-delay": `${i * 0.18}s`,
							}}
						>
							<Star class="h-8 w-8" fill="currentColor" strokeWidth={1} />
						</span>
					))}
					<span
						class="celebrate-star absolute top-[30%] text-gold"
						style={{ left: "47%" }}
					>
						<Sparkles class="h-10 w-10" />
					</span>
				</div>
			</Show>

			{/* 对照列表 */}
			<div class="flex flex-col gap-2.5 overflow-y-auto pr-1">
				<For each={props.rows}>
					{(r) => (
						<div
							class={`flex items-center gap-3 rounded-lg px-4 py-3 ${
								props.mode === "cyber" && r.correct === true
									? "bg-ok-bg"
									: props.mode === "cyber" && r.correct === false
										? "bg-err-bg"
										: "bg-surface shadow-sm"
							}`}
						>
							<Show when={props.mode === "cyber"}>
								{r.correct ? (
									<Check class="h-4 w-4 shrink-0 text-ok" />
								) : (
									<X class="h-4 w-4 shrink-0 text-err" />
								)}
							</Show>
							<div class="flex min-w-0 flex-1 flex-col">
								<span class="text-base font-semibold text-ink">{r.word}</span>
								<Show when={r.definition}>
									<span class="truncate text-[13px] text-ink-faint">
										{r.definition}
									</span>
								</Show>
								<Show
									when={
										props.mode === "cyber" &&
										r.answerDef !== undefined &&
										props.withDefinition
									}
								>
									<span
										class={`truncate text-[13px] ${
											r.answerDef ? "text-ink-soft" : "text-ink-faint"
										}`}
									>
										我的释义：{r.answerDef || "（未填写）"}
									</span>
								</Show>
							</div>
							<Show when={props.mode === "cyber" && r.answer !== undefined}>
								<span
									class={`max-w-[40%] truncate text-right text-[15px] ${
										r.correct ? "text-ok" : "text-err"
									}`}
								>
									{r.answer}
								</span>
							</Show>
						</div>
					)}
				</For>
			</div>

			{/* 判定说明 */}
			<Show when={props.mode === "cyber"}>
				<p class="text-right text-xs text-ink-faint">
					单词判定：大小写与标点需完全一致 · 释义不批改
				</p>
			</Show>

			{/* 底部提示：回车可关闭，回到词库数据全保留 */}
			<p class="mt-auto text-center text-xs text-ink-faint">
				关闭后回到词库，单词保留；要重默直接点开始，要清空点清空
			</p>
		</div>
	);
}
