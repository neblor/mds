# Phase 2 · 范例组句（cloze）+ 自定义远端清单 实施报告

日期：2026-10-12 ｜ 范围：`plans/wordbank-srs-cloze.md` 的 Phase 2（第四种内容模式「组句」）
＋ Phase 1 实施报告的遗留项（TS 基线、远端清单可配）
状态：**完成**（`pnpm check` 全绿；组句接口、队列释义、cloze 复习写回已在生产构建上真实 HTTP 验过）
设计稿：`.design/mds.pen` 的 24–29 屏（组句模式、出题准备、出题失败、组句轮、组句结果、检查清单更新）

## 一、交付内容

| 模块 | 文件 | 说明 |
| --- | --- | --- |
| 出题契约（纯函数） | `src/lib/cloze-parse.ts` | 解析 + 严格校验：1–6 题、每题 2–3 句、2–4 空、`##n` 与 blanks 一一对应、答案∈候选池、usedWords 一致、全场答案去重 ≤16、未挖空候选词不得出现在短文里；另含 `splitClozeSentence` / `fillClozeSentence` / `sentenceOfBlank` 三个渲染辅助 |
| 出题提供器 | `src/lib/cloze-provider.ts` | 复用 definition-provider 的 chat 调用与内容块抽取，一次请求生成整场题；任何失败抛 `DefinitionProviderError`（不降级、不重试） |
| 公共 chat 工具 | `src/lib/definition-provider.ts` | 抽出并导出 `readChatSources` / `callChatCompletion` / `contentCandidates`（释义、中文词、批改、组句共用；行为不变） |
| 路由 | `src/routes/api/cloze.ts` | 只做参数校验与 HTTP 适配；候选池上限 24（超出取前 24）；错误按类别返回 `{error,message}` |
| 客户端 API | `src/lib/api.ts` | `requestClozeQuestions(candidates, settings, signal)` |
| 每轮时长 | `src/lib/timing.ts` | `clozeDuration()`：看题基准 3s + 0.09s/字符 + 3s/空，× 档位 × 倍率；占位符不计字符 |
| 键盘状态机（纯函数） | `src/lib/cloze-input.ts` | ←→ 选词光标、1–9 快选、Enter 填入、Tab/↑↓ 换空、Backspace 撤回/回退；填入后自动推进到下一个未填空 |
| 默写编排 | `src/lib/use-dictation.ts` | `contentMode="cloze"`：出题 → 只为答案词合成 TTS → 建轮次；组句轮不走语音轨；选完自动提交、倒计时结束按空提交；出题失败给「AI 当前不可用」 |
| 组句轮界面 | `src/components/ClozeView.tsx` | 候选词卡（≤24，已用打勾、光标描边）＋短文卡（内联空槽三态）＋键盘提示行；窗口级键盘监听（无输入框） |
| 结果与历史 | `src/lib/results.ts`、`src/components/ResultsView.tsx`、`src/lib/history-storage.ts` | 每个空一行：判定图标 + 单词 + 发音 + `句子：…（答案已填）` + 右侧「我的选择」；`ResultRow.context` 落历史 |
| 复习写回 | `src/lib/review-service.ts` | 队列返回 `definitions`（组句出题带英文释义）；`buildCommitItems` 覆盖 cloze 行；日志 `mode="cloze"` |
| 准备/完成弹层 | `src/components/ReadyOverlay.tsx`、`src/lib/ready-overlay.ts` | 组句文案改为「N 道题 · 候选词已就绪 · 题序已打乱」（不提语音） |
| 入口接线 | `src/components/WordBank.tsx`、`src/routes/index.tsx` | 模式条第 4 项「组句」（lucide `text-cursor-input`）；组句下「开始书写默写」置灰并显示信息条；`startDictation` 强制 cyber |
| 诊断脚本 | `scripts/get-cloze.mjs` + `pnpm get:cloze` | 走生产 provider 跑真 KEY 的组句回归；输出题目/答案覆盖/耗时/降级诊断，不打印 Key |
| 远端清单（遗留项） | `src/lib/remote-fetch.ts`、`src/lib/bank-catalog.ts`、`src/routes/api/bank-manifest.ts`、`src/routes/api/bank-remote.ts`、`src/components/ManifestUpdateDialog.tsx` | 自定义清单地址 + 增量状态（下载/更新/已是最新）+ 批量更新 |
| TS 基线（遗留项） | `src/lib/icons.tsx`、`vite.config.ts`、`tsconfig.json`、若干测试 | 见下「关键决策 8」 |

