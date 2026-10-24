# 取词队列改为「按轮」 + 每日统计按场次求和（2026-10-24）

## 口径

- **取词队列与「每日」无关**：只有一个数字 = **本次取几个词**；点`重新取词`就按这个数字再取一批。
- 队列只由 SRS 状态决定：`due <= now` 的复习词 + 还没学过的词，取到 `size` 为止。
  不按「今天结束」提前取，也没有「今天额度用完」这回事。
- **统计侧保留「每日」**：当天所有场次的词数相加（同一词多轮也累加），不跨批次去重；
  这是 `readDayStats(bankId, day).words`，与队列的 `size/done` 完全分开。

## 改动

### 队列（服务端）

- `src/lib/round-queue.ts`（替代 `daily-queue.ts`）：
  - `buildRoundQueue({ entries, cards, now, size })`：到期判断从 `due <= 今天结束` 收紧为
    **`due <= now`**；新词 = 没有卡片的词；**不再接收 `doneToday`**。
  - `clampBatchSize` / `DEFAULT_BATCH_SIZE` / `MIN/MAX_BATCH_SIZE`。
- `src/lib/day.ts`：`localDateKey` 移到独立日期工具，只给统计/归档用；
  队列不再 import 任何 daily helper。
- `src/lib/review-service.ts`：
  - `buildQueueForBank({ size })` 返回 `{ queue: RoundQueue, progress }`。
  - `QueueProgress`：`size` / `done`（**本批**已默，服务端新取时固定 0）/
    `todayWords`（今日累计词数）/ `correct/total/elapsedMs`（今日逐题统计）。
  - `CommitProgress`：`words`（今日累计词数）/ `correct/total/elapsedMs`；不再输出队列进度。
  - `review_log` 的 `correct/total/elapsedMs` 与 `session.word_count` 的 `words` 分开查询。
- `src/routes/api/review-queue.ts`：`size` 参数；旧 `target` 兼容。

### 每日统计（store）

- `DayStats` 增加 `words`；SQLite `readDayStats` 额外 `SUM(session.word_count) WHERE day=?`；
  legacy store 按 session 的 `words.length` 求和；`emptyDayStats` 补 `words: 0`。
- 当天默了几次就加几次：同一词两轮 → 2；书写场次也有 session → 计入。
- `review_store` / `review-service` 的测试同步 `words` 断言。

### 客户端

- `use-wordbanks`：
  - `batchDone` 独立信号，换批/选库清零；`applyCommitToQueue(view)` 把本场写回的词并进**本批**，
    `progress.done` 只数当前队列里的词；`todayWords` 用 `view.progress.words`。
  - 结算后**不自动重新取词**：本批词面冻结到用户点`重新取词`。
- `TodayQueueCard`：标题`本次取词 · N 词`；`已默 x / N` 用 `progress.size/done`（同一批）；
  chips 打勾用 `batchDone`；空态里的「今天已经练了 x 个词」用 `progress.todayWords`（每日聚合）。
- `BankSourceCard`/`WordBank`：`todayTarget` → `batchSize`，文案`今天默` → `本次默`；
  改数字只保存，不自动换批。
- 其它文案（ModeActions、BankDetailScreen、入口空态提示、README 等）统一为「本批/本次」。

### 文档/记忆

- `AGENTS.md`：新增「取词数量语义（2026-10-24 崔总更正）」；明确队列无每日边界、
  `size/done` 同批、`todayWords` 每日按场次求和、结算后不重取词。
- `.design/mds.md` / `.design/mds.pen`（18、23 屏）改为「本次默 / 本次取词」。
- `plans/wordbank-srs-cloze.md`、`plans/wordbank-stats.md`、`FUTURE.md` §7/§10 同步；
  `README.md` 把「每日复习」改成「取词队列」。
- 本报告替代 `.implementation-report/2026-10-24-batch-queue-semantics.md` 的旧描述。

## 验证

- `pnpm test:run`：**82 文件 / 853 测试全绿**（新增 round-queue/day 测试，删掉旧 daily-queue 的每日测试）。
- `pnpm exec tsc --noEmit`：无错误。
- `pnpm check`：构建 + 生产冒烟通过。
- 临时 data dir 接口探针：
  - 取 5 → 练完 → 再取 5 得到不重叠的新一批，`done 0/5`。
  - 第二遍练完后 `todayWords = 10`（每日按场次累加）。
  - 到期时间未到的词不会被提前取；到期后作为复习词回来。
- 界面实测（临时 data dir）：5 个词练完显示 `已默 5 / 5` 且词面不跳；点`重新取词`换另一批
  5 个、`已默 0 / 5`；今日统计仍累计。

## 后续

- 如果以后要「今日上限」，必须新增独立设置，不能复用 `batchSize`（见 FUTURE §九.10）。
- 兼容模式/旧日志没有 session 时，`DayStats.words` 为 0（没有场次词数可加）；
  `correct/total/elapsedMs` 仍按 `review_log` 给出。
