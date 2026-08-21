import { Loader2, OctagonX } from "lucide-solid";

interface Props {
	onAbort: () => void;
}

/** AI 批改中：全屏毛玻璃遮罩（与默写准备同风格），中止后降级本地判定 */
export default function GradingOverlay(props: Props) {
	return (
		<div class="absolute inset-0 z-20 flex items-center justify-center bg-ink/30 backdrop-blur-md">
			<div class="flex w-[400px] flex-col items-center gap-4 rounded-2xl bg-surface px-8 py-8 shadow-xl">
				<Loader2 class="h-9 w-9 animate-spin text-brand" />
				<h2 class="font-heading text-2xl text-ink">正在批改…</h2>
				<p class="text-sm text-ink-faint">
					AI 正在检查你的中文词答案，请稍等
				</p>
				<button type="button"
					class="mt-1 flex items-center gap-1.5 rounded-full bg-err-bg px-4 py-2 text-sm text-err transition hover:brightness-95"
					onClick={props.onAbort}
				>
					<OctagonX class="h-[15px] w-[15px]" />
					中止（改用本地判定）
				</button>
			</div>
		</div>
	);
}
