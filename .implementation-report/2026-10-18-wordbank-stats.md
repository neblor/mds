# 词库学习档案 · SQLite 迁移与统计（实施报告）

> 状态：**已实施（2026-10-18）**。方案：`plans/wordbank-stats.md`；设计：`.design/mds.pen` 30/31/32/30a。
> 背景：FUTURE 的 FSRS-6 学习统计图 / 积分进度；崔总 2026-10-18 批复：
> ① 切 SQLite、迁移无感；②「已掌握」= 间隔 ≥ 21 天；③「专练薄弱词」一起做；④ 入口按书本图标方案。

## 1. 交付范围

1. **复习状态迁移到 SQLite**：`mds-data/review/review.sqlite`（WAL）；卡片、日志、场次、统计查询。
2. **无感迁移**：旧 `cards.json / log.jsonl / sessions.jsonl` → 临时库/事务/计数校验/`quick_check`/原子 rename；
   旧文件归档 `review/migrated-v1/`；失败回退兼容模式；`migrated-v1/` 可回滚。
3. **兼容模式**：迁移失败时保留旧 JSON store，默写/队列/结算/书写场次照常；统计接口 503。
4. **场次采集**：书写与赛博每场一行（模式、词表、得分、activeMs/wallMs），`session.id` 幂等。
5. **`daily.json` 退场**：今日进度改由每库 `review_log` 聚合；主界面进度不变。
6. **统计接口**：`GET /api/bank-stats`；进度、使用频率、正确率、180 天热力、14 天预测、薄弱/常练词。
7. **学习档案 UI**：30/31/32 屏；书本图标按钮；词表详情互跳；Esc/焦点恢复；空态/旧数据/兼容态。
8. **专练**：薄弱词最多 5 个，一键「单词 + 赛博」，不依赖 AI，写回本词库。
9. **诊断工具**：`pnpm db:status`、`pnpm db:rollback -- --yes`。
10. **文档**：本报告、`AGENTS.md`、`FUTURE.md`、`plans/wordbank-stats.md`、`.design/mds.md`、README。

## 2. 存储与迁移

### 2.1 Schema v1

- `cards(bank_id, word_key, word, due, due_day, state, stability, difficulty,
  elapsed_days, scheduled_days, learning_steps, reps, lapses, last_review)`
- `review_log(id, bank_id, session_id, at, day, word, word_key, mode, gen_mode, rating,
  correct, elapsed_ms, queue_kind, state_before, interval_before_days,
  interval_after_days, stability_after, difficulty_after)`
- `session(id, bank_id, at, day, gen_mode, content_mode, word_count, correct,
  active_ms, wall_ms)`
- `session_word(session_id, bank_id, word_key, word)`
- 时间戳 epoch ms；`day/due_day` 写入时用本地 `localDateKey` 固化；索引覆盖 `(bank_id, day)`、
  `(bank_id, word_key)`、`(bank_id, due)` 等。
- `PRAGMA user_version = 1`；连接参数 WAL / `synchronous=NORMAL` / `busy_timeout=3000` / `foreign_keys=ON`。

### 2.2 无感迁移

`createReviewStore(reviewDir)` 首次调用（服务启动 import 阶段）：
- 有 DB：校验 `user_version`；`0` 且无表视为空库初始化；有表但版本未知则报错（不猜）。
- 无 DB 且有旧文件：`review/.migrate.lock` → `.migrating-<pid>.sqlite` → schema → 事务导入 →
  计数校验 + `quick_check` → close → 原子 rename；旧文件（含 `daily.json`）移入 `migrated-v1/`。
- 失败：回滚/删除临时库，旧文件原样保留，写 `migration.log`，返回兼容模式；下次启动重试。
- `daily.json` **不导入**；旧书写场次本来就没落盘，场次类指标从本版开始（UI 32 屏明确说明）。

### 2.3 运行时取模块

`process.getBuiltinModule("node:sqlite")` 运行时获取，不静态 `import`：
- 拿不到模块 → 兼容模式，不会让整个服务 import 崩溃；
- Vite/Nitro 不需要解析/打包 `node:sqlite`；
- Electron 43（Node 24.18）已实测：建库、事务、WAL、`PRAGMA user_version` 正常。

### 2.4 回滚

`pnpm db:rollback -- --yes`：`review.sqlite*` 改名为 `review.sqlite.bak-<timestamp>`，
把 `migrated-v1/` 文件搬回 `review/`；下次启动重新迁移。`db:status` 只读查看 schema/条数/归档/WAL/quick_check。

## 3. 统计口径（实现值）

