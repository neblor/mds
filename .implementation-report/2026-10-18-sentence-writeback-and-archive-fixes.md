# 短句写回为空 + 档案热力滚动条 + 模式操作区「更新短句」（实施报告）

> 状态：**已实施（2026-10-18）**。来源：崔总 2026-10-18 报告的三点
> ①短句模式做完一场后档案页全空（热力、最近练习 0、到期预测不对）
> ②档案热力图内部出现纵向滚动条 ③主界面模式滑块右侧要加「按模式变化的操作区」，短句模式先给「更新短句」。
> 相关：`.implementation-report/2026-10-17-sentence-mode.md`、`.implementation-report/2026-10-18-wordbank-stats.md`。

## 1. 症状与根因

### 1.1 短句场次写回为空（本轮的主 bug）

症状：小孩用**短句 + 赛博**做了一场 20 词（对了十几题），结算页关闭后档案页：
热力全空、最近练习 `0 / 20`、到期预测不对。

根因：**结算写回只认 `kind === "word"` 的判定字段，而短句轮的生产路径产出的是 `kind === "sentence"`。**

- 结果行由 `buildResultRows`（`src/lib/results.ts`）产出：短句轮 = `fields:[{ kind:"sentence", graded:true, correct }]`，
  只有**降级轮**（本词没拿到合格短句）才落回 `kind:"word"`。
- `buildCommitItems`（`src/lib/review-service.ts`）此前写死：
  `row.fields?.find((field) => field.kind === "word" && field.graded)` → 短句轮一个都匹配不上。
- 后果是**整场 items 为空**：`cards` 不更新（不排期→到期预测错）、`review_log` 不写（→热力图空、正确率 0），
  而 `session` 照写，且 `session.correct` 由 items 重算 → 正好是用户看到的 `0 / 20`。

为什么测试没抓到：原来的「短句写回」单测**手搓**了 `fields:[{ kind:"word", … }]` 这种生产不存在的形状，
于是测试全绿、生产恒空。这正是 `AGENTS.md` 里「单测必须直接覆盖生产实际调用的实现」要防的那类漂移。

### 1.2 热力图内部的纵向滚动条

`HeatmapCard` 的网格容器是 `min-h-0 overflow-x-auto`：
CSS 规定一轴为 `auto`、另一轴为 `visible` 时后者按 `auto` 计算 → 该容器**纵向也会出滚动条**。
而卡片是 `min-h-[260px] flex-1`、行/列写死 `min-h-[520px]`，窗口一矮（如 747×547 最小窗口），
flex 只能压这个 `min-h-0` 的网格容器 → 网格被压到比 158px（7×18 格 + 间距 + 内边距）矮 → 内部纵向滚动条。
设计与既有约定本来就写着「热力图横向滚动，**不压缩格子**」，是实现没做到。

### 1.3 「更新短句」缺失

短句缓存在 `<cacheDir>/sentences.json`（键 = 词，带 `model` + `contentLevel`），
命中就复用，用户没有「不满意这句、换一句」的入口。

## 2. 改动

### 2.1 结算写回（`src/lib/review-service.ts`）

- `buildCommitItems` 现在**认所有参与批改的字段**：这一行**每个 `graded` 字段都对**才算对。
  短句轮是 `sentence`（整句归一化比较），其余模式与短句降级轮是 `word`。
- 降级轮的判定改为**看判定字段种类**（是否出现 `sentence` 字段），不再依赖 `context` 是否为空——
  降级按 `word` 记账，避免污染模式维度统计（这条口径没变，只是判据更贴近生产形状）。
- `ResultRowLike.context` 保留为展示信息字段（不再参与判定）。
- 详见 §6（与学习状态对齐的复核）：该函数后续又做了两处口径修正（多字段对错 + 按轮取耗时）。

### 2.2 测试（`src/lib/review-service.test.ts`）

