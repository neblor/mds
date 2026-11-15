# 架构与决策

> 分层、版本基线、决策记录（背景 / 决定 / 后果 / 日期）与调研存档。一个事实一个家。
> 未收口的工作在 `specs/PLAN.md`；已收口的工作在 `FINISHED.md`。

## 分层

证据：目录与文件本身 + `package.json`（2026-11-15 实测，未做运行验证）。

| 层 | 落点 | 读到的证据 |
| --- | --- | --- |
| 界面（Solid 组件） | `src/components/*.tsx`（22 个） | 另有 1 个 `SettingsPanel.test.ts`；`WordBank` / `DictatingView` / `ResultsView` / `SettingsPanel` / `PhoneticView` 等 |
| 路由与页面 | `src/routes/index.tsx`、`src/routes/phonetic-symbols.tsx` | SolidStart 2.0 路由约定 |
| HTTP 适配层 | `src/routes/api/*.ts`（20 个非测试路由） | `tts` / `definitions` / `sentences` / `cloze` / `phonetics` / `answer-grade` / `review-queue` / `review-commit` / `audio` / `bank-*` |
| 业务与纯逻辑 | `src/lib/*.ts`（156 个文件，其中 76 个 `*.test.ts`） | `timing` / `match` / `state` / `mixed-mode` / `review-service` / `edge-tts-*` / `*-provider` / `*-service`；全仓 `src/` 共 215 个 `.ts`/`.tsx`、87 个测试 |
| 桌面壳 | `electron/main.mjs`、`electron/port-picker.mjs`、`electron/runtime-paths.mjs`、`electron/window-options.mjs` | 共 323 行；`package.json` `"main": "electron/main.mjs"` |
| 工具与诊断脚本 | `scripts/*.mjs`（23 个） | 由 `package.json` 的 `scripts` 逐条调用 |
| 数据（运行时，不入库） | `.mds-data/word-cache`（Web）、`userData/mds-data`（Electron）、`mds-data/review/review.sqlite` | `AGENTS.md` §项目输出形式；`.gitignore` 忽略 `.mds-data/`、`voice-cache/`、`public/word-cache/` |

关键分层约束（违反会退化或崩溃，原话除非另注出处）：`src/lib/review-service.ts` 及其依赖**不得 import `node:*`**（浏览器端复用 `buildCommitItems`，曾导致 Vite dev 下整页 externalized、水合失败）；`node:sqlite` 只能经 `process.getBuiltinModule` 运行时获取。详见 `AGENTS.md` §系统基础功能 §词库 / 复习 / 学习档案。

### 界面状态机（现行口径）

- 阶段：`Phase = "idle" | "preparing" | "ready" | "dictating" | "results"`（`src/lib/state.ts`）。原 `PLAN.md` 写的 `idle → preparing → ready → dictating → finished → results → idle` 已没有 `finished` 这个阶段（2026-11-15 复核）。
- 推进双轨：倒计时结束只置 `countdownDone`，音频播完只置 `speechDone`，两者都成立才进下一轮（`AGENTS.md` §系统基础功能「倒计时与跳转到下一轮的概念」）。
- 赛博两步输入（带释义时）：先单词回车 → 屏上显示 → 再释义回车 → 两者消失进下一轮（`AGENTS.md` §系统基础功能）。

## 版本基线（2026-11-15 实测）

| 项 | 值 | 来源 |
| --- | --- | --- |
| 应用版本 | `1.0.1` | `package.json` `version`（唯一数据源） |
| 包管理 | pnpm 12.14.0；`pnpm-lock.yaml` `lockfileVersion: '9.0'` | `pnpm -v`；lockfile 首行 |
| Node | 本机 v26.5.0；`engines.node: ">=24"` | `node -v`；`package.json` |
| 桌面运行时 | electron `^43.2.0`；electron-builder `^26.15.3` | `package.json` `devDependencies` |
| 框架/构建 | `@solidjs/start` `^2.0.0-rc.6`、vite `^8.0.0`、nitro `^3.0.260610-beta`、tailwindcss `^4.0.7` | `package.json` |
| 测试 | vitest `^4.1.10`，入口 `scripts/run-vitest.mjs` | `package.json` `scripts.test:run` |
| 类型检查 | typescript `^6.0.3`，`tsc --noEmit` | `package.json` `scripts.typecheck` |
| 许可 | MIT，Copyright (c) 2026 neblor | `LICENSE` 首三行 |
| CI | 仓库内**没有** CI 配置（无 `.github/`） | 目录检查 |
| 远程 | `origin` = `git@github.com:neblor/mds.git`，分支 `master` | `git remote -v`、`git branch --show-current` |

