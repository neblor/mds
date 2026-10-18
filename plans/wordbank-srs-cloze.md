# 词库 · 每日复习（SRS）· 范例组句 —— 方案与难点（待审）

> 状态：**待崔总审核**。本文件只做规划与调研，不含界面设计；审完再进 `.design` 出设计稿。
> 调研数据都是实测（命令与结果见文末「附录」），关键外部事实均给了出处 URL。
>
> **2026-10-18 更新**：复习状态已从 JSON 迁移到 SQLite（`mds-data/review/review.sqlite`）；
> 本文件 §3 的 `<bankId>.cards.json / .log.jsonl / daily.json` 是当时方案，现行数据模型见 `AGENTS.md`
> 与 `plans/wordbank-stats.md`，迁移/回滚见 `.implementation-report/2026-10-18-wordbank-stats.md`。

---

## 0. 需求还原（先对齐理解）

| # | 需求 | 我的理解 |
| --- | --- | --- |
| R1 | 词库功能 | 词源区加一条**「录入 / 词表」切换条**；切到词表模式即进入选词表，词表分**资源词表**（网上抓、只读）与**自建词表**（可增删） |
| R2 | 优先「从网上抓」 | 资源词表来自在线清单（ECDICT 生成 / 远端 manifest），内置若干个 + 按需增量下载；不是让用户手敲 |
| R3 | 自建词库 | 词表模式内可**新建空词表**；把**录入模式的词**或**历史默写记录**的词加入词表（自动去重）；自建词表可编辑增删 |
| R4 | 类 Anki 算法 | 每个词是一张「卡片」，按记忆状态排下次到期日；漏了/错了更早再来 |
| R5 | 每日 review 默写模式 | 一个「今日任务」入口：自动挑出今天该复习的词 + 今天的新词，组成一场（或几场）默写 |
| R6 | 范例组句题 | **独立模式**（与单词/释义/中文词并列，进同一条模式选择条）：上方给出**候选词范围（≤24 个）**，下方 2–3 句短文挖 2–4 个空显示为横线，用户为每个空**选**词；实际用到的答案词 ≤16 个 |
| R7 | 出题方式 | 开始前**一次 AI 请求批量获取整场题库**，不落盘（不做题库文件）；**失败即报「AI 当前不可用」并结束**，不降级到其他模式 |

> 已定稿（崔总 2026-10-12）：
> ① 组句是**独立模式**（第四种内容模式）、准备时**一次批量出题**、失败即「AI 当前不可用」结束，不降级；
> ② 词源区做**「录入 / 词表」双模式**切换条，录入模式行为不变；
> ③ 词表模式**不做选词**：选定词表后完全由 FSRS-6 排（到期优先 + 新词补足），用户只能定**「今天默几个」**；
> ④ **SRS 含在 Phase 1** 内一起做。

**R6 的两个数字含义**（我按此实现，若理解有偏差请纠正）：
- 一次组句考核的**候选范围** ≤ 24 个词 → 屏幕上可选项最多 24 个；
- 答案只从范围里取，**一屏最多 16 个词被真正考到**（因为每题 2–4 空、多题覆盖）。
- 也就是说：范围是「干扰项池 + 答案池」，范围 > 答案，逼学生自己筛。

---

## 1. 调研结论

### 1.1 词库数据源：推荐 ECDICT（MIT），排除 qwerty-learner

**ECDICT**（`skywind3000/ECDICT`，仓库 8k star，**MIT 许可**）
仓库： https://github.com/skywind3000/ECDICT

实测下载 `ecdict.csv`（62.9 MB，770,611 词条）后统计：

| 字段 | 说明 | 可用性 |
| --- | --- | --- |
| `word` | 词/词组 | 100% |
| `definition` | **英文释义**（本项目的「释义」只要英文） | 考试标签词覆盖 99.6–100% |
| `translation` | 中文释义 | ~99%（可用于「中文词」模式，省一次 AI 调用） |
| `phonetic` | 音标 | 部分 |
| `tag` | 考纲标签：`zk/gk/cet4/cet6/ky/ielts/toefl/gre` | 见下表 |
| `frq` / `bnc` | 词频序号 | 基本 100%（可作为「新词先学高频」的排序依据） |
| `collins` / `oxford` | 柯林斯星级 / 牛津三千核心词 | 13,633 / 3,461 条 |

