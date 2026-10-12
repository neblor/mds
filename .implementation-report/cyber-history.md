# 赛博默写历史记录（最近 5 次）

> 日期：2026-08-21 · 方案存档：`plans/cyber-history.md` · 设计：`.design/mds.pen`（新增 History / History Detail 两个画板）

## 需求

词库主界面提供测试历史入口，点击弹出毛玻璃浮窗，展示最近 5 次赛博默写结果（localStorage 持久化），点击记录可回看同款结算画面。

## 实现概览

### 入口与弹窗

- `WordBank.tsx` 头部设置齿轮左侧新增 `History` 图标按钮（lucide，经 `src/lib/icons.tsx` 按需入口补 `history` / `chevron-right` 两个深路径 re-export）
- 新组件 `src/components/HistoryDialog.tsx`：遮罩与设置/批量导入同款（`bg-ink/30 backdrop-blur-sm`，遮罩点击关闭、面板内不误关）
- 两级视图：列表（时间 / 内容模式 pill / 词数 / 得分 / chevron）⇄ 详情（内嵌 `ResultsView`，免费获得红绿对照、得分、全对撒花）
- `ResultsView.tsx` 增加可选 `title` / `footerHint` / `class` props 同时服务现场结算与历史回看，默认行为不变

### 存储与录制

- 新模块 `src/lib/history-storage.ts`：key `mds.history.v1`，上限 5 条 prepend 截断；`normalizeHistory` 逐条校验形状并**重算** correctCount/wordCount（不信任存储值），损坏条目丢弃；SSR/配额异常静默降级
- `use-dictation.ts` 将三处进入 results 的路径（赛博单词直进 / AI 批改完成 / 中止批改降级）收口为唯一 `enterResults()`：赛博模式在判定（含 AI 覆盖与 gradeNote）落定后 `buildResultRows` 烘入判定再 `appendHistory`；书写模式不记录；每场只经此出口一次，无重复写入

### 发音试听

- 原 `playResultAudio` 抽取为通用工厂 `src/lib/result-audio.ts`（`createResultAudioPlayer(canPlay)`）：同一时间只播一个、迟到回调按 controller 身份失效、失败淘汰缓存
- 结算页实例限定 `phase() === "results"`（行为与原先完全一致），历史弹窗独立实例随弹窗生命周期（互斥不会同时发声）

### 键盘流

- Escape 分层：详情 → 返回列表 → 关闭弹窗；列表条目为原生 button（Tab + Enter 可操作）
- 关键修复：视图切换会卸载刚点击的按钮导致焦点回落 `body`、Escape 收不到 —— `openDetail`/`back` 后 `requestAnimationFrame` 把焦点拉回弹窗容器（`tabIndex=-1` + autofocus）

## 关键决策

| 决策 | 说明 |
| --- | --- |
| 只记录赛博模式 | 书写模式无批改；三种落地结算的路径（含中止批改降级）都记录，与"赛博流程跑到结算画面"语义一致 |
| 判定烘入历史 | 记录时用 `buildResultRows` + lastGrades 固化 correct/note，回看不依赖现场状态，也不会因后续缓存变化而变 |
| 计数读取时重算 | normalizeHistory 从 rows 重算 correctCount/wordCount，防止存储被篡改或损坏后界面显示错误汇总 |
| 详情面板 max-h 自适应 | 首版固定 `h-[86%]` 在记录少时下半段大片空白（视觉审查发现 ~310px 空洞）；改为 `max-h-[86%]` + ResultsView `flex-1 min-h-0`，内容少时收缩、多时内部滚动 |
| pencil MCP 不可用 | 本会话无 pencil MCP 工具，`.pen`（明文 JSON）按既有 token/节点范式直接编辑并保持 id 唯一性；视觉验证改由生产构建 + playwright 截图 + 视觉子代理审查完成 |

## 测试

- `history-storage.test.ts`（10 例）：normalize 校验/损坏丢弃/倒序截断、计数重算、append 置顶持久化、SSR/配额静默、buildHistoryEntry 汇总
- `result-audio.test.ts`（5 例）：播放状态同步、canPlay 拒绝、互斥播放与迟到回调失效、失败淘汰缓存、dispose 中止
- `use-dictation.test.ts` 扩展（4 例，走生产编排实现）：单词模式记录、AI 批改覆盖烘入、中止批改降级记录、书写模式不记录
- `history-dialog.test.ts`：时间格式化（跨年补年份、分补零）、Escape 分层
- 视觉冒烟：`.tmp/verify/*.png`（入口/列表/详情/关闭后/空态），子代理像素级复核通过

`pnpm check` 全绿：37 个测试文件 318 例 + 生产构建 + HTTP 冒烟。

## 后续可考虑

- 历史列表暂无「清空历史」（用户确认不加）；若未来加，`appendHistory` 旁补 `clearHistory` 即可
- 详情发音依赖音频缓存仍在；缓存被清理后按钮优雅失败（不影响回看），暂不打算回源重生成
- 若将来要记录书写模式（仅答案对照无判定），HistoryEntry.contentMode 需扩展 mode 字段，当前结构可直接容纳
