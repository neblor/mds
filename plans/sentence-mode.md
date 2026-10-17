# 短句默写模式（sentence）方案

> 状态：**已实施（2026-10-17）**。决策见 §5；实施与验证结果见
> `.implementation-report/2026-10-17-sentence-mode.md`。
> 关联：内容模式现状见 `AGENTS.md`「系统基础功能」；生成级别见 `.implementation-report/2026-10-13-generation-level-and-objective-prompts.md`；
> 组句模式（cloze）见 `plans/wordbank-srs-cloze.md`。

## 1. 需求还原

崔总 2026-10-17：

> 把「短句」默写模式加上，放在组句的左边，简单地说就是……此时默写时会为每个单词组一个短句或词组来默写，
> 而不是只默这一个单词。生成的句子的用词及复杂度根据设置里的生成级别来定（用于提交给 AI 生句子时提示词中明确标明），
> 然后在给答案时也要明确让用户知道，这一句默的是哪个单词，以及用户自己输入的整句是什么，这个单词对不对等。

拆成可验收的五条：

1. 内容模式滑块新增「短句」，位置在「组句」左侧：`单词 · 释义 · 中文词 · 短句 · 组句`。
2. 准备阶段为**每个目标词**生成一句短句/词组，默写轮次播报与作答对象是**整句**，判定核心是该句里的目标词。
3. 生句请求的提示词必须显式带上设置里的**生成级别**（contentLevel）来约束用词与句法复杂度。
4. 结果页必须让用户看懂三件事：这句默的是**哪个词**、**标准整句**、**自己输入的整句**，以及**该词对错**。
5. **句子要短**（崔总 2026-10-17 追加）：尽量避免出现过多长句；**允许不是完整句子**（短语/片段/词组都行），
   只要短句本身**通顺自然**即可。这一条是硬约束，不能只写在提示词里靠模型自觉。

## 2. 现状调研（本轮实现要复用的既有件）

| 关注点 | 现状 | 对本模式的影响 |
| --- | --- | --- |
| 内容模式枚举 | `src/lib/state.ts` 的 `ContentMode = word\|definition\|chinese\|cloze`，白名单 `CONTENT_MODES`（恢复与历史校验共用） | 需加 `sentence`，加进白名单后历史/恢复自动兼容 |
| 滑块顺序 | `src/components/WordBank.tsx` 的 `CONTENT_MODES` 数组（带图标） | 在 `cloze` 之前插入一项 |
| AI 释义链路 | `ai-pair-service.ts`：按 kind 分文件缓存（`definitions.json` / `chinese-words.json`），带 `model` + `contentLevel` 失效判断，一次请求 + 逐条校验 + 原子写 + 写后复读 | 短句同构：新增 kind `sentence` + `sentences.json` 缓存文件 |
| 生成级别 | `src/lib/content-level.ts`：`CONTENT_LEVEL_PROMPTS`（英文客观描述），默认 `junior` | 提示词里直接用 `CONTENT_LEVEL_PROMPTS[level]` |
| 语音 | `src/lib/edge-tts-client.ts`（自研，v2 令牌）单次文本上限 4000 字节 | 整句合成无障碍；缓存 key 用**句子文本**（`cacheFileName(sentence, voice)`，含 40 字符 slug + 6 位哈希，不同句子不碰撞） |
| 计时 | `src/lib/timing.ts`：`countdownDuration` 支持 word / definition / chinese 段；`clozeDuration` 用字符系数 | 新增 `sentenceDuration`（纯函数 + 单测） |
| 轮次 | `use-dictation.ts` 的 `buildRounds` → `WordRound`（含 `definition` / `chineseWord`） | 加 `sentence` 字段与整句音频名 |
| 作答 | `DictatingView`：`definition`/`chinese` 是两段式（先词后第二步） | `sentence` 是**一段式**（只输整句），需单独分支 |
| 结果模型 | `results.ts`：`ResultRow { word, audioName, context?, fields }`；`context` 目前只给组句用 | `sentence` 复用 `context` 存标准整句；新增字段 kind `sentence` 承载整句判定/对照 |
| 结果页 | `ResultsView.tsx`：`context` 用 `truncate` 单行显示；右侧用户作答 `truncate` | **必须改造**：整句会长，需换行显示 + 目标词高亮 |
| 复习写回 | `review-store.ts` 的 `REVIEW_MODES = ["word","definition","chinese","cloze"]` | 加 `sentence`（只增不改，旧数据照读） |
| 组句限制 | `WordBank.tsx` 的 `clozeOnly()` 让书写按钮置灰 | 短句**两种作答都允许**（手写整句同样成立），不参与该限制 |

