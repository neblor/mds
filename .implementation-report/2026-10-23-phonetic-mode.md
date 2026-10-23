# 音标模式实施报告（2026-10-23）

> 方案：`plans/phonetic-mode.md`；音源调研：`plans/phonetic-audio-research.md`；
> 设计：`.design/phonetic-mode.md` + 四张 Web 实机截图。
> 本文只记录「实际做了什么、为什么这样做、验证到什么程度、还剩什么」；
> 后续项统一登记在 `FUTURE.md` §十。

## 一、交付结果

音标模式已可完整跑一场：选词 → 准备（词典/可选 AI 兜底 + TTS）→ 准备完成 →
看单词点选音标（chip 左移除/右喇叭、池子左放入/右试听）→ 提交/超时自动提交 →
结果页（标准/我的 token 都带喇叭、对错底色、单词发音、音标表入口）→ 关闭回词库。
默写中可 F1/按钮打开独立全屏音标表，倒计时与音频冻结，关闭后从当前这一遍恢复。

**已完成**：`.design/mds.pen` 第六批 **33–36** 已切（33 词库页、34 音标轮、35 结果、36 全屏表）。

**未完成项**（已登记 `FUTURE.md` §十）：
1. Electron 全屏窗口在 Windows 包上的平台验证（Web 弹窗/暂停已实机验证）；
2. 真实 AI 20 词音标回归/人工抽检（provider/service 单测已绿）；
3. 音素音频质量复核（Commons 辅音带元音上下文、双元音为拼接）；
4. 设计反馈（#1/#2 已改；#3/#4 保持）；
5. 历史结果页的音标表按钮、IPA θ 字形回退、音标轮键盘 E2E。

## 二、关键决策（沿用方案 + 本轮落定）

| 决策 | 结果 |
| --- | --- |
| 数据源 | 内置 Britfone 3.0.1（MIT）+ AI 兜底；ECDICT 弃用（`the→ðә` 等不可靠） |
| 词典形态 | `public/ipa/en-gb.v1.json`，token 数组；15,194 词 / 16,172 读音；PET 单条词覆盖 93.7% |
| 重音 | 构建期「最大音节首」归位；判定两端再归位；主重音严格、次重音忽略 |
| 音标池 | 答案 token 多重集合 + 4–6 个易混干扰项；按池内 index 记录使用，重复 token 不联动置灰 |
| 作答 | 只允许赛博；书写按钮置灰 + 信息条 |
| 音素音频 | Wikimedia Commons 真人 + 双元音拼接；45 个 MP3 / 323 KB / 37 源；CC BY-SA 4.0 |
| 音色 | 音标轮优先 en-GB（用户已是 en-GB 则尊重，否则 Sonia）；设置补 3 个 en-GB 选项 |
| 缺失词 | 词典未收录 → AI 兜底（配置了才请求）→ 仍缺失降级 WordRound；不中止本场 |
| AI 缓存 | 独立 `phonetics.json`；model + promptVersion 身份；不写负缓存；写后复读 |
| 全屏表 | 独立 `/phonetic-symbols`；Electron `setWindowOpenHandler` 无边框全屏子窗口；Web 弹窗 |
| 暂停 | 倒计时冻结、音频 abort；关闭从当前遍恢复；暂停时长不计入 `elapsedMs` |
| 结果写回 | 有 `phonetic` 字段的行记 `phonetic`，降级词记 `word`；场次仍记 `phonetic` |

## 三、实现落点

### 数据与脚本

- `public/ipa/phonetic-symbols.png`（3600×2400，按原图复制）
- `public/ipa/en-gb.v1.json` + `LICENSE-britfone.txt` + `README.md`
- `public/ipa/audio/v1/`：45 MP3 + `manifest.json` + `LICENSE.md` + `preview.html`
- `scripts/build-phonetics.mjs`（`pnpm build:phonetics`）
- `scripts/build-phoneme-audio.mjs`（`pnpm build:phoneme-audio`）
- `scripts/data/phoneme-audio-sources.json`
- `scripts/get-phonetics.mjs`（`pnpm get:phonetics`，不写缓存、不打印 Key）
- `THIRD_PARTY_NOTICES.md`

