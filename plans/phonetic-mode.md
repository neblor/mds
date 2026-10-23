# 音标默写模式（phonetic）方案

> 状态：**已实现（2026-10-23）**。实施报告 `.implementation-report/2026-10-23-phonetic-mode.md`；
> 设计 `.design/phonetic-mode.md`（`.pen` 第六批待补）；后续项 `FUTURE.md` §十。
> 崔总 2026-10-23 提出；已确认的四个关键决策见 §7；
> 同日追加「已放置音标可单独试听」需求，音源/许可/原型调研见
> `plans/phonetic-audio-research.md`。
> 关联：内容模式现状见 `AGENTS.md`「系统基础功能」；短句模式（最近一次新增的内容模式）见
> `plans/sentence-mode.md`；复习写回口径见 `plans/wordbank-stats.md`。
>
> **结论先行**：功能可行。真正的工作量不在「点音标」，而在四处：
> ① 找到可信的英式音标数据并切成音素序列；② 主窗口被限制在 1120×820，全屏音标表必须另开
> Electron 窗口；③ 现有倒计时与音频播放都不支持暂停，看表暂停需要抽一层可测的时钟并支持
> 「从当前这一遍继续播」；④ 音素独立发音需要一套可随包的音源，并且要与本轮单词音频互斥。
> 数据、全屏、暂停、音源许可是四个最大的技术风险。

---

## 1. 需求还原

崔总 2026-10-23：

> 我想添加一个音标默写功能，首先是要把 `~/repos/andares/clocktower/cheat-sheets/phonetic-symbols.png`
> 这个图内置进来，并且在切到音标默写模式时可以随时点开全屏观看（跳出窗口限制），点任意键关闭。
> 然后再想一个默写音标的方案，我想的一个方案是直接利用现有的默写单词的功能，只是增加一个音标模式，
> 点开后是给你看到单词，然后下面给你一堆音标让你点击来拼，从而拼出正确的音标。

拆成可验收的七条：

1. **音标表内置**：`phonetic-symbols.png` 随包发布；切到音标模式后，在主界面、准备中、
   准备完成、默写中、结果页都能点开（F1 亦可），**Electron 下是真全屏独立窗口**，
   不受主窗口 1120×820 限制；按任意键或点击关闭，关闭后回到原处。
2. **新模式**：内容模式滑块新增「音标」，位置在「短句」与「组句」之间；
   因为作答是点选，**只允许赛博默写**，书写按钮置灰并说明原因。
3. **每轮形态**：显示目标英文单词（音标练习不考拼写，单词必须可见），播该词发音；
   下方给出一堆音标，点击（或键盘）按顺序拼出音标；可撤销、清空、提交。
4. **判定**：按音素序列比对；**主重音 `ˈ` 严格，次重音 `ˌ` 忽略**；同一个词的多个标准读音
   全部接受；结果页给出标准音标、我的音标与逐音素差异。
5. **数据**：内置英式词典优先（离线、权威、稳定）；词典没有的词用已配置 AI 补齐并缓存；
   AI 不可用时这些词**降级为单词轮**，不中止整场。音标为英式，语音尽量同为英式。
6. **闭环**：结果页、历史、学习档案的模式统计、复习写回都认识「音标」；
   降级轮按「单词」记账，不污染统计口径。
7. **音素独立发音**（崔总 2026-10-23 追加）：答题时**已放置的每个音标 chip 右侧有喇叭**，
   点击单独播放该音素；点左侧仍移除。池子/结果页同构（建议，见 §3.10）；
   重音符号 `ˈ`/`ˌ` 本身不发音并明确提示；音频失败不卡流程。

---

## 2. 现状调研（可复用的既有件）

| 关注点 | 现状 | 对本模式的影响 |
| --- | --- | --- |
| 内容模式枚举 | `src/lib/state.ts` 的 `ContentMode` + `CONTENT_MODES` 白名单（恢复/历史共用） | 加 `phonetic`，白名单同步；旧数据不受影响 |
| 模式滑块 | `WordBank.tsx` 的 `CONTENT_MODES` 数组，`SegmentedSlider` 宽 366px | 加第 6 项；宽度约 430px，需设计确认 |
| 轮次模型 | `use-dictation.ts` 的 `WordRound` / `ClozeRound`，`buildRounds` / `buildClozeRounds` | 新增 `PhoneticRound`，与降级 `WordRound` 混排 |
| 计时 | `timing.ts`：单词/释义/中文词/短句/组句各有纯函数 | 新增 `phoneticCountdownDuration`（音素数 + 音频余量） |
| 作答 | `DictatingView`：赛博单词输入；组句是选词 | 音标面板单独分支，点击 + 键盘 |
| 结果模型 | `results.ts`：`ResultRow.fields`，字段 kind 有 word/definition/chinese/sentence | 加 `phonetic` 字段与专用结果行 |
| 复习写回 | `review-service.ts` 的 `buildCommitItems`；`review-types.ts` 的 `REVIEW_MODES` | 加 `phonetic`；降级轮按 `word` 记账 |
| 历史 | `history-storage.ts` 的 `FIELD_KINDS` + `isContentMode` | 两处都要加 `phonetic` |
| TTS | `api.ts` 的 `requestTtsAll`，Edge TTS 自研 provider，按词/音色缓存 | 音标轮复用词音频；音色需考虑英式 |
| 音素音频 | 现有 TTS 不支持 IPA 单音；无内置音素库 | 新增 `public/ipa/audio` 静态音素 + 单例播放器；来源/许可见 `plans/phonetic-audio-research.md` |
| AI 链路 | `definition-provider.ts` 的 `callChatCompletion` / `extractJsonCandidates`；`ai-pair-service.ts` 的缓存编排 | 新增独立的音标 provider/service，复用调用与缓存纪律 |
| 运行时缓存 | `cache-storage.ts` 的 `RuntimeCacheStorage`（definitions / chinese-words / sentences） | 加 `readPhonetics` / `writePhonetics` |
| Electron 窗口 | `electron/main.mjs` + `window-options.mjs`；主窗口 `maximizable:false`、`fullscreenable:false`，无 preload | 用 `setWindowOpenHandler` 另开全屏窗口，不需要 preload |
| 静态资产 | `public/` 随 `.output/public` 打包；`client:package` 排除的只有 `word-cache` | 音标表与词典放 `public/ipa/` |
| 设计 | `.design/mds.pen` + `.design/mds.md`，Pencil 维护 | 新增音标模式屏与结果行设计，先评审再写 UI |
| 测试 | Vitest（node 环境）；`use-dictation.test.ts` 有完整流程 mock；`api.test.ts` 已覆盖 `playWithIntervals` | 纯逻辑 + provider/service + 关键流程都能单测 |

**现有词库里的 `phonetic` 不能直接用**：它来自 ECDICT，是清洗不彻底的非标准写法。
实测样本：`the → ðә`（西里尔 schwa）、`water → 'wɒ:tә`（ASCII 冒号/撇号 + 西里尔 schwa）、
`this → θis`（应为 `ðɪs`）、`what → hwɒt`（过时）、`go → gou`（偏美式）。
没有标准主重音 token，符号集也跟音标表不一致。因此本方案另建数据源，详见 §3.2。

---

## 3. 方案

### 3.1 模式与数据模型

```ts
// src/lib/state.ts
export type ContentMode =
  | "word" | "definition" | "chinese" | "sentence" | "phonetic" | "cloze";
export const CONTENT_MODES = [
  "word", "definition", "chinese", "sentence", "phonetic", "cloze",
] as const;

// src/lib/review-types.ts（复习日志与场次共用）
export const REVIEW_MODES = [
  "word", "definition", "chinese", "sentence", "phonetic", "cloze",
] as const;
```