## 3. 方案

### 3.1 数据模型

```ts
// state.ts
export type ContentMode = "word" | "definition" | "chinese" | "sentence" | "cloze";
export const CONTENT_MODES = ["word", "definition", "chinese", "sentence", "cloze"] as const;

// use-dictation.ts 的 WordRound 追加
sentence?: string;   // 标准整句（含目标词）
```

- `ReviewMode`（`review-store.ts`）+ `ResultFieldKind`（`results.ts`）各加 `"sentence"`。
- 历史条目 `contentMode` 走 `isContentMode` 校验 → 无需迁移，旧条目不受影响。

### 3.2 AI 生句（一次请求，与释义同构）

- 新 provider：`src/lib/sentence-provider.ts`
  - 输入：`words[]`、`baseUrl`/`apiKey`/`model`、`contentLevel`、`signal`
  - system prompt 要点（英文，客观口径，风格沿用现有去主观化写法）：
    - 用 `CONTENT_LEVEL_PROMPTS[level]` 约束词汇与句法
    - 「为每个给定单词写**一个自然英文短句**（short sentence），必须包含该词」
    - **短是首要要求**：「keep it as short as possible — usually 3–6 words, **never more than 8**」
    - **允许片段**：「a phrase or fragment is fine; it does not have to be a complete sentence,
      as long as it reads naturally on its own」（例：`a bright sunny morning` / `at the end of the day`）
    - 「只输出一句，不要换行、不要引号、不要解释；不要为了凑长而补充从句」
  - 输出契约：`{"sentences":[{"word":"apple","sentence":"I ate an apple after lunch."}]}`
  - 逐条校验（与释义一致：**只缓存通过校验的项**，缺失/失败项不作为负缓存）：
    1. `word` 必须属于本次请求集合、且不重复
    2. `sentence` 非空、纯 ASCII 英文、无换行、长度 1–200 字符
    3. **包含目标词**（大小写不敏感；允许屈折变化，见 §5 决策）
    4. **长度硬上限**：词数 ≤ `SENTENCE_MAX_WORDS = 8`；目标区间 `SENTENCE_TARGET_WORDS = 3–6`
       （低于 3 词不算错——词组本来就短；超过 8 词直接判不合格）
    5. 不要求是完整句子：**不校验句号/动词**，片段同样合格（只要求非空且含目标词）
  - **超长重试（一次）**：第一批里超过硬上限的词，用同一 provider 再请求一次，
    提示词升级为「MUST be at most 5 words, prefer 3–5」并把上一版太长一并告知；
    仍不合格的词走 §5 决策 3 降级为单词轮。这样既不整场报废，也不会让长句混进默写。
  - 长度分布写进诊断输出（`pnpm get:sentences` 打印每词词数 + 分布），
    7–8 词（贴上上限）占比超过 30% 时提示「提示词可能需要收紧」——只提示，不拦截。
- 编排：`ai-pair-service.ts` 加 kind `sentence`，缓存文件 `sentences.json`（带 `model` + `contentLevel`，级别变了就失效重取）
- 路由：`POST /api/sentences`（与 `/api/definitions`、`/api/chinese-words` 同构：校验入参 → service → 只回有效项 + `missing`）
- 诊断：`pnpm get:sentences word1 word2 ...`（复用 provider，打印每词句子/缺项/耗时，不写缓存）

### 3.3 准备流程

`runPreparation` 里按 `content === "sentence"` 走一条与 `definition` **并行结构相同**的分支：

1. 先取句子（AI，一次请求）——**这决定 TTS 的文本**，所以与 TTS 不能并行；
2. 超长/不合格的词再做**一次**收紧重试（见 §3.2），仍不合格 → 该词 `variant = "word"`；
3. 合格的句子 + 降级词分别做 TTS（每 4 词一批，沿用 `requestTtsAll` 的分块进度；
   目标词音频与单词模式共用缓存，命中则免费）；
4. `buildRounds` 写入 `sentence` / `variant` 与对应音频名；
5. AI 整体不可用（网络/额度/鉴权）→ 按 §5 决策 3 处理（降级为单词轮，不中止本场）。

进度条：句子生成是单次请求（无中间进度），TTS 是多批（有真实进度）。为此把准备进度改成
「阶段 + 阶段内进度」（见 §6 的进度条改造），避免长时间 0% 或 100% 仍在等。

### 3.4 计时（整句基础公式，`timing.ts`）

崔总 2026-10-17 修订：计时偏快，且要求「**基础计算方式调整，不要通过系数调整**」。
因此短句模式改用**整句专用的基础公式**（不改全局 `SPEED_RATE` / 倍率调整）：

