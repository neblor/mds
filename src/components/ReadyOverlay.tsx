import { CircleCheckBig, Play } from "lucide-solid";
import { onMount } from "solid-js";
import { isReadyOverlayConfirmKey } from "~/lib/ready-overlay";

interface Props {
	count: number;
	withDefinition: boolean;
	onGo: () => void;
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
					{props.count} 个单词 · 语音已就绪 · 顺序已打乱
					{props.withDefinition ? " · 含释义" : ""}
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
			</div>
		</div>
	);
}
