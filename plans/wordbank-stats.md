# 词库学习档案 · SQLite 迁移与统计（第二轮计划）

> 状态：**已实施（2026-10-18）**。实施报告：`.implementation-report/2026-10-18-wordbank-stats.md`。
> 本文件保留为方案与任务表；实际偏差/已知限制以报告为准。
> 批复记录（2026-10-18）：
> ① 切 SQLite，迁移要无感；②「已掌握」按 21 天口径；③「专练薄弱词」一起做；④ 入口按书本图标方案。
>
> 交付物：
> - 本计划：`plans/wordbank-stats.md`
> - 设计稿：`.design/mds.pen` 的 **30 / 31 / 32 / 30a** 四屏（已评审并实现）
> - 设计说明：`.design/mds.md`（本轮同步更新）
>
> 关联：`FUTURE.md` 第一节（FSRS-6 统计图 / 积分与进度）、`plans/wordbank-srs-cloze.md` §3、
> `AGENTS.md`「系统基础功能」。

---

## 0. 批复后的结论（先看这 7 条）

1. **复习状态改由 SQLite 承担**：卡片、复习日志、场次、统计查询都进 `mds-data/review/review.sqlite`；
   词库本体（`banks/*.json`）不动。**正常路径下 SQLite 是复习状态的唯一事实来源**（迁移失败时的临时兼容模式见第 3 条）。
2. **迁移自动、无弹窗、无用户操作**：首次启动时把旧 `cards.json / log.jsonl / sessions.jsonl` 导入临时库，
   校验通过后原子替换；旧文件移入 `review/migrated-v1/` 留作回滚。典型数据迁移 < 1 秒。
3. **迁移失败不阻断默写**：保持旧文件不动，当次运行走兼容模式（旧 JSON 存储），下次启动重试；
   兼容模式下统计页显示「统计暂不可用（不影响默写）」。数据库已存在但损坏时不静默降级，明确报错。
4. **删掉 `daily.json`**：它现在「done 随当前词库覆盖、correct 跨库混算」，不能当每库统计；
   新的今日进度直接由 `review_log` 聚合（每库、每日、可解释），主界面行为不变。
5. **场次成为一等数据**：书写与赛博每场都记一行（时长、模式、词表、得分），
   解决「书写场次完全不入库」和「无法按场看使用频率」；结算用 `session.id` 做幂等。
6. **学习档案页**：4 个 KPI + 学习进度 / 180 天热力 / 最近练习 + 到期预测 / 重点词；
   「已掌握」= 下次间隔 ≥ 21 天；「薄弱词」最多 5 个；底部可一键**专练这 5 个（单词 · 赛博）**。
7. **入口**：词表模式当前词表左侧的书本图标改成 32×32 圆形按钮（默认 / 悬停 / 焦点三态，见 30a），
   点开学习档案；点词表名仍然打开选择弹层。档案页可进入词表详情，详情返回回档案；Esc 返回并恢复焦点。

---

## 1. 现状与决策

### 1.1 现状（迁移前）

| 落点 | 内容 | 写入方式 |
| --- | --- | --- |
| `mds-data/banks/index.json` | 词库索引（可重建） | 原子整写 |
| `mds-data/banks/<bankId>.json` | 词库本体 | 原子整写 |
| `mds-data/review/<bankId>.cards.json` | 每词 FSRS 卡片快照 | 每场结算整写 |
| `mds-data/review/<bankId>.log.jsonl` | 逐题判定日志（append-only） | 追加 |
| `mds-data/review/daily.json` | 全局每日汇总（缓存） | 原子整写 |
| localStorage `mds.*` | 偏好/设置/录入词表/最近 5 场历史 | 浏览器 |

关键缺口：没有场次边界；书写场次不落盘；每日活动不按词库归属；词级聚合每次全扫。

### 1.2 为什么这次切 SQLite

- 数据量本身不大（每天 20 词 ≈ 1.8 MB/年），但**多维统计**（按库 / 天 / 模式 / 词 / 窗口）用 SQL 更直接，
  不需要维护若干派生 JSON 汇总文件与失效逻辑。
- 已实测：Electron 43（Node 24.18）与开发 Node 26 都内置 `node:sqlite`，
  无需原生模块、无需 electron-rebuild，**不影响 Linux/WSL 交叉打 Windows 包**。
- 单用户、单进程、同步 API（`DatabaseSync`）足够；WAL 提供崩溃安全。
- 用户数据仍是本地文件；词库本体保持 JSON，方便查看与备份。

### 1.3 非目标

- 不做跨设备同步、云备份、多人并发。
- 不做排行榜/积分商城；不把「已掌握」说成绝对结论。
- 不改今日队列取词算法、默写流程、结果页判定。
- 不在本轮做跨库总览（P2，登记 FUTURE）。
- 不引入图表库；热力/柱状/堆叠条用 div + Tailwind 手绘。

---

## 2. 存储与迁移

### 2.1 目录布局（迁移后）

```text
mds-data/
  banks/
    index.json
    <bankId>.json
  review/
    review.sqlite                # 唯一事实来源（WAL 模式）
    review.sqlite-wal            # 运行时，崩溃安全
    review.sqlite-shm
    migrated-v1/                 # 一次性归档（回滚用）
      <bankId>.cards.json
      <bankId>.log.jsonl
      <bankId>.sessions.jsonl    # 兼容模式下产生过才有
      daily.json
    migration.log                # 迁移/兼容模式诊断（不含词汇与 Key）
  word-cache/                    # 音频/释义缓存，不变
```

