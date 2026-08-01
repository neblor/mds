import { Show } from "solid-js";
import { Timer } from "lucide-solid";

interface Props {
	/** 剩余秒数（0.1s 精度显示） */
	remainingSec: number;
	totalSec: number;
	showNumber: boolean;
}

/** 倒计时条 + 可选 0.1s 数字 */
export default function CountdownBar(props: Props) {
	const pct = () => {
		const t = props.totalSec > 0 ? props.totalSec : 1;
		return Math.max(0, Math.min(100, (props.remainingSec / t) * 100));
	};

	return (
		<div class="flex items-center gap-3">
			<div class="h-2.5 flex-1 overflow-hidden rounded-full bg-soft">
				<div
					class="h-full rounded-full bg-brand transition-[width] duration-100 ease-linear"
					style={{ width: `${pct()}%` }}
				/>
			</div>
			<Show when={props.showNumber}>
				<span class="flex w-[52px] items-center justify-end gap-1 font-data text-[17px] text-ink tabular-nums">
					<Timer class="h-4 w-4 text-brand" />
					{props.remainingSec.toFixed(1)}
				</span>
			</Show>
		</div>
	);
}
