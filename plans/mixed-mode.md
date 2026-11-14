# 混合模式（mixed）方案

> 状态：**已实施（2026-10-29）**。决策见 §1，实施与验证见
> `.implementation-report/2026-11-09-mixed-mode.md`；界面见 `.design/mds.md` 第七批 37–40。
> 关联：内容模式现状见 `AGENTS.md`「系统基础功能」；短句先例见 `plans/sentence-mode.md`；
> 复习写回口径见 `AGENTS.md`「词库 / 复习 / 学习档案」。

## 1. 需求与决策

崔总 2026-10-29：

> 增加一个混合模式，每个单词在释义、中文词、短句三种模式中选 2 个来默写，
> 20 个词会默 40 遍。

**已拍板的四条**：

| # | 决策 | 结论 |
| --- | --- | --- |
| 1 | 配对方式 | **每词随机从三种里取 2**（三种配对都会在场上出现） |
| 2 | 轮次顺序 | **整场打乱，同一词两轮至少隔 6 轮**（20 词时；见 §3.2），绝不两遍制 |
| 3 | 两段式轮 | **第 1 次出现**（pass=1）若是释义/中文词 → 保持两段式（写单词 + 第二步）；**第 2 次出现**（pass=2）→ **只写第二步**。同时把**所有**两段式赛博默写界面的提示改造清楚：用户必须一眼看出本轮要写的是单词本身，还是释义/中文词 |
| 4 | 计分与展示 | **逐轮记分（40 行，x/40）**，结果页顶部同时给**词级** `y/20`（该词两轮全对才算对）；每行带本轮模式标签 |

补充默认（无异议即按此实现）：

- 混合模式**书写与赛博都支持**（与释义/中文词/短句一致）。书写场次无判定字段 → 照旧不写回 SRS，只记场次。
- 混合模式也显示「更新短句」操作（它会用到短句缓存）。
- 混合模式必须配置 AI（三类数据都要），未配置时禁止开始并提示。
- 混合模式是**场次概念**，`contentMode` 记 `"mixed"`；每一轮的**真实模式**逐轮记录（见 §9）。

## 2. 现状与改动面（本轮要复用的既有件）

| 关注点 | 现状 | 本轮动作 |
| --- | --- | --- |
| 内容模式枚举 | `state.ts` `ContentMode` + 白名单 `CONTENT_MODES` | 加 `"mixed"`（白名单同时作用于持久化恢复与历史校验） |
| **场次级模式** | `use-dictation.ts:333` `activeContentMode()` 被 8 处当作「这一轮是什么」 | **核心改动**：新增 `round.mode` / `round.pass`，改为读**轮级**模式（统一走 `roundAskOf`） |
| 轮次模型 | `WordRound` 已有 `variant`/`phonetic`/`countdownSec`/`gapSec`/`playLabels` | 加 `mode` / `pass`；短句轮沿用 `variant: "sentence"` |
| 计时 | `timing.ts` 释义段、中文词段、整句公式都是独立纯函数 | 新增 `secondStepOnlyDuration`（第二轮只写第二步，删掉「写单词」占用） |
| 准备链路 | 释义/中文词：TTS 与 AI 并行；短句：先 AI 后 TTS（两轨合并进度） | 新增 `prepareMixed`：三类 AI 并行 → 词音 + 句音两轨合并进度 |
| AI 缓存 | 按 kind 分文件（`definitions.json` / `chinese-words.json` / `sentences.json`），带 model(+level) 失效 | 直接复用，第二次起几乎无 AI 成本 |
| **AI 批改** | `runGrading()` 单 kind、`GradeOverride` 以**词**为键、提示词要求 "keyed by the exact original word" | **必须按 kind 拆两次请求**，override 键改 `kind:word` |
| 结果模型 | `results.ts` `buildResultRows(rounds, mode, contentMode, grades)`，`buildFields` 按场次模式分支 | 改按 `roundAsksWord` 分支；`ResultRow` 加 `mode` / `pass` |
| 写回 | `buildCommitItems` 行判定 = 所有 graded 字段都对；短句/音标降级轮覆写 `word` | 改「逐行 mode 优先」；`aggregateItemsByWord` 天然支持一词两轮（全对才推进） |
| 存储 | `session.content_mode` 是 `TEXT NOT NULL`，**无 CHECK**，`REVIEW_SCHEMA_VERSION = 1` | 只加白名单，**不迁移** |
| 归档/历史 | `CONTENT_MODE_LABELS[session.contentMode]`、`isContentMode` 校验历史 | 加 `mixed` 标签；历史行保留 `mode`/`pass` |
| 滑块 | `WordBank.tsx` 6 项 / 430px，槽宽 ~71px | 第 7 项 → 滑块 500px，控制行改 `flex-wrap`（窄窗时操作区换行） |