- `MASTERED_SCHEDULED_DAYS = 21`；`WEAK_LAPSES = 2`；`WEAK_WRONG_IN_WINDOW = 2`；
  `MIN_ACCURACY_SAMPLE = 10`；`HEATMAP_DAYS = 180`；`FORECAST_DAYS = 14`；`WEAK_LIMIT = 5`；`RECENT_SESSIONS = 3`。
- 已掌握 = `state=Review` 且 `scheduled_days ≥ 21`；复习中 = Review 且 <21；学习中 = 其余已有卡片；未学 = 无卡。
- 到期：逾期 / 今天 / 今天起 7 天 / 今天起 30 天；预测 14 天只含已排期卡。
- 正确率：近 7 / 30 / 全部；样本 <10 界面显示「—」。
- 使用：近 7/30 天场次、30 天活跃天数、连续天数（今天没练从昨天算）、首次/上次使用、近 7/30 天用时。
- 薄弱：`seen≥2` 且（近 30 天错 ≥2 或 lapses ≥2 或 difficulty ≥7）；最多 5 个。
- 常练：判定次数 + 书写场次出现次数；书写-only 也计入。
- 评估条：近 30 天首次判定 ≥9 时估算剩余未学词开始速度；不足则隐藏。
- API 比原计划多返回一个 `activity.practiceMs7`（KPI「近 7 天」副行用）；不影响既有字段。

## 4. 界面

- **入口**：`BankSourceCard` 左侧 `library` 图标 → 32×32 圆形按钮（默认透明 / hover `bg-soft` /
  `focus-visible:outline-2` 主色）。点击开档案；点词表名仍开选择弹层；录入/无词表不显示按钮。
- **档案**：4 KPI → 左列（学习进度堆叠条 / 180 天热力 / 最近 3 场）+ 右列（14 天预测 / 重点词）
  → Footer 估算 + Esc。窄窗整页滚动、主区单列；无横向溢出（747 实测）。
- **空态 31**：KPI 0/—，主区居中卡；有词时「开始默写」（当前队列赛博）+「词表内容」。
- **旧数据 32**：正确率/热力/薄弱词正常；连续/场次 `—`；最近练习卡内说明「场次统计从本版开始」。
- **兼容 503**：错误卡显示可读文案，不空白、不影响默写。
- **键盘**：打开即聚焦容器；Esc 返回；关闭后焦点回书本按钮；词表详情打开也聚焦容器；
  图表/热力格不进 Tab；专练按钮/页签可键盘操作。
- **专练**：仅薄弱页签；最多 5 个；固定单词 + 赛博；结果页/历史显示「单词」；退出后恢复用户内容模式。

## 5. 实施中的关键决策与坑

1. **`review-service` 不能 import `node:crypto`**：它被客户端 `use-wordbanks` 用来 `buildCommitItems`，
   静态 import 会在 Vite dev 变成 externalized 模块、整页 hydration 失败。改为本地 `fallbackSessionId`
   （客户端已生成 UUID；这是兜底）。这是本轮实际踩到并修掉的问题。
2. **场次 words 优先用结果行**：组句场次的队列候选词（≤24）≠ 本场挖空的词；用队列词会放大
   `recent` 得分分母/词数。现在优先用 `rows.map(word)`，队列词只作兜底。
3. **赛博场次 correct 服务端重算**：不信任客户端传值，按实际 items 的 correct 计数。
4. **`CommitResult.progress.target = 0`**：commit 不持有「今天默几个」；UI 的进度条/目标来自队列与 prefs，
   不读 commit.progress.target。保留字段是为了不破坏 `CommitView` 既有形状。
5. **预测窗口方向**：纯计算最初复用「最近 N 天」导致预测落在过去；已改为「今天起 N 天」并加回归测试。
6. **连续天数**：修正了按 `streak` 递推导致跳日的循环；改为 `shiftDay(now, -(start+i))`，并加断日测试。
7. **迁移锁/并发**：`.migrate.lock` + 临时库 rename；目标已存在则使用既有 DB；单进程正常无感。
8. **兼容模式降级**：只保留一个发布周期；稳定后删除（FUTURE §八.1）。
9. **db:status 只读**：不启动 Nitro、不触发迁移；脚本用 `readOnly` 打开。
10. **测试隔离**：路由测试 mock `runtime-stores`，避免 import 时迁移项目 `.mds-data`。

## 6. 验证结果

