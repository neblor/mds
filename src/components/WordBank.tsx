import { For, Show, createSignal } from "solid-js";
import {
	Star,
	Settings,
	PenLine,
	Keyboard,
	Trash2,
	X,
	ListPlus,
} from "lucide-solid";
import BatchImportDialog from "~/components/BatchImportDialog";
import type { SpeedLevel } from "~/lib/timing";

interface Props {
	words: string[];
	speed: SpeedLevel;
	withDefinition: boolean;
	error: string | null;
	onAdd: (word: string) => void;
	onAddMany: (words: string[]) => void;
	onRemove: (word: string) => void;
	onClear: () => void;
	onSpeed: (s: SpeedLevel) => void;
	onWithDefinition: (v: boolean) => void;
	onStartWriting: () => void;
	onStartCyber: () => void;
	onOpenSettings: () => void;
}

const SPEED_LEVELS: { key: SpeedLevel; label: string }[] = [
	{ key: "fast", label: "快" },
	{ key: "normal", label: "中" },
	{ key: "slow", label: "慢" },
];

export default function WordBank(props: Props) {
	const [input, setInput] = createSignal("");
	const [batchOpen, setBatchOpen] = createSignal(false);

	const submit = () => {
		const v = input().trim();
		if (!v) return;
		props.onAdd(v);
		setInput("");
	};

	return (
		<div class="flex h-full flex-col gap-5 p-7">
			{/* 头部 */}
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-3">
					<Star class="h-9 w-9 text-gold" fill="currentColor" strokeWidth={1} />
					<div class="flex flex-col gap-0.5">
						<h1 class="font-heading text-3xl text-ink">默点啥</h1>
						<p class="text-[13px] text-ink-faint">记单词 · 听写 · 默写小帮手</p>
					</div>
				</div>
				<button type="button"
					class="rounded-full p-2 text-ink-faint transition hover:bg-soft hover:text-ink"
					onClick={props.onOpenSettings}
					aria-label="设置"
				>
					<Settings class="h-[22px] w-[22px]" />
				</button>
			</div>

			{/* 输入 */}
			<div class="flex items-center gap-2.5 rounded-2xl bg-surface px-4 py-3.5 shadow-sm">
				<PenLine class="h-5 w-5 shrink-0 text-brand" />
				<input
					class="w-full bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-faint"
					placeholder="输入单词或词组，回车添加…"
					value={input()}
					onInput={(e) => setInput(e.currentTarget.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") submit();
					}}
				/>
				<button
					type="button"
					class="flex shrink-0 items-center gap-1.5 rounded-xl bg-canvas px-3 py-2 text-[13px] font-semibold text-ink-soft transition hover:bg-soft hover:text-ink"
					onClick={() => setBatchOpen(true)}
				>
					<ListPlus class="h-4 w-4 text-brand" />
					批量导入
				</button>
			</div>

			{/* 词库 */}
			<div class="flex flex-col gap-3 rounded-2xl bg-surface p-4 shadow-sm">
				<div class="flex items-center justify-between">
					<span class="text-[13px] text-ink-soft">
						单词表 · {props.words.length} 个
					</span>
					<Show when={props.words.length > 0}>
						<button type="button"
							class="flex items-center gap-1 rounded-full px-2 py-1 text-[12px] text-ink-faint transition hover:bg-err-bg hover:text-err"
							onClick={props.onClear}
						>
							<Trash2 class="h-4 w-4" />
							清空
						</button>
					</Show>
				</div>
				<Show
					when={props.words.length > 0}
					fallback={
						<p class="py-6 text-center text-[13px] text-ink-faint">
							还没有单词，从上面输入开始吧 ✏️
						</p>
					}
				>
					<div class="flex flex-wrap gap-2">
						<For each={props.words}>
							{(w) => (
								<button type="button"
									class="group flex items-center gap-1.5 rounded-full bg-[#EDF3F2] px-3.5 py-2 text-sm text-ink transition hover:bg-err-bg"
									onClick={() => props.onRemove(w)}
									title="点击删除"
								>
									{w}
									<X class="h-3 w-3 text-ink-faint group-hover:text-err" />
								</button>
							)}
						</For>
					</div>
				</Show>
			</div>

			{/* 控制 */}
			<div class="flex items-center justify-between">
				<div class="flex gap-1 rounded-full bg-surface p-1 shadow-sm">
					<For each={SPEED_LEVELS}>
						{(l) => (
							<button type="button"
								class={`rounded-full px-4 py-2 text-[13px] transition ${
									props.speed === l.key
										? "bg-brand text-white"
										: "text-ink-faint hover:text-ink"
								}`}
								onClick={() => props.onSpeed(l.key)}
							>
								{l.label}
							</button>
						)}
					</For>
				</div>
				<label class="flex cursor-pointer items-center gap-2.5 text-sm text-ink-soft">
					默写释义
					<input
						type="checkbox"
						class="toggle-switch"
						checked={props.withDefinition}
						onChange={(e) => props.onWithDefinition(e.currentTarget.checked)}
					/>
				</label>
			</div>

			<Show when={props.error}>
				<div class="flex items-center gap-2 rounded-xl bg-err-bg px-4 py-3 text-sm text-err">
					{props.error}
				</div>
			</Show>

			{/* 操作 */}
			<div class="mt-auto flex gap-3.5">
				<button type="button"
					class="flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand px-6 py-3.5 text-base text-white shadow-sm transition hover:brightness-105 active:scale-[0.99]"
					onClick={props.onStartWriting}
				>
					<PenLine class="h-[18px] w-[18px]" />
					开始书写默写
				</button>
				<button type="button"
					class="flex flex-1 items-center justify-center gap-2 rounded-xl border-[1.5px] border-soft bg-surface px-6 py-3.5 text-base text-ink shadow-sm transition hover:border-brand/40 active:scale-[0.99]"
					onClick={props.onStartCyber}
				>
					<Keyboard class="h-[18px] w-[18px] text-ink-soft" />
					开始赛博默写
				</button>
			</div>

			<Show when={batchOpen()}>
				<BatchImportDialog
					existingWords={props.words}
					onImport={props.onAddMany}
					onClose={() => setBatchOpen(false)}
				/>
			</Show>
		</div>
	);
}