## 3. 混合计划（纯函数，`src/lib/mixed-mode.ts`）

```text
export const MIXED_BASE_MODES = ["definition", "chinese", "sentence"] as const;
export type MixedBaseMode = (typeof MIXED_BASE_MODES)[number];

export interface MixedRoundSlot {
  word: string;
  /** 本轮默写模式（降级后可能是 "word"） */
  mode: MixedBaseMode | "word";
  /** 该词在本场第几次出现（按最终顺序判定） */
  pass: 1 | 2;
  /** 降级说明（结果页/结算提示用） */
  note?: string;
}

export interface MixedPlanOptions {
  words: string[];
  /** 注入随机源（0..1）；默认 Math.random */
  random?: () => number;
  /** 间隔下限；缺省 mixedMinGap(words.length) */
  minGap?: number;
}

export function mixedMinGap(wordCount: number): number;   // max(3, round(0.3n))：10→3, 20→6, 30→9
export function buildMixedPlan(options: MixedPlanOptions): MixedRoundSlot[];

/** 规划完再按数据可用性改配（保持顺序与 pass；短句失败/句音缺失走这里） */
export function applyMixedAvailability(
  rounds: MixedRoundSlot[],
  isAvailable: (word: string, mode: MixedBaseMode) => boolean,
): { rounds: MixedRoundSlot[]; degraded: MixedDegradation[] };
```

### 3.1 配对

每个词独立选「省略哪一种」，三种配对等概率；剩下两种的顺序再随机（决定谁先出现）。
用 `wordKey` 去重（大小写/首尾空格视为同词），保证「每个词恰好 2 轮」。

### 3.2 顺序（保证间隔）

1. **种子构造**：词序洗牌后，第 i 个词的先出现轮放槽位 `i`、后出现轮放槽位 `n+i`
   → 天然满足「同词间隔 ≥ n」（n=词数）。
2. **随机换位**：做 `4n` 次尝试，随机取两个槽位交换；只接受**不破坏任何词间隔下限**的交换。
   下限 `d = max(3, round(0.3n))`。种子构造已满足 `d`，且每次换位都校验，故**下限恒成立**（可测）。
3. 交换后再按最终槽位重算 `pass`（先出现 = 1）。

效果：整场是混着两种模式的 40 轮，同词两轮至少隔 6 轮（20 词），不会出现「刚写完马上再写同一个词」。

### 3.3 降级

按 `isAvailable` 逐槽处理，**不缩短场次**：

1. 该槽模式不可用（如短句生成失败）→ 换成该词**另一种可用**的基础模式；
2. 若两种都不可用 → 换成 `"word"`（普通单词轮），并记 `note`；
3. 任何降级都写进结算 `resultNote`（如「3 个词没有合格短句，已改配为释义轮」）。

### 3.4 作答形态（第 3 条决策的唯一真源）

```text
export type RoundAsk = "word" | "word+second" | "second" | "sentence";
export function roundAskOf(round: { mode?: string; pass?: 1 | 2 }, sessionMode: string): RoundAsk;
```

- `sentence` 模式 → `"sentence"`（单格：写整句）
- `definition` / `chinese`：
  - `pass === 2` → `"second"`（**只写释义/中文词，不写单词**）
  - 否则 → `"word+second"`
