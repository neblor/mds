/**
 * 词源模式切换条：录入 / 词表
 *
 * 只决定「词从哪来」，与下面的快中慢、单词/释义/中文词互不影响。
 * 键盘：←/→ 切换（键盘流铁律，鼠标与键盘都能一次到底）。
 */
import { For } from "solid-js";
import { Library, PenLine } from "lucide-solid";

export type SourceMode = "entry" | "bank";

interface Props {
	mode: SourceMode;
	onChange: (mode: SourceMode) => void;
}

const TABS: { value: SourceMode; label: string; icon: typeof PenLine }[] = [
	{ value: "entry", label: "录入", icon: PenLine },
	{ value: "bank", label: "词表", icon: Library },
];

export default function SourceModeSwitch(props: Props) {
	const move = (delta: number) => {
		const index = TABS.findIndex((tab) => tab.value === props.mode);
		const next = Math.min(TABS.length - 1, Math.max(0, index + delta));
		if (next !== index) props.onChange(TABS[next].value);
	};

	return (
		<div
			role="tablist"
			aria-label="词源模式"
			class="flex w-fit items-center gap-1 rounded-full bg-soft p-1"
			onKeyDown={(event) => {
				if (event.key === "ArrowRight") {
					event.preventDefault();
					move(1);
				} else if (event.key === "ArrowLeft") {
					event.preventDefault();
					move(-1);
				}
			}}
		>
			<For each={TABS}>
				{(tab) => {
					const active = () => props.mode === tab.value;
					return (
						<button
							type="button"
							role="tab"
							aria-selected={active()}
							tabIndex={active() ? 0 : -1}
							class={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition ${
								active()
									? "bg-brand text-white shadow-sm"
									: "text-ink-faint hover:text-ink"
							}`}
							onClick={() => props.onChange(tab.value)}
						>
							<tab.icon class="h-[15px] w-[15px]" />
							{tab.label}
						</button>
					);
				}}
			</For>
		</div>
	);
}
