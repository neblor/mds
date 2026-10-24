/**
 * 模式操作区的纯逻辑（组件在 components/ModeActions.tsx，逻辑放这里便于单测）
 */

/** 清短句缓存的结果文案 */
export function sentenceRefreshMessage(removed: number, total: number): string {
	if (total === 0) return "还没有可用的词";
	if (removed === 0) return "这些词还没有短句缓存，准备时会直接生成";
	return `已清掉 ${removed} 个词的短句，下次准备会重新生成`;
}