### 纯逻辑

- `src/lib/phonetic-symbols.ts`（47 token：44 音 + happy i + 重音）
- `src/lib/phonetic-parse.ts`（清洗、最长匹配、最大音节首归位、校验、多读音）
- `src/lib/phonetic-match.ts`（判定、LCS diff、最佳变体）
- `src/lib/phonetic-pool.ts`（多重集合 + 干扰项 + 可注入 shuffle）
- `src/lib/phonetic-dictionary.ts`（懒加载/查找/坏条目过滤）
- `src/lib/phoneme-audio.ts` + `use-phoneme-audio.ts`（单例播放器 + Solid 生命周期）
- `src/lib/phonetic-chart.ts`（内部路径、打开、postMessage + 轮询关闭）
- `src/lib/phonetic-provider.ts`（AI prompt、严格 JSON/token 校验、对齐/缺失/截断）
- `src/lib/phonetic-service.ts`（缓存命中/只补缺失/写后复读/不写负缓存）

### 流程与界面

- `src/lib/use-dictation.ts`：`PhoneticRoundData`、`preparePhonetic`、音标计时、音素试听中断/恢复、
  暂停/恢复、`openPhoneticChart`、F1、提交/超时/降级、结果写回。
- `src/components/PhoneticView.tsx`：音标轮面板（chip 左右分区、池子 8 列、roving tabindex、
  Shift+Enter/Backspace/Ctrl+Enter/F1、暂停禁用、焦点恢复）。
- `src/components/ResultsView.tsx`：`PhoneticResultRow`、token 喇叭、单词/音素互斥、
  结果页音标表按钮、`onStopAudio`。
- `src/components/WordBank.tsx`：第 6 项「音标」、滑块 430、书写置灰/信息条、`ModeActions`。
- `src/components/ModeActions.tsx`：音标表 + F1。
- `src/components/PreparingOverlay.tsx` / `ReadyOverlay.tsx`：音标表次按钮。
- `src/routes/index.tsx`：音标轮/降级单词轮分流、`PhoneticView`、结果页 props。
- `src/routes/phonetic-symbols.tsx`：全屏表页面（任意键/点击关闭、暂停提示）。
- `src/routes/api/phonetics.ts` + `src/lib/api.ts#requestPhonetics`。
- `electron/main.mjs` / `electron/window-options.mjs`：同源白名单 + 全屏子窗口。
- `src/lib/cache-storage.ts`：`phonetics.json` 读写。
- `src/lib/settings.ts`：3 个 en-GB 音色 + `phoneticVoice()`。
- `src/lib/timing.ts`：`phoneticCountdownDuration` + 常量。
- `src/lib/results.ts` / `history-storage.ts` / `review-types.ts` / `state.ts` / `ready-overlay.ts` /
  `review-service.ts`：枚举、字段、标签、判定说明、降级写回。

## 四、验证

### 单元测试

`pnpm test:run`：**81 个测试文件 / 852 个测试全绿**。新增/更新的重点：

- `phonetic-symbols`、`phonetic-parse`、`phonetic-match`、`phonetic-pool`
- `phonetic-data`（真实词典 schema/覆盖/样本）
- `phoneme-audio` + `phoneme-audio-data`（45 文件/manifest/许可/播放器）
- `phonetic-dictionary`（懒加载/缓存/失败重试/坏 token）
- `phonetic-provider`（token 数组/字符串、重音归位、坏 token、缺词、截断、HTTP/Key 不泄露）
- `phonetic-service`（缓存命中/写后复读、缺失不写负缓存、model 失效、坏缓存、AI 空结果）
- `phonetic-chart`（路径、轮询关闭、同源 postMessage）
- `electron-window-options`（同源精确路径、全屏选项）
- `results`/`review-service`/`history-storage`/`timing`/`ready-overlay`/`state`/`dictation-input`
  （音标字段、判定、写回、计时、文案、持久化、超时空答案）