- 目录优先级仍由 `src/lib/data-paths.ts` 决定（Web `.mds-data`；Electron `userData/mds-data`）。
- 词库文件不动；`review.sqlite*` 与归档都随词库数据目录走，卸载保留。

### 2.2 Schema v1

`PRAGMA user_version = 1`。全部时间戳用 epoch ms；`day` / `due_day` 是**本地时区** `YYYY-MM-DD`
（写入时用 `localDateKey` 计算，SQL 不做时区换算）。

```sql
CREATE TABLE cards (
  bank_id        TEXT NOT NULL,
  word_key       TEXT NOT NULL,
  word           TEXT NOT NULL,
  due            INTEGER NOT NULL,
  due_day        TEXT NOT NULL,
  state          INTEGER NOT NULL,
  stability      REAL NOT NULL,
  difficulty     REAL NOT NULL,
  elapsed_days   REAL NOT NULL,
  scheduled_days REAL NOT NULL,
  learning_steps INTEGER NOT NULL,
  reps           INTEGER NOT NULL,
  lapses         INTEGER NOT NULL,
  last_review    INTEGER,
  PRIMARY KEY (bank_id, word_key)
);
CREATE INDEX cards_due_idx      ON cards (bank_id, due);
CREATE INDEX cards_due_day_idx  ON cards (bank_id, due_day);
CREATE INDEX cards_state_idx    ON cards (bank_id, state);

CREATE TABLE review_log (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  bank_id               TEXT NOT NULL,
  session_id            TEXT,
  at                    INTEGER NOT NULL,
  day                   TEXT NOT NULL,
  word                  TEXT NOT NULL,
  word_key              TEXT NOT NULL,
  mode                  TEXT NOT NULL,
  gen_mode              TEXT NOT NULL,
  rating                INTEGER NOT NULL,
  correct               INTEGER NOT NULL,
  elapsed_ms            INTEGER NOT NULL,
  queue_kind            TEXT NOT NULL,
  state_before          INTEGER NOT NULL,
  interval_before_days  REAL NOT NULL,
  interval_after_days   REAL NOT NULL,
  stability_after       REAL NOT NULL,
  difficulty_after      REAL NOT NULL
);
CREATE INDEX review_log_bank_day_idx  ON review_log (bank_id, day);
CREATE INDEX review_log_bank_word_idx ON review_log (bank_id, word_key);
CREATE INDEX review_log_bank_at_idx   ON review_log (bank_id, at);
CREATE INDEX review_log_session_idx   ON review_log (bank_id, session_id);

CREATE TABLE session (
  id           TEXT PRIMARY KEY,
  bank_id      TEXT NOT NULL,
  at           INTEGER NOT NULL,
  day          TEXT NOT NULL,
  gen_mode     TEXT NOT NULL,
  content_mode TEXT NOT NULL,
  word_count   INTEGER NOT NULL,
  correct      INTEGER,
  active_ms    INTEGER NOT NULL,
  wall_ms      INTEGER NOT NULL
);
CREATE INDEX session_bank_day_idx ON session (bank_id, day);
CREATE INDEX session_bank_at_idx  ON session (bank_id, at);

CREATE TABLE session_word (
  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  bank_id    TEXT NOT NULL,
  word_key   TEXT NOT NULL,
  word       TEXT NOT NULL,
  PRIMARY KEY (session_id, word_key)
);
CREATE INDEX session_word_bank_word_idx ON session_word (bank_id, word_key);
```

- `session.correct` 对书写场次为 `NULL`（不伪造 0）。
- `review_log.session_id` 旧数据迁移后为 `NULL`；新数据必填，便于按场回溯。
- `session_word` 用于「常练词」与「书写也计入练习次数」；词典内容不重复存。

### 2.3 连接与生命周期

- 模块通过 `process.getBuiltinModule("node:sqlite")` 运行时获取（Node 24 / Electron 已实测）：
  拿不到模块时不让整个服务 import 崩掉，直接走兼容模式；Vite/Nitro 也不需要解析这个内置模块。
- 打开：`new DatabaseSync(path)`；执行
  `PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 3000; PRAGMA foreign_keys = ON;`
- 单例由 `src/lib/runtime-stores.ts` 持有；所有路由只通过 `reviewStore`，不碰路径与 SQL。
- 退出：注册 `process.once("exit", close)`；WAL 本身崩溃安全，异常退出最多留下可恢复的 WAL。
- 事务：写一场 = `BEGIN IMMEDIATE` → 卡片 upsert → 日志批量插入 → 场次 + `session_word` → `COMMIT`；
  任一步失败整体回滚。
- 幂等：`session.id` 由客户端在开始默写时生成（UUID）；服务端若发现该 id 已存在，直接返回当前进度，
  不重复写卡片/日志/场次。重试不会把同一场算两次。

### 2.4 迁移流程（无感）

在 `createReviewStore(reviewDir)` 首次被调用时同步执行（当前由 `runtime-stores` 在服务启动 import 阶段调用）：

1. **已有 DB**：打开 → 校验 `user_version` → 必要时执行增量迁移（v1 之后只增不改）→ 返回 SQLite store。
   `user_version = 0` 且库里没有数据表 → 视为空库初始化；有表但版本未知 → 报错，不猜。