## 二、关键决策（含相对 plan 的细化）

1. **组句只允许赛博作答**（崔总 2026-10-12 选「禁用按钮并提示」）：选中组句时「开始书写默写」`disabled` + `opacity-45`，并在错误条位置显示信息条`组句模式请用赛博默写：选词作答需要在屏幕上完成`；`startDictation` 里再兜一层（即使被其它入口调用也强制 `cyber`）。
2. **本场候选池 = 词表前 24 词**（崔总选「本场只取前 24 词」）：超出部分不进本场，队列重算后自然轮到下一场；每轮都显示同一个候选池（它是「干扰项池 + 答案池」）。
3. **音频只为答案词生成**（崔总选「只为答案词」）：AI 出题并校验通过后才知道答案词（去重 ≤16），比全候选池省时；**组句轮本身不播语音**，音频只服务结果页发音按钮。TTS 失败**不阻塞本场**（降级为空表 + 结算页提示「结果页的发音按钮不可用」）。
4. **组句轮不新增引擎分支**：`dictation-engine` 一行没改——组句轮在 `startRound` 里直接 `speech-end`（语音轨视为已完成），于是
   - 倒计时结束 + 输入未完 → 现有「自动提交未填项」逻辑照旧；
   - 选完所有空 → `inputDone` + `speechDone` → 现有 cyber 规则立即推进（不等倒计时）。
   这样「双轨制」的既有语义完全复用，bug 面最小。
5. **每空一行（而不是每题一行）**：结果页沿用既有的 `ResultRow` 结构，一个空 = 一行（`word` 是答案词），并新增可选的 `context`（该空所在句、答案已填入）。好处是判定、发音按钮、历史回看、复习写回四件事全部复用既有通道；同一个词被两个空用到时各自独立计分。
6. **候选池随队列带释义**：`buildQueueForBank` 增加 `definitions`（只含队列里出现且有英文释义的词）。词表模式出题时把释义一起给 AI（选义项更准）；录入模式没有释义也能出题，不额外发请求。
7. **数据落盘沿用 Phase 1**：复习日志多了一个 `mode="cloze"` 取值，字段与 `FUTURE.md` 要求一致（`elapsedMs` 仍是「每轮实际耗时」= 整题耗时，逐空不再细分）。题目**不落盘**（R7）。
8. **TS 基线修复**（Phase 1 遗留）：`icons.tsx` 从 `lucide-solid/dist/source/icons/*.jsx` 深路径改为包的 `lucide-solid/icons/*` 子路径（该子路径同时带 `types` 与 `solid` 条件，指向同一个单文件），vite alias 同步改为 `/^lucide-solid\/icons\//`，删掉已失效的 `icons.d.ts`。顺带修掉全仓 `tsc --noEmit` 的其余报错（`definition-provider` 里两个不存在的类型名、`ai-pair-service` 联合类型未收窄、`SegmentedSlider` 的 Icon 组件、`chinese-word-service` 的 storage 形状、4 个测试文件的类型），并给 tsconfig 加 `skipLibCheck`（第三方 `.d.ts` 噪音）。现在 **`pnpm exec tsc --noEmit` 零报错**（`pnpm check` 目前不含 tsc，见 FUTURE）。
9. **远端清单放在「检查清单更新」弹层**（对 plan §D3-2「设置里填写」的偏差，已与崔总确认）：设置面板当前总高 779/820，再加一张卡会溢出；入口放在「选择词表」底部，正好是使用它的地方。地址仍持久化在 `mds.settings.v1` 的 `bankManifestUrl`。
10. **远端抓取一律走服务端**：只允许 http(s)、拒绝带用户密码的 URL、**拒绝本机/内网/链路本地/保留地址**（主机名先 DNS 解析再逐地址判断）、手动跟随跳转（每跳重新校验、最多 3 跳）、15s 超时、响应体上限（清单 1 MiB / 词库 32 MiB）、必须能 `JSON.parse`。远端词库文件的 `source` 被强制改写成 `remote`（只读资源词表）。
11. **增量 = 版本比较**：`mergeCatalog` 用「本地 version < 远端 version → 更新」，不做字段级 diff（plan 里提到的 sha256 校验留作后续，见 FUTURE）。下载失败/清单不可用都只提示，不阻塞内置清单使用。
12. **顺手修掉一个真 bug**：`useDictation` 的 `currentRound` 原本是 `createMemo`，在非追踪上下文（如测试、事件回调）里读到的是旧值/undefined；改为普通派生函数（与 `resultRows` 同一处理，注释里写清了原因）。

