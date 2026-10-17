import { Show } from "solid-js";
import { Volume2, Check } from "lucide-solid";
import type { ContentMode } from "~/lib/state";

export interface DictatingViewProps {
	index: number;
	total: number;
	remainingSec: number;
	durationSec: number;
	showNumber: boolean;
	repeatIndex: number;
	repeatCount: number;
	/** 播报序列的标签（短句轮为 ["单词","整句 1","整句 2"]）；缺省时按序号显示 */
	playLabels?: string[];
	speechDone: boolean;
	/** 是否正在发声（播报间隔期间为 false） */
	sounding: boolean;
	mode: "writing" | "cyber";
	contentMode: ContentMode;
	submittedWord: string | undefined;
	submittedDef: string | undefined;
	/** 输入框受控值 */
	wordInput: string;
	defInput: string;
	onWordInput: (v: string) => void;
	onDefInput: (v: string) => void;
	/** 回车提交 */
	onWordSubmit: () => void;
	onDefSubmit: () => void;
}

/** 新挂载的输入框自动聚焦（ref 在元素插入时触发） */
function autoFocus(el: HTMLInputElement | undefined) {
	if (el) requestAnimationFrame(() => el.focus());
}

/** 播报状态文案 */
/** 当前正在播的那一项叫什么（短句轮显示「单词」「整句 1」这类标签） */
function currentPlayLabel(props: DictatingViewProps): string {
	const label = props.playLabels?.[Math.max(0, props.repeatIndex)];
	if (label) return label;
	return `第 ${Math.max(1, props.repeatIndex + 1)} 遍`;
}

function playStatus(props: DictatingViewProps): string {
	if (props.speechDone) return "播报完成";
	if (props.sounding) return `播报 ${currentPlayLabel(props)}`;
	return "请作答…";
}

/** 当前输入步骤 */
function step(props: DictatingViewProps): "word" | "def" | "done" | "none" {
	if (props.mode !== "cyber") return "none";
	if (props.submittedWord === undefined) return "word";
	if (
		(props.contentMode === "definition" || props.contentMode === "chinese") &&
		props.submittedDef === undefined
	) {
		return "def";
	}
	return "done";
}

function statusText(props: DictatingViewProps): string {
	const s = step(props);
	if (s === "none") return "用笔写在纸上吧 ✍️";
	if (props.contentMode === "sentence")
		return "听整句写整句，写完按回车";
	if (s === "word") return "听语音写单词，写完按回车";
	if (s === "def")
		return props.contentMode === "chinese"
			? "再写中文词，写完按回车"
			: "再写释义，写完按回车";
	return "已提交，等时间到自动进入下一轮";
}

/** 是否两步输入（释义/中文词模式） */
function hasSecondStep(props: DictatingViewProps): boolean {
	return (
		props.contentMode === "definition" || props.contentMode === "chinese"
	);
}

function progressPct(remainingSec: number, durationSec: number): number {
	return Math.max(
		0,
		Math.min(100, (remainingSec / Math.max(1, durationSec)) * 100),
	);
}

/** 第 1 步：单词/中文词输入（或已提交显示，同一位置同一高度） */
function WordRow(props: DictatingViewProps) {
	return (
		<Show
			when={step(props) === "word"}
			fallback={
				<div class="flex h-14 items-center gap-3 rounded-xl border-[1.5px] border-ok bg-ok-bg px-4">
					<Check class="h-5 w-5 shrink-0 text-ok" />
					<span class="text-base font-medium text-ink">
						{props.submittedWord ?? ""}
					</span>
				</div>
			}
		>
			<div class="flex h-14 items-center gap-3 rounded-xl border-[1.5px] border-brand bg-surface px-4 shadow-sm">
				{/* 仅两步模式才需要“第 1 步”标记 */}
				<Show when={hasSecondStep(props)}>
					<span class="flex h-[22px] w-11 shrink-0 items-center justify-center rounded-full bg-brand text-[11px] text-white">
						第 1 步
					</span>
				</Show>
				<input
					ref={autoFocus}
					class="w-full bg-transparent text-base text-ink outline-none placeholder:text-ink-faint"
					placeholder={
						props.contentMode === "sentence" ? "输入整句…" : "输入单词…"
					}
					value={props.wordInput}
					onInput={(e) => props.onWordInput(e.currentTarget.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							e.stopPropagation();
							props.onWordSubmit();
						}
					}}
				/>
			</div>
		</Show>
	);
}

