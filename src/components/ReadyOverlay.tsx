import { CircleCheckBig, LayoutGrid, Play } from "lucide-solid";
import { Show, onMount } from "solid-js";
import { isReadyOverlayConfirmKey, readyOverlaySummary } from "~/lib/ready-overlay";
import { CONTENT_MODE_LABELS } from "~/lib/results";
import type { ContentMode } from "~/lib/state";

interface Props {
	count: number;
	contentMode: ContentMode;
	onGo: () => void;
	/** 音标模式：准备完成也能打开全屏音标表（不暂停） */
	showChart?: boolean;
	onOpenChart?: () => void;
}

/** 准备完成：Let's Go */
export default function ReadyOverlay(props: Props) {
	let goButton!: HTMLButtonElement;

	onMount(() => goButton.focus());

	return (
		<div class="absolute inset-0 z-20 flex items-center justify-center bg-ink/30 backdrop-blur-md">
			<div class="flex w-[400px] flex-col items-center gap-4 rounded-2xl bg-surface px-9 py-9 shadow-xl">
				<CircleCheckBig class="h-10 w-10 text-ok" />
				<h2 class="font-heading text-[26px] text-ink">准备完成</h2>
				<p class="text-sm text-ink-faint">
					{readyOverlaySummary({
						count: props.count,
						contentMode: props.contentMode,
						summaryLabel: CONTENT_MODE_LABELS[props.contentMode],
					})}
				</p>
				<button type="button"
					ref={goButton}
					class="mt-1 flex items-center gap-2 rounded-xl bg-brand px-7 py-3.5 text-[17px] text-white shadow-sm transition hover:brightness-105 active:scale-[0.99]"
					onClick={props.onGo}
					onKeyDown={(event) => {
						if (isReadyOverlayConfirmKey(event)) {
							event.preventDefault();
							props.onGo();
						}
					}}
				>
					<Play class="h-[18px] w-[18px]" fill="currentColor" />
					Let's Go!
				</button>
				<Show when={props.showChart}>
					<button
						type="button"
						class="flex items-center gap-1.5 rounded-full bg-soft px-4 py-2 text-[12px] text-ink-soft transition hover:bg-brand/10 hover:text-brand"
						onClick={() => props.onOpenChart?.()}
						title="全屏查看音标表（F1）"
					>
						<LayoutGrid class="h-4 w-4" />
						音标表（F1）
					</button>
				</Show>
			</div>
		</div>
	);
}