## 三、接口与契约

```text
POST /api/cloze
  { candidates: [{word, definition?}] | words: string[], baseUrl, apiKey, model }
  → { items: [{ id, sentences: ["… ##1 …"], blanks: [{index, answer}], usedWords }] }
  → { error: "invalid-response" | "http" | "network" | "timeout" | "empty", message }
  候选上限 24（超出取前 24）；失败一律不降级

GET /api/bank-manifest?url=<encoded>
  → { banks: [{ id, name, count, version, url(绝对), description?, license? }] }
  → { error: "invalid-url" | "blocked-host" | "http" | "network" | "timeout" | "too-large" | "invalid-body", message }

GET /api/bank-remote?url=<encoded>
  → { bank }（source 强制为 remote；交给 /api/bank-import 落库）
  → { error, message }

GET /api/review-queue?bankId=&target=
  → { bankId, queue{...}, definitions: Record<string,string>, doneWords, progress }
```

## 四、验证证据

| 项 | 结果 |
| --- | --- |
| `pnpm test:run` | **57 文件 / 566 用例全过**（新增 ~100 条：出题契约边界、provider 失败分类、时长计算、键盘状态机、组句编排、结果/历史、队列释义、cloze 写回、清单解析、SSRF 防护、CLI 回归） |
| `pnpm exec tsc --noEmit` | **0 报错**（HEAD 时有 35 + 30 条） |
| `pnpm check` | 全绿（vitest → 生产构建 → 生产冒烟） |
| 生产构建真实 HTTP（独立数据目录 + 本地 stub AI 服务） | ① 组句正常出题 ✓；② 契约不过 → `invalid-response：…「made-up-word」不在候选词里` ✓；③ 空候选 → 400 ✓；④ 清单 SSRF：`127.0.0.1` → blocked-host、`ftp://` → invalid-url、`localhost` → blocked-host ✓；⑤ 带释义资源词表导入 → 队列 `definitions` 正确 ✓；⑥ cloze 写回：卡片 + 日志（mode=cloze，FUTURE 字段齐全）+ 今日进度 done=2/correct=1/elapsedMs=6000 ✓；⑦ 队列重算：已默词打勾、剩下 banana ✓ |

未做自动化验证：**在浏览器里真跑一遍界面**（组句轮的键盘流、结果页、清单弹层）——按项目口径留给人工验证；`pnpm get:cloze` 的 20 词真实 Key 回归也留待有 Key 时跑（脚本已就绪）。

## 五、已知问题与遗留

1. **没有「下一场」入口**（本轮口径：候选池只取前 24 词）。今天设 30 → 跑完第一场后队列剩 6 词，需要用户自己再点一次开始。
2. **清单每次进词表模式都会重拉**：`refresh()` 里同步拉自定义清单（无缓存、无 ETag/If-Modified-Since），网络慢时会拖慢词表弹层的打开。
3. **没有 sha256 校验**：plan 里的「比对 version/sha256」只做了 version 比较；远端清单若同版本换了内容不会被发现。
4. **组句结果页的句子不可试听**：只有逐词发音按钮；整句朗读（TTS 整句）没做。
5. **`pnpm check` 不含 tsc**：类型零报错靠手动跑 `pnpm exec tsc --noEmit`（建议纳入 check，见 FUTURE）。
6. 组句轮的「候选池」在录入模式下没有释义可用（用户手敲的词表），出题质量依赖 AI 常识；想要更稳就把词放进有释义的词表。

## 六、给未来的接口

- 出题契约与校验都在 `cloze-parse.ts`；改 prompt 时**先改这里的规则和测试**，provider 会自动按新规则拒绝不合规输出。
- `ResultRow.context` 是组句的句子上下文；历史/结果页已支持，其它模式不填。
- 组句的日志保留 `genMode=cyber`、`queueKind`、`elapsedMs`（= 整题耗时）——将来要做「每空耗时」需要先改 `roundElapsed` 的粒度。
- 远端清单的抓取入口是 `remote-fetch.ts`；要加「镜像/多地址回退」只需在这里加一个候选地址列表，路由与界面不用改。