2. **没有 DB，也没有旧文件**：创建空库（schema v1）→ 返回。
3. **没有 DB，有旧文件**：
   1. 取迁移锁 `review/.migrate.lock`（`wx` 创建；超过 60 秒视为陈旧；最多等 2 秒）；
   2. 在 `review/.migrating-<pid>.sqlite` 建 schema；
   3. 逐库导入（**以文件名为准**，不信任记录里的 `bankId`）：
      - `<id>.cards.json` → `cards`（`due` 转 epoch，`due_day` 用本地日）；
      - `<id>.log.jsonl` → `review_log`（坏行跳过，`session_id = NULL`）；
      - `<id>.sessions.jsonl`（若兼容模式产生过）→ `session` + `session_word`；
      - `daily.json` **不导入**（缓存，口径已废）；
   4. 校验：导入卡片/日志/场次计数与解析计数一致；`PRAGMA quick_check` 为 `ok`；
   5. `COMMIT` → `close` → 原子 rename 为 `review.sqlite`；
   6. 把旧文件移入 `review/migrated-v1/`（保留原文件名；目标已存在时加时间戳后缀，不覆盖）；
   7. 写一行 `migration.log`（耗时、库数、条数、结果；不含词汇）；释放锁；返回 SQLite store。
4. **失败**：回滚并删除临时库；旧文件原样保留；写 `migration.log`；返回**兼容模式**（旧 JSON store）。
   下次启动会再次尝试迁移。

用户侧体验：没有弹窗、没有确认、没有“正在迁移”界面；迁移在服务启动阶段完成，
Electron 窗口等内置服务就绪后再显示（常见数据多等几百毫秒，5 年满量日志也在数秒内），
Web dev 首次启动略慢；不阻塞启动后的任何操作。

### 2.5 兼容模式（迁移失败的兜底）

- 保留现有 JSON store 作为 `mode = "legacy"` 的实现，接口与 SQLite 一致：
  `readCards / commit / readDayStats / readSessions / removeBankState / close`。
- 兼容模式下**默写、队列、结算、书写场次全部可用**，写入旧文件（含新的 `sessions.jsonl`），
  下次迁移会一并导入。
- 兼容模式下 `GET /api/bank-stats` 返回 `503`，界面显示：
  「学习数据正在使用兼容模式，统计暂不可用；默写与复习不受影响。」
- 兼容路径只保留一个发布周期；迁移稳定后被后续版本移除（写入 FUTURE）。

### 2.6 回滚

- 数据归档在 `review/migrated-v1/`，不是一次性删除。
- 提供 `pnpm db:rollback -- --yes`：停应用后执行，把 `review.sqlite*` 改名为
  `review.sqlite.bak-<timestamp>`，把归档文件搬回 `review/`，下次启动重新迁移。
- 提供 `pnpm db:status`（只读）：schema 版本、各库卡片/日志/场次条数、归档是否存在、WAL 大小、
  `quick_check` 结果。
- 回滚 runbook 见附录 B。

### 2.7 `daily.json` 退场

- 删除 `ReviewStore.readDaily/writeDaily`；`buildQueueForBank` 的今日 `correct/total/elapsedMs`
  改为 `readDayStats(bankId, today)`（SQL 聚合）。
- `words` 由 `session.word_count` 按本地日求和（当天多轮累加）；`correct/total/elapsedMs` 仍来自 `review_log`。
- 主界面「已默 x / N」与复习写回文案不受影响；`daily.json` 只进归档。
- 收益：今日进度从「全局混算缓存」变成「每库、每日、可回放」。

### 2.8 打包与运行时

- `node:sqlite` 通过 `process.getBuiltinModule` 运行时获取，不产生静态 import，Vite/Nitro 不会把它打进 bundle；
  实施第一步仍用 `pnpm web:build && pnpm web:smoke` 验证生产构建与冒烟。
- Electron 43 / Node 24.18 已实测 `require("node:sqlite")` + 建库 + 事务 + WAL 正常；
  打包产物不含原生 `.node`，WSL 交叉打包流程不变。
- `package.json` 的 `engines.node >= 24` 已满足；Web 模式不支持 Node 22 及以下（与现状一致）。

---

## 3. 数据采集

### 3.1 场次记录

```ts
export interface SessionLogRecord {
  /** 客户端生成的 UUID；结算幂等键 */
  id: string;
  /** 结算时刻（epoch ms） */
  at: number;
  bankId: string;
  /** 怎么答 */
  genMode: "writing" | "cyber";
  /** 本场问什么（短句降级为单词轮时仍是 sentence） */
  contentMode: ReviewMode;
  /** 本场目标词（队列原词 / 专练词），去重后最多 200 个 */
  words: string[];
  /** 赛博：判定正确数；书写：null */
  correct: number | null;
  /** 各轮作答耗时之和 */
  activeMs: number;
  /** 从开始到结算的总时长（含准备/停顿） */
  wallMs: number;
}
```

- `words` 同时写 `session`（`word_count`）与 `session_word`（逐词）。
- 不记录逐题作答原文（历史记录已有）；不记录中止场次（v1 不记，避免噪声）。
- `word_count` 是去重后的词数；`correct` 夹到 `[0, word_count]`。

### 3.2 结算写入

`POST /api/review-commit` 扩展可选 `session`：

```http
POST /api/review-commit
{
  "bankId": "pet",
  "items": [ ... ],              // 书写时为空数组
  "requestRetention": 0.9,
  "session": {
    "id": "uuid",
    "genMode": "cyber",
    "contentMode": "word",
    "words": ["apple", "..."],
    "correct": 18,
    "activeMs": 312000,
    "wallMs": 360000
  }
}
```

