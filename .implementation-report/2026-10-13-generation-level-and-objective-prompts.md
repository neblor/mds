# 生成级别（小学/初中/高中/大学）+ 提示词去主观化（2026-10-13）

## 一、需求（崔总反馈要点）

1. 提示词里**不要「儿童」这类主观表述**，改用客观表述；「前后全有儿童，这是不对的」。
2. 设置里加**生成级别**：小学 / 初中 / 高中 / 大学（或类似更准确地偏向指定级别难度的说法），**默认初中**。
3. 生成时用**明确指定的词汇/语法复杂度级别**来约束内容，而不是「儿童」这种定位。
4. 语气**冷静客观、平铺直叙、无重复**，只说需求 + 真护栏。

## 二、关键决策

### 1. 级别＝枚举 + 客观英文描述（`src/lib/content-level.ts`）

```ts
CONTENT_LEVELS = ["primary", "junior", "senior", "college"]   // 默认 junior
CONTENT_LEVEL_OPTIONS   // 界面中文：小学 / 初中 / 高中 / 大学
CONTENT_LEVEL_PROMPTS   // 写进提示词的英文客观描述：
  primary : "primary-school English: the most common everyday words, one-clause sentences, simple present and past"
  junior  : "junior-high English: common everyday words, basic tenses, simple compound sentences"
  senior  : "senior-high English: senior-high vocabulary, common subordinate clauses and phrasal verbs"
  college : "college English: CET-4 and CET-6 vocabulary, complex sentence structures"
```

- 描述只讲**词汇范围与句法特征**，不含任何年龄/人群定位，也不写「允许/不允许」式废话。
- `parseContentLevel` 宽容解析：未知、缺失、类型不符一律回落初中（设置迁移与请求体共用）。

### 2. 命名用 `contentLevel`，不用 `level`

`definition-provider` 的诊断事件里已有 `level: "warning" | "error"`（日志级别）。为免歧义，内容难度统一叫
`contentLevel`（`AppSettings.contentLevel`、请求体 `contentLevel`、provider 选项 `contentLevel`），
也正好和 `content-level.ts` / `CONTENT_LEVEL_*` 对齐。

### 3. 级别只作用于「会生成内容」的两处

| 功能 | 是否接级别 | 理由 |
| --- | --- | --- |
| 组句出题（`/api/cloze`） | 是 | 句子的词汇与句法就是要按级别约束的「生成内容」 |
| 英文释义（`/api/definitions`） | 是 | 释义句本身的难度决定学生读不读得懂 |
| 中文对应词（`/api/chinese-words`） | 否 | 一个词对一个中文词，与英文难度级别无关（只去掉「儿童」字样） |
| AI 批改（`/api/answer-grade`） | 否 | 判定标准（同义/改述是否算对）不随级别变（只去掉「儿童」字样） |

### 4. 释义缓存把级别算进身份

`ai-pair-service` 的缓存原本只按 `model` 失效。释义提示词现在依赖级别，如果不理会级别，
切到「大学」后仍会命中「初中」时期生成的释义。因此：

- `definitions.json` 增加 `contentLevel` 字段，读取时 `raw.contentLevel !== contentLevel` 即视为未命中；
- `chinese-words.json` **不参与**级别失效（中文词与级别无关），写入时不带该字段（`undefined` 被 JSON 省略）；
- 复读校验（写后读回）走同一套身份判断，避免「写进去了但读不出来」的假成功。

### 5. 中文词 / 批改提示词：只去主观措辞，不接级别

- `You are an English dictionary for kids.` → `You write one-sentence English definitions.`
- `You are an English-Chinese dictionary for kids.` → `You translate English words into Simplified Chinese.`
- `... dictation exercise for kids.` → `... dictation exercise.`
- 保留原有真护栏：STRICT JSON only、Simplified Chinese characters only - no pinyin / no English explanation、
  include every requested word exactly once。

### 6. 诊断脚本必须能复现生产口径