```ts
// src/lib/result-types / results.ts
export type ResultFieldKind =
  | "word" | "definition" | "chinese" | "sentence" | "phonetic";

// use-dictation.ts
export interface PhoneticRound {
  kind: "phonetic";
  word: string;
  audioName: string;
  /** 标准音标（token 字符串，空格分隔，如 "ˈ æ p ə l"） */
  expected: string;
  /** 全部可接受读音（token 字符串；expected 是其第一项） */
  variants: string[];
  /** 词典命中 or AI 生成（结果页要标注） */
  source: "dict" | "ai";
  /** 本轮的音标池（token 数组，已打乱；含答案重复项与干扰项） */
  pool: string[];
  repeatCount: number;
  countdownSec: number;
  gapSec: number[];
  /** 赛博作答：提交后的 token 序列（未提交为 undefined） */
  answerTokens?: string[];
}

export interface PhoneticPick {
  /** 池内下标：同符号可能出现多次，必须按“哪一块”而不是按 token 记录 */
  index: number;
  token: string;
}

export type DictRound = WordRound | ClozeRound | PhoneticRound;
```

- `CONTENT_MODE_LABELS`、`JUDGEMENT_NOTES`、`FIELD_KINDS`、`ReadyOverlay` 的 summary
  各加一处「音标」；`resolveStoredContentMode` 因白名单自动兼容。
- 历史条目只增字段，不做迁移：旧条目照读，新条目 `contentMode: "phonetic"`。

### 3.2 音标数据：内置英式词典 + AI 兜底

#### 3.2.1 数据源选型

| 候选 | 结论 | 原因 |
| --- | --- | --- |
| **Britfone 3.0.1**（MIT，15,212 条，433 KB CSV） | **采用** | RP/Standard Southern British；带主/次重音；干净；覆盖常用词 |
| ipa-dict `en_UK`（MIT/ISC，65,118 条） | 暂不采用，留作未来扩覆盖 | 覆盖更广，但数据有 ZWJ（`apple → /ˈæpə‍l/`）、重音标在元音前（`study → /stˈʌdi/`）等不一致 |
| ECDICT `phonetic`（已在词库里） | 不采用 | 符号非标准、有错词（见 §2） |
| CMUdict | 不采用 | 美式音标，与英式音标表不一致 |
| 纯 AI | 只做兜底 | 慢、结果不稳定、离线不可用；且音标准确度依赖模型 |

**Britfone 对内置词库的实测覆盖率**（只统计单条英文词，不含词组/专名）：

| 词库 | 单词条 | 命中 | 覆盖率 |
| --- | ---: | ---: | ---: |
| PET | 3,055 | 2,862 | 93.7% |
| CET-4 | 3,846 | 3,595 | 93.5% |
| CET-6 | 5,406 | 4,530 | 83.8% |
| 中考 | 1,600 | 1,564 | 97.8% |
| 高考 | 3,674 | 3,409 | 92.8% |
| 考研 | 4,801 | 4,264 | 88.8% |
| IELTS | 5,038 | 4,065 | 80.7% |
| TOEFL | 6,970 | 4,072 | 58.4% |
| GRE | 7,504 | 2,921 | 38.9% |
| core3000 | 3,000 | 2,944 | 98.1% |

PET/CET-4/中高考足够；GRE/TOEFL 会较多走 AI。每场队列通常只有 20–30 词，
最坏情况也是一次 20–30 词的 AI 请求，可接受。若以后 GRE/TOEFL 用户反馈 AI 太慢，
再考虑合并 ipa-dict（见 FUTURE）。

#### 3.2.2 构建脚本与归一化

新增 `scripts/build-phonetics.mjs`（`pnpm build:phonetics`）：

- 输入：Britfone CSV（默认下载到 `.tmp/phonetics-src/`，支持 `--csv` 指定本地文件）。
- 输出：`public/ipa/en-gb.v1.json` + `public/ipa/LICENSE-britfone.txt` + `public/ipa/README.md`。
- 生成物**提交进仓库**；`pnpm check` 不联网、不重新生成；脚本只用于换版本/改规则时重跑。
- 只保留单条英文词：跳过 `_` 词组、`'COS` 这类缩写、纯符号条目；键统一小写；
  `WORD(1)/WORD(2)` 合并为多个读音变体，去重后最多保留 3 个。
- **符号归一化到音标表的写法**（必须在 README 里写清，防止后来者“改回去”）：

  | 源 | 目标 | 原因 |
  | --- | --- | --- |
  | `ɹ` | `r` | 音标表用 `r` |
  | `ɛ` | `e` | 音标表用 `e` |
  | `ɛə` | `eə` | 音标表用 `eə` |
  | `ɐ` | `ʌ` | 音标表用 `ʌ`（STRUT） |
  | `g` | `ɡ` | 统一用 U+0261，与音标表一致 |
  | `ˈeɪ` / `ˌəʊ` | `ˈ` + `eɪ` / `ˌ` + `əʊ` | 重音必须是独立可点的 token |
  | `i`（happy 尾音） | `i` | 音标表 44 音未单列，作为第 45 个 token |

- 长元音/双元音/塞擦音是**单个 token**：`iː`、`uː`、`ɑː`、`ɔː`、`ɜː`、`eɪ`、`tʃ`、`dʒ` 等，
  不把 `ː` 拆成单独音素（与音标表的展示一致）。
- **重音位置必须归位（容易漏掉的一步）**：Britfone 的 README 明确说 `ˈ`/`ˌ` 是挂在
  **重读元音/双元音**上的（例如 `WATER, w ˈɔː t ə`、`STUDY, s t ˈɐ d i`），而标准音标把重音
  写在**音节首**（`/ˈwɔːtə/`、`/ˈstʌdi/`）。如果只把重音拆成独立 token 就存储，答案会变成
  `/wˈɔːtə/`，既不符合音标表，也和词典/用户预期不一致。构建期必须做一次
  **最大音节首（maximal onset）归位**：
  - 对每个 `ˈ`/`ˌ`，找到它后面第一个元音，再把标记左移到紧贴该元音之前、且属于该音节
    的所有辅音之前（最大合法英文音节首，最多 3 个辅音）；
  - 例：`w ˈɔː t ə → ˈ w ɔː t ə`；`ɪ m p ˈɔː t ə n t → ɪ m ˈ p ɔː t ə n t`；
    `s t ˈɐ d i → ˈ s t ʌ d i`；`k ə m p j ˈuː t ə → k ə m ˈ p j uː t ə`；
    `ɪ k s p ˈɛ n s ɪ v → ɪ k ˈ s p e n s ɪ v`；`f ˈəʊ t ə ɡ ɹ ˌɑː f → ˈ f əʊ t ə ˌ ɡ r ɑː f`；
  - 音节首集合用一份可维护的常量（单辅音除 `ŋ`；常见 2/3 辅音簇 `pl/pr/tr/dr/kl/kr/gl/gr/
    fl/fr/θr/ʃr/tw/dw/sw/kw/sp/st/sk/sm/sn/sl/...`、`spl/spr/str/skr/skw/...`），
    归位函数独立成纯函数并单测；构建脚本抽样打印多音节词，供人工抽查；
  - AI 的提示词要求标准位置；解析时仍跑同一个归位函数（幂等），保证词典与 AI 同形。
- 归位后的显示是标准 IPA；判定时对**用户与标准两端都先归位**（见 §3.3.3），
  所以用户把 `ˈ` 点在高元音前还是音节首前，只要重读的是同一个元音，都算对。
- **未知符号一律报错**：不允许静默丢弃。构建结束打印：总词数、变体数、被拒词数、
  各内置词库覆盖率、生成文件大小。
- 输出 schema：