- `word` 模式 → `"word"`
- 缺省（无轮级 mode）按场次模式回落，保证单一模式行为完全不变。

**判定字段随形态走**：`"second"` 轮**不产生 `word` 字段**（否则空作答会被判错、整行恒错）。

## 4. 准备链路（`prepareMixed`）

1. 洗牌词表 → `buildMixedPlan`（顺序、配对、pass 在此定死）。
2. **阶段 1：三类 AI 并行**（每个词都请求三类，便于降级改配与缓存复用）
   - `requestDefinitions(all)` / `requestChineseWords(all)` / `requestSentences(all)`
   - 单类失败 → 记为降级（不中止）；**三类全失败** → `prepError = "AI 当前不可用：…"`（与单一模式一致）
   - 进度：不确定态动画（三请求并行，单次请求无中间进度）
3. **阶段 2：语音两轨并行**，合并成一条 x/y 进度
   - 词音：全部去重词（`def`/`chinese`/降级 `word` 轮都要用）
   - 句音：**只合成实际用到的整句**（去重）
4. `buildMixedRounds`：逐槽建轮 → 每轮 = 自己所选模式的计时与播报
5. 降级/失败信息 → `resultNote`；`setPhase("ready")`

## 5. 计时

| 轮型 | 播报 | 计数轨 |
| --- | --- | --- |
| 短句 | 整句 3 遍（`SENTENCE_REPEATS`） | `sentenceCountdownDuration`（不变） |
| 释义/中文词 **pass=1** | 词 3 遍 / 2–3 遍（`repeatCount`） | `countdownDuration`（不变，含第二步段） |
| 释义/中文词 **pass=2** | 同上（听音不变） | **新增** `secondStepOnlyDuration` = `THINK_SECONDS × repeats + 第二步段`，再乘档位×倍率 |
| 单词（降级） | 词 2–3 遍 | `countdownDuration`（不变） |

说明：pass=2 删掉的是「写单词」占用的 `LETTER_SECONDS × L × repeats`（听与思考仍在），
播报间隔 `speechIntervals` 不变——播报节奏与音频解耦，倒计时交给计数轨。

## 6. 作答、提示与键盘流

### 6.1 轮次提示（本轮改造重点，覆盖**所有**两段式赛博界面）

| 场景 | 顶部徽标 | 状态行（输入框上方，固定高度） |
| --- | --- | --- |
| 单一释义（两段式） | 无（维持现状） | `听语音写单词 → 再写释义` |
| 单一中文词（两段式） | 无 | `听语音写单词 → 再写中文词` |
| 混合 · 释义 pass=1 | `本轮：释义 · 第 1 次` | `听语音写单词 → 再写释义` |
| 混合 · 释义 pass=2 | `本轮：释义 · 第 2 次` | `听语音直接写释义（本轮不写单词）` |
| 混合 · 中文词 pass=1 | `本轮：中文词 · 第 1 次` | `听语音写单词 → 再写中文词` |
| 混合 · 中文词 pass=2 | `本轮：中文词 · 第 2 次` | `听语音直接写中文词（本轮不写单词）` |
| 混合 · 短句 | `本轮：短句` | `听整句写整句` |

- 输入框徽标由「第 1 步 / 第 2 步」改为**语义化**：`① 单词`、`② 释义`、`② 中文词`；
  单步轮只有一个 `释义` / `中文词` 徽标，右侧补浅色说明`不用写单词`。
- 占位符：`输入单词…` / `输入释义…` / `输入中文词…` / `输入整句…`（按格取值，不再按场次模式猜）。
- 顶部进度：混合场次显示 `第 7 / 40 轮`；单一模式保持 `第 7 / 20 个`。
- 布局稳定：状态行固定 `h-6`、输入区 `mt-auto`；轮内不因提示变化而位移。

### 6.2 键盘与提交

- 两段式：第 1 格 Enter → 第 2 格；第 2 格 Enter → 本轮完成。**不变**。
- 单步轮（pass=2）：只有一个输入框，自动聚焦，Enter 直接完成本轮。
- 倒计时结束（赛博）：按 `RoundAsk` 封口——`"second"` 只封 `answerDef`，**不写 `answer`**；
  `"word+second"` 两格都封（未输入记空串）。书写模式规则不变（空格跳过）。