- `api`（`playWithIntervals` 的 `startIndex` 从当前遍恢复）

> `phonetic-data` 的全量循环原本接近 5s 默认超时，本轮加了显式 20s 上限（不是放宽断言）。

### Web 实机（Playwright，2026-10-23）

- `pnpm web:dev` → 录入 `apple` → 选「音标」：书写按钮置灰、信息条、`音标表` 出现；
- 开始赛博 → 准备完成文案「1 个单词 · 语音已就绪 · 顺序已打乱 · 看单词拼音标」；
- Let's Go → 音标轮：单词 apple、倒计时 12.6、池子/答案条/键盘提示；
- 点 `ˈ æ p ə l`：chip 左移除/右喇叭、池子已用置灰、`5 / 5`；
- 超时自动提交空答案 → 结果 0 / 1，浅红、我的「未填写」；
- 正确提交 → 结果 1 / 1，浅绿、标准/我的 token 都带喇叭；
- 结果页「音标表」→ 新标签 `/phonetic-symbols`，图片完整；Esc 关闭回结果；
- 默写中 F1 → `/phonetic-symbols?paused=1`，提示「默写已暂停」；等 3s 关闭后倒计时从 12.6
  变为 10.3（暂停的 3s 未计入，恢复后只走了约 2.3s），音频从当前遍继续；
- 点 chip/pool 喇叭、结果页单词/音素喇叭均无控制台错误（听感由崔总人工确认）。
- 2026-10-23 反馈后：池子改为 125px 固定宽度 tile 自动换行（8 列）、`min-height 232`；
  单词/答案/池子整体顶部对齐；底部操作条绝对贴底/`bg-canvas`/`z-20`；截图
  `.design/phonetic-mode-dictating-new.png`。

截图：`.design/phonetic-mode-dictating.png`、`-dictating-filled.png`、
`-result.png`、`-result-empty.png`。

### 交付检查

`pnpm check`：Vitest → Web 生产构建（含 `/phonetic-symbols`、`/api/phonetics`）→
生产冒烟 HTTP 200 全部通过。

## 五、本轮修过的关键坑

1. **暂停时 abort 音频会误推进赛博轮**：`audio-state(false)` 在 `inputDone=true` 时会被状态机
   判成「间隔区」直接下一轮。`runStep` 在 `paused()` 时一律 no-op；音素试听打断则只忽略
   `audio-state`，提交/倒计时仍处理。
2. **音素播完恢复**：连续点多个喇叭只在最后一个播完后 120ms 去抖恢复；`playWithIntervals`
   新增 `startIndex`，从当前遍继续且 `onPlay` 仍回报绝对下标。
3. **`clearRoundRuntime` 要停音素**：否则上一轮的 chip 试听会带到下一轮；同时清
   `phonemeResumePending`，避免换轮后又恢复旧音频。
4. **降级词按轮 kind 渲染**：音标场次里的 WordRound 走普通单词输入（`displayContentMode`），
   结果页仍按场次 `phonetic` 显示总判定说明并标注降级。
5. **结果页单词/音素互斥**：`ResultsView` 自带音素播放器，点 token 前 `onStopAudio()`，
   点单词前 `phoneme.stop()`；历史回看复用同一组件。
6. **AI 兜底不写负缓存**：只缓存通过白名单/重音校验的音标；缺失词下次仍会请求；
   `model`/`promptVersion` 变化让 `phonetics.json` 失效；写后复读校验。
7. **工程守卫**：`icons.tsx` 补 `AudioLines`/`LayoutGrid`；`ReadyOverlay` 补 `Show`；
   `window.open` 固定内部路径并加 `pi-lens-ignore` 说明；`stopChartWatch` 在卸载时清理；
   `phonetic-data` 全量测试显式超时。