```json
{
  "version": 1,
  "source": { "name": "Britfone", "version": "3.0.1", "url": "https://github.com/JoseLlarena/Britfone", "license": "MIT" },
  "symbols": ["iː", "ɪ", "e", "æ", "ɑː", "ɒ", "ɔː", "ʊ", "uː", "ʌ", "ɜː", "ə",
              "eɪ", "aɪ", "ɔɪ", "əʊ", "aʊ", "ɪə", "eə", "ʊə",
              "p", "b", "t", "d", "k", "ɡ", "tʃ", "dʒ", "f", "v", "θ", "ð",
              "s", "z", "ʃ", "ʒ", "h", "m", "n", "ŋ", "l", "r", "w", "j",
              "i", "ˈ", "ˌ"],
  "words": {
    "apple": [["ˈ", "æ", "p", "ə", "l"]],
    "water": [["ˈ", "w", "ɔː", "t", "ə"]],
    "the": [["ð", "ə"], ["ð", "i"], ["ˈ", "ð", "iː"]]
  }
}
```

- 客户端首次进入音标准备时懒加载该 JSON（同源 `fetch`，缓存 Promise），
  解码成 `Map<string, PhoneticAnswer>`；文件缺失/损坏不阻塞整场，转入 AI 或降级。
- 版本化文件名 `en-gb.v1.json`：归一化规则变化时升到 `v2`，浏览器缓存自然失效。

#### 3.2.3 AI 兜底（只补词典没有的词）

- 新增 `src/lib/phonetic-provider.ts`：复用 `definition-provider.ts` 的
  `callChatCompletion`（含 400/422 两级兼容降级）、`extractJsonCandidates`、
  `DefinitionProviderError` 与诊断回调；**不复用** `fetchAiPairs` 的 responseschema。
- 提示词要点：
  - British English (RP) phonemic transcription；
  - 只允许使用音标表的 44 个符号 + `i` + `ˈ`/`ˌ`；
  - 每个符号用空格分隔，不要斜杠/方括号/音节点；
  - 主重音 `ˈ`、次重音 `ˌ`；每个词一个读音；
  - 输出严格 JSON：`{"phonetics":{"<原词>":"ˈ æ p ə l"}}`；
  - 例子：`apple → ˈ æ p ə l`、`water → ˈ w ɔː t ə`、`important → ɪ m ˈ p ɔː t ə n t`、
    `happy → ˈ h æ p i`、`photograph → ˈ f əʊ t ə ɡ r ɑː f`、`schedule → ˈ ʃ e dʒ uː l`。
- 解析与校验（`phonetic-parse.ts` 共用，纯函数）：
  - 词必须属于本次请求集合且不重复；
  - 先做有限的等价符号归一（`ɹ→r`、`ɛ→e`、`ɛə→eə`、`ɐ→ʌ`、`g→ɡ`、`oʊ→əʊ`），
    再要求每个 token 都在 `IPA_SYMBOLS` 中；
  - 至少 1 个元音；主重音最多 1 个；`ˌ` 可有可无；总 token 数 ≤ 40；
  - 斜杠、方括号、音节点、换行、中英文解释一律清洗后校验，校验不过就判缺失；
  - **不做负缓存**：缺失/失败的词不写缓存，下次准备仍会重新请求。
- 服务：新增 `src/lib/phonetic-service.ts`，与 `ai-pair-service.ts` 同构：
  - 缓存文件 `mds-data/word-cache/phonetics.json`，
    `{ model, promptVersion, phonetics: { word: "ˈ æ p ə l" } }`；
  - 命中 → 请求缺失 → 校验合并 → 原子写 → 写后复读校验；
  - `model`/`promptVersion` 变化视为未命中；失效/中止不写；
  - 诊断事件写入现有 `mds-data/logs/ai-definitions.log`（不记录 Key，沿用 logger 脱敏）。
- 路由：`POST /api/phonetics`（薄适配，参数校验同 `/api/chinese-words`），
  返回 `{ phonetics, missing, cachedCount, warning }`。
- 客户端：`requestPhonetics(words, settings, signal)` 只对词典没命中的词调用；
  **未配置 AI 时直接跳过**，这些词降级为单词轮，不影响整场。
- 诊断：`pnpm get:phonetics word1 word2 ...`，复用生产 provider，
  输出「词典命中 / AI 命中 / 缺失 / 耗时 / token 序列」，不写业务缓存、不打印 Key。
- 结果页对 AI 来源的字段加 `note: "AI 生成，仅供参考"`；就绪页/结果页提示本次有几个词走了 AI。

#### 3.2.4 英式发音一致性（容易被忽略的问题）

音标表是 British English，而当前设置里的音色全是 `en-US-*`。若用美式音色播
`water`，音频会是带卷舌的 /ˈwɔːtər/，与英式答案 /ˈwɔːtə/ 不一致。方案：

- 设置里补充英式音色（如 `en-GB-SoniaNeural`、`en-GB-RyanNeural`、`en-GB-LibbyNeural`），
  只增加选项，不改其他模式的默认音色。
- 音标轮优先使用 `en-GB-*` 音色：用户当前音色是英式则用用户的；不是则用固定默认
  `en-GB-SoniaNeural`。这样音标轮始终听到英式发音，其他模式仍按用户设置。
- 在音标面板角落标注「英式发音」；如不希望强制切换音色，可退化为提示语，待崔总定（§7）。

### 3.3 音标池与判定

#### 3.3.1 符号表

- 元音 20：12 单母音 + 8 双母音，青绿色系（与音标表一致）；
- 辅音 24，珊瑚色系；
- 额外 `i`（happy 尾音，音标表未单列）单列一个中性色 tile，tooltip 说明；
- `ˈ` / `ˌ` 用金色 tile，与音素区分；
- **长音符号 `ː` 不是独立 tile**，长元音/双母音/塞擦音整体一个 tile。

```ts
// src/lib/phonetic-symbols.ts（纯常量，客户端/服务端/构建脚本共用）
export const IPA_MONOPHTHONGS = [
  "iː", "ɪ", "e", "æ", "ɑː", "ɒ", "ɔː", "ʊ", "uː", "ʌ", "ɜː", "ə",
] as const;
export const IPA_DIPHTHONGS = [
  "eɪ", "aɪ", "ɔɪ", "əʊ", "aʊ", "ɪə", "eə", "ʊə",
] as const;
export const IPA_CONSONANTS = [
  "p","b","t","d","k","ɡ","tʃ","dʒ","f","v","θ","ð",
  "s","z","ʃ","ʒ","h","m","n","ŋ","l","r","w","j",
] as const;
export const IPA_HAPPY = ["i"] as const;      // 音标表外，单独提示
export const IPA_STRESS = ["ˈ", "ˌ"] as const;
export const IPA_SYMBOLS = [
  ...IPA_MONOPHTHONGS, ...IPA_DIPHTHONGS, ...IPA_CONSONANTS,
  ...IPA_HAPPY, ...IPA_STRESS,
] as const;
```

#### 3.3.2 池子构成（崔总已确认：答案音素 + 易混干扰项）

- 答案所需 token 的**多重集合**全部放进池子（如 `ə` 需要两个就给两块）；
  同词多个读音时取并集，保证任何一个标准读音都拼得出来。
- 再放 4–6 个易混干扰项，从 `CONFUSABLE` 映射里取、排除答案已有的符号，
  不够时用随机符号补：
  - `iː/ɪ/i`、`e/æ`、`ʌ/ɑː/ɒ`、`ɔː/ɒ/əʊ`、`uː/ʊ`、`ɜː/ə`、`eɪ/aɪ`、`aɪ/ɔɪ`、
    `əʊ/aʊ`、`ɪə/eə`、`ʊə/uː`；
  - 清浊对：`p/b`、`t/d`、`k/ɡ`、`f/v`、`θ/ð`、`s/z`、`ʃ/ʒ`、`tʃ/dʒ`；
  - `m/n/ŋ`、`l/r`、`w/v`。