按 `tag` 生成词库的实测规模与体积（只保留 `word` + 英文释义 + 音标 + 词频）：

| 词库 | 词条数 | JSON 体积 | gzip 估算 |
| --- | --- | --- | --- |
| 中考 zk | 1,600 | 298 KB | ~74 KB |
| 高考 gk | 3,668 | 652 KB | ~163 KB |
| CET-4 | 3,846 | 674 KB | ~169 KB |
| CET-6 | 5,403 | 911 KB | ~228 KB |
| 考研 ky | 4,801 | 830 KB | ~208 KB |
| IELTS | 5,019 | 863 KB | ~216 KB |
| TOEFL | 6,952 | 1,073 KB | ~268 KB |
| GRE | 7,478 | 1,058 KB | ~265 KB |
| 全部 8 库并集 | 14,942 个不重复词 | ~6.3 MB | **~1.6 MB** |

**结论**：8 个考试词库全内置也只有 1.6 MB（压缩后），完全可以直接随包发布；「抓取」因此可以做得很稳——不是去爬网页，而是**从清单拉 JSON**。

**为什么不选 qwerty-learner**（词库里 CET4/GRE/IELTS 等最全的那个项目）：
仓库 https://github.com/RealKai42/qwerty-learner ——**GPL-3.0**（已核实 LICENSE 文件是 GNU GPL v3）。
把它的 `public/dicts/*.json` 直接搬进本项目会引入 GPL 传染风险。**除非你明确同意接受 GPL-3.0 整体协议，否则不采用。**
（词表本身是事实、不受版权保护，但「整理好的文件」仍是该工程的受版权作品，我按保守处理。）

其他可选（备选，非必需）：
- NGSL（New General Service List，高频 2800 词）： http://www.newgeneralservicelist.org/
- CEFR 分级词表： https://www.englishprofile.org/wordlists
- 在线词典 API（require 联网，速度慢）： https://dictionaryapi.dev/

### 1.2 调度算法：推荐 FSRS-6（`ts-fsrs`），而不是自研 SM-2

- Anki 从 23.10 起内置 FSRS，**FSRS-6 自 Anki 25.07 起成为默认算法**（旧算法是 SM-2 变体）。
  出处： https://github.com/ankitects/anki/blob/main/docs-site/faqs/what-spaced-repetition-algorithm.mdx
  Anki 牌组参数（学习步、毕业间隔、简单间隔、失误重学、leech、期望保持率）： https://docs.ankiweb.net/deck-options
- `ts-fsrs` v5.4.2 实测元数据：**零依赖**、ESM/CJS/UMD 三种产物、解包 706 KB、纯 TypeScript 实现 FSRS-6。
  npm： https://www.npmjs.com/package/ts-fsrs ｜ 仓库： https://github.com/open-spaced-repetition/ts-fsrs
  用法：`createEmptyCard()` → `fsrs()` → `scheduler.next(card, now, Rating.Good)`，`card` 自带
  `due/stability/difficulty/elapsed_days/scheduled_days/reps/lapses/state/last_review`，可整体序列化存本地。
- Anki 的关键概念对应到我们这边（我建议照搬其行为模型，但**简化参数**）：
  - **新卡片**（New）→ 学习步（Anki 默认 1m/10m）→ 毕业进 Review（默认间隔 1 天）
  - **到期复习**（Review）：答对按 FSRS 给 `due`；答错 → **重学（Relearning）**，今天内再出现一次
  - **每日限额**：新卡上限 / 复习上限（Anki 默认 20 / 200，我们该按一场默写的长度收窄，见 D8）
  - **期望保持率**：FSRS 的核心可调参数（Anki 默认 0.9）——直接决定「多久见一次」，我建议做成设置项，默认 0.9

### 1.3 「自动判分」是这套算法的独特之处

Anki 要求用户自己点 Again/Hard/Good/Easy；我们**赛博默写有客观判定**（严格匹配 + AI 批改），可以自动映射评分。
这是本项目相对 Anki 的优势：不用用户自评，数据更干净。

---

## 2. 难点与解决方案

### D1｜评分从哪来：自动判分 → FSRS Rating 的映射