/** 第 2 步：释义输入（释义模式下单词已提交后出现，位于单词行下方） */
function DefRow(props: DictatingViewProps) {
	const visible = () =>
		step(props) === "def" || props.submittedDef !== undefined;
	return (
		<Show when={visible()}>
			<Show
				when={step(props) === "def"}
				fallback={
					<div class="flex h-14 items-center gap-3 rounded-xl border-[1.5px] border-ok bg-ok-bg px-4">
						<Check class="h-5 w-5 shrink-0 text-ok" />
						<span class="truncate text-base text-ink">
							{props.submittedDef}
						</span>
					</div>
				}
			>
				<div class="flex h-14 items-center gap-3 rounded-xl border-[1.5px] border-brand bg-surface px-4 shadow-sm">
					<span class="flex h-[22px] w-11 shrink-0 items-center justify-center rounded-full bg-brand text-[11px] text-white">
						第 2 步
					</span>
					<input
						ref={autoFocus}
						class="w-full bg-transparent text-base text-ink outline-none placeholder:text-ink-faint"
						placeholder={
							props.contentMode === "chinese"
								? "输入中文词…"
								: "输入释义…"
						}
						value={props.defInput}
						onInput={(e) => props.onDefInput(e.currentTarget.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.preventDefault();
								e.stopPropagation();
								props.onDefSubmit();
							}
						}}
					/>
				</div>
			</Show>
		</Show>
	);
}

/** 默写中：进度 + 倒计时 + 播报提示 + 赛博输入（布局稳定，提示不顶输入框） */
export default function DictatingView(props: DictatingViewProps) {
	return (
		<div class="flex h-full flex-col gap-4 p-7">
			{/* 顶部 */}
			<div class="flex items-center justify-between">
				<span class="rounded-full bg-surface px-4 py-2.5 font-data text-sm text-ink-soft shadow-sm">
					第 {props.index + 1} / {props.total} 个
				</span>
				<span class="flex items-center gap-2 rounded-full bg-surface px-4 py-2.5 shadow-sm">
					<Volume2 class="h-4 w-4 text-brand" />
					<span class="font-data text-sm text-ink">{playStatus(props)}</span>
				</span>
			</div>

			{/* 倒计时（固定位置） */}
			<div class="flex items-center gap-3">
				<div class="h-2.5 flex-1 overflow-hidden rounded-full bg-soft">
					<div
						class="h-full rounded-full bg-brand transition-[width] duration-100 ease-linear"
						style={{
							width: `${progressPct(props.remainingSec, props.durationSec)}%`,
						}}
					/>
				</div>
				<Show when={props.showNumber}>
					<span class="w-[60px] text-right font-data text-[17px] text-ink tabular-nums">
						{props.remainingSec.toFixed(1)}
					</span>
				</Show>
			</div>

			{/* 播报提示（固定区域） */}
			<div class="flex flex-col items-center gap-3 py-8">
				<Volume2 class="h-[52px] w-[52px] text-gold" />
				<span class="rounded-full bg-surface px-3 py-1.5 text-[13px] text-ink-soft shadow-sm">
					{props.speechDone
						? "播报完成"
						: props.sounding
							? `正在播报 · ${currentPlayLabel(props)}`
							: "请作答…"}
				</span>
			</div>

			{/* 输入区（固定布局：状态行在输入框上方，输入框永不移动） */}
			<div class="mt-auto flex flex-col gap-2.5">
				{/* 状态行：固定高度，提示不顶输入框 */}
				<div class="flex h-6 items-center justify-center">
					<span class="text-[13px] text-ink-faint">{statusText(props)}</span>
				</div>

				<Show when={props.mode === "cyber"}>
					<WordRow {...props} />
					<Show when={hasSecondStep(props)}>
						<DefRow {...props} />
					</Show>
				</Show>

				{/* 书写模式底部占位（与赛博输入区同高，位置稳定） */}
				<Show when={props.mode !== "cyber"}>
					<div class="flex h-14 items-center justify-center rounded-xl bg-soft/60 text-sm text-ink-faint">
						下一轮语音会自动继续（空格可跳过等待）
					</div>
				</Show>
			</div>
		</div>
	);
}