- 池子打乱；**重复 token 是两块不同的 tile**，按池内下标记录选择，
  避免「点了一个 `ə` 两块都变灰」。
- 已选 tile 置灰但保持可聚焦（`aria-disabled`，点击无效），撤销后恢复；
  这样键盘焦点不会因 tile 消耗而丢失。
- 池子大小通常 8–16 块；上限 20，避免一屏铺不开。
  超过上限时按「canonical 优先」保留变体，并把 `variants` 裁剪为
  **其 token 多重集合被池子完全覆盖**的那些——绝不让标准答案需要池子里没有的 token。
- 池子里有不需要的 token 时，用户提前提交也没关系；倒计时自动提交同理，按当前 picks 判定。

#### 3.3.3 判定

- 用户提交的是 token 序列；标准答案是 `variants`（每个变体一个 token 数组）。
- 归一化后比较：
  1. **两端都先做重音归位**（§3.2.2 的最大音节首；幂等），这样用户在元音前或音节首前
     点 `ˈ` 都是同一含义；
  2. **两端都删掉 `ˌ`**（次重音不判），保留 `ˈ`（主重音严格）；
  3. 再逐 token 比较。
- 命中任一变体即正确；`i` / `iː` / `ɪ` 三者不互相宽容（音标表上它们是不同的音）。
- 结果页做 token 级 LCS diff，输出 `ok / wrong / missing / extra` 四类片段：
  - 正确 → 绿；错位/写错 → 红；漏掉 → 红色描边；多余 → 删除线；
  - 多读音时选「与用户答案编辑距离最小」的变体做对照，并把该变体写进结果字段，
    保证历史回看时 diff 仍然正确。
- 不做 AI 批改：音标就是精确序列，AI 批改没有意义且会引入随机性。

### 3.4 准备流程

```ts
// use-dictation.ts 的 preparePhonetic 伪代码
const dict = await loadPhoneticDictionary(signal);        // 懒加载 + 缓存；失败 → 空表
const found = new Map<string, PhoneticAnswer>();
const missing: string[] = [];
for (const w of shuffled) lookup(dict, w) ? found.set(w, ...) : missing.push(w);

// TTS 与 AI 并行：TTS 不需要知道音标答案
const ttsPromise = requestTtsAll(shuffled, ipaVoice, signal, onTtsProgress);
const aiPromise = missing.length && isAiConfigured(settings())
  ? requestPhonetics(missing, settings(), signal)          // 只补缺失
  : Promise.resolve({ phonetics: {}, missing });

const [audioItems, ai] = await Promise.all([ttsPromise, aiPromise.catch(...)]);
// 词典 → AI → 仍缺失则该词降级 WordRound（variant="word"），不中止整场
```

- 进度：词典读取（不确定态）→ 语音 `x/y`（确定态）→ 若语音已 100% 而 AI 未回，
  切换不确定态（沿用 `prepIndeterminate`）；状态文案区分「正在读取音标词典… /
  正在生成语音 x/y / 正在补齐音标（N 个词未收录）…」。
- **部分失败**：AI 网络/鉴权失败 → 用词典结果 + 降级其余词，`resultNote` 说明；
  AI 只回部分 → 用有效项 + 降级其余，`warning` 说明。
- **全部失败**（词典不可用且 AI 不可用/全缺失）：`prepError` 明确提示
  「这些词都没有可用音标：检查安装包是否完整，或在设置里配置 AI 服务」，
  不进入一场全是单词轮的假音标场。
- 未配置 AI **不阻止**开始音标模式（与释义/中文词/短句/组句不同）：词典命中的词离线可用。
- 已有 `prepAbort`/`prepSeq` 竞态隔离照用；中止时词典 fetch、TTS、AI 一起 abort。
- 音标轮的音频使用 `ipaVoice`（§3.2.4），按词/音色缓存；与其它模式共享 TTS 缓存目录。

### 3.5 轮次、作答与计时

#### 3.5.1 每轮界面（详见设计与 §3.9）

```text
┌ 第 3 / 12 个                               🔊 正在播报 · 第 2 遍   [音标表 F1] ┐
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░  8.4s                                          │
│                                                                        │
│                          apple                        [AI 音标]         │
│                                                                        │
│  我的音标：  / [ɪ 🔊] [æ 🔊] [p 🔊] /               [撤销]  [清空]        │
│                                                                        │
│  音标池：  [ˈ] [æ 🔊] [p 🔊] [ə 🔊] [l 🔊] [e 🔊] [ɒ 🔊] [ə 🔊]          │
│            [ʌ 🔊] [k 🔊] [i 🔊] [ɪ 🔊]                                  │
│                                                                        │
│                                                   [提交 Ctrl+Enter]    │
└────────────────────────────────────────────────────────────────────────┘
```

- 作答区只显示**用户已点的 token**（不提前显示标准答案）；标准音标只在结果页出现。
  `[AI 音标]` 标签只在本题音标由 AI 生成时显示，提示“仅供参考”。
- **已放置的 chip 是左右两段**：左侧 token 点击移除（hover 变 err 色），右侧喇叭点击单独
  试听该音素；喇叭播放时高亮/脉冲。重音 chip 没有喇叭（本身不发音），整块可点移除并给
  title 说明。池子 tile 建议同样做「左放入、右试听」；若视觉太挤，退化为
  `Shift+Enter` 试听当前 tile（§3.10）。
- 点喇叭时若本轮单词音频正在播，先中止它，音素播完再从当前这一遍恢复；倒计时**不停**。
- 结果页的标准/我的音标也按 token 渲染并带喇叭；与结果页单词发音按钮互斥。

- 单词始终可见（这是音标练习，不是拼写默写）；语音自动播 2–3 遍（沿用现有
  `repeatCount(word, false)`），可提前提交。
- 答案区固定高度（一行 chips，最多折两行）；池子区固定高度；提示语不顶动布局。
- 提交后池子与按钮禁用，chips 保持显示；等语音轨结束或直接推进（赛博规则）。
- 倒计时结束：把当前 picks 作为答案提交（未选完就是错的），按赛博规则自动推进。
- 音标轮**只允许赛博**；`WordBank` 的书写按钮置灰，信息条：
  「音标模式请用赛博默写：点选音标需要在屏幕上完成」。
- **降级轮按当前轮的 kind 渲染，而不是只看场次 `contentMode`**：音标场次里的
  `WordRound` 走普通单词输入与提示；`Home` 给 `DictatingView` 传 `displayContentMode`
  （`phonetic` 场次里的 word 轮 → `word`）。顺带修正短句模式降级轮「单词轮却提示写整句」的
  同类问题；结果页仍用场次 `contentMode` 展示总判定说明。

#### 3.5.2 键盘流（必须满足项目的键盘交互铁律）

- 轮次开始自动聚焦池子第一块 tile；池子用 roving tabindex：
  - `←/→/↑/↓` 在网格移动（设计时按固定 8 列；**2026-10-23 改为按实际换行列数**）；`Home/End` 到首/尾；
  - `Enter` / `Space` 选取当前 tile；
  - `Backspace` 撤销最后一块；`Delete` 或「清空」按钮清空；
  - `Ctrl/Cmd + Enter` 提交；`Tab` 可到「清空 / 提交 / 音标表」按钮；
  - `Shift+Enter` 试听当前聚焦的池子 tile；已放置 chip 的喇叭是独立按钮，可 Tab 到；
  - `Shift+Backspace` 试听最后放置的音素（`Backspace` 仍是撤销）；
  - `F1` 随时打开全屏音标表。
- 提交后焦点留在「提交」按钮；下一轮自动回到池子第一块。
- 关闭音标表后焦点回到池子（不是音标表按钮），避免同一个键在窗口关闭后
  再次触发按钮点击。
- 提示行固定为「点选音标 · Enter 选取 · Shift+Enter 试听 · Backspace 撤销 · Ctrl+Enter 提交」。