- 「短句写回」两条用例改为**走生产链路**：`buildResultRows(rounds, "cyber", "sentence")` → `buildCommitItems`，
  轮次数据用 `use-dictation` 的真实形状（`variant:"sentence" + sentence` vs 降级轮的 `variant:"word"`）。
- 新增 store 级回归「短句场次真的写进 cards / review_log」：
  断言 20/2 条目的 `mode`、`sessionId`、卡片键、`readDayStats` 的 `total/correct/elapsedMs`、
  以及场次 `correct` 由服务端按实际判定重算。
- 已验证该用例在旧逻辑下**必红**（临时把 `sentenceJudged` 置空复跑：2 failed）。

### 2.3 热力图（`src/components/BankArchiveScreen.tsx`）

- `HeatmapCard`：`flex min-h-[260px] flex-1` → `flex min-h-[296px] shrink-0 grow basis-0`
  （可长不可压，内容自然高 ≈ 287px）。
- 网格容器：`min-h-0 overflow-x-auto py-1` → `flex h-[176px] shrink-0 items-center overflow-x-auto overflow-y-hidden py-1`
  （158px 网格 + 18px 余量给横向滚动条；纵向显式 `hidden`，不留任何内部纵向滚动条）。
- 中部行与左右列**去掉写死的 `min-h-[520px]`**（保留行的 `flex-1`）：
  自动最小尺寸交给内容，空间不够时由**整页滚动**承担，而不是挤卡片。

### 2.4 模式操作区 +「更新短句」

- `src/components/ModeActions.tsx`（新）：模式滑块右侧的操作区，按 `contentMode` 显示；
  当前只有短句模式：`更新短句` 按钮（`refresh-cw` 图标、复用次按钮样式、`aria-label`/`title` 说明）+ 结果提示行
  （成功/无缓存/失败三态；离开短句模式即清掉旧提示，避免切回来看到过期结果）。
- `src/lib/mode-actions.ts`（新）：结果文案纯函数 `sentenceRefreshMessage(removed, total)`（组件只做渲染）。
- `src/lib/cache-storage.ts`：`RuntimeCacheStorage` 新增 `removeSentences(words): number`
  （大小写不敏感、保留其余词与 `model`/`contentLevel`、文件缺失/损坏/结构不认返回 0；仍走统一 storage 接口）。
- `src/routes/api/sentence-cache.ts`（新）：`POST /api/sentence-cache { words } → { removed }`，
  参数清洗复用 `extractWords`，上限 200 词（与队列上限对齐），空数组 400。
- `src/lib/api.ts`：`refreshSentences(words)`（浏览器端封装）。
- `src/components/WordBank.tsx`：控制条加 `<ModeActions contentMode queueWords />`；队列词取
  `vocab.queue()?.queue.words`（录入模式没有队列 → 按钮置灰并给出「先选词表/调大今天默几个」提示）。
- 语义：只清**当前今日队列**这些词的短句缓存；下次准备（`/api/sentences`）对这些词重新生句并各自写回缓存。

### 2.5 文档

- `AGENTS.md`：短句模式补「模式操作区 / 更新短句」；档案补热力网格高度与「不压缩」规则；
  「词库 / 复习 / 学习档案」补写回判定字段口径（`sentence` / `word`）。
- `.design/mds.md`：补第五批说明（模式操作区、热力卡固定高度与整页滚动）。
  `.pen` 未重切（该按钮是既有次按钮的实例化），已登记 `FUTURE.md`。
- `README.md`：功能列表与使用步骤补「更新短句」。

## 3. 验证

