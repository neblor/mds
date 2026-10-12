/**
 * SegmentedSlider — 可滑动、可扩展的选择条组件。
 *
 * - 通用：options 传入任意字符串值选项（可带图标），点击或左右拖动滑块切换
 * - 键盘：焦点在组件上时 ←/→/Home/End 切换（键盘流铁律）
 * - 纯计算逻辑见 lib/segmented-slider.ts（可单测）
 */
import { For, Show, createSignal, type Component } from "solid-js";
import { indexAtPointer } from "~/lib/segmented-slider";

export interface SliderOption<T extends string> {
	value: T;
	label: string;
	icon?: Component<{ class?: string }>;
}

/** 指针位移超过该像素才算拖拽（否则视为点击，切换走过渡动画） */
const DRAG_THRESHOLD_PX = 6;

interface Props<T extends string> {
	options: SliderOption<T>[];
	value: T;
	onChange: (value: T) => void;
	ariaLabel?: string;
	/** 附加到根容器的类（如宽度控制） */
	class?: string;
}

export default function SegmentedSlider<T extends string>(props: Props<T>) {
	let trackRef!: HTMLDivElement;
	const [dragIndex, setDragIndex] = createSignal<number | null>(null);
	const dragging = () => dragIndex() !== null;
	/** 指针按下位置与是否已进入拖拽（超过阈值才跟手，纯点击留给过渡动画） */
	let pointerDown = false;
	let pointerStartX = 0;
	let dragStarted = false;

	const currentIndex = () => {
		const drag = dragIndex();
		if (drag !== null) return drag;
		const i = props.options.findIndex((o) => o.value === props.value);
		return Math.max(0, i);
	};

	const indexFromPointer = (clientX: number) => {
		const rect = trackRef.getBoundingClientRect();
		return indexAtPointer({
			clientX,
			rectLeft: rect.left,
			rectWidth: rect.width,
			optionCount: props.options.length,
		});
	};

	const onPointerDown = (e: PointerEvent) => {
		if (props.options.length <= 1) return;
		trackRef.setPointerCapture(e.pointerId);
		pointerDown = true;
		pointerStartX = e.clientX;
		dragStarted = false;
	};
	const onPointerMove = (e: PointerEvent) => {
		// 未按下（悬停移动）不响应，避免误判拖拽
		if (!pointerDown) return;
		// 未进入拖拽：位移超过阈值才算滑动（否则视为点击，切换交给过渡动画）
		if (!dragStarted) {
			if (Math.abs(e.clientX - pointerStartX) < DRAG_THRESHOLD_PX) return;
			dragStarted = true;
		}
		setDragIndex(indexFromPointer(e.clientX));
	};
	const onPointerUp = (e: PointerEvent) => {
		const dragged = dragIndex();
		setDragIndex(null);
		dragStarted = false;
		pointerDown = false;
		// 拖拽：提交跟手槽位；纯点击：提交抬起位置的槽位（切换走过渡动画）。
		// 不能依赖按钮 click 事件：指针捕获会把 click 重定向到轨道容器。
		const target = dragged ?? indexFromPointer(e.clientX);
		if (target !== currentIndex()) {
			props.onChange(props.options[target].value);
		}
	};
	const onPointerCancel = () => {
		setDragIndex(null);
		dragStarted = false;
		pointerDown = false;
	};
	const onKeyDown = (e: KeyboardEvent) => {
		const i = currentIndex();
		let next: number | null = null;
		if (e.key === "ArrowRight") next = Math.min(props.options.length - 1, i + 1);
		else if (e.key === "ArrowLeft") next = Math.max(0, i - 1);
		else if (e.key === "Home") next = 0;
		else if (e.key === "End") next = props.options.length - 1;
		if (next === null) return;
		e.preventDefault();
		props.onChange(props.options[next].value);
	};

	return (
		<div
			ref={trackRef}
			role="radiogroup"
			tabIndex={0}
			aria-label={props.ariaLabel}
			class={`relative flex min-h-9 select-none rounded-full bg-soft p-1 shadow-inner outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${props.class ?? ""}`}
			style={{ "touch-action": "none" }}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={onPointerCancel}
			onKeyDown={onKeyDown}
		>
			{/* 滑动滑块：宽度=槽宽，translateX(索引×100%) 逐槽滑动 */}
			<div
				class="absolute bottom-1 left-1 top-1 rounded-full bg-brand shadow-sm"
				style={{
					width: `calc((100% - 8px) / ${Math.max(1, props.options.length)})`,
					transform: `translateX(${currentIndex() * 100}%)`,
					transition: dragging()
						? "none"
						: "transform 0.22s cubic-bezier(0.22, 0.61, 0.36, 1)",
				}}
			/>
			<For each={props.options}>
				{(o, i) => {
					const active = () => currentIndex() === i();
					return (
						<button
							type="button"
							role="radio"
							tabIndex={-1}
							aria-checked={active()}
							class={`relative z-10 flex flex-1 items-center justify-center gap-1.5 rounded-full text-[13px] font-semibold transition-colors duration-150 ${
								active()
									? "text-white"
									: "text-ink-faint hover:text-ink"
							}`}
							onClick={() => props.onChange(o.value)}
						>
							<Show when={o.icon}>
								{(icon) => {
									const Icon = icon();
									return <Icon class="h-4 w-4" />;
								}}
							</Show>
							{o.label}
						</button>
					);
				}}
			</For>
		</div>
	);
}
