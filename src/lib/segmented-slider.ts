/**
 * SegmentedSlider 的纯计算逻辑（可单测）
 *
 * 拖拽/点击位置 → 选项索引：按指针在轨道内的相对位置取整。
 * 边界外（左/右超出轨道）一律 clamp 到最近选项，不产生越界索引。
 */

export interface PointerGeometry {
	/** 指针相对视口的 X（clientX） */
	clientX: number;
	/** 轨道矩形左边缘 */
	rectLeft: number;
	/** 轨道宽度（px） */
	rectWidth: number;
	/** 选项数量（至少 1） */
	optionCount: number;
}

export function indexAtPointer(opts: PointerGeometry): number {
	const { clientX, rectLeft, rectWidth, optionCount } = opts;
	if (optionCount <= 0 || rectWidth <= 0) return 0;
	const ratio = (clientX - rectLeft) / rectWidth;
	const raw = Math.floor(ratio * optionCount);
	return Math.min(optionCount - 1, Math.max(0, raw));
}