- `pnpm test:run`：**71 文件 / 768 用例全绿**（本轮新增 2 条短句写回用例、3 条 storage、4 条路由、3 条文案）。
- `pnpm exec tsc --noEmit`：0 报错。
- `pnpm check`：Vitest → 生产构建 → 生产冒烟 全通过。
- 真实浏览器端到端（一次性脚本，生产构建 + 临时数据目录 + Chromium，**14/14 通过**）：
  1. HTTP 造 24 词词库 → `POST /api/review-commit` 提交 20 词短句赛博场次 → 档案 API 显示热力今天 20 题、
     最近练习 `16 / 20`、近 7 天正确率 `16/20`、今天到期 20（修复前分别为 0/0/无）；
  2. 1120×820 与 747×547 两种尺寸下，热力网格 `overflow-y: hidden`、`scrollHeight == clientHeight`、
     180 格全部渲染，并在最小尺寸下自动转为横向滚动；
  3. 主界面切短句模式 → `更新短句` 出现 → 点击后提示「已清掉 4 个词的短句，下次准备会重新生成」，
     `sentences.json` 恰好只少队列里那 4 个词、`model`/`contentLevel` 保留；切回单词模式按钮消失；
     747 宽时模式行（691px）不横向溢出、按钮完整可见；全程无 `pageerror`。
- 截图（一次性产物，位于 `.tmp/archive-verify/`）：`archive-default.png`、`archive-min.png`、
  `main-sentence.png`、`main-sentence-after.png`、`main-sentence-747.png`。

## 4. 兼容与遗留数据

- **不动 schema、不动接口字段**：`review_log.mode` 本来就有 `sentence`（`REVIEW_MODES` 白名单），无需迁移。
- 修复前做的短句场次**无法回溯**：那场 `review_log` 从未写入（只有一条 `session`，`correct` 被算成 0）。
  按 append-only 原则不改写历史；档案里那一场会一直显示 `0 / N`，重做一场即可，统计从本版起正确。
- 「更新短句」只清文本缓存；短句音频按句子文本命名，重新生句后旧 mp3 成为无引用的孤儿文件（不清理，见 FUTURE）。

## 5. 与学习状态对齐的复核（第二轮，2026-10-18）

崔总要求「结合数据算法再 check 一遍：这些操作能不能跟单词的学习状态对得上」。逐条核过
`buildResultRows → buildCommitItems → commitReviews → 统计 SQL → 档案/队列` 整条链路，又找出 **4 处同类漂移**：

### 5.1 判定口径：拼写对、释义错也进了 FSRS 的 Good（已修）

- **现象**：释义/中文词模式一行有两个 `graded` 字段（单词严格匹配 + AI 批改的第二步），
  结算页按「两个都对」判 `✗`；但 `buildCommitItems` 只取 `word` 字段 → **档案记对、卡片按 Good 排期**。
  同一场在结算页和档案页会出现两个不同的正确数。
- **修正**：对错 = 该行**所有 `graded` 字段都对**（与 `rowJudgement` 同口径）。新增两条用例：
  拼写对+释义错 → 记错；两段都对 → 记对。

### 5.2 组句多空：耗时按行号取，整场耗时统计错位（已修）

- **现象**：`roundElapsed` 是**按轮**记的（一轮 = 一道组句题，可能 2–4 个空），
  但 `resultRows` 是**按空**展开的，`buildCommitItems` 用 `elapsedMs[rowIndex]` 取轮耗时：
  2 轮 × 2 空时，第 3/4 空拿到 `undefined → 0`，第 1/2 空各拿了一整轮的时间（实测
  `apple:12000, banana:20000, cherry:0, date:0`）。`session.activeMs` 按轮求和是对的，不受影响，
  但 `review_log.elapsed_ms`（将来做「按空耗时」分析的数据源）是错的。
- **修正**：`ResultRow` 新增 `roundIndex`（`buildResultRows` 写入）；`buildCommitItems` 按轮取耗时并
  **均分到该轮的各空**（无 `roundIndex` 时按行号兼容旧调用）。

### 5.3 同一个词一场推进两次 FSRS：会提前毕业（已修）