**难点**：FSRS 期望 1–4 四档评分（Again/Hard/Good/Easy），但我们的判定只有对/错；书写模式（用笔默）根本没有判定。
**方案**：
- 赛博 + 单词判定错 → `Again`；判定对 → `Good`；判定对且**用时 < 轮次时长 50%** → `Easy`（有奖励含义，但可先不做，M2 只上 Again/Good）
- 释义/中文词由 AI 批改，与单词判定**与**的规则：单词错 → `Again`；单词对、第二步错 → `Again`（第二步是同一张卡的一部分）
- 书写模式：**默认只记「练过」不进调度**；可选项（默认关）「书写模式结束后自评对/错」二档，映射 Again/Good
**取舍**：不引入 Hard 档，避免用户无感知的算法抖动；宁可少一档也不要错档。

### D2｜数据放哪儿：localStorage 已经不够用

**难点**：现在单词表在 `localStorage`（`mds.words.v1`）；一个词库几千词 + 每张卡的调度状态，localStorage 既装不下（5–10 MB 配额）也不适合频繁整体读写。
**方案**：沿用项目既有架构——**服务端文件 + HTTP API**，与音频/释义缓存同一套路：
- 复用 `src/lib/cache-storage.ts` 的「运行时存储边界」思想，新增一组 `BankStorage` / `ReviewStorage` 接口，由工厂按 web/client 选实现；业务路由不碰文件路径
- 落点：`.mds-data/banks/<bankId>.json`（词库）、`.mds-data/review/<bankId>.json`（卡片状态 + 复习日志），Electron 侧走 `userData/mds-data/…`（卸载保留）
- 写入用现成的「临时文件 + rename 原子写」实现；读坏容错（损坏词库整体丢弃 + 提示重下）
**取舍**：Web 模式（`pnpm web:dev`）也依赖本地服务端，符合当前所有构建都带 Nitro 的现实，可接受。
**不选 IndexedDB 的原因**：Electron 里 userData 文件更容易备份/导出，也和「缓存不得写进 public」的既有约定一致。

### D3｜词库从网上「抓」：抓什么、怎么抓、网不通怎么办

**难点**：真正的网页爬取不稳定（HTML 结构会变、可能被墙、许可不明）。
**方案**：三段式
1. **内置**：构建期脚本 `scripts/build-banks.mts` 从 ECDICT CSV 生成 `public/banks/*.json`（中考/高考/CET4/CET6/考研/IELTS/TOEFL/GRE 八库 + 一个高频 3000 词库），随包发布，**离线可用**；脚本可重跑、可复现，许可 MIT
2. **在线清单**：`public/banks/manifest.json` 内置；另支持设置里填写**自定义清单 URL**，客户端拉清单 → 比对 `version/sha256` → 只下增量 → 写进本地词库目录。清单可托管在 GitHub raw / OSS / 你自己的服务器
3. **导入**：本地文件（`.json` / `.csv` / `.txt` 每行一个词）导入为自建词库；也支持粘贴文本（复用批量导入的切分规则）
**风险与对策**：GitHub raw 在国内可能慢 → 清单 URL 可配 + 默认给镜像；下载失败必须给出「重试 / 仍用内置库」两条路，绝不静默失败。

### D4｜词源区做成「录入 / 词表」双模式（崔总 2026-10-12 定稿）

**难点**：现有 UI 的入口是一张手敲的单词表；要引入词表，又不能把老路径推翻。
**方案**：词源卡片顶部加**切换条（录入 / 词表）**，两种模式共用下面同一张「本次默写的单词表」：
- **录入模式**（默认，行为原样不动）：输入框 + 批量导入 + 恢复词汇；敲进去的词直接进「本次单词表」
- **词表模式**：这一栏变成**选词表**——
  - **资源词表**（网上抓的）：**只读**，不可编辑、不可增删，可取词
  - **自建词表**：可新建、可编辑、可增删词
  - 支持把**录入模式的词**加入自建词表（自动去重）
  - 支持把**历史默写记录**里的词加入自建词表
- 选定词表后**不选词**：本场默哪些词完全由 FSRS-6 决定（到期复习优先，剩余名额配新词），用户只调**「今天默几个」**；下面的列表从「本次单词表」变成**今日队列**
- 录入模式**不进调度**（它是「练一把」的临时路径）；想让词有复习计划，就先把它加进词表
- 反向流动只有这一条：录入 / 历史的词 → 词表（靠显式动作，不自动同步）
**取舍**：词表是「长期资产」，本次单词表是「本场要默的词」；不做隐式双向同步，避免用户不知道自己的词去了哪。

### D5｜音频预生成：词库几千词不能全量合成