- `pnpm get:cloze -- --level <primary|junior|senior|college> <words…>`：把级别透传给生产 provider，并在输出里回显 `contentLevel`。
- `pnpm get:explain --level <…> <words…>`：只对释义生效（中文词忽略），同样回显级别。
- 顺带修复：`scripts/get-explain.mjs` 之前**没有注册** TS 解析钩子（`definition-provider` 原来没有任何本地相对导入，
  所以一直没暴露）；本轮给 provider 加 `./content-level` 引入后立刻炸了 → 改为「先 register 钩子，再动态 import provider」，
  与其他脚本一致。相应地把 `explain-cli.test.ts` 的 stderr 解析改为「从第一个 `{` 起」，容忍 Node 的 Deprecation 警告行。

## 三、改动落点

- **新增** `src/lib/content-level.ts`、`src/lib/content-level.test.ts`
- `src/lib/settings.ts` — `contentLevel` 字段 + 默认初中 + 读取时宽容解析（旧数据自动迁移）
- `src/components/SettingsPanel.tsx` — AI 服务卡加「生成级别」下拉（沿用音色下拉样式）+ 客观说明文案
- `src/lib/definition-provider.ts` — `buildDefinitionSystemPrompt(contentLevel)` / `CHINESE_SYSTEM_PROMPT` /
  `buildPairSystemPrompt`；批改提示词去 kids
- `src/lib/cloze-provider.ts` — `buildClozeSystemPrompt(contentLevel)`，`FetchClozeOptions.contentLevel`
- `src/lib/definition-service.ts`、`src/lib/ai-pair-service.ts` — 级别透传 + 缓存身份（模型 + 级别）
- `src/routes/api/definitions.ts`、`src/routes/api/cloze.ts` — 解析 `contentLevel` 并传给 provider
- `src/lib/api.ts` — 释义 / 组句请求体带 `contentLevel`
- `scripts/get-cloze.mjs`、`scripts/get-explain.mjs` — `--level` 参数；get-explain 补 TS 钩子注册
- 测试：`content-level.test.ts`（新）、`settings.test.ts`、`cloze-provider.test.ts`、`definition-provider.test.ts`、
  `definition-service.test.ts`、`routes/api/cloze.test.ts`、`explain-cli.test.ts`
- `.design/mds.md` — 4 设置屏与出题口径更新

## 四、验证

1. **单测**：`pnpm test:run` → 58 文件 / **584 用例全绿**（含：级别解析回落、提示词含级别描述、不含 kid/child、
   缓存身份按级别失效、路由透传）。
2. **设置面板（Playwright 实测 DOM）**：`select` 默认 `junior`，选项 `[小学, 初中, 高中, 大学]`，
   说明文案「约束 AI 出题与释义的词汇、句法难度；默认初中」；切到「大学」后 1.5s 防抖落盘
   `mds.settings.v1.contentLevel = "college"`；面板高 738（`max-h 90%`），内滚动区 638/795，
   生成级别行在首卡、无需滚动即见。截图：`.tmp/settings-level.png`。
3. **真实 AI 对比（`glm-5.2`，同词池不同级别）**：
   - 组句 `--level primary`：`I read a ##1 every day.` / `It helps me learn new things.`（单句、简单）
   - 组句 `--level college`：`The professor recommended a comprehensive ##1 to help students deepen their
     understanding of the subject.` / `Through consistent ##2, learners can gradually ##3 their academic
     performance.` / `However, only through repeated ##2 …`（从句、连接副词、学术措辞）
   - 释义 `--level primary`：`knowledge: what you know and learn.`
   - 释义 `--level college`：`knowledge: the accumulation of facts, information, and skills acquired through
     experience or education, which enables an individual to comprehend complex subjects …`
   → 级别确实改变生成结果，不是写在提示词里没人理。
4. **未做**：`.design/mds.pen` 的 4 设置屏没有同步（pencil MCP 连不上运行中的 Pencil 应用，`.pen` 是加密格式不能直接改）；
   已按现有下拉样式实现并用真实面板 DOM 验证，设计稿同步待 Pencil 应用可用后补（见 FUTURE 第 14 条）。

## 五、后续

- FUTURE 14：`.design/mds.pen` 4 设置屏补「生成级别」行（阻塞于 Pencil 应用未连接）。
- FUTURE 15：`module.register()` 已被 Node 标记 deprecated（`registerHooks` 替代），三个脚本共用同一个钩子文件，后续统一迁移。
