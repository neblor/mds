# 混合模式（mixed）实施报告

> 日期：2026-11-09 ｜ 方案：`plans/mixed-mode.md` ｜ 设计：`.design/mds.md` 第七批 37–40
> 结论：已实现并通过 `pnpm check`（899 个单测 + Web 生产构建 + 冒烟）。

## 1. 需求与决策

崔总 2026-10-29：混合模式里每个单词在**释义 / 中文词 / 短句**中取 2 个默写，20 词 = 40 遍。

| # | 决策 |
| --- | --- |
| 1 | 每词**随机**取 2 种（三种配对等概率；一场里三种都会出现） |
| 2 | 整场 2n 轮打乱，**同词两轮至少隔 `max(3, round(0.3n))` 轮**（20 词 → 6），不做两遍制 |
| 3 | 同词**第 1 次**出现的释义/中文词轮 = 两段式；**第 2 次** = **只写第二步**；并统一改造所有两段式赛博界面提示 |
| 4 | 逐轮记分（x/40）+ 词级汇总（y/20，两轮全对才算对）；逐行带模式标签 |

## 2. 交付内容

### 纯逻辑

| 文件 | 内容 |
| --- | --- |
| `src/lib/mixed-mode.ts`（新） | `buildMixedPlan`（种子布局 + 只接受合法间隔的随机换位）、`mixedMinGap`、`applyMixedAvailability`、`roundAskOf`、`isSecondStepOnly`、`secondStepLabel`、`uniqueMixedWords` |
| `src/lib/timing.ts` | `secondStepOnlyDuration`：单步轮删掉「写单词」占用的 `LETTER_SECONDS×L×遍数`，只留每遍思考 + 第二步段 |
| `src/lib/state.ts` | `ContentMode` / `CONTENT_MODES` 加 `mixed`（历史与持久化白名单同一处） |
| `src/lib/results.ts` | 行级 `mode`/`pass`；`buildFields` 按 `roundAskOf` 生成字段（`second` 轮**不产生 word 字段**）；`gradeKey(kind, word)`；`wordSummary`；`mixed` 标签与判定说明 |
| `src/lib/review-types.ts` | `REVIEW_MODES` 加 `mixed`（session 用；日志仍记真实模式） |
| `src/lib/review-service.ts` | `buildCommitItems` 逐行 mode 优先（混合不写成 mixed）；保留短句/音标降级轮记 word 的既有规则 |
| `src/lib/dictation-input.ts` | `timedOutInputPatch` 改按 `RoundAsk` 封口（`second` 只封 answerDef） |

### 编排

| 文件 | 内容 |
| --- | --- |
| `src/lib/use-dictation.ts` | `WordRound.mode/pass/note`；`buildMixedRounds`；`prepareMixed`（三类 AI 并行 → 可用性改配 → 词音/句音两轨 → 再按句音改配）；`askOf` 驱动 `step`/`inputDone`/超时封口；`finishDictation` 按轮判断是否批改；`runGrading` 按 kind 分组两次请求并合并 `kind:word` 键；混合 AI 未配置提示 |

### 界面

| 文件 | 内容 |
| --- | --- |
| `src/components/DictatingView.tsx` | 本轮徽标（品牌胶囊）、`① 单词` / `② 释义（中文词）` 语义化徽标、单步轮只有一格 + 「不用写单词」、按 `ask` 给状态文案与占位符、进度按「轮」 |
| `src/components/ResultsView.tsx` | 逐行模式胶囊 + 「只写释义/中文词」胶囊；混合顶部副胶囊 `y / M 词` |
| `src/components/WordBank.tsx` | 第 7 项「混合」（`shuffle`）；滑块 500px；控制行 `flex-wrap` |
| `src/components/ModeActions.tsx` | 混合模式也显示「更新短句」（它会用到短句缓存） |
| `src/lib/ready-overlay.ts` | 混合文案：`40 轮 · 每个词默 2 遍 · 释义/中文词/短句随机搭配 · 顺序已打乱` |
| `src/routes/index.tsx` | 轮级 `contentMode`/`ask`/`roundBadge`/`unit` 接线 |
| `src/lib/history-storage.ts` | 历史行保留 `mode`/`pass`（回看显示本轮模式） |
| `src/lib/icons.tsx` | 新增 `Shuffle` 按需导出 |

### 设计

