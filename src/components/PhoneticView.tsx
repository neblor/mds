/**
 * 音标轮面板：看单词 → 从池子里点音素 → 拼出一条音标。
 *
 * 交互（键盘铁律）：
 * - 池子 roving tabindex；←/→/↑/↓/Home/End 移动，Enter/Space 放入；
 * - Shift+Enter 试听当前池子音素；Backspace 撤销最后一块；Shift+Backspace 试听最后一块；
 * - Delete 清空；Ctrl/Cmd+Enter 提交；F1 打开音标表；
 * - 放置后的 chip 左半移除、右半喇叭试听（重音符号无音频）；
 * - 提交后整块禁用，等语音轨结束按赛博规则推进。
 */
import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { Check, LayoutGrid, Trash2, Volume2 } from "lucide-solid";
import { columnsForWidth, type PhoneticPoolItem } from "~/lib/phonetic-pool";
import { phoneticToString, tokensFromString } from "~/lib/phonetic-parse";
import { isStressToken } from "~/lib/phonetic-symbols";
import type { PhoneticRoundData } from "~/lib/use-dictation";

export interface PhoneticViewProps {
	index: number;
	total: number;
	remainingSec: number;
	durationSec: number;
	showNumber: boolean;
	repeatIndex: number;
	speechDone: boolean;
	sounding: boolean;
	word: string;
	phonetic: PhoneticRoundData;
	/** 受控的音素串（空格分隔 token）；与父级 use-dictation 的 wordInput 同步 */
	tokenInput: string;
	/** 已提交的答案（有值即本轮已提交） */
	answer: string | undefined;
	/** 看音标表暂停时 UI 全部禁用 */
	paused?: boolean;
	/** 正在播放的 key（pool-i / chip-i） */
	playingKey: string | null;
	onTokenInput: (value: string) => void;
	onSubmit: () => void;
	onPlay: (token: string, key: string) => void;
	onOpenChart: () => void;
}

interface Pick {
	token: string;
	/** 池内唯一 index：重复 token 也是不同 tile，撤销后只恢复那一块 */
	poolIndex: number;
}

function progressPct(remainingSec: number, durationSec: number): number {
	return Math.max(
		0,
		Math.min(100, (remainingSec / Math.max(1, durationSec)) * 100),
	);
}