```ts
SENTENCE_REPEATS      = 3      // 只念整句 3 遍
SENTENCE_THINK_SECONDS = 4     // 每遍后的思考时间（整句需要回忆结构、核对已写部分）
SENTENCE_CHAR_SECONDS  = 0.45  // 每字符书写时间（含空格与标点）

countdownSec = (SENTENCE_THINK_SECONDS + SENTENCE_CHAR_SECONDS × 整句字符数) × 3
gapSec       = [思考, 思考 + 书写, 书写]        // 三遍播报后的间隔
```

- 不再叠加「目标词段」（不再先念单词），但每遍的思考与书写单价都按整句重设；
- 字符数**含空格与标点**（整句匹配要求这些一致，写的时候也要落笔）；
- 三档速率 × 倍率调整照旧乘在外面（双重缩放与基础公式相互独立）；
- 与音频时长无关：倒计时结束只表示「允许进入下一轮」，语音没放完继续等。

### 3.5 轮次与作答

- **播放序列模型**：把 `api.playWithIntervals` 的 `url + count` 升级为 `items: {url,label}[]` +
  逐项 `gapsMs`（现有唯一的调用方是 `use-dictation`，改动面小）：
  - 单词轮：`[单词 × repeatCount]`
  - 短句轮：`[整句 ×3]`，标签「整句 1/2/3」，供状态行显示（不再有单词那一遍）
  - 某项播放失败：按该项的缓存名淘汰（现在只有单个 `audioName`，要改成逐项）
- 书写：按序列播完 → 学生手写整句 → 空格跳过（现有逻辑不变）。
- 赛博：**一段式**输入（`placeholder`「输入整句，回车提交」）→ 回车提交 → 本轮结束。
  判定走 `isSentenceMatch`（忽略大小写、空格与标点算），大小写写错不算错，
  结算页原样显示用户输入供自己核对。
  `DictatingView` 按 `round.variant === "sentence"` 分支，不显示第二输入框。
- 降级轮（缺句）：`variant = "word"`，播报/计时/作答完全按单词轮走，结果页标注降级原因。
- 跳过/自动推进规则与现有单词轮一致（倒计时 + 语音双轨）。

### 3.6 结果页

新增「整句行」形态（改动 `ResultsView.tsx`，只对 `contentMode === "sentence"` 生效）：

```text
[✓] apple  🔊            标准整句：I ate an apple after lunch.     ⌨ 输入整句
    ↑ 目标词（大字）      ↑ 目标词高亮（brand/30 底色）              I eat a apple after lunch.
```

- 目标词高亮：新纯函数 `highlightOccurrences(sentence, word)` → 片段数组（供 `<For>` 渲染），
  大小写不敏感、支持一次命中多处；单词对错清楚标注（`✓/✗` + 行底色沿用现有 ok/err 规则）。
- 用户输入整句：**不用 `truncate`**，允许换行（`break-words`），最多 3 行折叠 + title 展示全文。
- 发音按钮：播放**整句音频**（`round.audioName` 指向整句音频；降级轮指向单词音频），
  符合「听到什么就默什么」。
- 整句 AI 批改：复用 `answer-grade-service`（与释义/中文词同构），一次请求批改全场整句；
  失败或中止时降级为「只展示标准句 + 用户输入」并在结果页提示（沿用现有 `gradeNote` 机制）。
  **不计入** `<correct>/<total>`。
- 汇总 `<correct>/<total>`：按**目标词**对错统计（见 §5 决策）。

### 3.7 复习写回

- `commitSession` 的 `mode: "sentence"`；`correct` 取目标词判定（与单词模式同口径）。
- 混合场次要如实记录：`buildCommitItems` 支持**逐项覆盖** mode（降级轮写 `word`），
  否则复习统计会把「只默了单词」的轮次算成短句轮。
- `ReviewLog.mode` 增加 `sentence`（只增不改，旧日志照读）。
- 历史记录条目 `contentMode: "sentence"`，回看时结果页走同一套渲染。

### 3.8 测试

- 单测：
  - `sentence-provider.test.ts`：契约校验（含词、**长度硬上限 8 词**、**片段合格**、纯英文、缺项、
    非法块、截断响应、超长项触发一次收紧重试、重试仍超长则判缺失）
  - `sentence-service`（ai-pair-service 扩展）：缓存写入 / 写后复读 / 级别变化失效 / 失败不写负缓存
  - `timing.test.ts`：`sentenceDuration` 边界（空句、超长句、倍率）
  - `results.test.ts`：短句结果行（单词判定 + 整句字段 + 高亮）
  - `state.test.ts`：`sentence` 进出白名单
  - `history-storage.test.ts`：旧条目无 `sentence` 时仍正常