## 决策记录

格式：背景 / 决定 / 后果 / 日期。只追加；被取代时标「已被取代」并链到取代者。原 `PLAN.md`「用户已确认的决策」表与「调研结论」中的结论性内容迁到这里，原处只留指针。

### D-1 包管理与构建工具链 —— pnpm + vite（生效）

- 背景：规划段比较过「deno 管一切」与「pnpm 管依赖、vite 构建」。
- 决定：**pnpm 管依赖 + vite 构建**，不迁移到 deno 包管理。
- 后果：所有开发/测试/构建/运行/打包命令从项目根通过 `pnpm` 执行；命令清单见 `AGENTS.md` §项目脚本。
- 日期：2026-08-02（来源 原 `PLAN.md` 2026-08-02「用户已确认的决策」表；该表已迁入本文件，`specs/PLAN.md` 只留覆盖说明）。

### D-2 桌面输出方案 —— 从 deno desktop 改为 electron + NSIS（生效）

- 背景：deno desktop 交叉编译可行，但 Windows webview 后端有未修 bug（`denoland/deno` #35645/#35562/#35590 空窗口/启动失败），CEF 后端 ~150 MB 无体积优势，且无 MSI/自动更新；调研详见 `.implementation-report/2026-08-02-research-web-desktop.md`。
- 决定：切 electron（内置 nitro server + BrowserWindow）+ electron-builder，Windows 输出 NSIS 安装包。
- 后果：`electron/*.mjs` 成为桌面壳；`deno.json` 方案作废（见本文件「调研存档」）。当前输出形态见 `AGENTS.md` §项目输出形式。
- 日期：2026-08-02（来源 原 `PLAN.md` 2026-08-02「实施计划（待审批）」§B 方向 1，已实施）。

### D-3 对错判定口径（生效，按模式分叉）

- 背景：最初只有单词模式，定为「严格匹配」。
- 决定：
  - 单词：`isStrictMatch` —— trim 首尾空白后**完全相等**（大小写/标点/中间空格都算错）。
  - 短句：`isSentenceMatch` —— 小写 → 去所有标点 → 压空白后全等（崔总 2026-10-17 定）。
  - 释义 / 中文词：AI 批改，失败降级本地宽松匹配。
  - 只有赛博（有输入）才判对错；书写场次不判、不进 SRS。
- 后果：`src/lib/match.ts` 是唯一判定入口；短句模式不调 AI 批改。
- 日期：2026-08-02 定单词口径；2026-10-17 加短句口径（来源 `src/lib/match.ts` 文件头注释）。

### D-4 播报遍数 —— 释义 3 遍、非释义按长度 2/3 遍（生效）

- 决定：`repeatCount(word, withDefinition)`：释义模式必 3 遍；非释义 <6 字母 2 遍、≥6 字母 3 遍。
- 后果：`src/lib/timing.ts` `repeatCount` 是唯一实现；音标模式复用 `repeatCount(word,false)`。
- 日期：2026-08-02（来源 原 `PLAN.md` 决策表；2026-11-15 复核实现一致）。

### D-5 每轮时长公式（已被取代，按模式各自演进）

- 背景：2026-08-02 的初版公式 `max(书写估算, 音频时长×遍数) + 1.5s`，书写估算 0.45s/字母、三档 ×0.6/×1.0/×1.8、释义 +词数×0.5s。
- 决定：**该轮公式作废**，现行口径见 `src/lib/timing.ts`：单词轮 `THINK_SECONDS=2`、`LETTER_SECONDS=0.3`、释义段 `DEF_THINK_SECONDS=5` / `DEF_LETTER_SECONDS=0.4`、`SPEED_RATE` 快 0.85 / 中 1.0 / 慢 1.3，最终 ×倍率调整；短句轮、音标轮、组句轮各用自己的基础公式（`SENTENCE_*`、`phoneticCountdownDuration`、`CLOZE_*`）。
- 后果：调时长**改基础公式**，不靠倍率硬拧（短句/音标模式在 `AGENTS.md` 里已写明这条）。双轨推进（倒计时轨 / 音频轨各自置位，两者都结束才进下一轮）保持初版设计不变。
- 日期：2026-08-02 初版；2026-11-15 复核为已取代（证据 `src/lib/timing.ts` 常量）。

### D-6 TTS 必须在服务端合成（生效）

