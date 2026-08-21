# 释义模式改为 AI 批改（与中文词模式同构）

## 需求

用户确认：释义模式的释义作答也改成 AI 批改，与中文词模式完全一致——不再"释义不批改"，而是与中文词共用同一套批改链路（一次请求、结构化 JSON、关 thinking、失败/中止降级本地匹配）。

## 关键决策

### 批改链路泛化（chinese → definition 同构）

原先 `/api/chinese-grade` 只批中文词。现泛化为按 `kind` 参数化的通用批改：

- provider：`fetchChineseGrades` → `fetchAnswerGrades({ kind: "chinese" | "definition" })`，系统提示词按 kind 二选一：
  - chinese：原有口径（同义词/合理选词可接受、忽略空白与中文标点、空答案算错）
  - definition（新增）：判"学生释义是否表达与标准释义相同的核心意思"——**改述（paraphrase）与不同措辞可接受**、忽略大小写/标点/冠词（a/the）差异、不明显影响含义的拼写小错可接受、空答案算错
- 响应解析复用原逻辑（`{results:[...]}` / `{grades:[...]}` / `{words:{...}}` / 直接数组或映射，correct 支持 bool/"yes"/"no"/1/0），两口径共用
- service：`chinese-grade-service` → `answer-grade-service`（`gradeAnswers({kind, items, ...})`），不可解析降级空结果 + 警告、网络错误抛出由调用方降级，均与原一致
- 路由：`POST /api/chinese-grade` → **`POST /api/answer-grade`**，请求体新增 `kind`（"chinese"|"definition"，非法值 400），items/baseUrl/apiKey/model 校验不变
- 客户端：`requestChineseGrades` → `requestAnswerGrades(kind, items, settings, signal)`

### 结果模型（results.ts）

释义模式赛博结果行改为与中文词模式**完全同构的双判定字段**：
- 英文单词：严格匹配（不变）
- 英文释义：**graded: true**，correct = AI 结果覆盖 ?? 本地兜底 `isDefinitionMatch`（原来 graded: false 只展示）

书写模式释义仍只展示参考（无作答无批改），不变。

### 本地兜底口径（match.ts）

新增 `normalizeDefinition` / `isDefinitionMatch`：小写 + 去英文标点 + 压缩空白后完全一致才算对。**改述判定交给 AI**，本地兜底从严是预期行为（兜底只在 AI 失败/中止时生效）。

### 流程编排（use-dictation.ts）

- 进入 grading 的条件从「chinese」扩为「chinese 或 definition」赛博模式：答完先过「正在批改」遮罩再进结果
- 批改 items 的 expected 按 kind 取 `chineseWord` 或 `definition`
- 降级提示、token 隔离、新一场清状态等沿用原逻辑

### 结果页（ResultsView）

「判定性第二步字段的标准行」泛化：原来硬编码中文词，现在按字段 kind 显示「中文词：…」或「释义：…」（释义判对时也展示标准行供学习参考）。

### 诊断脚本

`pnpm get:explain --grade-def "apple=a round fruit"` 批改释义作答；原 `--grade` 不变（中文词口径）。

## 文档同步

- AGENTS.md：「释义部分不批改」→「释义部分由 AI 批改（同构：意思相同即算对，改述可接受；失败/中止降级本地宽松匹配并提示）」
- README：功能列表与 `--grade-def` 用法

## 结果

- 296 个单测（34 文件）全绿，`pnpm check`（测试 + 生产构建 + 冒烟）通过
- Playwright 全流程验证：释义模式两段输入 → 一次批改请求（kind=definition）→ 改述作答被 AI 判对（计数 2/2）→ 标准释义对照行展示 → 批改 500 时降级本地判定并提示、与标准一致的作答仍判对

## 后续可处理

- 批改 note（AI 判定理由）已进数据模型仍未在 UI 渲染，需要时加一行淡色说明即可
- 定义与中文词批改提示词的松紧（如拼写小错容忍度）可能需要按真实模型表现微调