- 混合场次仍不新增快捷键；`F1` 音标表、结果页 Enter/Escape 不变。

## 7. AI 批改

- 只批改 `answerDef !== undefined` 的轮（即 pass=1 的释义/中文词 + pass=2 的单步轮）。
- **按 kind 分组两次请求**（释义一组、中文词一组），并行；短句轮不请求。
- `GradeOverride` 键改 `gradeKey(kind, word)`（如 `definition:ability`），避免同词两种第二步互相覆盖。
- 失败/中止沿用现有降级（本地归一化匹配 + `gradeNote`）。

## 8. 结果与计分

- 40 行，逐行带本轮模式标签（`释义` / `中文词` / `短句`；单步轮加 `· 只写释义`）。
- 行判定 = 该行所有 graded 字段都对（pass=2 行只有一个判定字段）。
- 顶部：主胶囊 `32 / 40`（轮），副标签 `18 / 20 词`（该词两轮全对才算对）。
  新增纯函数 `wordSummary(rows) → { words, correctWords }`。
- 全对庆祝：40 行全对才撒花（沿用 `isAllCorrectRows`）。
- 判定说明 `JUDGEMENT_NOTES.mixed`：说明两轮各判什么、pass=2 不判拼写。

## 9. 写回与统计口径

- `session.content_mode = "mixed"`；`review_log.mode` 记**每轮真实模式**
  （`definition` / `chinese` / `sentence` / 降级 `word`）。
- `REVIEW_MODES` 加 `"mixed"`（同时被 `/api/review-commit` 校验、`modeOf` 白名单使用）。
- `buildCommitItems`：**逐行 mode 优先**（`row.mode`），无则回落场次模式并保留短句/音标降级规则。
- 一词两轮 → `aggregateItemsByWord` 聚合成一张卡：**两轮全对才 Good，一错即 Again**（既有语义，不改）。
- 统计展示：`session.judged = 40`、`word_count = 20`（与组句一轮多空同构）；
  「模式占比」按 `review_log.mode` 分组，混合场次不会把「混合」塞进模式分布。
- 无 schema 迁移；旧数据不受影响。

## 10. 界面改动清单

1. `WordBank.tsx`：滑块加第 7 项 `{ value: "mixed", label: "混合", icon: Shuffle }`（短句之后、音标之前）；
   滑块 430 → 500px；控制行 `flex-wrap`（窄窗时模式操作区换行）。
2. `ModeActions.tsx`：混合模式显示「更新短句」（与短句模式同一入口）；未知模式不显示。
3. `DictatingView.tsx`：新增 `ask` / `roundBadge` / `secondLabel` 渲染（§6.1），去掉按场次模式猜的 `step()` 分支。
4. `ResultsView.tsx`：行模式标签、单步轮说明、顶部副标签（词级）。
5. `ReadyOverlay.tsx`：混合文案 `${count} 轮 · 每个词默 2 遍 · 顺序已打乱`；`ready-overlay.ts` 加分支。
6. `HistoryScreen` / `HistoryImportDialog` / `BankArchiveScreen`：`CONTENT_MODE_LABELS.mixed` 自动生效；
   历史行回看显示逐行模式标签（`mode`/`pass` 随行持久化）。
7. `.design/mds.pen` **第七批 37–40**（已切）：37 词库页（混合）、38 默写中（第 1 次两段式）、
   39 默写中（第 2 次只写第二步）、40 结果页（逐轮标签 + 词级汇总）；注解见 `.design/mds.md` §第七批，
   截图 `.design/mixed-mode-*.png`。窄窗（747）未单独出稿，控制行换行行为实现后核验。

## 11. 降级矩阵

