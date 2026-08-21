# 中文词模式升级：两段式输入 + AI 批改 + 正在批改遮罩

## 需求

1. 中文模式改为与释义模式一致的两段式：先输入英文，再输入中文
2. 中文输入段的时间按取回的中文词字符数计算（UTF-8 语义，1 个中文字记 1 个字符），每字时间系数为原来的 5 倍
3. 中文判定改用 AI 批改；未配置 AI 时中文模式不可用
4. 答完后、进结算前显示「正在批改」遮罩（与准备中同风格，背景模糊）
5. 本场所有回答组合成一次 AI 请求（关 thinking，模型不支持时自动降级），返回结构化 JSON 逐词判定

## 关键决策

### 两段式输入与判定结构

- 中文模式赛博输入复用释义模式的第二段机制（`answer` = 英文，`answerDef` = 中文词），`step()`/`inputDone`/`timedOutInputPatch` 的条件统一为「definition 或 chinese 需要第二步」
- 结果页中文模式行含**两个判定字段**：英文单词（本地严格匹配）+ 中文词（AI 批改，无 AI 结果时回退本地归一化匹配）；整行对 = 全部判定字段对
- 书写模式中文：无输入无批改，只展示中文词标准供自检（与之前一致）
- 判定说明更新为「中文词由 AI 批改，常见同义词也算对 · 英文单词大小写与标点需完全一致」

### 中文段计时（timing.ts）

- `chineseLength` 改为 UTF-8 字符计数：`[...text].filter(非空白)`，每个汉字/字符记 1（"你好"→2，"你好！"→3）
- 中文段 = 第二步作答段：`THINK_SECONDS(2) + CHINESE_CHAR_SECONDS × 字符数`，其中 `CHINESE_CHAR_SECONDS = 5 × LETTER_SECONDS = 1.5s`（原字母系数 0.3 的 5 倍）
- 总时长 = 单词段（×播报遍数）+ 中文段（一次），例：hello→你好 = 7.0 + 5.0 = 12s

### AI 批改链路（一次请求，结构化结果）

- provider：`fetchChineseGrades`（definition-provider.ts）——请求体含系统提示词（严格但公平的小学生中文默写批改：同义词可接受、忽略空白与中文标点、空答案算错、必须逐词返回）+ 所有作答 `{word, expected, answer}`；响应解析兼容 `{results:[...]}` / `{grades:[...]}` / `{words:{word: bool|{correct}}}` / 直接数组/映射，correct 支持 boolean/"yes"/"no"/1/0
- **关 thinking**：沿用 `reasoning_effort: "none"` + `response_format: json_object`，400/422 时自动两级降级（先移除 response_format，再退回最小请求体）——为此把原 `fetchAiPairs` 的「请求 + 兼容降级 + 网络/超时/中止错误映射」抽成共享的 `callChatCompletion`，释义/中文词/批改三条链路复用
- 服务：`chinese-grade-service`（无磁盘缓存，批改是一次性结果）；响应不可解析（invalid-response/empty）时降级为空结果 + 警告，网络错误直接抛出由调用方决定
- 路由：`POST /api/chinese-grade`（校验 items 非空、AI 配置，错误码与 definitions 一致）
- 客户端：`requestChineseGrades`；`pnpm get:explain --grade "hello=你好"` 支持命令行诊断

### 正在批改遮罩与降级

- 新阶段 `grading`（仅中文赛博模式）：最后一轮结束 → `正在批改…` 全屏模糊遮罩（复用准备中同款卡片样式，Loader2 旋转图标，30s 超时）
- 批改完成后进入结果页；**失败/中止自动降级**：按单词回退本地归一化匹配，并在结果页判定说明下方显示来源提示（"AI 批改失败，已改用本地匹配判定"/"已中止 AI 批改…"）
- Escape 可中止批改直接进结果；新一场默写开始前清空上一场批改状态（防同词命中旧判定）；批改请求带 token 隔离，迟到结果不覆盖状态

## 测试与验证

- 单测 281 个全部通过（新增 24 个）：`fetchChineseGrades`（多响应形状、correct 归一化、部分返回、兼容降级、空结果错误）、`gradeChineseAnswers`（20 词批量对齐、不可解析降级、网络错误抛出）、`/api/chinese-grade` 路由（校验、no-config、降级、错误映射）、`requestChineseGrades` 客户端、`timedOutInputPatch` 中文两步封口、`timing` 中文段公式与 UTF-8 计数、`results` 双判定字段与 AI 覆盖、`use-dictation` 两段输入 + grading 阶段 + 失败/中止降级 + 单词模式不批改
- `pnpm check` 全绿（测试 + 生产构建 + HTTP 冒烟）
- Playwright 全流程验证：两段式输入、倒计时 12s、一次批改请求、AI 判定驱动计数（1/2）、批改失败降级提示、批改遮罩出现（含 blur 校验）、Escape 中止批改

## 后续可处理

- AI 批改目前只判对错，`note` 已进入数据模型但未在 UI 渲染，如需展示判错原因可加上
- 批改超时 30s，可按需要调整；批改结果不做缓存（每场作答唯一）
- 若希望整行对错只按中文词判定（英文仅展示），改 `results.ts` 中 word 字段的 `graded: false` 即可