- **现象**：`commitReviews` 对每个 item 依次 `scheduler.review`；组句一轮里同一个词填两个空
  （`buildClozeRows` 明确允许），就变成同一时刻对同一张卡评两次分。实测 ts-fsrs：
  新卡在同一毫秒两次 Good → **直接从 Learning 跳过 10 分钟学习步、毕业到 Review，due 跳到 2 天后**；
  而正常路径应先停在当天学习步、隔天才拉开间隔。同一场多空也会让结算页 `updated` 出现重复词。
- **修正**：`commitReviews` 先用 `aggregateItemsByWord` **按词聚合卡片推进**（有一空错就记 Again，耗时求和），
  `review_log` 仍逐题写入（正确率、耗时、将来训练都需要逐题数据）。每个词的 `queueKind`/`stateBefore`/
  间隔变化由这次唯一推进提供，同词各题日志共享。用例：同词「错、对」→ 只推一次且记 Again；
  同词「对、对」→ 停在 Learning（`state=1`、`scheduled_days=0`）。

### 5.4 「最近练习」的得分分母：`correct` 曾按词数夹取（已修）

- **现象**：`session.correct` 由服务端按 items 重算后 `Math.min(words.length, …)`，
  而 `words` 是去重后的词、items 是逐空作答。组句 2 词 3 空对了 2 空 → 存成 `2 / 2`（假满分）；
  反过来 3 空全对也是 `2 / 2`。
- **修正**：分子按**题**计（= 结算页逐题数），分母改用 `judged`——`recentSessions` 新增一个
  `(SELECT COUNT(*) FROM review_log WHERE bank_id=? AND session_id=s.id)`，
  `review_log_session_idx (bank_id, session_id)` 让它走索引；书写场次 `judged = 0`，继续显示 `— / 词数`。
  这样「最近练习」与结算页、热力图、正确率的单位一致（都是「题/空」）。
- 顺带：`session.correct` 现在夹到**实际写入的日志条数**，不会因 `wordKey` 为空的行而算多。

### 5.5 核过但**不改**的口径（设计如此，已写进文档/FUTURE）

| 口径 | 现状 | 结论 |
| --- | --- | --- |
| 书写场次不推进卡片 | `已默 x / N`、队列打勾不增长；同样的词第二天仍算新词 | 既定「书写不进 SRS」，但体验上确实对不上；登记 FUTURE §九.7 |
| 中途退出不记账 | 只有进入结算页才提交一次事务 | 既定（整场一个 `session.id` 幂等键）；登记 FUTURE §九.8 |
| 短句降级轮记 `word` | 短句场次里被降级的词不污染 sentence 模式统计 | 设计如此 |
| 短句丢音标点即判对 | `isSentenceMatch` 归一化后全等 | 崔总 2026-10-17 定 |
| 只有两档评级 | 对 = Good、错 = Again（无 Hard/Easy） | 设计如此 |
| 组句逐空耗时是均分 | 一轮共用一个轮耗时 | 登记 FUTURE §九.9（要真实逐空需在 `ClozeView` 记录提交时刻） |

### 5.6 验证

- `pnpm test:run`：**71 文件 / 768 用例全绿**（新增释义两段判定 ×2、按轮均分耗时、同词聚合 ×2、场次得分）。
- `pnpm exec tsc --noEmit`：0 报错（含 `judged` 的类型扩散）。
- `pnpm check`：Vitest → 生产构建 → 生产冒烟 全通过。
- 浏览器端到端扩到 **17/17**：新增「短句场次 16/20」「组句同词两空 → updated 2 条」「场次 2/3（judged=3、
  wordCount=2）」，并断言档案页「最近练习」同时显示 `2 / 3` 与 `16 / 20`。

## 6. 后续可能要做的事

- 已登记 `FUTURE.md`：§八.6（recent 分母已解决，剩历史场次过滤）、§九（孤儿缓存、冒烟固化、
  `.pen` 补稿、操作区扩展、更新短句作用范围、无判定旧场次、书写是否计入完成度、中途退出记账、逐空耗时）。