- 路由只做清洗：白名单 `contentMode`；数值有限、非负；`wallMs >= activeMs`；
  `correct` 书写强制 `null`；`words` 截断 200 / 单个 80 字符；非法 `id` 由服务端生成。
- 编排层 `commitReviews` 构造变更卡片、日志、场次，调用 `reviewStore.commit(...)` 一次事务写入。
- 书写模式：`items` 空，仍写场次；卡片/日志不变。
- 失败：事务回滚；客户端结果页照常显示，错误走现有 banner，不阻塞关闭。

### 3.3 客户端计时

- `beginSession(bankId, words)` 记录 `sessionId`、`startedAt`、`words`。
- `commitSession` 组装 `session`：`wallMs = Date.now() - startedAt`，`activeMs = sum(roundElapsed)`。
- 赛博/书写同一路径；结果页 `ResultsView` 不变。
- 现有 `committed` 守卫保留，服务端幂等作为第二道保险。

### 3.4 专练场次

- 档案页「专练这 5 个」→ 关闭档案 → `beginSession(bankId, weakWords)` → `d.startWeakDrill(words)`。
- 专练固定**单词 + 赛博**（不依赖 AI，不受当前内容模式影响）。
- `use-dictation` 增加 `runContentMode` 覆盖：本场内部用 `word`，结果页/历史记录也用 `word`；
  当前内容模式滑块不变，回到准备态后恢复。
- 专练写回卡片与日志，计入本库统计与今日 done；仍按 FSRS 排期（提前复习会正常更新间隔）。

---

## 4. 统计口径

常量集中在 `src/lib/bank-stats.ts`，界面、测试、SQL 查询共用：

```ts
export const MASTERED_SCHEDULED_DAYS = 21; // 下次间隔 ≥ 3 周（Anki mature 档）
export const WEAK_WINDOW_DAYS = 30;
export const WEAK_LAPSES = 2;
export const WEAK_WRONG_IN_WINDOW = 2;
export const MIN_ACCURACY_SAMPLE = 10;
export const HEATMAP_DAYS = 180;
export const FORECAST_DAYS = 14;
export const WEAK_LIMIT = 5;
export const RECENT_SESSIONS = 3;
```

### 4.1 状态与掌握

| 指标 | 口径 |
| --- | --- |
| 未学 | 词库条目没有可解析卡片 |
| 学习中 | `state` 为 New / Learning / Relearning |
| 复习中 | `state = Review` 且 `scheduled_days < 21` |
| 已掌握 | `state = Review` 且 `scheduled_days >= 21` |
| 已学 | 总数 − 未学 |
| 掌握度 | 已掌握 / 总数（1 位小数） |

- 只统计词库当前仍存在的词；删词遗留的孤儿卡片不计入任何桶、不进预测。
- 界面用 `title` 解释「已掌握 = 下次复习间隔 ≥ 3 周」，不夸大。

### 4.2 到期与预测

- `overdue`：`due < 今天 00:00`；
- `today`：今天 00:00 ≤ `due` < 明天 00:00；
- `next7` / `next30`：今天起 7 / 30 个本地日（含今天）；
- `forecast[14]`：今天起 14 天，按 `due_day` 分组；逾期单独展示，不混进柱子；
- 只统计已排期卡片，新词没有 due，不计入（界面写明）。

### 4.3 正确率、耗时、使用频率

| 指标 | 口径 |
| --- | --- |
| 近 7 / 30 天正确率 | `SUM(correct) / COUNT(*)`；样本 < 10 显示「—」 |
| 累计正确率 | 全量日志 |
| 近 30 天用时 | 判定题 `elapsed_ms` + **书写场次** `active_ms`（赛博场次不重复计） |
| 每题平均耗时 | 判定题 `elapsed_ms` / 判定题数（书写无逐题数据，不参与） |
| 模式分布 | 近 30 天按 `content_mode`/`mode` 统计题数（短句降级轮记 `word`，既有口径） |
| 近 7 / 30 天场次 | `session.at` 窗口内条数 |
| 活跃天数 | 近 30 天有任意日志或场次的不同本地日 |
| 连续练习 | 从今天（今天没练则从昨天）往前连续有活动的天数；断一天即停；最多回溯 365 天 |
| 上次 / 首次使用 | `max/min(session.at, review_log.at)` |
| 场次统计可用 | `session` 总数 > 0；否则场次类指标显示「—」 |
| 常练词 | 判定次数 + 书写场次出现次数，取前 5 |
| 最近练习 | 最近 3 场（含书写），展示时间、模式、得分/词数、用时 |

### 4.4 薄弱词

候选：`seen >= 2` 且满足任一：

- 近 30 天错 ≥ 2 次；
- 卡片 `lapses >= 2`；
- `difficulty >= 7`。

排序分（不展示）：`wrong30 × 3 + lapses × 2 + (difficulty − 5) × 0.5`。
展示理由取第一条命中：`近 30 天错 3 次` / `累计重学 2 次` / `难度偏高`。
最多 5 个；没有则显示「暂时没有需要特别关注的词」。

### 4.5 评估条（底部一行）

- 只在近 30 天「首次判定」的词 ≥ 9 个时出现；
- 文案：`近 30 天新开始 24 个词 · 剩余未学词约需 106 天才会都开始（估算）`；
- 只估算「开始速度」，不承诺「全部掌握时间」；样本不足整行隐藏。

---

