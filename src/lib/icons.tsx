/**
 * lucide 按需入口（dev 优化）
 * lucide-solid 的 exports 有 "solid" 条件 → vite-plugin-solid 解析到全量源码入口
 * （dist/source/lucide-solid.jsx，~2MB），dev 模式不做树摇 → 整个图标库载入。
 * 本文件只 re-export 应用实际用到的 icon，走包的 `./icons/*` 子路径导出：
 * 该子路径同时带 types 与 solid 条件（解析到 dist/source/icons/<name>.jsx，单文件 ~1KB），
 * 因此 tsc 能解析类型、dev/build 都只包含这些图标。
 * 升级 lucide-solid 时注意图标名（kebab-case）。
 */
export { default as Star } from "lucide-solid/icons/star";
export { default as Settings } from "lucide-solid/icons/settings";
export { default as PenLine } from "lucide-solid/icons/pen-line";
export { default as Keyboard } from "lucide-solid/icons/keyboard";
export { default as Trash2 } from "lucide-solid/icons/trash-2";
export { default as X } from "lucide-solid/icons/x";
export { default as CircleCheckBig } from "lucide-solid/icons/circle-check-big";
export { default as Play } from "lucide-solid/icons/play";
export { default as Minus } from "lucide-solid/icons/minus";
export { default as Plus } from "lucide-solid/icons/plus";
export { default as Timer } from "lucide-solid/icons/timer";
export { default as Volume2 } from "lucide-solid/icons/volume-2";
export { default as Check } from "lucide-solid/icons/check";
export { default as Sparkles } from "lucide-solid/icons/sparkles";
export { default as OctagonX } from "lucide-solid/icons/octagon-x";
export { default as ListPlus } from "lucide-solid/icons/list-plus";
export { default as Type } from "lucide-solid/icons/type";
export { default as BookOpen } from "lucide-solid/icons/book-open";
export { default as Languages } from "lucide-solid/icons/languages";
export { default as Loader2 } from "lucide-solid/icons/loader-2";
export { default as History } from "lucide-solid/icons/history";
export { default as ChevronRight } from "lucide-solid/icons/chevron-right";
export { default as RotateCcw } from "lucide-solid/icons/rotate-ccw";
export { default as ScrollText } from "lucide-solid/icons/scroll-text";
export { default as Undo2 } from "lucide-solid/icons/undo-2";
export { default as Library } from "lucide-solid/icons/library";
export { default as ChevronDown } from "lucide-solid/icons/chevron-down";
export { default as RefreshCw } from "lucide-solid/icons/refresh-cw";
export { default as Download } from "lucide-solid/icons/download";
export { default as Folder } from "lucide-solid/icons/folder";
export { default as ArrowLeft } from "lucide-solid/icons/arrow-left";
export { default as Copy } from "lucide-solid/icons/copy";
export { default as Info } from "lucide-solid/icons/info";
export { default as Pencil } from "lucide-solid/icons/pencil";
export { default as Upload } from "lucide-solid/icons/upload";
export { default as TextCursorInput } from "lucide-solid/icons/text-cursor-input";
export { default as MessageSquareQuote } from "lucide-solid/icons/message-square-quote";
