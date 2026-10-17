/**
 * 组句轮（第四种内容模式 · 赛博作答）
 *
 * 布局（对应 .design/mds.pen 27 屏，自上而下位置固定）：
 *   `第 n / N 题` + `选词作答` → 倒计时条（可选数字）→ 候选词卡（≤24）
 *   → 短文卡（句数由出题方给，多了可滚动，句中内联空槽）→ 底部键盘提示行
 *
 * 键盘流（铁律，逻辑在 lib/cloze-input.ts 里可单测）：
 *   ←→ 选词 · 1–9 快选 · 回车填入 · Tab/↑↓ 换空 · Backspace 撤回 · 选完自动进下一题
 * 鼠标流：点候选词 = 填入当前空并自动跳到下一个未填空（与回车同路）；
 *   点空槽（含已填）= 切到该空，可再点候选词覆写；不禁用来回点击。
 * 组句轮不播语音，所以这里没有播音区；输入区位置固定，提示不顶动空槽。
 */
import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { Check, Keyboard } from "lucide-solid";
import {
	initialClozeInput,
	stepClozeInput,
	type ClozeInputContext,
	type ClozeInputEvent,
	type ClozeInputState,
} from "~/lib/cloze-input";
import { splitClozeSentence } from "~/lib/cloze-parse";

export interface ClozeBlankView {
	index: number;
	answer: string;
	chosen?: string;
}

interface Props {
	/** 轮次下标（换题时重置键盘状态） */
	index: number;
	total: number;
	remainingSec: number;
	durationSec: number;
	showNumber: boolean;
	sentences: string[];
	blanks: ClozeBlankView[];
	/** 本场候选池（每轮相同，≤24） */
	candidates: string[];
	onChoose: (blankIndex: number, word: string) => void;
	onClear: (blankIndex: number) => void;
}

function progressPct(remainingSec: number, durationSec: number): number {
	return Math.max(
		0,
		Math.min(100, (remainingSec / Math.max(1, durationSec)) * 100),
	);
}

/** 候选词胶囊样式：已用（打勾变淡）/ 当前光标（主色描边）/ 普通 */
function chipClass(state: "used" | "cursor" | "idle"): string {
	const base =
		"flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm transition";
	if (state === "used") return `${base} bg-soft text-ink-faint`;
	if (state === "cursor") {
		return `${base} bg-brand/10 text-brand ring-[1.5px] ring-brand`;
	}
	return `${base} bg-[#EDF3F2] text-ink hover:bg-brand/10 hover:text-brand`;
}

/** 空槽样式：已填（白底描边，当前空加一圈光）/ 当前空（下划线 + 浅底）/ 未激活（浅灰下划线） */
function slotClass(state: "filled" | "active" | "idle", isActive = false): string {
	const base =
		"inline-flex min-w-[72px] items-center justify-center rounded-lg px-3 py-0.5 text-[21px] align-middle transition";
	if (state === "filled") {
		return `${base} border-[1.5px] border-brand bg-surface text-brand ${
			isActive ? "ring-[3px] ring-brand/30" : ""
		}`;
	}
	if (state === "active") {
		return `${base} border-0 border-b-[3px] border-brand bg-brand/10 px-4 text-brand`;
	}
	return `${base} border-0 border-b-2 border-soft px-4 text-ink-faint`;
}

