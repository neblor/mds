/**
 * 词表模式的词源卡：当前词表 + 「今天默几个」
 *
 * 点词表名打开选择词表弹层；数量用步进器调（5–100，步长 5），即改即存。
 * 键盘：步进器按钮回车/空格即调整；Tab 顺序为「选词表 → 减 → 加」。
 */
import { ChevronDown, Library, Minus, Plus } from "lucide-solid";
import { MAX_TODAY_TARGET, MIN_TODAY_TARGET } from "~/lib/daily-queue";

const STEP = 5;

interface Props {
	bankName: string | null;
	hasBank: boolean;
	todayTarget: number;
	busy: boolean;
	onOpenPicker: () => void;
	onTodayTarget: (value: number) => void;
}

export default function BankSourceCard(props: Props) {
	const adjust = (delta: number) => {
		const next = Math.min(
			MAX_TODAY_TARGET,
			Math.max(MIN_TODAY_TARGET, props.todayTarget + delta),
		);
		if (next !== props.todayTarget) props.onTodayTarget(next);
	};

	return (
		<div class="flex items-center gap-2.5 rounded-2xl bg-surface px-4 py-3.5 shadow-sm">
			<Library class="h-5 w-5 shrink-0 text-brand" />
			<button
				type="button"
				class="flex items-center gap-2 rounded-xl bg-canvas px-3 py-2 text-[15px] font-semibold text-ink transition hover:bg-soft"
				onClick={props.onOpenPicker}
				aria-haspopup="dialog"
			>
				<span class="max-w-[260px] truncate">
					{props.bankName ?? "还没有词表"}
				</span>
				<ChevronDown class="h-4 w-4 shrink-0 text-ink-faint" />
			</button>
			<div class="flex-1" />
			<span class="text-[13px] text-ink-soft">今天默</span>
			<div class="flex items-center gap-3 rounded-full bg-canvas px-3 py-1">
				<button
					type="button"
					class="flex h-6 w-6 items-center justify-center rounded-full text-ink-soft transition hover:bg-soft hover:text-ink"
					onClick={() => adjust(-STEP)}
					aria-label="减少今日数量"
				>
					<Minus class="h-4 w-4" />
				</button>
				<span class="w-9 text-center font-data text-base text-ink tabular-nums">
					{props.todayTarget}
				</span>
				<button
					type="button"
					class="flex h-6 w-6 items-center justify-center rounded-full text-ink-soft transition hover:bg-soft hover:text-ink"
					onClick={() => adjust(STEP)}
					aria-label="增加今日数量"
				>
					<Plus class="h-4 w-4" />
				</button>
			</div>
			<span class="text-[13px] text-ink-faint">个</span>
		</div>
	);
}