export default function PhoneticView(props: PhoneticViewProps) {
	const [picks, setPicks] = createSignal<Pick[]>([]);
	const [focusIndex, setFocusIndex] = createSignal(0);
	/** 池子固定 tile 宽度自动换行，方向键的上下步长要跟实际列数走 */
	const [columns, setColumns] = createSignal(8);
	let poolRef: HTMLDivElement | undefined;
	let rootRef: HTMLDivElement | undefined;

	const submitted = () => props.answer !== undefined;
	const disabled = () => submitted() || Boolean(props.paused);
	const targetCount = () => tokensFromString(props.phonetic.expected).length;

	const used = () => new Set(picks().map((pick) => pick.poolIndex));
	/**
	 * 焦点回池子。目标块可能已因「已放入 / 已提交 / 暂停」被禁用，
	 * 而 disabled 元素无法聚焦（焦点会掉到 body，键盘流直接断），
	 * 所以逐级兜底：指定块 → 任意可用块 → 根容器（仍能收 Ctrl+Enter 等）。
	 */
	const focusTile = (index: number) => {
		const target = poolRef?.querySelector<HTMLButtonElement>(
			`[data-pool-focus="${index}"]`,
		);
		const next =
			target && !target.disabled
				? target
				: poolRef?.querySelector<HTMLButtonElement>(
						"[data-pool-focus]:not(:disabled)",
					);
		if (!next) {
			rootRef?.focus();
			return;
		}
		// 兜底到别的块时同步 roving tabindex，避免 Tab 又跳回旧块
		const position = Number(next.dataset.poolFocus);
		if (Number.isFinite(position)) setFocusIndex(position);
		next.focus();
	};
	/** tile 宽度与间距从 DOM 实测，不和样式表里的数值各写一份 */
	const updateColumns = () => {
		const el = poolRef;
		const tile = el?.querySelector<HTMLElement>("[data-pool-tile]");
		if (!el || !tile) return;
		if (!(tile.offsetWidth > 0)) return;
		const gap = Number.parseFloat(getComputedStyle(el).columnGap) || 0;
		setColumns(columnsForWidth(el.clientWidth, tile.offsetWidth, gap));
	};

	const syncTokenInput = (next: Pick[]) => {
		setPicks(next);
		props.onTokenInput(phoneticToString(next.map((pick) => pick.token)));
	};

	const add = (item: PhoneticPoolItem, position: number) => {
		if (disabled() || used().has(item.index)) return;
		const nextPicks = [
			...picks(),
			{ token: item.token, poolIndex: item.index },
		];
		syncTokenInput(nextPicks);
		// 刚放的块立刻变灰禁用，焦点不能留在原地：顺延到下一个没用的块，
		// 键盘用户才能一路 Enter 放完；全放完落到根容器，仍可 Ctrl+Enter 提交。
		const taken = new Set(nextPicks.map((pick) => pick.poolIndex));
		const pool = props.phonetic.pool;
		const nextPosition = Array.from(
			{ length: pool.length },
			(_, offset) => (position + offset + 1) % pool.length,
		).find((candidatePosition) => {
			const candidate = pool[candidatePosition];
			return Boolean(candidate) && !taken.has(candidate.index);
		});
		if (nextPosition === undefined) {
			rootRef?.focus();
			return;
		}
		setFocusIndex(nextPosition);
		requestAnimationFrame(() => focusTile(nextPosition));
	};
	const removeAt = (index: number) => {
		if (disabled()) return;
		syncTokenInput(picks().filter((_, i) => i !== index));
	};
	const clear = () => {
		if (disabled() || picks().length === 0) return;
		syncTokenInput([]);
		// 清空后所有块恢复可用，焦点送回池子，键盘流不中断
		setFocusIndex(0);
		requestAnimationFrame(() => focusTile(0));
	};
	const play = (token: string, key: string) => {
		if (props.paused) return;
		props.onPlay(token, key);
	};

	/** chip 右半喇叭：重音符号没有音频，用灰态说明而不是假装可播 */
	const chipSpeaker = (pick: Pick, index: number) => {
		const key = `chip-${index}`;
		if (isStressToken(pick.token)) {
			return (
				<span
					class="flex w-7 items-center justify-center border-l border-soft text-[10px] text-ink-faint"
					title="重音符号不发音"
				>
					·
				</span>
			);
		}
		return (
			<button
				type="button"
				class="flex w-7 items-center justify-center border-l border-soft text-ink-faint transition hover:bg-brand/10 hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand"
				onClick={() => play(pick.token, key)}
				aria-label={`播放音素 ${pick.token}`}
				title={`播放音素 ${pick.token}`}
				aria-pressed={props.playingKey === key}
				disabled={Boolean(props.paused)}
			>
				<Volume2
					class={`h-3.5 w-3.5 ${
						props.playingKey === key ? "animate-pulse text-brand" : ""
					}`}
				/>
			</button>
		);
	};

	const onPoolKeyDown = (
		event: KeyboardEvent,
		position: number,
		item: PhoneticPoolItem,
	) => {
		const count = props.phonetic.pool.length;
		let next: number | null = null;
		if (event.key === "ArrowRight") next = Math.min(count - 1, position + 1);
		else if (event.key === "ArrowLeft") next = Math.max(0, position - 1);
		else if (event.key === "ArrowUp")
			next = Math.max(0, position - Math.max(1, columns()));
		else if (event.key === "ArrowDown")
			next = Math.min(count - 1, position + Math.max(1, columns()));
		else if (event.key === "Home") next = 0;
		else if (event.key === "End") next = count - 1;
		if (next !== null) {
			event.preventDefault();
			setFocusIndex(next);
			requestAnimationFrame(() => focusTile(next as number));
			return;
		}
		if (event.key === "Enter" && event.shiftKey) {
			event.preventDefault();
			event.stopPropagation();
			play(item.token, `pool-${item.index}`);
		}
	};

	const onRootKeyDown = (event: KeyboardEvent) => {
		if (props.paused) return;
		if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
			event.preventDefault();
			event.stopPropagation();
			if (!submitted()) props.onSubmit();
			return;
		}
		if (event.key === "Backspace") {
			event.preventDefault();
			if (event.shiftKey) {
				const last = picks().at(-1);
				if (last) play(last.token, `chip-${picks().length - 1}`);
			} else {
				removeAt(picks().length - 1);
			}
			return;
		}
		if (event.key === "Delete") {
			event.preventDefault();
			clear();
			return;
		}
		if (event.key === "F1") {
			event.preventDefault();
			event.stopPropagation();
			props.onOpenChart();
		}
	};

	// 每一轮重置：池子第一块自动聚焦（音标模式的所有操作都能从键盘开始）
	createEffect(() => {
		// 显式依赖轮次身份，切词/重开都清空
		void props.index;
		void props.word;
		setPicks([]);
		setFocusIndex(0);
		requestAnimationFrame(() => {
			focusTile(0);
			updateColumns();
		});
	});

	onMount(() => {
		// 音标表关闭后焦点回池子；父级负责恢复倒计时与音频
		const onMessage = (event: MessageEvent) => {
			if (event.origin !== window.location.origin) return;
			if (
				typeof event.data === "object" &&
				event.data !== null &&
				(event.data as { type?: unknown }).type === "mds-phonetic-chart-closed"
			) {
				requestAnimationFrame(() => focusTile(focusIndex()));
			}
		};
		window.addEventListener("message", onMessage);
		updateColumns();
		const observer = new ResizeObserver(updateColumns);
		if (poolRef) observer.observe(poolRef);
		onCleanup(() => {
			window.removeEventListener("message", onMessage);
			observer.disconnect();
		});
	});

	const playStatus = () => {
		if (props.speechDone) return "播报完成";
		if (props.sounding)
			return `正在播报 · 第 ${Math.max(1, props.repeatIndex + 1)} 遍`;
		return "请作答…";
	};

	return (
		<div
			ref={rootRef}
			tabIndex={-1}
			class="relative flex h-full flex-col gap-3.5 overflow-hidden p-7 outline-none"
			onKeyDown={onRootKeyDown}
		>
			{/* 顶部 */}
			<div class="flex items-center justify-between">
				<span class="rounded-full bg-surface px-4 py-2.5 font-data text-sm text-ink-soft shadow-sm">
					第 {props.index + 1} / {props.total} 个
				</span>
				<div class="flex items-center gap-2">
					<button
						type="button"
						class="flex items-center gap-1.5 rounded-full bg-surface px-3 py-2 text-[12px] text-ink-soft shadow-sm transition hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
						onClick={props.onOpenChart}
						title="全屏查看音标表（F1）"
					>
						<LayoutGrid class="h-4 w-4 text-brand" />
						音标表
					</button>
					<Show when={props.paused}>
						<span class="rounded-full bg-soft px-3 py-2 text-[12px] text-ink-faint">
							已暂停
						</span>
					</Show>
					<span class="flex items-center gap-2 rounded-full bg-surface px-4 py-2.5 shadow-sm">
						<Volume2 class="h-4 w-4 text-brand" />
						<span class="font-data text-sm text-ink">{playStatus()}</span>
					</span>
				</div>
			</div>

			{/* 倒计时 */}
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

			{/* 单词/答案/池子顶部对齐（与 .pen 34 一致）；底部操作条绝对定位覆盖，
			   池子行数变多时可以自然长到操作条后面被遮住，不把按钮顶出屏幕。 */}
			<div class="flex min-h-0 flex-1 flex-col gap-3.5">
			<div class="flex items-center gap-4 rounded-2xl bg-surface px-5 py-3 shadow-sm">
				<div class="flex min-w-0 flex-1 flex-col">
					<span class="text-[11px] text-ink-faint">
						看单词，点选音标
					</span>
					<span
						class="truncate font-heading text-[30px] leading-tight text-ink"
						title={props.word}
					>
						{props.word}
					</span>
				</div>
				<span class="shrink-0 rounded-full bg-brand/10 px-3 py-1 text-[11px] text-brand">
					英式
				</span>
			</div>

			<div
				class={`flex min-h-[62px] flex-wrap items-center gap-1.5 rounded-2xl border-[1.5px] px-3 py-2 ${
					submitted()
						? "border-ok bg-ok-bg"
						: "border-soft bg-surface"
				}`}
				role="group"
				aria-label="已放置的音标"
			>
				<Show
					when={picks().length > 0}
					fallback={
						<span class="px-1 text-[13px] text-ink-faint">
							从下面点选音标，按顺序拼出这个词…
						</span>
					}
				>
					<Show when={submitted()}>
						<Check class="mr-1 h-4 w-4 shrink-0 text-ok" />
					</Show>
					<For each={picks()}>
						{(pick, index) => (
							<div class="flex h-9 items-stretch overflow-hidden rounded-lg border border-soft bg-surface shadow-sm">
								<button
									type="button"
									class="flex min-w-7 items-center justify-center px-2 font-data text-[17px] text-ink transition hover:bg-err-bg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand disabled:cursor-default"
									onClick={() => removeAt(index())}
									aria-label={`移除音素 ${pick.token}`}
									title="点击移除"
									disabled={disabled()}
								>
									{pick.token}
								</button>
								{chipSpeaker(pick, index())}
							</div>
						)}
					</For>
					<span class="ml-1 text-[11px] text-ink-faint">
						{picks().length} / {targetCount()}
					</span>
				</Show>
			</div>

			{/* 音标池 */}
			<div class="flex items-center justify-between px-0.5">
				<span class="text-[12px] text-ink-faint">
					音标池 · 左放入 / 右试听
				</span>
				<span class="font-data text-[11px] text-ink-faint">
					{picks().length > 0 && !submitted()
						? "Backspace 撤销"
						: "Enter 选取"}
				</span>
			</div>
			<div
				ref={poolRef}
				role="group"
				aria-label="音标池"
				class="flex min-h-[232px] flex-wrap content-start gap-2"
			>
				<For each={props.phonetic.pool}>
					{(item, position) => {
						const tileUsed = () => used().has(item.index);
						const isStress = isStressToken(item.token);
						return (
							<div
								data-pool-tile
								class={`flex h-11 w-[125px] shrink-0 items-stretch overflow-hidden rounded-xl border-[1.5px] bg-surface shadow-sm transition ${
									tileUsed()
										? "border-soft opacity-35"
										: "border-soft hover:border-brand/40"
								}`}
							>
								<button
									type="button"
									data-pool-focus={position()}
									tabIndex={focusIndex() === position() ? 0 : -1}
									class="flex min-w-0 flex-1 items-center justify-center font-data text-[19px] text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand disabled:cursor-not-allowed"
									onFocus={() => setFocusIndex(position())}
									onClick={(event) => {
										if (event.shiftKey) return;
										add(item, position());
									}}
									onKeyDown={(event) =>
										onPoolKeyDown(event, position(), item)
									}
									disabled={disabled() || tileUsed()}
									aria-label={`放入音素 ${item.token}`}
									title={`放入 ${item.token}`}
								>
									{item.token}
								</button>
								{isStress ? (
									<span
										class="flex w-6 items-center justify-center border-l border-soft text-[10px] text-ink-faint"
										title="重音符号不发音"
									>
										·
									</span>
								) : (
									<button
										type="button"
										tabIndex={-1}
										class="flex w-6 items-center justify-center border-l border-soft text-ink-faint transition hover:bg-brand/10 hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-40"
										onClick={() =>
											play(item.token, `pool-${item.index}`)
										}
										aria-label={`试听音素 ${item.token}`}
										title={`试听 ${item.token}（Shift+Enter）`}
										disabled={Boolean(props.paused) || submitted()}
										aria-pressed={
											props.playingKey === `pool-${item.index}`
										}
									>
										<Volume2
											class={`h-3 w-3 ${
												props.playingKey === `pool-${item.index}`
													? "animate-pulse text-brand"
													: ""
											}`}
										/>
									</button>
								)}
							</div>
						);
					}}
				</For>
			</div>

			</div>

			{/* 底部操作条：贴屏幕底、默认背景色、z 高于池子；池子行数多时被它遮住 */}
			<div class="absolute inset-x-0 bottom-0 z-20 flex flex-col gap-2 bg-canvas px-7 pb-7 pt-3">
				<div class="flex h-5 items-center justify-center">
					<span class="truncate text-[12px] text-ink-faint">
						{props.paused
							? "默写已暂停：关闭音标表后从当前这一遍继续"
							: submitted()
								? "已提交，等语音播完进入下一轮"
								: "点选音标 · Enter 选取 · Shift+Enter 试听 · Backspace 撤销 · Ctrl+Enter 提交"}
					</span>
				</div>
				<div class="flex items-center justify-center gap-3">
					<button
						type="button"
						class="flex items-center gap-1.5 rounded-xl border-[1.5px] border-soft bg-surface px-4 py-2.5 text-[13px] text-ink-soft shadow-sm transition hover:border-brand/40 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
						onClick={clear}
						disabled={disabled() || picks().length === 0}
					>
						<Trash2 class="h-4 w-4" />
						清空
					</button>
					<button
						type="button"
						class="flex items-center gap-1.5 rounded-xl bg-brand px-5 py-2.5 text-[13px] text-white shadow-sm transition hover:brightness-105 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-45"
						onClick={() => {
							if (!submitted()) props.onSubmit();
						}}
						disabled={disabled()}
					>
						<Check class="h-4 w-4" />
						提交
						<span class="text-[10px] text-white/70">Ctrl+Enter</span>
					</button>
				</div>
			</div>
		</div>
	);
}