#### 3.5.3 计时

```ts
// src/lib/timing.ts
export const IPA_THINK_SECONDS = 3;
export const IPA_TOKEN_SECONDS = 0.8;
/** 每遍音频本身的估算余量（音频时长不受倍率影响，故不乘倍率） */
export const IPA_AUDIO_TAIL_SECONDS = 1.2;

export function phoneticCountdownDuration(opts: {
  tokens: string[];          // canonical（含 ˈ/ˌ）
  gapSec: number[];          // 已乘过档位×倍率
  repeatCount: number;
  level: SpeedLevel;
  multiplier?: number;
}): number {
  const graded = opts.tokens.filter((t) => t !== "ˌ").length;
  const thinkAndClick = scaleTime(
    IPA_THINK_SECONDS + IPA_TOKEN_SECONDS * graded,
    opts.level,
    opts.multiplier ?? 1,
  );
  const audioAllowance =
    opts.gapSec.reduce((sum, g) => sum + g, 0) +
    opts.repeatCount * IPA_AUDIO_TAIL_SECONDS;
  return Math.round((thinkAndClick + audioAllowance) * 10) / 10;
}
```

- **倒计时必须不小于「音频遍数 + 间隔」**：现有赛博规则是倒计时一到就自动提交，
  若倒计时比音频还短，用户还没听完就被判空。公式里的 `audioAllowance` 就是为此。
- 倒计时只是上限；用户提前拼完并提交，语音在间隔区则立即推进，正在发声则等这一遍播完。
- 系数可在实机试听后调；**调基础公式，不靠全局倍率硬拧**（沿用短句模式的口径）。
- 暂停看音标表时，倒计时冻结；该段时间不计入本轮的 `elapsedMs`（见 §3.6.4）。

### 3.6 全屏音标表

#### 3.6.1 资产与页面

- 复制 `~/repos/andares/clocktower/cheat-sheets/phonetic-symbols.png`
  → `public/ipa/phonetic-symbols.png`（3600×2400，约 949 KB，RGBA）。
  运行时只引用项目内路径，不依赖 clocktower 仓库。
- 新路由 `src/routes/phonetic-symbols.tsx`：深色全屏底 + `object-contain` 居中图片 +
  底部提示「按任意键或点击关闭」；是否显示「默写已暂停」由查询参数 `?paused=1` 决定。
- 页面 `onMount` 后 150ms 绑定 `keydown` / `pointerdown`（忽略单独的 Shift/Ctrl/Alt/Meta）；
  关闭时先 `window.opener?.postMessage({ type: "mds-phonetic-chart-closed" }, origin)`，
  再 `window.close()`；不是脚本打开的窗口则 `history.back()` / 回 `/`。
- 图片的 alt 文案、页面 title「音标表 · 默点啥」；Web 下是普通弹窗，浏览器可能保留地址栏，
  真正全屏由 Electron 窗口保证，Web 只保证「另开窗口、不挤在 1120 宽的主界面里」。

#### 3.6.2 Electron 独立窗口（不新增 preload）

```js
// electron/main.mjs（创建 mainWindow 后）
mainWindow.webContents.setWindowOpenHandler(({ url }) => {
  if (!isPhoneticChartUrl(url, mainWindow.webContents.getURL())) {
    return { action: "deny" };
  }
  return {
    action: "allow",
    overrideBrowserWindowOptions: createPhoneticWindowOptions(),
  };
});
mainWindow.webContents.on("did-create-window", (child) => {
  child.setFullScreen(true);          // override 不生效时的兜底
  child.setMenuBarVisibility(false);
  child.on("closed", () => mainWindow?.focus());
});
```

```js
// electron/window-options.mjs
export function isPhoneticChartUrl(url, mainUrl) {
  try {
    const target = new URL(url);
    const main = new URL(mainUrl);
    return target.origin === main.origin && target.pathname === "/phonetic-symbols";
  } catch {
    return false;
  }
}

export function createPhoneticWindowOptions() {
  return {
    width: 1280,
    height: 800,
    frame: false,
    fullscreen: true,
    fullscreenable: true,
    resizable: false,
    skipTaskbar: true,
    backgroundColor: "#0b1220",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  };
}
```

- 主窗口仍然禁止最大化/全屏（AGENTS 约束不动）；全屏只发生在独立子窗口。
- 名字用 `window.open(url, "mds-phonetic-chart", ...)`，重复打开时复用已有窗口；
  主进程只允许同源、路径精确为 `/phonetic-symbols` 的地址。
- 关闭检测：优先 `postMessage`（即时）；同时轮询 `win.closed`（250ms）兜底
  （用户用 Alt+F4 或窗口管理器关闭时也能恢复）。
- 如果 P0 验证发现 `window.open` 在 Electron 里无法应用 `overrideBrowserWindowOptions`
  或 `fullscreen`，再退回 preload + IPC 方案（`electron/preload.mjs` +
  `ipcMain.handle("phonetic-chart:open")`），本计划不默认引入 preload。
- 打开/关闭时把焦点还给主窗口；主窗口被关闭时 app 退出，子窗口随之关闭。

#### 3.6.3 入口

- 主界面 `ModeActions`（选中音标时）：`音标表` 按钮 + 「F1」提示；
- 默写中 `DictatingView` 头部：小图标按钮 + `F1`；
- 准备中 / 准备完成遮罩：一个次要按钮「音标表（F1）」，因为此时主界面的模式条被遮住；
- 全局 `F1`：`use-dictation` 的 window keydown 里处理，只在 `activeContentMode() === "phonetic"`
  时生效；浏览器默认帮助被 `preventDefault` 拦截。
- 任何阶段（idle/preparing/ready/dictating/results）都可打开；只有 `dictating` 阶段需要暂停。

#### 3.6.4 看表时暂停（本次最大的流程改造）

现状：倒计时是固定 `startedAt` 的 `setInterval`；音频是 `playWithIntervals` 的
`Audio` + `setTimeout` 链。两者都不支持暂停。方案：

1. 抽出 `src/lib/countdown-clock.ts`（纯状态 + 注入 `now`）：
   `start / pause / resume / stop / remainingAt`；单测覆盖「走 3s → 暂停 10s → 恢复 →
   再走 7s 归零」与重复 pause/resume。hook 只负责每 100ms 调 `remainingAt`。
2. 暂停 = 记录剩余毫秒 → `clearInterval` → `audioAbort.abort()`（`playWithIntervals`
   resolve `"aborted"`，其 `.then` 已忽略，不会误触发 `speech-end`）→ `sounding=false`。
3. 恢复 = 用剩余毫秒重启倒计时；若 `speechDone()` 为 false，从**当前这一遍**
   重播音频（`startIndex = Math.max(0, repeatIndex)`），而不是从头播；若这一轮已经播完，
   只恢复倒计时。
4. `playWithIntervals` 增加可选 `startIndex`（默认 0，现有调用不变），
   `onPlay` 仍回报绝对下标，状态行的「第 n 遍」不会错。
5. 本轮已 `countdownDone`（等语音）时暂停：只暂停音频，不再启动倒计时；
   语音播完按原规则推进。
6. 本轮的实际耗时排除暂停时间：`pauseStartedAt` / `pausedMs`，
   `recordRoundElapsed` 用 `now - startedAt - pausedMs`；session 的 `wallMs` 仍含暂停。
7. 暂停只在 `phase === "dictating"` 时发生；准备/就绪/结果阶段打开音标表不暂停。
8. 看表期间主窗口失去焦点，`window` 上的空格/回车不会误触默写；音标表窗口自己处理任意键关闭。
   Web 下弹窗可能没抢到焦点（或用户点回主窗口），因此暂停期间面板与全局键盘事件里的
   提交/跳轮一律 no-op（只保留 F1/关闭），避免在另一个窗口看表时误操作推进轮次。