## 5. API

### 5.1 `POST /api/review-commit`

- 请求见 §3.2；`session` 可选（旧客户端不传照常工作）。
- 返回仍为 `{ updated, progress }`；`progress.words` 由 `readDayStats` 的按日场次词数和计算。
- 幂等：`session.id` 已存在 → 不重复写，返回当前 `progress`。

### 5.2 `GET /api/bank-stats?bankId=<id>&days=180`

- `days` 夹到 30–365，默认 180（只影响热力图窗口；正确率窗口固定 7/30/全部）。
- 词库不存在 / id 非法 → 404；兼容模式 → 503（message 可读）。
- 响应（计数原样，格式化在前端）：

```ts
interface BankStatsView {
  bank: { id: string; name: string; source: BankSource; count: number; updatedAt: number };
  coverage: {
    total: number; started: number; unstarted: number;
    mastered: number; reviewing: number; learning: number;
  };
  due: {
    overdue: number; today: number; next7: number; next30: number;
    forecast: { date: string; count: number }[]; // 14 项
  };
  activity: {
    heatmap: { date: string; attempts: number; reviews: number; correct: number }[];
    sessions: { last7: number; last30: number; total: number };
    sessionsAvailable: boolean;
    lastUsedAt: number | null;
    firstUsedAt: number | null;
    activeDays30: number;
    streak: number;
    practiceMs7: number;
    practiceMs30: number;
  };
  accuracy: {
    last7: { correct: number; total: number };
    last30: { correct: number; total: number };
    all: { correct: number; total: number };
  };
  modes: { mode: ReviewMode; reviews: number; correct: number; elapsedMs: number }[];
  words: {
    weak: {
      word: string; seen: number; wrong30: number; lapses: number;
      reason: string; dueAt: string | null;
    }[];
    mostPracticed: {
      word: string; practiced: number; judged: number; correct: number;
      lastAt: number | null;
    }[];
  };
  recentSessions: {
    at: number; genMode: "writing" | "cyber"; contentMode: ReviewMode;
    wordCount: number; correct: number | null; activeMs: number;
  }[];
  meta: { generatedAt: number; statsSince: number | null; heatmapDays: number };
}
```

- 热力图 `attempts` = 判定题数 + 书写场次词数（赛博场次不重复加）。
- 所有查询在同一 SQLite 连接内完成；不跨请求缓存（数据量小），但卡片行/聚合查询都用索引。

### 5.3 性能验收

- PET（3,108 词）+ 合成 5 万条日志：首次响应 < 400 ms，重复请求 < 120 ms。
- 迁移：典型 < 1 s；5 万条日志 < 3 s；迁移只发生一次。

---

## 6. 界面

### 6.1 设计稿（本轮已绘制）

| 屏 | 名称 | 内容 |
| --- | --- | --- |
| 30 | 学习档案（有数据） | 4 KPI + 进度/热力/最近练习 + 预测/重点词 |
| 31 | 学习档案（新库空态） | KPI 0/—，主区居中空态 + 「开始默写 / 词表内容」 |
| 32 | 学习档案（旧数据·无场次） | 正确率/进度正常；连续与场次「—」，最近练习卡内说明旧数据 |
| 30a | 书本图标按钮态 | 默认 / 悬停 / 焦点三态 |

> 设计文件：`.design/mds.pen`；说明：`.design/mds.md`。视觉以 pen 文件为准。
> 注：pen.dev 的 MCP 写入先进入 IDE 的**未保存文档**；评审时看画布，确认后在 VS Code 里
> `Cmd/Ctrl + S` 才写回 `.design/mds.pen`（pen.dev 文档的既有行为）。

### 6.2 入口与导航

- 词表模式 `BankSourceCard` 左侧 `Library` 图标 → 32×32 圆形按钮：
  默认透明 + 主色图标；悬停浅底；键盘焦点 1.5px 主色外描边。
- 点击打开档案页；点词表名仍打开选择弹层（两个操作不混）；
  无当前词表 / 录入模式不显示该按钮。
- 档案页头部右侧「词表内容」→ `BankDetailScreen`；**从档案进入详情时，返回箭头回档案**；
  从选择弹层「编辑」进入时，返回回主界面。详情页不额外加「学习档案」按钮，保持头部干净。
- 返回栈：主界面 → 档案 → 词表内容 → 档案 → 主界面；每层 Esc 等价于返回箭头。
- 关闭档案后焦点回到书本按钮（`BankSourceCard` 暴露 ref），不能落回 `body`。

### 6.3 30 屏结构（1120×820）

- 根：`padding 28`、`gap 16`、`bg $bg`。
- Header：返回 + 词表名（24 heading）+ meta（来源 · 词数 · 统计起始日）；右侧「词表内容」。
- KPI 行（92 高，4 等分）：
  1. 已掌握：`86 / 3,108`、`2.8%`、细进度条；
  2. 近 7 天正确率：`92%`、`140 题 · 21 分钟`；
  3. 连续练习：`6 天`、`近 30 天活跃 18 天`；
  4. 今天到期：`24`、`积压 3 · 未来 7 天 61`（积压用 error 色）。
- 主区左列（660）：
  - 学习进度：`已学 561 / 3,108`；堆叠条（已掌握 / 复习中 / 学习中 / 未学）+ 图例；
    底部一行近 30 天模式分布。
  - 练习热力：180 天（26 周 × 7 天）18px 圆角格，5 档主色透明度；今天加描边；
    图例「少→多」+「近 30 天活跃 18 天 · 平均 41 题/天」；格内 `title` 显示当天明细。
  - 最近练习：3 行（时间、`赛博 · 释义` / `书写 · 单词`、得分/词数、用时）。