- `pnpm exec tsc --noEmit`：通过。
- `pnpm test:run`：**69 个测试文件 / 752 个测试全部通过**
  （新增 `bank-stats`、`bank-stats-service`、`review-store` 重写、迁移、场次、路由 503/404、
  `startWeakDrill`、21 天边界、时区、预测方向、连续天数等）。
- `pnpm check`：Vitest → Web 生产构建 → 生产冒烟全通过。
- `pnpm client:package:wsl test`：NSIS 测试包构建、校验、清理通过；
  `dist/electron-test/mds-0.9.1-setup.exe`（版本未改）。包内无原生 `.node`/node_modules/word-cache。
- **生产接口集成**（临时数据目录）：
  - 创建 6 词 bank → 赛博 3 题 + 书写 2 词 → `GET /api/bank-stats` 200；
  - 重复提交同一 `session.id` 不重复计（sessions total 仍为 2）；
  - 书写场次进入统计；`practiceMs7=11000`；weak/常练/最近练习正确。
- **迁移/回滚演练**（合成旧数据：cards + 2 条有效日志 + 1 条坏行 + sessions + daily）：
  - 迁移后 SQLite cards 1 / logs 2 / sessions 1 / session_words 2；
  - `db:status` schema v1、quick_check ok、归档 4 个；
  - `db:rollback -- --yes` 恢复旧文件 + DB 备份；再次迁移计数一致。
- **性能**：3,108 词 + 50,000 条日志，`buildBankStats` 首次调用 **137 ms**（验收 <400 ms）。
- **浏览器实测**（Playwright + Chrome headless，1120 与 747×700）：
  - 书本按钮 bounding box 32×32；档案加载无 console/page error；
  - Esc 后 `activeElement` 的 aria-label 回到「查看学习档案」；
  - 空词表档案显示 31 空态；窄窗无横向溢出；
  - 专练按钮点击 → 准备中 → 中止 → 回主界面（键盘/焦点闭环）。
- 设计稿 `.design/mds.pen`（30/31/32/30a）已由崔总在 VS Code 保存到磁盘。

## 7. 已知限制 / 后续

- **兼容模式**只在迁移失败时出现，统计 503；计划一个发布周期后移除（FUTURE §八.1）。
- **旧书写场次无法回溯**：本版之前的书写没有落盘；32 屏明确标注，不伪造。
- `daily.json` 不导入：旧全局汇总口径已废；历史正确率仍可从日志回看。
- **组句 recent 分母**：`session.word_count` 用去重后的作答词；若一场组句里同一词填多个空，
  最近练习的 `x / N` 分母会小于空数；主统计正确率按日志逐空计算，不受影响。后续可加 `answered` 字段
  （FUTURE §八.6）。
- **跨库总览 / 选择弹层迷你进度 / 词级详情 / DB 备份导出 / 日志归档 / 更多统计维度**：未做，见 FUTURE §八.2–6。
- `db:status`/`db:rollback` 是排障工具，不替代正式备份；换机前建议导出（FUTURE §八.4）。

## 8. 文件变更

#### 新增
- `src/lib/review-types.ts`、`review-schema.ts`、`review-store-sqlite.ts`、
  `review-store-legacy.ts`、`review-migrate.ts`、`review-stats-query.ts`。
- `src/lib/bank-stats.ts`、`bank-stats-service.ts`、`routes/api/bank-stats.ts`、
  `components/BankArchiveScreen.tsx`。
- `src/lib/bank-stats.test.ts`、`bank-stats-service.test.ts`、`review-store.test.ts`（重写）、
  `routes/api/bank-stats.test.ts`。
- `scripts/review-db-status.mjs`、`scripts/review-db-rollback.mjs`。
- 本报告。

#### 修改
- `review-store.ts`（工厂 + re-export）、`review-service.ts`（session/无 daily）、
  `routes/api/review-commit.ts`、`runtime-stores`（工厂不变，store 工厂内部降级）、
  `srs.ts` / `daily-queue.ts` 类型来源、`bank-api.ts` / `use-wordbanks.ts`（loadStats、session）、
  `use-dictation.ts`（runContentMode/startWeakDrill）、`index.tsx`（专练接线）、
  `WordBank.tsx` / `BankSourceCard.tsx` / `BankDetailScreen.tsx`（入口/焦点/返回栈）、
  `icons.tsx`（Target）、`package.json`（db 脚本）、`data-paths.ts` 注释。
- 文档：`plans/wordbank-stats.md`、`.design/mds.md`、`FUTURE.md`、`AGENTS.md`、README。

> 注：本轮未修改 `package.json` 版本号；测试打包仍为 `0.9.1`。正式发版请按项目规则使用
> `pnpm client:package major|minor|patch`。