| 情况 | 行为 |
| --- | --- |
| 短句生成失败（整类） | 计划里所有 `sentence` 槽改配为释义或中文词（按可用性），场次仍 40 轮 |
| 个别词短句不合格 / 超 8 词重试后仍不合格 | 同上，按词改配；`note` 记进结果页 |
| 释义/中文词缺失（AI 少返） | 该轮第二步不计分（`graded:false`），只判其余字段；结果页说明 |
| 三类 AI 全失败 | 准备阶段报错并中止（与单一模式一致） |
| 词音 TTS 失败 | 该轮音频缺省（沿用现有「加载失败不卡死 + 淘汰坏缓存」逻辑） |
| 句音 TTS 失败 | 该整句轮无法播报 → 视为该句不可用，改配另一种模式（与短句缺失同路） |

## 12. 测试清单（先写测试再实现）

| 文件 | 覆盖 |
| --- | --- |
| `mixed-mode.test.ts`（新） | 每词恰好 2 轮、两种模式互异且合法；三种配对都能出现（注入随机源）；间隔下限恒成立（多种子 + 边界 5/10/30）；降级改配后仍 2 轮/词且不改 pass；`roundAskOf` 四种形态 + 单一模式回落 |
| `timing.test.ts` | `secondStepOnlyDuration`：释义/中文词各自公式、档位×倍率双重缩放、与两段式差值 = 写单词占用 |
| `results.test.ts` | 逐轮 mode 决定字段；`"second"` 轮无 `word` 字段；`mixed` 标签与判定说明；`wordSummary` |
| `review-service.test.ts` | 逐行 mode 写回；一词两轮聚合（一错即 Again）；`judged=40` 与 `word_count=20` 并存；`mixed` 场次白名单 |
| `use-dictation.test.ts` | 混合准备（三类请求、单类失败降级、全失败报错）；两段式/单步轮提交与超时封口；按 kind 两次批改 + 键不碰撞；书写场次不写回；结果行模式标签 |
| `history-storage.test.ts` | `mixed` 条目与逐行 `mode`/`pass` 往返；损坏字段丢弃 |
| `state.test.ts` | 白名单含 `mixed`；恢复/历史校验 |
| `ready-overlay.test.ts` | 混合文案；Enter 确认不变 |
| `word-bank`/`mode-actions` 相关 | 第 7 项顺序、混合模式操作区显示 |

交付前：`pnpm test:run` + `pnpm check`。

## 13. 实施顺序

1. `.design` 出稿（已切 37–40，已评审）→ 实现
2. `state.ts` / `mixed-mode.ts` / `timing.ts` + 单测（纯逻辑先行）
3. `use-dictation.ts`：轮级 mode、`prepareMixed`、`roundAskOf` 接线、批改拆 kind
4. `results.ts` / `review-service.ts` / `review-types.ts` + 单测
5. 界面：`DictatingView` / `ResultsView` / `WordBank` / `ModeActions` / `ReadyOverlay`
6. `use-dictation.test.ts` 端到端补测 → `pnpm check`
7. 实施报告 `.implementation-report/<date>-mixed-mode.md`；未做项登记 `FUTURE.md`

## 14. 验收

- 20 词 → 40 轮；每词恰好两种不同模式；同词两轮至少隔 6 轮。
- 第 2 次出现的释义/中文词轮：只有一个输入框，没有「写单词」这一步，结果页也只对照第二步。
- 混合任意轮次，用户**不用回忆场次模式**就能从顶部徽标与状态行看出本轮要写什么。
- 结果页 `x/40` 与 `y/20` 同屏；历史/档案可回看逐轮模式。
- 复习库：`session.content_mode='mixed'`、`review_log.mode` 为真实模式；一词两轮只推进一次卡片。
- `pnpm check` 全绿。

## 15. 本轮不做（实施时同步登记 FUTURE.md）

- 混合配对偏好（固定配对 / 权重 / 用户手选配对）
- 混合模式的结果按词分组视图（现在按轮平铺 + 词级汇总）
- 混合模式与音标/组句组合（现在固定「释义 / 中文词 / 短句」三选二）
- 混合场次的自定义间隔下限设置（现在按词数自动取 `max(3, 0.3n)`）
