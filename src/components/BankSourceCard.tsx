/**
 * 词表模式的词源卡：当前词表 + 「本次默几个」
 *
 * 这个数字是**这一批取几个词**，不是「今天一共默几个」：改完数字点「重新取词」就按新数量再取一批。
 * 点词表名打开选择词表弹层；数量用步进器调（5–100，步长 5），即改即存。
 * 键盘：步进器按钮回车/空格即调整；Tab 顺序为「选词表 → 减 → 加」。
 */
import { Show } from "solid-js";
import { ChevronDown, Library, Minus, Plus } from "lucide-solid";
import { MAX_BATCH_SIZE, MIN_BATCH_SIZE } from "~/lib/round-queue";

const STEP = 5;

interface Props {
	bankName: string | null;
	hasBank: boolean;
	batchSize: number;
	busy: boolean;
	onOpenPicker: () => void;
	onBatchSize: (value: number) => void;
	/** 书本图标：打开学习档案（无当前词表时不显示按钮） */
	onOpenArchive: () => void;
	archiveButtonRef?: (el: HTMLButtonElement) => void;
}

export default function BankSourceCard(props: Props) {
	const adjust = (delta: number) => {
		const next = Math.min(
			MAX_BATCH_SIZE,
			Math.max(MIN_BATCH_SIZE, props.batchSize + delta),
		);
		if (next !== props.batchSize) props.onBatchSize(next);
	};

	return (
		<div class="flex items-center gap-2.5 rounded-2xl bg-surface px-4 py-3.5 shadow-sm">
			<Show
				when={props.hasBank}
				fallback={<Library class="h-5 w-5 shrink-0 text-brand" />}
			>
				<button
					type="button"
					ref={props.archiveButtonRef}
					class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-brand transition hover:bg-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
					onClick={props.onOpenArchive}
					aria-label="查看学习档案"
					title="学习档案"
				>
					<Library class="h-5 w-5" />
				</button>
			</Show>
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
			<span class="text-[13px] text-ink-soft">本次默</span>
			<div class="flex items-center gap-3 rounded-full bg-canvas px-3 py-1">
				<button
					type="button"
					class="flex h-6 w-6 items-center justify-center rounded-full text-ink-soft transition hover:bg-soft hover:text-ink"
					onClick={() => adjust(-STEP)}
					aria-label="减少本次数量"
				>
					<Minus class="h-4 w-4" />
				</button>
				<span class="w-9 text-center font-data text-base text-ink tabular-nums">
					{props.batchSize}
				</span>
				<button
					type="button"
					class="flex h-6 w-6 items-center justify-center rounded-full text-ink-soft transition hover:bg-soft hover:text-ink"
					onClick={() => adjust(STEP)}
					aria-label="增加本次数量"
				>
					<Plus class="h-4 w-4" />
				</button>
			</div>
			<span class="text-[13px] text-ink-faint">个</span>
		</div>
	);
}