## 六、后续

全部登记在 `FUTURE.md` §十，摘要：

- `.pen` 第六批 33–36 已完成；设计 4 点已于 2026-10-23 定稿；
- Electron 全屏窗口 Windows 平台验证；
- 真实 AI 20 词音标回归/人工抽检；
- Commons 音素音频质量复核/备选音源；
- 历史结果页音标表按钮、θ 字形回退、音标轮键盘 E2E。

## 六点五、2026-10-23 第三方评审修复

评审中发现两处问题（均在本轮改动范围内），已修复并补测：

1. **方向键上下步长与真实列数不一致（本轮引入）**：`columns` 原先按硬编码 `tile=125/gap=8`
   计算，样式一改就漂。改为 DOM 实测（`[data-pool-tile]` 的 `offsetWidth` +
   `getComputedStyle(pool).columnGap`），算法抽成纯函数 `columnsForWidth()` 放进
   `src/lib/phonetic-pool.ts` 并补 4 条单测（1120=8 列、1056 边界、747=5 列、异常输入）。
2. **放入后焦点掉到 body，键盘流第一块就断（既有缺陷，同一功能内）**：tile 放入即
   `disabled`，`disabled` 元素无法保持焦点，实测 `Enter` 放入后 `activeElement === BODY`，
   之后方向键/Enter 全部失效。改为：放入后焦点顺延到下一个未用块；全放完落根容器
   （`tabIndex=-1`，仍能收 Ctrl+Enter/Backspace/Delete/F1）；`clear()` 后焦点回池子第一块；
   `focusTile()` 逐级兜底（目标块 → 任一可用块 → 根），关表恢复时也不会落到已用的块上。
   实测（747×547，5 列）：`Enter` 连续放入焦点 0→1→2→3→4→5，`Delete` 后 chips=0 且焦点回 0，
   `ArrowDown` 从 0 → 5。

范围外但记录：池子被底部操作条遮挡时，被遮住的 tile 仍可 Tab 聚焦（当前池子上限 20、
实际到不了遮挡状态），已登记 `FUTURE.md` §十.1b。

## 七、文件清单（新增/修改）

新增：
`public/ipa/`（图/词典/音频/许可/README）、`scripts/build-phonetics.mjs`、
`scripts/build-phoneme-audio.mjs`、`scripts/data/phoneme-audio-sources.json`、
`scripts/get-phonetics.mjs`、`src/lib/phonetic-{symbols,parse,match,pool,dictionary,chart,provider,service}.ts`、
`src/lib/use-phoneme-audio.ts`、`src/components/PhoneticView.tsx`、
`.design/phonetic-mode-dictating-new.png`、
`src/routes/phonetic-symbols.tsx`、`src/routes/api/phonetics.ts`、
`src/lib/phonetic-*.test.ts`、`src/lib/phoneme-audio*.test.ts`、
`src/lib/use-phoneme-audio` 无独立测试（薄 hook，播放器已测）、
`.design/phonetic-mode.md`、`.design/phonetic-mode-*.png`、
`plans/phonetic-mode.md`、`plans/phonetic-audio-research.md`、`THIRD_PARTY_NOTICES.md`。

修改：
`src/lib/{use-dictation,results,review-service,review-types,history-storage,state,timing,ready-overlay,settings,cache-storage,api}.ts`、
`src/components/{WordBank,ModeActions,ResultsView,PreparingOverlay,ReadyOverlay,HistoryScreen}.tsx`、
`src/routes/index.tsx`、`electron/{main,window-options}.mjs`、
`src/lib/electron-window-options.test.ts`、`src/lib/*.test.ts`、
`AGENTS.md`、`FUTURE.md`、`.design/mds.md`、`.design/mds.pen`（33–36）、`package.json`。