- 主区右列（392）：
  - 到期预测：14 根柱、今天实色其余 32% 透明；「积压 3」chip；「峰值 61」；说明只含已排期卡。
  - 重点词：`薄弱 / 常练` 两个页签；5 行词 + 理由/下次到期；列表下一行灰字「按近 30 天出错与累计重学排序」；
    底部 `专练这 5 个（单词 · 赛博）`（brand-tint 底、主色文字）+ 小字「仍按 FSRS 排期，会计入本词库」。
    `常练` 页签复用同一列表，排序改为练习次数（设计稿未单独画）。
- Footer：左估算条，右 `Esc 返回 · 数据只保存在本机`。

### 6.4 31 / 32 屏

#### 31 新库空态

- KPI：已掌握 `0 / 42`、正确率 `—`、连续 `—`、到期 `0`；
- 主区：单张白卡居中：book-open 图标（brand-tint 圆）、
  「这个词表还没开始记录」、说明、「开始默写」主按钮 +「词表内容」次按钮、`Esc 返回`。

#### 32 旧数据（无场次）

- 布局与 30 完全一致，不加额外横条；
- KPI 连续练习：`—`，副文案「场次统计从本版开始」；
- 最近练习卡：用 info 图标 +「场次统计从本版开始记录 / 已有的正确率与学习进度不受影响」占位；
- 正确率、热力、薄弱词正常来自历史日志；
- Footer 改为「场次类指标从本版开始 · 正确率与进度可回看历史日志」。

### 6.5 键盘与焦点

- 打开档案：容器 `tabIndex=-1` 并 focus；Esc 返回；关闭后焦点回书本按钮。
- Tab 顺序：返回 → 词表内容 → 薄弱/常练页签 → 专练按钮；图表与热力格不进入 Tab 序列。
- 所有图标按钮有 `aria-label` / `title`；热力格用 `title` + 卡片头部的文字摘要提供信息。
- 专练启动后进入现有准备/默写流程，键盘流与主界面一致。

### 6.6 专练交互

- 仅「薄弱」页签显示；薄弱词为空时按钮不显示；
- 点击 → 关闭档案 → 直接用这 5 个词开始一场**单词 + 赛博**默写；
- 不使用 AI、不需要释义配置；用当前音色/速度/倍率设置；
- 结果页标题、历史记录都显示「单词」，不显示用户原先选的内容模式；
- 结算写回本词库，计入今日 done 与统计；不做额外确认弹窗（按钮文案已说明）。

### 6.7 状态、窗口与可访问性

| 状态 | 表现 |
| --- | --- |
| 加载 | 4 个 KPI 骨架 + 两个大块骨架，布局不跳 |
| 404 / 读取失败 | 居中提示 + 返回；不显示半张图 |
| 兼容模式（503） | 「学习数据正在使用兼容模式，统计暂不可用；默写与复习不受影响」+ 返回 |
| 新库 | 见 31 |
| 旧数据无场次 | 见 32 |
| 只有书写、没有判定 | 正确率「—」，使用/热力正常 |

- 最小窗口 747×547：整页 `overflow-y-auto`，主区在 < 1000px 时单列；热力图横向滚动，不压缩格子。
- 数字 `font-data tabular-nums`；只用现有 token；红色只用于积压/薄弱等行动点。

### 6.8 设计评审点

- 30 屏的信息密度是否合适（4 KPI + 5 张卡）？
- 「重点词」默认薄弱，是否需要默认显示常练？
- 专练按钮文案与位置是否合适？
- 31 空态的「开始默写」是否会与主界面按钮重复？
- 32 不额外加提示条、只在最近练习卡解释，是否够清楚？

---

## 7. 实施计划表

预估为单人工作量，含测试与设计往返；**未开始编码**。