- 回归：`pnpm get:sentences`（≥20 词，验证解析/对齐/缓存/复读）；
  浏览器真实跑一场短句默写（准备 → 播报 → 作答 → 结果 → 写回）。

### 3.9 设计稿

- `.design/mds.md` 同步说明增加「短句」滑块项与结果行形态；
- `.pen` 需要 Pencil 应用在线才能改（加密，不能手改）——与 `FUTURE.md` 第 14 条同一限制，运行时补。

## 4. 实施分期

| 期 | 内容 | 产出 |
| --- | --- | --- |
| P1 | 枚举/白名单 + provider + service + 路由 + 单测 | `pnpm get:sentences` 可用，缓存可复读 |
| P2 | 播放序列改造 + 准备流程 + 阶段化进度条 + 计时 + 轮次（书写/赛博/降级）+ 单测 | 能完整默一场（界面最简） |
| P3 | 结果页整句行 + 高亮 + 整句 AI 批改展示 + 历史 + 复习写回 + 单测 | 崔总要求的「看明白」达成 |
| P4 | 诊断脚本回归 + 浏览器端到端 + 报告/FUTURE | 可交付 |

## 5. 决策（崔总 2026-10-17 确认）

| # | 决策点 | 结论 | 对实现的影响 |
| --- | --- | --- | --- |
| 1 | 播报内容与遍数 | **只念整句 3 遍**（2026-10-17 修订：不先念目标词——用户听到第一个音就开始写，念单词没有用） | 轮次模型从「同一音频播 N 遍」升级为「播放序列」：短句轮 = `[整句 ×3]`，各有标签与间隔；**不再合成目标词音频**（只有降级轮才需要） |
| 2 | 判定口径 | **整句匹配计分**（2026-10-17 修订）：忽略大小写，**空格与标点必须对上**；AI 批改只给「差在哪」的参考备注，不计分 | 结果行 = 一个 `graded` 的 `sentence` 字段（`isSentenceMatch`）+ AI 备注；整句全对时不再请求 AI；复习写回取整句判定 |
| 3 | AI 失败/缺句 | **缺句的词当场降级为「只默单词」轮**，结果页标注「本词无句子，按单词默」 | 一场允许混合轮次：`variant: "sentence" \| "word"`；轮次/计时/作答/结果/写回都按 variant 分支；不整场报废 |
| 4 | 词形要求 | **允许屈折变化**（`go`→`went`、`apple`→`apples`），本地词干规则校验，不额外请求 AI | 校验函数 `containsWordForm(sentence, word)`：原形精确 → 常见屈折（+s/+es/+ed/+ing、去 e、双写辅音、不规则表小集）；判不出就当缺句走决策 3 |
| 5 | 句子长度（崔总 2026-10-17 追加） | **短句优先**：目标 **3–6 词**，**硬上限 8 词**；**允许片段/词组**，不要求完整句子，只要求本身通顺 | 提示词把「短」列为首要要求并显式允许片段；校验按硬上限拦截；超长项做一次收紧重试（≤5 词）；长度分布进诊断。阈值集中在 `timing.ts`/`sentence-provider.ts` 的常量里，便于按体验再调 |

## 6. 附带项：进度条阶段化（本轮一并做，P2 内）

现状实测（本机，真实 AI）：

| 阶段 | 请求形态 | 实测表现 | 判定 |
| --- | --- | --- | --- |
| 生成语音（单词/释义/中文词/短句） | 每 4 词一批，多批 | 0% → 40% → 80% → 100%，逐批跳动 | 正常 |
| 组句「正在出题」 | **单次** AI 请求 | 0% 冻结 **33s**（另一次 12.3s） | 看着像卡死 |
| 释义/中文词的 AI 阶段 | 单次请求，与 TTS **并行** | TTS 8.4s 跑满 100%，之后又等了 12s | 100% 仍在等，误导 |

按崔总「多次请求要有合理进度」的口径，改成「阶段化进度」：

- `PreparingOverlay` 支持 `indeterminate`（不确定态，条纹动画）与「阶段列表」；
- 每个阶段声明权重，主进度 = 已完成阶段权重 + 当前阶段内部进度（无内部进度则用不确定动画）；
- 组句：出题（不确定）→ 语音（determinate x/y）；释义/中文词/短句：语音（determinate）+ AI（不确定，并行）；
- 附带显示「已用时 N 秒」，让慢请求有可感知的反馈。
