/**
 * lucide 按需入口（dev 优化）
 * lucide-solid 的 exports 有 "solid" 条件 → vite-plugin-solid 解析到全量源码入口
 * （dist/source/lucide-solid.jsx，~2MB），dev 模式不做树摇 → 整个图标库载入。
 * 本文件只 re-export 应用实际用到的 icon（深路径单文件 ~1KB），
 * 通过 vite alias 将 "lucide-solid" 指向这里，dev/build 都只包含这些图标。
 * 升级 lucide-solid 时注意深路径文件名（kebab-case）。
 */
export { default as Star } from "lucide-solid/dist/source/icons/star.jsx";
export { default as Settings } from "lucide-solid/dist/source/icons/settings.jsx";
export { default as PenLine } from "lucide-solid/dist/source/icons/pen-line.jsx";
export { default as Keyboard } from "lucide-solid/dist/source/icons/keyboard.jsx";
export { default as Trash2 } from "lucide-solid/dist/source/icons/trash-2.jsx";
export { default as X } from "lucide-solid/dist/source/icons/x.jsx";
export { default as CircleCheckBig } from "lucide-solid/dist/source/icons/circle-check-big.jsx";
export { default as Play } from "lucide-solid/dist/source/icons/play.jsx";
export { default as Minus } from "lucide-solid/dist/source/icons/minus.jsx";
export { default as Plus } from "lucide-solid/dist/source/icons/plus.jsx";
export { default as Timer } from "lucide-solid/dist/source/icons/timer.jsx";
export { default as Volume2 } from "lucide-solid/dist/source/icons/volume-2.jsx";
export { default as Check } from "lucide-solid/dist/source/icons/check.jsx";
export { default as Sparkles } from "lucide-solid/dist/source/icons/sparkles.jsx";
export { default as OctagonX } from "lucide-solid/dist/source/icons/octagon-x.jsx";