- `.design/mds.pen` 第七批 **37–40**：词库页（混合）/ 默写中（第 1 次两段式）/ 默写中（第 2 次单步）/ 结果页（逐轮标签 + 词级分）。
- 截图：`.design/mixed-mode-wordbank.png`、`mixed-mode-dictating-first.png`、`mixed-mode-dictating-second.png`、`mixed-mode-result.png`。
- 本轮改用 **headless `pen` CLI** 操作 `.pen`（不再依赖 VS Code 打开文档），通道规则已写入全局 `~/.pi/agent/AGENTS.md`。

## 3. 关键实现

### 3.1 顺序下限是构造性保证

种子布局把每词的两次出现放在 `i` 与 `n+i`（间隔恒为 n），随后做 `40n` 次随机换位，**只接受不破坏任何受影响词间隔的交换**。因此 `mixedMinGap` 不是重试出来的概率保证，测试可直接断言（5/10/20/30 词 × 多个种子）。

### 3.2 作答形态只有一个真源

`roundAskOf(round, sessionMode)` → `word | word+second | second | sentence`。
`DictatingView`、`step()`、`inputDone()`、超时封口、结果字段全部读它；单一模式场次没有 `round.mode` 时回落到场次模式，行为与改造前**完全一致**（所有旧测试未改即通过）。

### 3.3 批改键不能只按词

混合里同一个词可能既有释义轮又有中文词轮。改为**按 kind 分组并行两次请求**，override 表键为 `kind:word`（`gradeKey`）。测试用一个词两种 kind 给相反判定，验证互不覆盖。

### 3.4 写回与统计

- `session.content_mode = "mixed"`，`review_log.mode` 记每轮真实模式 → 学习档案的「模式占比」不会被 mixed 污染。
- 一词两轮仍由 `aggregateItemsByWord` 聚合成一张卡：两轮全对才 Good，一错即 Again（既有语义）。
- `judged = 40`（题）、`word_count = 20`（词），与组句一轮多空同构；「最近练习」显示 32/40。

## 4. 验证

```bash
pnpm test:run   # 84 文件 / 899 测试 全绿
pnpm check      # Vitest → Web 生产构建 → Web 生产冒烟 全绿
```

新增测试覆盖：

- `mixed-mode.test.ts`：每词 2 轮、两种模式互异、三种配对都会出现、间隔下限（5/10/20/30 × 5 个种子）、不是两遍制、降级改配保持顺序/pass、两种都不可用 → word、`roundAskOf` 四种形态与单一模式回落。
- `timing.test.ts`：`secondStepOnlyDuration` 释义/中文词公式、与两段式的差值 = 写单词占用、档位×倍率。
- `results.test.ts`：逐轮 mode/pass；`second` 轮无 word 字段；混合标签与判定说明；`gradeKey` 覆盖表。
- `review-service.test.ts`：逐行模式写回；混合场次 4 题 / 2 词、卡片各推一次、一错即 Again、`judged=4 & wordCount=2`。
- `use-dictation.test.ts`：混合准备（三类 AI 各一次、每词两轮）、全失败中止、赛博两段式 + 单步轮驱动、两次批改且不碰撞、单步轮无单词字段、书写不批改且历史记 mixed。
- `dictation-input.test.ts` / `state.test.ts` / `history-storage.test.ts` / `ready-overlay.test.ts`：封口形态、白名单、逐行 mode/pass 往返、文案。

## 5. 手工验收清单（建议）

1. 词库页：滑块 7 项、选中「混合」；书写按钮**不**置灰；右侧显示「更新短句」。
2. 取 20 词开始赛博：Ready 显示 `40 轮 …`；默写页顶部 `第 x / 40 轮`，中间品牌胶囊显示 `本轮：xxx · 第 1|2 次`。
3. 第 2 次出现的释义/中文词轮：**只有一格输入**、右侧「不用写单词」、回车直接提交；结果页该行没有单词作答。
4. 倒计时结束自动提交：单步轮只提交第二步（不产生空单词判错）。
5. 结果页：`x/40` + `y/20 词`；每行模式胶囊；第 2 次行有「只写…」胶囊。
6. 学习档案：最近练习显示 `x / 40`，模式占比仍是释义/中文词/短句（没有「混合」行）。
7. 窄窗（747 最小宽）：控制行换行、滑块不挤（本轮未单独出 747 设计稿，见 FUTURE）。

## 6. 本轮不做（已登记 FUTURE.md）

- 混合配对偏好（固定配对 / 权重 / 用户手选）
- 混合结果按词分组的视图（现在逐轮平铺 + 词级汇总）
- 混合与音标/组句组合（现在固定三选二）
- 间隔下限的用户可调设置（现在按词数自动）
- 747 窄窗设计稿（仅实现后核验）