### 3.7 结果页、历史与复习写回

- `results.ts` 增加 `PhoneticRoundLike` 分支：
  - `fields: [{ kind: "phonetic", expected, userValue, graded, correct, note? }]`；
  - `expected` 存**匹配到的变体**（无匹配则 canonical）的 token 字符串；
  - `userValue` 存用户 token 字符串（空提交就是 `""`；存**归位后**的序列，
    避免标准与我的只因重音插入点不同而看起来不一致）；
  - AI 来源加 `note: "AI 生成，仅供参考"`；降级词走普通 word 行并带
    `row.note: "本词没有可用音标，按单词默写"`。
- `ResultsView` 新增 `PhoneticResultRow`（与 `SentenceResultRow` 并列）：
  - 行首 ✓/✗ + 底色（ok-bg/err-bg）；
  - 单词 + 发音按钮（播放本轮那份音频，英式音色）；
  - 标准音标（`/ˈæpəl/`）；我的音标；逐 token diff 着色；
  - **标准与我的 token 都可单独试听**：每个 token 右侧小喇叭（复用 `PhonemeChip`），
    与结果页单词发音按钮互斥（先停对方）；历史回看同样可用；
  - 「同一词有多个标准读音时，任一匹配即算对」的说明；`JUDGEMENT_NOTES` 加：
    「音标判定：按音素序列比对，主重音必须正确，次重音不参与判定」。
- 历史：
  - `history-storage.ts` 的 `FIELD_KINDS` 加 `phonetic`；旧条目照读；
  - `HistoryScreen` 用 `CONTENT_MODE_LABELS` 显示「音标」，回看走同一结果行。
- 复习写回：
  - `REVIEW_MODES` 加 `phonetic`；`buildCommitItems` 的 `rowMode` 增加规则：
    `mode === "phonetic"` 且该行没有 `phonetic` 判定字段（降级轮）→ `word`；
  - 场次 `contentMode: "phonetic"`、`genMode: "cyber"`；
  - 卡片仍按词聚合推进（一场一次），与释义/短句/组句一致；降级轮按 word 计入日志，
    所以档案的模式分布会如实出现「音标」和少量「单词」。
  - 若以后希望「音标练习不推进拼写排期」，再单列（见 FUTURE），本版不改变卡片语义。
- `BankArchiveScreen` 的模式分布使用 `CONTENT_MODE_LABELS`，加标签即可；
  `review-stats-query.modeOf` 通过 `REVIEW_MODES` 自动接受新值。

### 3.8 测试

| 文件 | 覆盖点 |
| --- | --- |
| `phonetic-parse.test.ts` | 源符号归一（ɹ/ɛ/ɐ/ɡ、重音拆分、`i`）、**最大音节首重音归位**（water/important/study/computer/expensive/photograph/the）、长元音/双元音/塞擦音 token、未知符号拒绝、斜杠/空格/音节点清洗、空输入、变体去重 |
| `phonetic-data.test.ts` | 读取 `public/ipa/en-gb.v1.json`：schema、全部 token 合法、样本词（apple/water/important/photograph/happy/the）、PET 单条词覆盖率 ≥ 90% |
| `phonetic-pool.test.ts` | 答案多重集合完整、重复 token、干扰项不重复答案、池子上限、注入 shuffle、已选/撤销/清空 |
| `phonetic-match.test.ts` | 重音归位后比较（元音前/音节首前等价）、主重音严格、次重音忽略、多读音任一命中、`i/iː/ɪ` 不互宽、LCS diff 四类片段、最佳变体选择 |
| `timing.test.ts` | `phoneticCountdownDuration` 边界（1 token、长词、多遍、倍率、空 gap）、倒计时 ≥ 音频余量 |
| `countdown-clock.test.ts` | 走时/暂停/恢复/归零、重复暂停、暂停时间不计入 elapsed |
| `phonetic-provider.test.ts` | 请求体/prompt、合法/非法 token、缺词、截断、兼容降级、诊断不含 Key |
| `phonetic-service.test.ts` | 缓存命中/写入/复读、model/promptVersion 失效、坏缓存、中止不写、缺失不写负缓存 |
| `api.test.ts` | `requestPhonetics` 成功/错误；`playWithIntervals` 的 `startIndex` 从中间继续、绝对下标、中止 |
| `results.test.ts` | phonetic 行、AI note、降级 word 行、`rowJudgement`、token diff 与 expected 选择 |
| `review-service.test.ts` | 音标场次写回、降级轮记 word、日志 mode、session contentMode、统计模式分布 |
| `history-storage.test.ts` | phonetic 字段/条目归一化、旧条目无 phonetic 仍可读 |
| `state.test.ts` | `phonetic` 进白名单、`resolveStoredContentMode` 恢复 |
| `ready-overlay.test.ts` | 音标 summary 文案 |
| `use-dictation.test.ts` | 词典命中 + AI 缺失 + TTS 的混合轮次；未配置 AI 时降级不中止；提交/超时自动提交；暂停/恢复（mock clock/audio，尽量覆盖）；**点音素喇叭 → 中止单词音频 → 播完从当前遍恢复；提交/推进/进结果不恢复；多个喇叭只恢复一次** |
| `phoneme-audio.test.ts` | mock `Audio` 覆盖 play/stop/ended/error、单例互斥、`playingKey`、preload、失败置灰、`ˈ`/`ˌ` 无音频 |
| `phoneme-audio-data.test.ts` | 45 个 token（除重音）都有 manifest；MP3 文件存在/头合法/大小 < 100 KB；slug 全 ASCII；每个文件有作者/来源/许可；双元音有两条源引用 |
| `electron-window-options.test.ts` | `isPhoneticChartUrl` 同源/路径/非法 URL；音标窗口 options（fullscreen、无 nodeIntegration、无 frame） |
| `web:smoke` | `/phonetic-symbols` 200、`/ipa/en-gb.v1.json` 200、`/ipa/audio/v1/ei.mp3` 200；`client:verify` 包含 `public/ipa` |

- 数据构建脚本不进入 `pnpm check`（不联网）；提交的 JSON 由 `phonetic-data.test.ts` 守护。
- 手动验收：`pnpm client:dev`（Electron 全屏窗口、任意键关闭、暂停/恢复焦点）+
  `pnpm web:dev`（弹窗/拦截提示）；真实跑一场音标默写（词典命中、AI 兜底、降级三种词）。
- 交付前跑 `pnpm check`（Vitest → Web 构建 → Web 冒烟）。

### 3.9 设计稿与文档

- `.design/mds.md` 新增「音标模式」批次说明：6 项模式条、音标轮、结果行、全屏音标表入口；
- `.design/mds.pen` 新增对应屏（Pencil 应用在线时编辑；`.pen` 加密，不手改）：
  - 主界面（选中音标、书写按钮置灰 + 信息条、音标表按钮）；
  - 音标轮（单词、答案 chips、音标池、键盘提示）：**chip 左 token/右喇叭**，
    池子 tile 建议同构；重音 tile/chip 无喇叭；喇叭播放态/失败置灰；
  - 结果页（标准/我的音标 + diff + 每个 token 的喇叭）；
  - 全屏表（图片 + 关闭提示 + 暂停提示）。
- 音素音频的来源/许可/原型见 `plans/phonetic-audio-research.md`；音频许可页加入设置里的
  「关于/许可」入口（或音标面板的一行链接）。
- 先评审设计再写界面代码（项目开发流程要求）。
- 实施完成后更新 `AGENTS.md`（模式说明、音标数据源/许可、全屏窗口、暂停口径、诊断脚本）、
  `FUTURE.md`（未做项）与 `.implementation-report/<date>-phonetic-mode.md`。

### 3.10 音素独立发音（2026-10-23 追加）

