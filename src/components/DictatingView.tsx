import { Show } from "solid-js";
import { Volume2, Check } from "lucide-solid";
import type { ContentMode } from "~/lib/state";
import { secondStepLabel, type RoundAsk } from "~/lib/mixed-mode";

export interface DictatingViewProps {
	index: number;
	total: number;
	/** 进度单位：混合场次按「轮」，其余按「个」 */
	unit?: "个" | "轮";
	remainingSec: number;
	durationSec: number;
	showNumber: boolean;
	repeatIndex: number;
	repeatCount: number;
	/** 播报序列的标签（短句轮为 ["整句 1","整句 2","整句 3"]）；缺省时按序号显示 */
	playLabels?: string[];
	speechDone: boolean;
	/** 是否正在发声（播报间隔期间为 false） */
	sounding: boolean;
	mode: "writing" | "cyber";
	/** 本轮内容模式（混合场次逐轮不同；决定第二步是释义还是中文词） */
	contentMode: ContentMode;
	/** 本轮作答形态（唯一真源，见 mixed-mode.roundAskOf） */
	ask: RoundAsk;
	/** 本轮徽标（如「本轮：释义 · 第 1 次」）；单一模式场次为 null */
	roundBadge?: string | null;
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

/** 当前正在播的那一项叫什么（短句轮显示「整句 1」这类标签） */
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

/** 第二步的文案：释义 / 中文词（与 lib 侧同一份规则） */
function secondLabel(props: DictatingViewProps): string {
	return secondStepLabel({ mode: props.contentMode });
}

/** 当前输入步骤（按本轮作答形态判定，不再按场次模式猜） */
function step(props: DictatingViewProps): "word" | "def" | "done" | "none" {
	if (props.mode !== "cyber") return "none";
	// 单步轮（混合里第 2 次出现的释义/中文词）直接从第二步开始
	if (props.ask === "second") {
		return props.submittedDef === undefined ? "def" : "done";
	}
	if (props.submittedWord === undefined) return "word";
	if (props.ask === "word+second" && props.submittedDef === undefined) {
		return "def";
	}
	return "done";
}

function statusText(props: DictatingViewProps): string {
	if (props.mode !== "cyber") return "用笔写在纸上吧 ✍️";
	if (props.ask === "sentence") return "听整句写整句，写完按回车";
	if (step(props) === "done") return "已提交，等时间到自动进入下一轮";
	if (props.ask === "second") {
		return `直接写${secondLabel(props)}（本轮不写单词），回车提交`;
	}
	if (step(props) === "def") return `再写${secondLabel(props)}，写完按回车`;
	return "听语音写单词，写完按回车";
}

/** 第 1 格（单词/整句）的占位符 */
function wordPlaceholder(props: DictatingViewProps): string {
	if (props.ask === "sentence") return "输入整句…";
	return "输入单词…";
}

function progressPct(remainingSec: number, durationSec: number): number {
	return Math.max(
		0,
		Math.min(100, (remainingSec / Math.max(1, durationSec)) * 100),
	);
}

/** 第 1 格：单词 / 整句（ask=second 的轮次不渲染这一格） */
function WordRow(props: DictatingViewProps) {
	return (
		<Show
			when={step(props) === "word"}
			fallback={
				<div class="flex h-14 items-center gap-3 rounded-xl border-[1.5px] border-ok bg-ok-bg px-4">
					<Check class="h-5 w-5 shrink-0 text-ok" />
					<span class="truncate text-base font-medium text-ink">
						{props.submittedWord ?? ""}
					</span>
				</div>
			}
		>
			<div class="flex h-14 items-center gap-3 rounded-xl border-[1.5px] border-brand bg-surface px-4 shadow-sm">
				{/* 两段式才需要「① 单词」标记，明确下一步还要写第二步 */}
				<Show when={props.ask === "word+second"}>
					<span class="flex h-[22px] w-[58px] shrink-0 items-center justify-center rounded-full bg-brand text-[11px] text-white">
						① 单词
					</span>
				</Show>
				<input
					ref={autoFocus}
					class="w-full bg-transparent text-base text-ink outline-none placeholder:text-ink-faint"
					placeholder={wordPlaceholder(props)}
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

/** 第 2 格：释义 / 中文词（两段式的第二步，或混合第 2 次出现的单步轮） */
function DefRow(props: DictatingViewProps) {
	const visible = () =>
		props.ask === "second" ||
		step(props) === "def" ||
		props.submittedDef !== undefined;
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
						{props.ask === "second"
							? secondLabel(props)
							: `② ${secondLabel(props)}`}
					</span>
					<input
						ref={autoFocus}
						class="w-full bg-transparent text-base text-ink outline-none placeholder:text-ink-faint"
						placeholder={`输入${secondLabel(props)}…`}
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
					{/* 单步轮：明确告诉用户不用再写单词 */}
					<Show when={props.ask === "second"}>
						<span class="shrink-0 text-[12px] text-ink-faint">不用写单词</span>
					</Show>
				</div>
			</Show>
		</Show>
	);
}

/** 默写中：进度 + 倒计时 + 播报提示 + 赛博输入（布局稳定，提示不顶输入框） */
export default function DictatingView(props: DictatingViewProps) {
	return (
		<div class="flex h-full flex-col gap-4 p-7">
			{/* 顶部：进度 / 本轮徽标 / 播报状态 */}
			<div class="flex items-center justify-between gap-3">
				<span class="shrink-0 rounded-full bg-surface px-4 py-2.5 font-data text-sm text-ink-soft shadow-sm">
					第 {props.index + 1} / {props.total} {props.unit ?? "个"}
				</span>
				<Show when={props.roundBadge}>
					{(badge) => (
						<span class="min-w-0 truncate rounded-full bg-brand px-4 py-2 font-body text-[13px] font-semibold text-white shadow-sm">
							{badge()}
						</span>
					)}
				</Show>
				<span class="flex shrink-0 items-center gap-2 rounded-full bg-surface px-4 py-2.5 shadow-sm">
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
					<Show when={props.ask !== "second"}>
						<WordRow {...props} />
					</Show>
					<DefRow {...props} />
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