- 背景：Microsoft TTS 需自定义 WebSocket header，浏览器环境除 Edge 外连不上。
- 决定：合成只发生在服务端 route，前端只 `<audio>` 播放；`edge-tts-universal` 于 2026-10-17 被项目内自研 provider 取代（v2 `Sec-MS-GEC` 令牌；旧库仍是 v1 令牌且握手失败时请求永不返回）。
- 后果：`src/lib/edge-tts-token.ts` + `src/lib/edge-tts-client.ts` 是生产实现；排障先跑 `pnpm get:tts <word>`。
- 日期：2026-08-02 定服务端合成；2026-10-17 换掉库（来源 `.implementation-report/2026-10-17-edge-tts-v2-and-hydration-crash.md`）。

### D-7 AI 释义：一次请求返回全部单词的 JSON（生效）

- 决定：标准 OpenAI 兼容接口，服务端 fetch（避 CORS、不暴露 Key），一次请求返回所有单词的英文释义 JSON。
- 后果：必须完整错误处理（配置缺失 / 网络失败 / 超时 / 用量耗尽）不卡死界面并提供中止；只写正缓存，不写负缓存。
- 日期：2026-08-02（来源 原 `PLAN.md` 决策；实现见 `src/lib/definition-provider.ts`、`src/lib/definition-service.ts`）。

### D-8 设置持久化 —— localStorage（生效）

- 背景：初版把「localStorage 不持久」列为风险，备选是服务端写 exe 同目录 JSON。
- 决定：用 electron 的 localStorage 持久化（落到 `userData`）；无确认按钮，变更即同步界面状态，`es-toolkit` 防抖 1.5s 写入，关闭面板/退出时立即提交。
- 后果：回退方案未采用；设置项清单见 `AGENTS.md` §系统基础功能。
- 日期：2026-08-02 初版；2026-11-15 复核已改为防抖写入（证据 `AGENTS.md` §系统基础功能）。

### D-9 web 性能：lucide 深路径入口 + 字体本地化（生效）

- 背景：dev 慢的元凶是 `lucide-solid` 的 `"solid"` 条件解析到全量源码入口（2 MB 全量载入），不是字体（268 KB）。
- 决定：`src/lib/icons.tsx` 按需 re-export + `vite.config.ts` alias；字体本地化到 `public/fonts/`；删掉死代码 `CountdownBar.tsx`。
- 后果：build 产物体积健康（当时实测客户端总 JS 88 KB）；新增图标必须同时加进 `src/lib/icons.tsx`。
- 日期：2026-08-02（来源 原 `PLAN.md` 2026-08-02「实施计划」§A；2026-11-15 复核三项均已落地）。

## 调研存档：deno desktop（2026-08-02，已被 D-2 取代）

保留原因：结论里仍有可复用的判断依据；实现细节全部作废。原 `PLAN.md` 的「技术调研结论」与「架构」两节内容只留在这里。

- `deno desktop` 需 Deno v2.9.0+（调研时本机 deno 2.9.4）；检测 `package.json` 的 `@solidjs/start`，把框架构建产物当 `Deno.serve()` handler，webview 指本地 HTTP。
- 交叉编译：`deno desktop --target x86_64-pc-windows-msvc .` 可在 Linux 产出 Windows 目录（`.bat` 启动器 + `denort.dll` + CEF 库）。
- 体积元凶：打包缺 `--exclude-unused-npm` 会把 lockfile 里全部 npm 快照嵌入（当时 node_modules 253 MB）。
- **否决点**：Windows webview 后端 bug 未修（见 D-2）；CEF 稳定但 ~150 MB 无优势；无 MSI/自动更新。
- 作废的架构草案：`deno.json` desktop 块 + `/api/tts`、`/api/audio/:file`、`/api/definitions`、`/api/settings` 四个 route 的 deno 内托管图。现行 route 清单见本文件「分层」。

## 已知漂移（2026-11-15 读到，未改原文，待崔总确认）

| 位置 | 读到的原文 | 实测证据 | 处置 |
| --- | --- | --- | --- |
| `AGENTS.md` §技术选型 | 用「DaisyUI + HeadlessUI」快速拼组件 | `package.json` 与 `pnpm-lock.yaml` 均无 `daisyui` / `@headlessui/solid` | 待确认：是真的要补装，还是这条选型已放弃 |
| `AGENTS.md` §项目脚本 | 未提及 `build:banks`、`build:pet-words`、`get:cloze` | 三者都在 `package.json` `scripts` 里 | 待补文档（见 `specs/PLAN.md` 未收口项） |
| 原 `PLAN.md` 决策表（时长公式） | 0.45s/字母、三档 ×0.6/×1.0/×1.8 | `src/lib/timing.ts` 是 0.3s/字母、×0.85/×1.0/×1.3 | 已按「被取代」归档（D-5） |