详细调研（源表/许可/原型/ffmpeg 参数/备选）见 `plans/phonetic-audio-research.md`，这里只列接入点：

- **数据**：`public/ipa/audio/v1/*.mp3` + `phoneme-audio.v1.json`（token → 文件、作者、
  来源、许可、修改）+ `LICENSE.md`；`scripts/fetch-phoneme-audio.mjs`
  （`pnpm build:phoneme-audio`）从 Wikimedia Commons 下载/转码/拼接；生成物提交。
  - 45 个音素（44 音标表 + happy `i`）；`ˈ`/`ˌ` 无音频。
  - 12 单元音 + 24 辅音来自 Commons 真人录音（多数 CC BY-SA 3.0，`dʒ` 公有领域）；
    8 个双元音由两个单元音拼接（CC BY-SA 4.0 改编）；辅音源多带元音上下文，
    UI 标「音素示范」而不是「单音」。
  - 音频目录单独 CC BY-SA 4.0；App 代码保持 MIT；随包 `THIRD_PARTY_NOTICES`/
    音频 LICENSE；设置里提供许可入口。
- **播放器**：`src/lib/phoneme-audio.ts` 单例 `HTMLAudioElement`；
  `play(token, key)`/`stop()`/`preload(tokens)`/`playingKey` 信号；失败置灰不抛错；
  MP3 64 kbps mono；预加载本轮池子。
- **UI**：`PhonemeChip`（左 token/右喇叭）用于已放置 chips；池子 tile 建议同构；
  结果页/历史的标准与我的 IPA token 同构；重音 chip 只有左段；喇叭播放态脉冲。
- **与单词音频互斥**：`use-dictation.previewPhoneme` 在 `dictating` 且未播完时
  abort 本轮音频 → 播音素 → 从 `repeatIndex` 恢复；倒计时不停；提交/推进/进结果/
  打开全屏表则不恢复；连续点多个只恢复最后一次。
- **键盘**：`Shift+Enter` 试听聚焦 tile；`Shift+Backspace` 试听最后放置的 token；
  chip 喇叭可 Tab；结果页 token 喇叭可 Tab。
- **测试**：见 §3.8 的 `phoneme-audio*` 与 `use-dictation` 行。
- **许可选择**（待崔总确认）：Commons CC BY-SA（推荐）/ eSpeak-ng 机器音 /
  Piper en_GB 神经音 / 自录或委托英式发音。

---

## 4. 实施分期

| 期 | 内容 | 产出 | 估时 |
| --- | --- | --- | --- |
| **P0 技术验证** | 复制音标表 → `public/ipa`；新路由；Electron `setWindowOpenHandler` 全屏窗口 + 任意键关闭 + 焦点返回；Britfone 样本转换/覆盖率跑通；**音素音频源/许可/原型**（已完成，见 `plans/phonetic-audio-research.md`） | 三个最大不确定项有结论；必要时改走 preload/换音源 | 0.5d |
| **P1 数据与纯逻辑** | `phonetic-symbols/parse/pool/match`（含最大音节首归位）；`build-phonetics.mjs` + JSON + license；AI provider/service/route/`get:phonetics`；cache storage；**`build:phoneme-audio` + manifest/license + `phoneme-audio.ts` 播放器** | `pnpm build:phonetics`、`pnpm get:phonetics`、`pnpm build:phoneme-audio` 可用；单测绿 | 2d |
| **P2 模式接入 + 设计** | 枚举/白名单/标签/滑块/书写置灰/Ready 文案/历史 field/review mode；Pencil 设计稿评审（含喇叭/左右分区） | 模式可见可持久化；设计定稿 | 1d |
| **P3 轮次与界面** | 准备流程、`PhoneticRound`、计时、音标面板、键盘、提交/超时、结果行、写回；**PhonemeChip/池子/结果页喇叭 + 单词音频中止/恢复** | 能完整跑一场音标默写（不含全屏暂停） | 2d |
| **P4 全屏与暂停** | 弹窗 hook、F1/入口、countdown clock、音频从当前遍继续、暂停耗时排除、焦点恢复；**全屏表打开时停止音素** | 看表暂停/恢复闭环；单测绿 | 1.25d |
| **P5 验收与文档** | 手动 Electron/Web、`pnpm check`、设计文档、AGENTS/FUTURE/实施报告、音频许可清单 | 可交付 | 0.5d |

合计约 **7–8 个工作日**（不含不可控的 Pencil 设计等待、Electron 窗口平台差异与音源替换）。

---

## 5. 难点与对策（逐条）

| # | 难点 | 影响 | 对策 |
| --- | --- | --- | --- |
| 1 | **没有可信音标数据** | 答案错 → 用户被误判，整个模式失去意义 | Britfone（MIT/RP）+ 构建期强校验；ECDICT 弃用；AI 只补缺并标注；覆盖率报告 |
| 2 | **符号切分与口音归一** | `tʃ`/`eɪ`/`iː` 被拆错、`ɹ/ɛ/ɐ` 与音标表不一致；Britfone 的重音挂在元音前，直接存会显示成 `/wˈɔːtə/` | 以 token 数组为唯一存储形态；构建期白名单；`ɹ→r`、`ɛ→e`、`ɐ→ʌ`、`ɡ` 统一；最长匹配 tokenizer + **最大音节首重音归位** + 单测/抽样 |
| 3 | **多读音/重音口径** | 同一词两种标准读音，用户拼对却被判错；重音标记的插入点在元音前/音节首前有歧义 | 词典保留最多 3 个变体，任一命中即对；判定前两端都做重音归位，再严格比对主重音、忽略次重音；结果页展示匹配到的变体 |
| 4 | **主窗口不能全屏** | 音标表在 1120×820 里看不清，违背「跳出窗口限制」 | 独立 BrowserWindow + `setWindowOpenHandler`；主窗口的全屏限制不动；P0 先验证；失败回退 preload/IPC |
| 5 | **暂停/恢复没有现成能力** | 看表时倒计时/音频继续，用户漏听、被扣时间 | 抽 `countdown-clock` 纯状态；暂停 abort、恢复从当前遍重播；暂停时间不计入 elapsed；单测 + 手动验证 |
| 6 | **模式枚举连锁改动** | 漏改历史/统计/写回，数据口径错 | 按短句模式的清单逐项改；`REVIEW_MODES`/`FIELD_KINDS`/`CONTENT_MODE_LABELS`/`JUDGEMENT_NOTES`；回归测试 |
| 7 | **准备阶段多源并行** | 词典、TTS、AI 三段等待，进度误导 | 词典懒加载；TTS 与 AI 并行；TTS 有确定进度，AI 单次请求用不确定态；部分失败降级不中止 |
| 8 | **音标池与键盘流** | 只能鼠标点，违背键盘交互铁律；重复符号/焦点丢失；喇叭与移除区域混在一起易误点 | 池内下标记录选择；roving tabindex + 方向键 + Enter/Backspace/Ctrl+Enter；chip 左 token/右喇叭两个独立按钮；`Shift+Enter` 试听；关闭全屏表后焦点回池子 |
| 9 | **英式音标 vs 当前美式音色** | 听到 /ˈwɔːtər/，标准答案 /ˈwɔːtə/ | 增加 en-GB 音色；音标轮优先 en-GB；面板标注「英式发音」 |
| 10 | **倒计时与音频时长耦合** | 倒计时一到自动提交，可能还没播完 | 公式含 `audioAllowance`（gap + 每遍音频余量）；实机试听调基础系数 |
| 11 | **结果/历史/写回口径** | 音标场次里降级单词轮被记成音标，统计失真 | `buildCommitItems` 按行字段判定：无 phonetic 字段 → word；场次仍记 phonetic |
| 12 | **UI 空间与字体** | 第 6 个模式条挤、IPA 字形（尤其 θ）显示不一致 | 滑块加宽到约 430px；音标面板固定高度；验证 Sarasa 对 IPA 的覆盖，必要时加系统字体回退或小型 IPA 字体 |
| 13 | **资产与打包** | 图片 949KB、词典 1–2MB，包体增大；许可要随包 | 接受体积；图片可选优化；词典/许可/README 放 `public/ipa`；不写中文文件名 |
| 14 | **AI 音标准确度** | AI 可能给出错读音 | 词典优先；AI 只补缺；严格符号校验；结果标注「AI 生成；仅供参考」；缓存稳定结果 |
| 15 | **音素音源与许可** | 没有可直接随包的英式单音集：Oxford 音频有版权、Freesound 是 CC BY-NC、IPA 官方是 CC BY-NC-ND、部分数据集无许可 | 采用 Wikimedia Commons 真人录音（CC BY-SA 3.0/4.0）+ 拼接双元音；音频目录单独 CC BY-SA 4.0；随包许可清单；备选 eSpeak/Piper/自录 |
| 16 | **单词音频与音素音频互斥** | 同时播会听不清；静音/停止又丢失这一遍单词 | 点喇叭时 abort 本轮音频 → 播音素 → 从 `repeatIndex` 恢复；倒计时不停；提交/推进/进结果/开全屏表不恢复 |
| 17 | **辅音上下文与双元音构造** | Commons 辅音多为「辅音+元音」示范，不是严格单音；双元音是拼接的 | UI 标「音素示范」；辅音保留第一段示范；双元音用同一说话人的两个单元音拼接；许可清单写明改编 |
| 18 | **喇叭 UI/左右分区/焦点** | 放错区域、重复 token 分不清、键盘无法试听 | `PhonemeChip` 左右两个独立按钮；按池内下标区分重复 token；`Shift+Enter`/`Shift+Backspace`/Tab 覆盖键盘；重音无喇叭 |