**难点**：现在准备阶段会为本次所有词生成音频（增量缓存）；但「几千词的词库」一旦全量生成，就是几千次 TTS 请求（慢、可能触发限流）。
**方案**：**只给本次上场的那 ≤24/≤N 个词合成**（就是现在的行为，不改），词库本身**不预生成音频**。
- 词库条目只在真正被排进某场默写时才走 TTS；缓存文件名规则不变（词+音色+短哈希）
- 加一个显式的「清理音频缓存」入口（按大小/按词库），避免缓存无限涨

### D6｜AI 组句出题（范例组句）

**难点**：LLM 出题容易出错——挖空位置不对、答案不在范围内、同一空能被多个词填、语法不通、句子太难/太简单、返回 JSON 不合法。
**方案**（定稿：一次批量出题，失败即结束）：
- **一次请求出整场题**：准备阶段把整场候选词（≤24，带英文释义）一次性交给 AI，要求返回**多道**组句题（题数按候选词量与每空 2–4 空确定，覆盖答案词 ≤16），**严格 JSON**：
  `{ "items": [ { "id": 1, "sentences": ["… ##1 …", "… ##2 …"], "blanks": [{"index":1,"answer":"apple"}], "usedWords": ["apple"] } ] }`
- **校验（纯函数，必测）**：整体 JSON 可解析且 `items` 非空 → 每题句子数 2–3 → 每题占位符恰好 2–4 个且与 `blanks` 数一致 → 每题 answer 都在候选集里（大小写不敏感）→ 全场答案词去重后 ≤16 → 每题 `usedWords` 与实际答案一致 → 短文里不含**未被挖空**的候选词（否则等于送答案）
- **失败即结束，不降级**：网络 / HTTP / 超时 / JSON 不合法 / 校验不通过 → 准备阶段直接进「准备失败」态，文案 **「AI 当前不可用」** + 具体原因（HTTP 码 / 超时 / 出题不符合要求），只提供「返回」；不落盘、不退回单词或释义模式。用户返回后再点一次开始即等价于重试——**不做自动重试**（避免等待翻倍）
- **不落盘**（R7）：题目只活在内存（本场有效）；**答卷与判定照常进历史**
- **成本/耗时**：一场只要 **1 次请求**（同 provider 的释义抓取实测 2.3s、批改 1.5s，出整场题预计 5–20s）；准备界面文案直接是「正在出题…」（一次性请求，无法细分进度，进度条走「不确定」样式）
**音频**：组句轮**不播语音**（它是「挑」不是「听」）；结果页发音按钮是否可用取决于准备阶段是否为这批词生成 TTS，见决策点 10。

### D7｜组句题型的交互与状态机接入

**难点**：现在的状态机是「一轮 = 一个词的语音 + 倒数 + 输入」，组句是「一轮 = 一句短文 + 2–4 个空」，完全不同的轮次结构。
**方案**：
- 一场 = 一组多道组句题（AI 一次给出），轮次 = **一道题**（一屏 2–4 空），题序打乱
- 轮次类型泛化成 `Round = WordRound | ClozeRound`（`dictation-engine` 增加 `kind`，`canAdvance/stepEngine` 逻辑不变，只是 `inputDone` 的判定改为「本题所有空都已选择」）
- 交互（键盘流铁律）：`Tab/↑↓` 在空之间移动，`←→` 在候选词里选，`1–9` 直接选第 n 个候选；**全部选完自动提交**（不再需要回车）；范围列表固定在上方、短文在下方，输入区不跳动
- 计时：组句轮沿用倒计时条，时长 = 句长基准 + 每空 × 选择用时（复用 `timing.ts` 的档位 × 倍率）；倒计时结束按现有规则处理（未选完的空按空提交）
- 判分：每个空独立比对（大小写不敏感、大小写/标点宽松），一个空错只影响该词对应的卡片
**取舍**：不做「拖拽填空」（鼠标重、键盘难），只做「点选/键选」。

### D8｜每日复习的任务组装