| ID | 阶段 | 任务 | 主要落点 | 验收 | 预估 |
| --- | --- | --- | --- | --- | --- |
| T0 | 设计 | 30/31/32/30a 屏 + `.design/mds.md` | `.design/*` | 崔总确认视觉 | 已完成 |
| T1.1 | 存储 | SQLite store + schema + `commit` 事务 + 幂等（`process.getBuiltinModule` 取模块） | `src/lib/review-store.ts`、新增 `review-schema.ts`、`review-types.ts`（类型/校验拆出，避免 migrate ↔ store 循环）、测试 | 单测全绿；同一 session 重放不重复；模块缺失走兼容模式 | 0.75d |
| T1.2 | 迁移 | 旧 JSON/JSONL 导入、校验、原子替换、归档、锁、日志 | 新增 `review-migrate.ts` | 真实 `.mds-data` 迁移计数一致；失败保留旧文件 | 0.75d |
| T1.3 | 兼容 | 保留 JSON store 为 `mode="legacy"`；接口对齐；统计 503 | `review-store-legacy.ts`、`runtime-stores.ts` | 模拟迁移失败仍可默写/结算 | 0.5d |
| T1.4 | 工具 | `pnpm db:status`、`pnpm db:rollback -- --yes` | `scripts/review-db-*.mjs`、`package.json` | 只读状态正确；回滚后重启可迁移 | 0.25d |
| T2.1 | 采集 | 结算路由扩展 `session`；校验与事务 | `api/review-commit.ts`、`review-service.ts` | 书写/赛博各一场都有 session；书写无日志 | 0.25d |
| T2.2 | 采集 | 客户端 sessionId/计时/words；删 daily 写回 | `use-wordbanks.ts`、`index.tsx`、`review-service.ts` | 今日进度仍正确；`daily.json` 不再生成 | 0.5d |
| T3.1 | 统计 | SQL 查询 + 纯计算 + 常量 + 测试 | 新增 `bank-stats.ts`、`bank-stats-service.ts` | 21 天边界、时区、薄弱/常练、旧数据用例全绿 | 0.75d |
| T3.2 | 统计 | `GET /api/bank-stats` + 性能 | `src/routes/api/bank-stats.ts` | 404/503/窗口夹取；5 万日志冷启 < 400ms | 0.25d |
| T4.1 | 界面 | 档案页 + 入口按钮 + 互跳 + 焦点恢复 | 新增 `BankArchiveScreen.tsx`、`WordBank.tsx`、`BankSourceCard.tsx`、`BankDetailScreen.tsx` | 1120/747 两尺寸；Esc/焦点正确 | 0.75d |
| T4.2 | 专练 | `runContentMode` 覆盖 + `startWeakDrill` + 回调 | `use-dictation.ts`、`index.tsx`、档案页 | 专练只练 5 词；结果/历史显示单词 | 0.5d |
| T4.3 | 界面 | 空态/旧数据/加载/兼容 503 + 骨架 | 档案页 | 三种状态与设计一致 | 0.25d |
| T5.1 | 验证 | `pnpm check`、手动场景、`client:package test` | 全仓库 | Vitest/构建/冒烟通过；包内无 native 依赖 | 0.5d |
| T5.2 | 文档 | 实施报告 + FUTURE 更新 | `.implementation-report/…`、`FUTURE.md` | 含迁移/回滚/兼容模式说明 | 0.25d |

**合计约 6–6.5 个工作日（含测试）。** 依赖顺序：
T0 → T1.1 → T1.2 → T1.3 → T1.4 →（T2.1/T2.2 可并行）→ T3.1 → T3.2 → T4.1 → T4.2 → T4.3 → T5。

### 7.1 里程碑

- **M1 数据安全**（T1.*）：迁移可在真实数据上跑通，失败可回退，兼容模式可默写。
- **M2 统计可用**（T2–T3）：接口返回真实口径；单测覆盖边界。
- **M3 界面可用**（T4）：入口、档案页、专练全部可用；键盘闭环。
- **M4 交付**（T5）：`pnpm check` + 测试打包 + 报告。

---

## 8. 测试计划（Vitest，直接覆盖生产实现）

### 迁移 / store

- 旧 `cards.json` + `log.jsonl` 导入后计数一致；坏日志行跳过；`daily.json` 忽略。
- 迁移幂等：第二次启动不重复导入；已有 DB 不再读旧文件。
- 迁移失败（模拟写临时库失败）：旧文件不动、返回 legacy、`migration.log` 有记录。
- 兼容模式：书写/赛博结算写 JSON + `sessions.jsonl`；下次迁移导入 sessions。
- `commit` 事务：日志插入失败时卡片不落盘；`session.id` 重复时不重复写。
- `removeBankState`：cards/log/session/session_word 全部清除；`session_word` 级联。
- `readDayStats`：跨日边界、空日、坏日志。

### 统计

- 21 天边界（20/21）；`Relearning` 不算已掌握；坏卡片按未学。
- 到期：逾期 / 今天 / 明天 / 第 7 天 / 第 30 天（本地时区）；孤儿卡片不计。
- 正确率样本 < 10 → `—`；模式分布；耗时只加书写场次。
- 连续天数：今天有/无、断一天、跨月；活跃天数 30 天窗口。
- 薄弱词：三条理由优先级、`seen < 2` 不入选、最多 5 个。
- 常练词：书写场次计入练习次数、赛博不重复计。
- 旧数据：无 session → `sessionsAvailable=false` 且指标为 `null`（不是 0）。

### 路由 / UI 纯逻辑

- 路由测试 mock `~/lib/runtime-stores`，避免 import 时迁移项目 `.mds-data`；需要真实 DB 的用例用临时目录。
- `review-commit`：session-only、session + items、非法字段夹取、404、重复 id。
- `bank-stats`：404、503、`days` 夹取、响应字段。
- 纯展示：相对时间、百分比样本阈值、时长格式、热力 5 档、预测柱归一化、专练词数/空态。
- `use-dictation` 的 `runContentMode`：专练后结果页/历史为 word，关闭后恢复用户模式。

### 手动 / 打包

- 用真实 `.mds-data` 跑一次迁移，核对卡片/日志条数与 `db:status`。
- 1120×820 与 747×547：档案页可滚动、不裁切。
- 键盘：打开 → Tab 页签 → Esc 返回 → 焦点在书本按钮。
- `pnpm check`；`pnpm client:package:wsl test`（包内无 `node_modules`/word-cache，node:sqlite 正常）。
- 回滚演练：`db:rollback -- --yes` 后重启，数据恢复并可再次迁移。

---