export default function ClozeView(props: Props) {
	const [input, setInput] = createSignal<ClozeInputState>(initialClozeInput());

	// 换题：键盘状态回到第一个空、候选池第一个
	createEffect(() => {
		void props.index;
		setInput(initialClozeInput());
	});

	// 空数/候选数变化时夹住光标（换题、不同题空数不同）
	createEffect(() => {
		const blanks = props.blanks.length;
		const candidates = props.candidates.length;
		setInput((previous) => ({
			active: Math.max(0, Math.min(Math.max(0, blanks - 1), previous.active)),
			cursor: Math.max(
				0,
				Math.min(Math.max(0, candidates - 1), previous.cursor),
			),
		}));
	});

	const context = (): ClozeInputContext => ({
		blankCount: props.blanks.length,
		candidates: props.candidates,
		filled: props.blanks.map((blank) => blank.chosen),
	});

	const apply = (event: ClozeInputEvent) => {
		const result = stepClozeInput(input(), event, context());
		setInput(result.state);
		// 状态机里的 blank/clear 是数组下标；对外一律用空编号（##n），避免 blanks 顺序不同时误写入
		if (result.clear !== null) {
			const blank = props.blanks[result.clear];
			if (blank) props.onClear(blank.index);
		}
		if (result.choose) {
			const blank = props.blanks[result.choose.blank];
			if (blank) props.onChoose(blank.index, result.choose.word);
		}
	};

	const activeBlankIndex = () =>
		props.blanks[input().active]?.index ?? props.blanks[0]?.index ?? 0;

	/** 点击空槽：把当前空移到它上面（已填的空也能点回来改选） */
	const focusBlank = (blankIndex: number) => {
		const position = props.blanks.findIndex((entry) => entry.index === blankIndex);
		if (position >= 0) setInput({ ...input(), active: position });
	};

	/** 正文里实际的空槽数（同一个编号写两次就有两个槽） */
	const slotCount = () =>
		props.sentences.reduce(
			(sum, sentence) => sum + (sentence.match(/##\d+/g)?.length ?? 0),
			0,
		);

	onMount(() => {
		const handler = (event: KeyboardEvent) => {
			if (event.metaKey || event.ctrlKey || event.altKey) return;
			let inputEvent: ClozeInputEvent | null = null;
			if (event.key === "ArrowLeft") inputEvent = { type: "cursor", delta: -1 };
			else if (event.key === "ArrowRight")
				inputEvent = { type: "cursor", delta: 1 };
			else if (event.key === "Tab")
				inputEvent = { type: "blank", delta: event.shiftKey ? -1 : 1 };
			else if (event.key === "ArrowDown") inputEvent = { type: "blank", delta: 1 };
			else if (event.key === "ArrowUp") inputEvent = { type: "blank", delta: -1 };
			else if (event.key === "Enter") inputEvent = { type: "enter" };
			else if (event.key === "Backspace") inputEvent = { type: "backspace" };
			else if (/^[1-9]$/.test(event.key))
				inputEvent = { type: "digit", value: Number(event.key) };
			if (!inputEvent) return;
			event.preventDefault();
			apply(inputEvent);
		};
		window.addEventListener("keydown", handler);
		onCleanup(() => window.removeEventListener("keydown", handler));
	});

	const usedWords = () =>
		new Set(props.blanks.map((blank) => blank.chosen).filter(Boolean) as string[]);

	const blankByIndex = (index: number) =>
		props.blanks.find((blank) => blank.index === index);

	return (
		<div class="flex h-full flex-col gap-4 p-7">
			{/* 顶部：进度 + 作答方式 */}
			<div class="flex items-center justify-between">
				<span class="rounded-full bg-surface px-4 py-2.5 font-data text-sm text-ink-soft shadow-sm">
					第 {props.index + 1} / {props.total} 题
				</span>
				<span class="flex items-center gap-2 rounded-full bg-surface px-4 py-2.5 shadow-sm">
					<Keyboard class="h-4 w-4 text-brand" />
					<span class="font-data text-sm text-ink">选词作答</span>
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

			{/* 候选词池（≤24，位置固定） */}
			<div class="flex flex-col gap-3.5 rounded-2xl bg-surface p-5 shadow-sm">
				<div class="flex items-center justify-between">
					<span class="text-[13px] text-ink-soft">
						候选词 · {props.candidates.length} 个（已用 {usedWords().size}）
					</span>
					<span class="text-[12px] text-ink-faint">
						←→ 选词 · 1–9 快选 · 回车填入
					</span>
				</div>
				<div class="flex flex-wrap gap-2">
					<For each={props.candidates}>
						{(word, chipIndex) => (
							<button
								type="button"
								class={chipClass(
									usedWords().has(word)
										? "used"
										: input().cursor === chipIndex()
											? "cursor"
											: "idle",
								)}
								onMouseEnter={() =>
									setInput({ ...input(), cursor: chipIndex() })
								}
								onClick={() => apply({ type: "pick", index: chipIndex() })}
								title={`填入「${word}」（自动跳到下一个空）`}
							>
								<Show when={usedWords().has(word)}>
									<Check class="h-3.5 w-3.5 text-ok" />
								</Show>
								{word}
							</button>
						)}
					</For>
				</div>
			</div>

			{/* 短文（句数不定，内联空槽；多了可滚动） */}
			<div class="flex min-h-0 flex-1 flex-col gap-5 rounded-2xl bg-surface px-8 py-6 shadow-sm">
				<span class="text-[13px] text-ink-faint">
					短文 · 本组 {slotCount()} 个空 · 选完自动进入下一题
				</span>
				<div class="min-h-0 flex-1 overflow-y-auto">
					<div class="flex min-h-full flex-col justify-center gap-6">
						<For each={props.sentences}>
							{(sentence) => (
								<p class="text-[21px] leading-[1.9] text-ink">
									<For each={splitClozeSentence(sentence)}>
										{(part) => (
											<Show
												when={part.kind === "blank"}
												fallback={
													<span>{part.kind === "text" ? part.text : ""}</span>
												}
											>
												<Show when={part.kind === "blank" ? part.index : 0}>
													{(blankIndex) => {
														const blank = () => blankByIndex(blankIndex());
														const isActive = () =>
															activeBlankIndex() === blankIndex();
														return (
															<Show
																when={blank()?.chosen !== undefined}
																fallback={
																	<button
																		type="button"
																		class={slotClass(isActive() ? "active" : "idle")}
																		onClick={() => focusBlank(blankIndex())}
																	>
																		{isActive() ? "选词" : "＿＿"}
																	</button>
																}
															>
																<button
																	type="button"
																	class={slotClass("filled", isActive())}
																	onClick={() => focusBlank(blankIndex())}
																	title="点这里改选这个空"
																>
																	{blank()?.chosen}
																</button>
															</Show>
														);
													}}
												</Show>
											</Show>
										)}
									</For>
								</p>
							)}
						</For>
					</div>
				</div>
			</div>

			{/* 键盘提示行（固定高度，不顶动空槽） */}
			<div class="flex h-6 items-center justify-center">
				<span class="text-[13px] text-ink-faint">
					←→ 选词 · 1–9 快选 · 回车填入 · Tab 换空 · 倒计时结束按已选提交
				</span>
			</div>
		</div>
	);
}
