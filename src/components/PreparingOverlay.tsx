import { Show } from "solid-js";
import { Volume2, OctagonX } from "lucide-solid";

interface Props {
	/** 0..1；不确定态时忽略 */
	progress: number;
	/** 当前阶段无法给出确定进度（单次 AI 请求）→ 流动动画代替固定宽度 */
	indeterminate?: boolean;
	/** 状态文案，如 "正在生成语音 3/6 · 正在获取释义…" */
	status: string;
	error: string | null;
	onAbort: () => void;
}

/** 默写准备中：全屏毛玻璃遮罩 + 进度 + 中止 */
export default function PreparingOverlay(props: Props) {
	return (
		<div class="absolute inset-0 z-20 flex items-center justify-center bg-ink/30 backdrop-blur-md">
			<div class="flex w-[400px] flex-col items-center gap-4 rounded-2xl bg-surface px-8 py-8 shadow-xl">
				<Show
					when={!props.error}
					fallback={
						<div class="flex flex-col items-center gap-4">
							<OctagonX class="h-9 w-9 text-err" />
							<p class="text-center text-[15px] leading-relaxed text-ink">
								{props.error}
							</p>
							<button type="button"
								class="rounded-full bg-err-bg px-6 py-2.5 text-sm text-err transition hover:brightness-95"
								onClick={props.onAbort}
							>
								返回
							</button>
						</div>
					}
				>
					<Volume2 class="h-9 w-9 text-gold" />
					<h2 class="font-heading text-2xl text-ink">默写准备中…</h2>
					<p class="text-sm text-ink-faint">{props.status}</p>
					<div class="h-2 w-[280px] overflow-hidden rounded-full bg-soft">
						<Show
							when={!props.indeterminate}
							fallback={
								// 不确定态：一条来回流动的亮条，明确表达「还在跑」而不是卡在某个百分比
								<div class="h-full w-1/3 animate-[prep-indeterminate_1.2s_ease-in-out_infinite] rounded-full bg-brand/80" />
							}
						>
							<div
								class="h-full rounded-full bg-brand transition-all duration-300"
								style={{ width: `${Math.round(props.progress * 100)}%` }}
							/>
						</Show>
					</div>
					<button type="button"
						class="mt-1 flex items-center gap-1.5 rounded-full bg-err-bg px-4 py-2 text-sm text-err transition hover:brightness-95"
						onClick={props.onAbort}
					>
						<OctagonX class="h-[15px] w-[15px]" />
						中止
					</button>
				</Show>
			</div>
		</div>
	);
}