## 9. 风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| `node:sqlite` 在 Electron 24.18 可用但仍是实验模块 | API 变动 | 已实测；只用 `DatabaseSync/prepare/exec` 稳定子集；升级 Electron 时回归 |
| Nitro/Vite 解析 `node:sqlite` | 构建失败 | 用 `process.getBuiltinModule` 运行时取模块，避免静态 import；构建+冒烟验证 |
| 迁移阻塞启动 | 首屏慢 | 临时库 + 事务 + 原子替换；典型 < 1s；日志记录耗时；失败立即回退兼容模式 |
| 两个进程同时迁移 | 文件竞争 | `.migrate.lock` + 临时库 rename；目标已存在则打开既有库 |
| DB 损坏 | 数据不可用 | WAL + `quick_check`；损坏时明确报错、不静默；归档可回滚；提供 `db:status` |
| 兼容模式长期存在 | 维护双实现 | 只保留一个发布周期，写 FUTURE 到期移除 |
| 旧书写场次无法恢复 | 历史使用频率缺口 | 32 屏明确说明；新场次开始记录；不伪造 |
| 时区/DST | 日统计错位 | 写入时用 `localDateKey` 固化 `day/due_day`；SQL 不做时区换算 |
| 重复提交 | 统计翻倍 | `session.id` 幂等；事务；客户端 committed 守卫 |
| 日志长期增长 | 查询变慢 | 索引 + 窗口查询；5 万条验收；超过 20 万条再评估归档/分区 |
| 测试环境与 Electron Node 版本差异 | 测试假绿 | 关键迁移/事务路径加一个 `ELECTRON_RUN_AS_NODE` 冒烟脚本（只读/临时库） |

---

## 10. 待崔总评审确认

1. **设计稿**：30/31/32/30a 视觉是否通过？重点看 KPI 密度、180 天热力、专练按钮、空态。
2. **迁移兜底**：是否接受「迁移失败自动兼容模式 + 统计暂不可用」这个策略（推荐）；
   还是宁可启动即报错、等修复后再用？
3. **文案**：`学习档案` / `重点词` / `专练这 5 个（单词 · 赛博）` / `掌握 = 下次间隔 ≥ 3 周` 是否合适？
4. **`daily.json` 退场**：确认可以删除（今日进度改由每库日志聚合）。
5. **实施节奏**：是否按 M1 → M2 → M3 → M4 推进；M1 完成后再看一次迁移报告。

---

## 附录 A：旧数据 → SQLite 映射

| 旧数据 | 新落点 | 备注 |
| --- | --- | --- |
| `<id>.cards.json` 的 `cards` | `cards` | `due` 转 epoch；`due_day` 本地日；字段一一对应 |
| `<id>.log.jsonl` 每行 | `review_log` | 坏行跳过；`session_id = NULL` |
| `<id>.sessions.jsonl`（兼容模式） | `session` + `session_word` | `sessions.jsonl` 不存在则跳过 |
| `daily.json` | 不导入 | 归档；今日进度由 `review_log` 重算 |
| `mds-data/banks/*` | 不动 | 词库本体继续 JSON |

## 附录 B：回滚 runbook

1. 退出应用（确认没有 Electron/Node 进程占用 `review.sqlite`）。
2. 执行 `pnpm db:rollback -- --yes`：
   - `review.sqlite*` → `review.sqlite.bak-<timestamp>`；
   - `review/migrated-v1/*` → 搬回 `review/`；
   - 打印下一步提示。
3. 重新启动；首次访问词表会再次迁移。
4. 如需彻底放弃迁移：保留归档，删除 `review.sqlite*`，在代码中临时切回兼容模式（仅排障用）。

## 附录 C：文件变更清单（实施时）

#### 新增

- `src/lib/review-types.ts`：类型、常量、日志/卡片/场次校验（migrate 与两个 store 共用）。
- `src/lib/review-schema.ts`：DDL、`user_version`、迁移 v1。
- `src/lib/review-migrate.ts`：旧文件导入、校验、归档、锁。
- `src/lib/review-store-sqlite.ts`：SQLite store（事务/幂等/读回）。
- `src/lib/review-stats-query.ts`：SQL 统计查询。
- `src/lib/review-store-legacy.ts`：兼容模式 store（现有 JSON 实现迁移过来）。
- `src/lib/bank-stats.ts`：常量 + 纯计算 + 类型。
- `src/lib/bank-stats-service.ts`：SQL 查询 → 视图。
- `src/routes/api/bank-stats.ts`。
- `src/components/BankArchiveScreen.tsx`。
- `src/lib/bank-stats.test.ts`、`bank-stats-service.test.ts`、`routes/api/bank-stats.test.ts`（重写的 `review-store.test.ts` 覆盖迁移/store/兼容）。
- `scripts/review-db-status.mjs`、`scripts/review-db-rollback.mjs`。
- `.implementation-report/2026-10-18-wordbank-stats.md`（实施后）。

#### 修改

- `src/lib/review-store.ts`：SQLite store + `commit` 事务 + 幂等 + 查询。
- `src/lib/review-service.ts`：去掉 daily，进度走 `readDayStats`；提交场次。
- `src/routes/api/review-commit.ts`：`session` 参数。
- `src/lib/runtime-stores.ts`：SQLite 优先 + 兼容模式。
- `src/lib/use-wordbanks.ts` / `src/lib/use-dictation.ts` / `src/routes/index.tsx`：会话计时、专练。
- `src/components/WordBank.tsx` / `BankSourceCard.tsx` / `BankDetailScreen.tsx`：入口与互跳。
- `src/lib/bank-api.ts`：stats/session 类型。
- `package.json`：`db:status` / `db:rollback` 脚本。
- `.design/mds.md`、`FUTURE.md`、`AGENTS.md`（如命令与数据落点变化）。
