# 已完成

> 只放已收口的工作：摘要、证据指针、历史附录。
> 不在这里重述规格（给指针），也不留未完成项。进度不写在这里（`todo` 工具负责）。

## 2026-08-02 第一轮：从 deno desktop 到可跑的默写工具

状态：**已收口**（原 `PLAN.md` 的 `Steps` 全部完成、`Verification` 全部通过）。

- 交付：词库录入（回车添加 / 瀑布流 / 清空 / 单删 / 批量导入）、设置面板（AI baseUrl+key、倍率调整、倒计时数字开关）、服务端 TTS（按词缓存 + 文件名转义 + 中止）、服务端释义（一次调用全部词）、默写流程（准备 → Let's Go → 逐轮 → 结果）、双轨推进、赛博两步输入、结果页对照与撒花。
- 形状变化：该轮的验收口径（`pnpm build`、`deno desktop` 冒烟、`pnpm test` 全绿）建立在 deno desktop 之上，**随后被 D-2 取代**；仅「`pnpm test` 覆盖纯逻辑（timing / match / state / tts-filename）」这条仍然有效。
- 证据：`.implementation-report/` 下 2026-08-01 ～ 2026-08-03 的 15 份报告；收口核对见 `specs/PLAN.md` §原 `PLAN.md` 的收口核对；决策记录见 `.agents/memory/ARCHITECTURE.md` D-1、D-3、D-4、D-6～D-8。

## 2026-08-02 第二轮：web 性能 + 桌面端调研

状态：**已收口**（`实施计划（待审批）` 的 A、B 两条路径都已落地）。

- A. web 优化：`src/lib/icons.tsx` 按需 re-export + `vite.config.ts` alias；字体本地化到 `public/fonts/`；删除未引用的 `src/components/CountdownBar.tsx`。改了 dev 载入与 build 体积，业务逻辑零改动。
- B. 桌面端：放弃 deno desktop，切 electron + electron-builder（详见 `.agents/memory/ARCHITECTURE.md` D-2）。
- 证据：`.implementation-report/2026-08-02-research-web-desktop.md`、`.implementation-report/2026-08-02-project-scripts.md` 等 2026-08-02 报告；收口判定逐条列在 `specs/PLAN.md` §原 `PLAN.md` 的收口核对；决策见 `.agents/memory/ARCHITECTURE.md` D-9、D-2。

证据链口径（写在这一次，不在别处重复）：`.agents/implementations/` 自 2026-11-15（框架 v1 采纳）起才承接新记录，此前所有改动的证据只在 `.implementation-report/` 与 `git log`。

## 2026-08-03 ～ 2026-11-15：持续迭代（按里程碑给指针，不在此转述）

- 已收口的功能轮各有实施报告，按日期在 `.implementation-report/` 里：
  - 释义/中文词 AI 批改、NSIS 安装包：`2026-08-03-*.md`
  - 词库 + FSRS（phase1/phase2）、PET 词库、组句放宽：`2026-10-12-*.md`、`2026-10-13-*.md`
  - Edge TTS v2 + 水合崩溃、短句模式、学习档案：`2026-10-17-*.md`、`2026-10-18-*.md`
  - 音标模式、取词批次口径：`2026-10-23-phonetic-mode.md`、`2026-10-24-batch-queue-semantics.md`、`2026-10-28-*.md`
  - 混合模式：`2026-11-09-mixed-mode.md`
  - 一键发版 + 评审、FUTURE A/B 清理：`2026-11-14-*.md`、`2026-11-15-*.md`
- 版本史：`docs/release-notes/1.0.0.md`、`docs/release-notes/1.0.1.md`；`git log` 里每条 `feat:`/`fix:` 提交对应一轮。
- 证据指针：上述报告仍在 `.implementation-report/`（只读历史档，见 `AGENTS.md` §开发目录定义）；本段之后的新证据进 `.agents/implementations/`，当前状态口径见 `specs/PLAN.md` §现状。

## 历史附录：agent 框架 v1 采纳（2026-11-15）

- 做的事：`PLAN.md` → `specs/PLAN.md`；装 `.agents/`（契约、signpost、memory 种子、state）；`AGENTS.md` 顶部加记忆契约 + 计划/记忆索引；原 `PLAN.md` 的决策记录迁到 `ARCHITECTURE.md`、已收口内容压到这里；迁移覆盖表见 `.agents/framework/reports/coverage-2026-11-15T04-15-23-08-00.md`。
- 未做（明确留给后续，见 `specs/PLAN.md` 未收口项）：`AGENTS.md` 超预算的正文瘦身、根 `FUTURE.md` 与 `.agents/memory/FUTURE.md` 的合并、`.implementation-report/` 的归档策略。
