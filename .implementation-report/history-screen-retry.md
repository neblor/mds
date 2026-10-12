# 全屏默写历史 + 再次默写/恢复词汇

日期：2026-08-29（会话实施）

## 需求

- 历史记录由弹窗改为全屏界面
- 列表条目：日期时间 + 词汇列表预览（上限截断 + 渐变淡出）+ 正确率 `答对/总数`，右侧「结算画面」「再次默写」两个入口
- 「再次默写」：先把当前词表存入内存临时变量，再用历史词汇覆盖，关闭历史回主界面；输入行末尾出现 `Undo2` 图标「恢复词汇」按钮，仅暂存有值时显示，恢复为一次性
- 老数据兼容：无词汇的历史条目不显示词汇区、不提供「再次默写」
- 用户确认：暂存仅内存（刷新失效）、再次默写不改动内容模式

## 关键决策

- **流程偏差**：本会话无 Pencil MCP 工具，`.pen` 视觉设计步骤跳过，直接沿用项目既有视觉语言（surface 卡片 / 胶囊 / 圆角体系）实现
- 新增纯逻辑模块 `src/lib/history-screen.ts`：`normalizeRetryWords` / `extractHistoryWords` / `canRetryHistory` / `planRetry`（覆盖前暂存编排）、`HISTORY_PREVIEW_MAX = 18`；曾实现的 `createWordStash` 闭包被删除——界面层 signal 已足够，避免出现未被生产使用的平行状态模型
- `HistoryScreen` 替换并删除 `HistoryDialog`；Escape 分层（详情→列表→关闭）沿用 `history-dialog.ts` 的纯函数；结算详情仍复用 `ResultsView`（全屏承载）
- 词汇预览：`max-h-[74px]` 裁剪 + `words.length > 18` 时叠加 `bg-gradient-to-t from-surface` 渐变淡出遮罩（渐变只在超出上限时出现，不误导未截断的条目）
- `use-dictation` 新增 `replaceWords`（trim/丢空/去重后整体覆盖并走 `saveWords` 持久化），再次默写回填与恢复暂存共用该通道；暂存本体是 `index.tsx` 里的内存 signal，不持久化
- icons.tsx（lucide 按需入口）新增 `RotateCcw`（再次默写）、`ScrollText`（结算画面）、`Undo2`（恢复词汇）
- `history-storage` 结构不动，老数据天然兼容（rows 必带 word，仍做防御式提取）

## 结果

- `pnpm test:run`：39 文件 335 测试全过（新增 `history-screen.test.ts` 与 `replaceWords` 用例）
- `pnpm check`：Vitest + 生产构建 + Web 冒烟通过

## 后续可处理

- 若 Pencil MCP 可用后，可补 `.pen` 设计稿做视觉回归对齐
- 预览渐变目前绑定"超过 18 个"才出现；若希望"换行超出 74px 也淡出"需改用内容高度判断

## 追加：历史记录覆盖书写模式（2026-08-29 第二轮）

- `HistoryEntry` 新增 `mode: "writing" | "cyber"`；老数据无该字段兼容为 `cyber`，`history-storage` 读取时归一
- `use-dictation.enterResults` 改为书写与赛博都记录；书写条目 rows 为无批改参考字段（单词模式 fields 为空），`gradeNote` 恒 null
- `HistoryScreen` 标题/入口统一改为「默写记录」；列表徽标带 书写/赛博 · 内容模式；书写条目正确率位置显示 `— / N`（title「书写模式不评分」）；结算回看把 `entry.mode` 透传给 `ResultsView`（书写态无对错标色、无得分、无判定说明，仅参考字段对照）
- 书写模式现场结算验证：`finishDictation` → `enterResults` 直达，`ResultsView` 的 writing 分支（无评分徽标/无 Check-X/无庆祝）本就完备，问题只在历史不记录，已修复
- WordBank 入口按钮 aria/title 同步为「默写记录 · 最近 5 场」
- 测试：`history-storage.test`（mode 归一 + writing 计 0 分 + buildHistoryEntry mode）、`use-dictation.test`（书写记录历史断言替换原「不记录」用例、cyber 用例断言 mode）；`pnpm check` 全绿（336 测试）