---

## 6. 不在本版范围（登记到 FUTURE）

- ipa-dict `en_UK` 合并扩覆盖（GRE/TOEFL 词典命中率低时再评估）；
- 美式音标/切换口音；
- 音节点、重音模式（`ˈ`/`ˌ` 之外的韵律）；
- 音标专项的独立排期/掌握度统计（当前共用词卡）；
- 音标表的缩放/拖拽/打印/导出；
- 词组、专有名词、缩写音标（当前降级单词轮）；
- 「听音选音标」（不显示单词的进阶题型）；
- IPA 键盘布局/直接键入；
- 辅音严格单音/英式真人音源（当前是 Commons 示范 + 拼接双元音）；
- 自录/委托英式 45 音；eSpeak-ng/Piper 作为替代音源；
- 池子 tile 喇叭（若本版只做已放置 chip）；结果页/历史 token 喇叭（若本版不做）；
- 重音示范音（当前重音符号不发音）；
- 单词音频 duck 模式（若不喜欢中止/重播）；
- AI 返回多个备选读音；
- 音标表 `.pen` 源文件的长期维护流程。

---

## 7. 决策

| # | 决策点 | 结论 | 来源 |
| --- | --- | --- | --- |
| 1 | 音标数据源 | **内置英式词典（Britfone，MIT）+ AI 兜底** | 崔总 2026-10-23 确认 |
| 2 | 音标池 | **答案音素（含重复）+ 4–6 个易混干扰项** | 崔总 2026-10-23 确认 |
| 3 | 判定严格度 | **主重音 `ˈ` 参与，次重音 `ˌ` 忽略；多读音任一命中** | 崔总 2026-10-23 确认 |
| 4 | 发音与暂停 | **播发音；看表时暂停计时与音频，关闭后从当前这一遍继续** | 崔总 2026-10-23 确认 |
| 5 | happy 尾音 `i` | 作为第 45 个可点 token（音标表外单列，tooltip 说明）；如坚持 44 音，构建期映射到 `ɪ` | 方案建议（可实现前一句话调整） |
| 6 | 模式位置 | `单词 · 释义 · 中文词 · 短句 · 音标 · 组句` | 方案建议 |
| 7 | 复习排期 | 音标轮与其他内容模式一样推进同一张词卡；降级轮按 word 记账 | 方案建议 |
| 8 | 词组/专名 | 无音标时降级为单词轮，结果页标注；不中止整场 | 方案建议 |
| 9 | AI 音标 | 只补词典缺失；严格校验；缓存；结果标注「AI 生成，仅供参考」 | 方案建议 |
| 10 | 音标轮音色 | 优先 en-GB（当前音色是英式则用之，否则 `en-GB-SoniaNeural`）；设置里补 en-GB 选项 | 方案建议，待崔总确认是否强制 |
| 11 | 全屏实现 | Electron 独立全屏 BrowserWindow；Web 另开弹窗（浏览器全屏能力不保证） | 方案建议 |
| 12 | 结构 | 不做音节点；长元音/双元音/塞擦音各为一个 tile；`ː` 不单独点 | 方案建议 |
| 13 | 重音位置 | 构建期做最大音节首归位，显示标准 IPA；判定前两端归位，因此在元音前或音节首前点 `ˈ` 等价 | 方案建议 |
| 14 | 音素音源 | Wikimedia Commons 真人录音 + 8 个双元音拼接；CC BY-SA 3.0/4.0，音频目录单独许可 | 崔总 2026-10-23 确认 |
| 15 | 已放置 chip 形态 | **左 token 点击移除；右喇叭点击单独发音** | 崔总 2026-10-23 确认 |
| 16 | 池子/结果页喇叭 | 池子 tile 同构（左放入/右试听）；结果页/历史 token 也带喇叭 | 崔总 2026-10-23 确认 |
| 17 | 重音符号音频 | `ˈ`/`ˌ` 不发音、无喇叭，chip 上说明 | 建议，待确认 |
| 18 | 单词音频冲突 | 点喇叭时中止本轮单词音频，播完从当前遍恢复；倒计时不停 | 崔总 2026-10-23 确认 |
| 19 | 音频许可 | 音频目录 CC BY-SA 4.0 + 逐文件 attribution；App 代码保持 MIT；随包 notices | 随 #14 确认 |

---

## 8. 验收清单

- [ ] 音标表随包；切到音标模式后，主界面/准备/就绪/默写/结果均可打开；
      Electron 为独立全屏窗口，任意键或点击关闭，关闭后回到原处并恢复焦点。
- [ ] 默写中打开音标表：倒计时冻结、音频暂停；关闭后从当前这一遍继续；
      该段暂停时间不计入本轮耗时。
- [ ] 模式滑块有「音标」；书写按钮置灰并显示「点选音标需要在屏幕上完成」。
- [ ] 每轮显示单词、播英式发音、答案音素 + 干扰项的池；鼠标/键盘均可完成
      点击、撤销、清空、提交；倒计时结束自动提交。
- [ ] **已放置的每个音标 chip 右侧喇叭可单独试听；点左侧仍移除**；池子/结果页按确认范围同构；
      重音符号无音频并提示；点喇叭时单词音频中止、播完恢复，倒计时不停；失败置灰不卡流程。
- [ ] 判定：主重音严格、次重音忽略、多读音任一命中；结果页有标准/我的音标与
      逐音素 diff；全对庆祝沿用。
- [ ] 词典命中（离线）/ AI 补齐（标注）/ 无音标降级（单词轮 + 提示）三条路径都正常；
      未配置 AI 时词典命中的词仍可用。
- [ ] 结果页、历史回看、学习档案模式分布、复习写回都包含音标；降级轮记 word。
- [ ] `pnpm test:run`、`pnpm check` 通过；`pnpm client:dev` 与 `pnpm web:dev` 手动验收通过。
- [ ] `plans/`（含 `phonetic-audio-research.md`）、`.design/`、`AGENTS.md`、`FUTURE.md`、实施报告同步。