**难点**：「今天该默什么」需要一个确定的、可测试的规则，否则每天结果都在变。
**方案**：纯函数 `buildDailyQueue(cards, now, options)`，输入用户设的**总量 N**（「今天默几个」）：
1. 先取**到期复习卡**（`due <= 今天结束`），按逾期程度排序
2. 入额未满时用**新词卡**补足到 N（来自当前词表的未学词，按词频 `frq` 升序 = 高频优先）
3. 结果按 **≤24 词/场** 切分成若干场（可一次跑一场）
4. 同一词表内不重复；同日重进不重排（同日队列稳定）
5. 日期边界用**本地时区当天 0 点**，存 `lastQueueDate` 用于「今日进度 x/y」
- 全部纯函数 + 注入 `now`，单测覆盖：空卡组、到期超额（N 小于到期量时只取逾期最重的 N 个）、新词补足、跨日重置、同词去重、排序稳定性
- 队列**不落盘**：每次进入词表模式按当日状态重算；只有「今日已默进度」与卡状态落盘
**另**：复习日志（每次评分的时间/结果/题型）也要存，为将来「优化 FSRS 参数」留口子（本轮只记录，不做训练）。

### D9｜与现有三种内容模式的关系

**难点**：现在是 单词/释义/中文词 × 书写/赛博；再加 SRS 与组句，容易组合爆炸。
**方案**：**正交**，不新增「模式枚举」：
- 内容模式（单词/释义/中文词/**组句**）→ 决定「问什么」（AI 释义/AI 中文词仍照旧）；组句是**第四个模式**，进同一条模式选择条
- 答题方式（书写/赛博）→ 决定「怎么答」
- 组句自带题干与答案（AI 一次出题），不调用释义/中文词的抓取链路，也不播语音；组句 × 书写 的语义待定（见决策点 9）
- 每日复习 → 只决定**词从哪来**（到期队列），与上面两维无关
这样「今日复习 + 释义 + 赛博」自然可用，不需要为每种组合单独设计界面。

### D10｜测试与回归

**难点**：这些新逻辑几乎都是「纯逻辑 + 时间 + 外部 AI」，最容易出一堆边界 bug。
**方案**（沿用项目现有纪律）：
- SRS：`srs.test.ts` 用注入的 `now` 断言「新卡→毕业→到期→失误→重学」的完整轨迹；跨时区/跨日边界单测
- 队列：`daily-queue.test.ts` 覆盖 D8 的边界
- 词库：`bank-parse.test.ts` 覆盖 CSV/JSON/txt 归一、去重、坏数据；`bank-manifest.test.ts` 覆盖增量与校验
- 组句：`cloze-prompt.test.ts`（prompt 契约）、`cloze-validate.test.ts`（非法 JSON/空数错/答案不在范围/占用词泄漏）、`cloze-fallback.test.ts`（AI 失败退回单词默写）
- 外部 AI 回归：沿用「≥20 词的批量回归」要求，新增「一次组句生成的端到端回归」脚本（`pnpm get:cloze`，走生产 provider，不打印 Key）

---

## 3. 数据模型（草案）

```ts
// 词库（文件：mds-data/banks/<id>.json）
interface WordBank { id: string; name: string; source: "builtin"|"remote"|"custom";
  version: number; entries: BankEntry[]; createdAt: number; updatedAt: number }
interface BankEntry { word: string; definition?: string; phonetic?: string;
  translation?: string; frq?: number; tags?: string[] }

// 卡片状态（文件：mds-data/review/<bankId>.json；直接存 ts-fsrs Card 快照）
interface ReviewCard { word: string; card: FsrsCard;   // due/stability/difficulty/state/…
  kind: "word"|"cloze"|"mixed"; updatedAt: number }

// 复习日志（append-only，key 带版本；字段只增不改）
// 这里的字段比当前界面用到的多得多——是故意提前存的：FUTURE.md 里的
// 统计图与积分进度都靠它，现在不多存，将来就算不出。
interface ReviewLog {
  at: number; word: string; bankId: string;
  rating: 1|2|3|4; correct: boolean;
  mode: "word"|"definition"|"chinese"|"cloze";   // 问什么
  genMode: "writing"|"cyber";                    // 怎么答
  elapsedMs: number;                              // 本题实际耗时（计时/答题区间）
  queueKind: "new"|"review"|"relearn";             // 队列来源
  stateBefore: 0|1|2|3; intervalBeforeDays: number;
  intervalAfterDays: number; stabilityAfter: number; difficultyAfter: number;
}

// 每日汇总（文件：mds-data/review/daily.json）—— streak / 进度条的数据源
interface DailyStat { date: string;            // 本地时区 YYYY-MM-DD
  target: number; done: number; correct: number; total: number; elapsedMs: number }

// 今日任务（内存计算，不落盘；只有 DailyStat 与卡片状态落盘）
interface DailyPlan { date: string; target: number; reviewCount: number; newCount: number;
  batches: { words: string[]; kind: "word"|"cloze" }[] }
```

> 落盘策略：日志与卡片用原子写（临时文件 + rename）；日志只追加（修正历史判定时新追一条）；
> 读坏容错——单条日志损坏只丢该条，不整文件丢弃。
> 将来要做的统计图/积分进度见项目根目录 `FUTURE.md`（只增字段，不靠回填）。

---

## 4. 实施分期（崔总 2026-10-12 定：两个大 phase）

> **Phase 1 已完成**（2026-10-12）：实现报告见 `.implementation-report/2026-10-12-wordbank-srs-phase1.md`；
> 界面见 `.design/mds.pen` 的 18–23 屏。
> **Phase 2 已完成**（2026-10-12）：实现报告见 `.implementation-report/2026-10-12-wordbank-srs-phase2.md`；
> 界面见 24–29 屏。实施时与计划的差异（已与崔总确认）与遗留项都写在报告与 `FUTURE.md` 第五节。

#### Phase 1 · 词库功能 + SRS 每日复习（先做；先改 pencil 界面 → 确认 → 再拆任务实现）
1. 词源区**切换条**：录入 / 词表
2. 词表模式：选词表（资源只读 / 自建可增删）+ 新建词表 + **「今天默几个」**
3. 队列：`buildDailyQueue` 由 FSRS-6 排（到期优先 + 新词补足到 N）；下面列表从「本次单词表」变为**今日队列**（带今日进度）
4. 数据层：词库 `mds-data/banks/*.json` + 复习状态 `mds-data/review/*.json`（ts-fsrs card + 复习日志）+ 内置 ECDICT 词库 + 在线清单增量；沿用 runtime cache storage 接口
5. 自建词表编辑：加词、删词、改名、删除词表；资源词表只读；录入词 / 历史记录 → 词表（自动去重）
6. 评分写回：赛博对/错 → FSRS Rating（书写模式默认不进调度）；结果页给一行复习反馈
7. 单测：词库解析/归一/去重、清单增量与校验、`buildDailyQueue` 边界、SRS 轨迹（注入时钟）、存量单词表兼容

#### Phase 2 · 填空模式（范例组句）　—— 已实现（2026-10-12）
1. 「组句」作为第四种内容模式进模式条
2. 准备阶段**一次 AI 请求批量出整场题库**（严格 JSON 契约 + 纯函数校验）
3. 组句轮 UI 与键盘流：上候选范围、下短文挖空、逐空选择
4. 每空判分写回（若 SRS 已落地则进调度，否则只进历史）
5. 失败即「AI 当前不可用」结束（不降级、不自动重试）
6. 单测：出题契约解析、校验边界（空数/答案越界/泄漏未挖空词/答案数上限）、判分

#### SRS 每日复习（崔总定：**含在 Phase 1**）
- 就是 Phase 1 的第 3/4/6 项：卡片与日志、`buildDailyQueue`、「今天默几个」、评分写回、今日进度
- 与 Phase 2 无依赖，不单独排期；也不做参数训练（详见 D1/D8）

---

## 4.1 历史上的分期建议（保留，已被上面取代）

| 阶段 | 内容 | 依赖 | 规模感 |
| --- | --- | --- | --- |
| **M1 词库** | ECDICT 构建脚本 + 内置 8 库 + 词库面板（列表/启用/删除）+ 在线清单抓取 + 自建/导入 + 「另存为词库」 | 无外部依赖 | 中 |
| **M2 每日复习** | `ts-fsrs` 接入 + 卡片/日志存储 + `buildDailyQueue` + 「今日任务」入口与进度 + 结算写回评分 + 统计（到期/已学/准确率） | M1 | 中 |
| **M3 范例组句** | 新增「组句」内容模式 + AI **一次批量出题** provider + 校验纯函数 + 组句轮 UI/键盘流 + 每空判分写回 SRS；失败即报「AI 当前不可用」并结束，**不降级不自动重试** | M2 | 中大（最不确定的是 AI 出题质量） |

建议**先让 M1 落地并让你实际用几天**，再定 M2 的限额参数（新词/天、每场词数）——这些参数的默认值应该由你的真实节奏决定，而不是我拍。

---

## 5. 需要你确认的决策点

| # | 决策 | 我的建议 |
| --- | --- | --- |
| 1 | 词库数据源 | **ECDICT（MIT）**，构建期生成内置词库；**不用** qwerty-learner（GPL-3.0） |
| 2 | 内置 or 在线 | **内置 8 库（压缩后 ~1.6 MB）** + 在线清单可配（默认 GitHub raw，可填镜像） |
| 3 | 调度算法 | **FSRS-6 via `ts-fsrs`**（零依赖、纯 TS）；不做自研 SM-2 |
| 4 | 期望保持率 | 做成设置项，默认 **0.9**；先不暴露 stability 等高级参数 |
| 5 | 书写模式是否进调度 | 默认**不进**（无客观判定）；可选「结束后自评对/错」开关，默认关 |
| 6 | 每日限额 | 新词 **10/天**、复习 **60/天**、单场 **≤24 词**（都可改；先给保守值） |
| 7 | 组句轮要不要语音 | **不要**（它是「挑」不是「听」） |
| 8 | 组句判分粒度 | **每空独立进 SRS**（一道题 2–4 空，不同词的卡片各记各的） |
| 9 | 组句模式下的「开始书写默写」 | 建议**禁用该按钮并提示「组句模式请用赛博默写」**（选择动作必须在屏幕上完成）；若你希望能在纸上写，就得接受该模式无判定 |
| 10 | 组句模式是否预生成音频 | 建议**照旧生成**（≤24 词，结果页发音可用）；不生成则准备更快，但结果页发音按钮全灰 |
| 11 | 「考到但答对」的干扰词 | 干扰词（未被挖空的候选词）**不记分、不进调度**，只用来制造选择压力 |
| 12 | SRS 每日复习放哪个 phase | **含在 Phase 1**（已定） |
| 13 | 词表模式下「本场默哪些词」 | **不做选词**：选定词表后完全由 FSRS-6 排（到期优先 + 新词补足），用户只能定**「今天默几个」**（已定） |

---

## 6. 本轮明确不做

- 不做 FSRS 参数训练（`@open-spaced-repetition/binding` 是 WASM，体积与收益都不划算）
- 不做题目题库落盘（遵 R7）
- 不做组句失败的自动降级与自动重试（已定：失败即报「AI 当前不可用」并结束，重来与否由用户决定）
- 不做跨设备同步 / 账号系统
- 不做「拖拽填空」「手写识别」这类交互
- 不做词库编辑器（富文本/例句/图片）；自建只用「词 + 可选释义」

---

## 附录：本次调研的实测命令与结果

```bash
# 1) ECDICT 体积与字段（MIT）
curl -sS -o ecdict.csv https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv
# 65,933,428 bytes / 770,611 词条 / 13 列：
# word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio
# 按 tag 统计（含英文释义的比例）：gre 7504/7478、toefl 6974/6952、cet6 5407/5403、
# ielts 5040/5019、ky 4801/4801、cet4 3849/3846、gk 3677/3668、zk 1603/1600

# 2) 每个词库转 JSON 的体积（只留 word/英文释义/音标/词频）
#    zk 298KB · gk 652KB · cet4 674KB · cet6 911KB · ky 830KB · ielts 863KB
#    toefl 1073KB · gre 1058KB · 并集 14,942 词 ≈ 6.3MB（gzip 后 ~1.6MB）

# 3) ts-fsrs 包体与依赖（零依赖）
curl -sS https://registry.npmjs.org/ts-fsrs/latest
# version 5.4.2 / dependencies: none / type: module / ESM+CJS+UMD / unpackedSize 706,415

# 4) qwerty-learner 许可（GPL-3.0，故排除）
curl -sS https://raw.githubusercontent.com/RealKai42/qwerty-learner/master/LICENSE
```

外部文档：
- Anki 牌组参数（学习步 / 毕业间隔 / 失误 / leech / 期望保持率）： https://docs.ankiweb.net/deck-options
- 「Anki 用哪个间隔重复算法」（FSRS 自 23.10 内置）： https://github.com/ankitects/anki/blob/main/docs-site/faqs/what-spaced-repetition-algorithm.mdx
- FSRS4Anki 教程（期望保持率与优化）： https://github.com/open-spaced-repetition/fsrs4anki/blob/main/docs/tutorial.md
- ts-fsrs 快速上手： https://github.com/open-spaced-repetition/ts-fsrs
