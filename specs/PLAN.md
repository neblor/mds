# 默点啥 mds — 进行中的工作

> 只放**还没收口**的事：路线、待做项、待定问题、预算债务。
> 已收口 → `.agents/memory/FINISHED.md`；决策与调研 → `.agents/memory/ARCHITECTURE.md`；业务层延期项 → 根 `FUTURE.md`。
> 进度不在文档里维护，`todo` 工具是唯一事实来源。

## 现状（2026-11-15 读到）

- 产品：Windows NSIS 安装包应用，当前版本 `1.0.1`（`package.json` `version`）；已有 `docs/release-notes/1.0.0.md`、`1.0.1.md`。
- 技术栈与版本基线：见 `.agents/memory/ARCHITECTURE.md` §版本基线（pnpm 12.14.0 / node ≥24 / electron ^43.2.0 / SolidStart 2.0-rc / vitest ^4.1.10）。
- 内容模式：单词 · 释义 · 中文词 · 短句 · 混合 · 音标 · 组句（7 项，`AGENTS.md` §系统基础功能）。
- 复习状态：`mds-data/review/review.sqlite`（SQLite/WAL + FSRS），schema v1。
- 发版链路：`pnpm release` 已具备（预检 → 构建 → 归档 → tag/push → GitHub Release），无代码签名。
- 工程检查入口：`pnpm check` = `test:run` → `typecheck` → `web:build` → `web:smoke`（`package.json` `scripts.check`）。

## 原 `PLAN.md` 的收口核对（无遗留）

原 `PLAN.md` 两轮工作都已收口，因此本文件没有从它继承任何待做项。逐项证据：

| 原本可能被当成「开放」的项 | 现状证据 | 归属 |
| --- | --- | --- |
| 第一轮 `Steps`（12 项） | 全部 `[x]`，产物落地（`src/lib/timing.ts`、`match.ts`、`state.ts`、`routes/api/tts.ts` 等） | `FINISHED.md` §2026-08-02 第一轮 |
| 第一轮 `Verification` | 与 deno desktop 绑定的口径已随 D-2 作废；`pnpm test` 覆盖纯逻辑这条仍有效 | `FINISHED.md` §2026-08-02 第一轮 |
| 第二轮 §A web 优化（5 步） | `src/lib/icons.tsx` 存在、`vite.config.ts` 有 lucide alias、`public/fonts/` 存在、`src/components/CountdownBar.tsx` 已不存在 | `FINISHED.md` §2026-08-02 第二轮 |
| 第二轮 §B 桌面端（两方向，标「需用户拍板」） | 已拍板并落地：切 electron（D-2），`electron/main.mjs` 为主进程入口 | `ARCHITECTURE.md` D-2 |
| 第二轮 `验证`（dev 请求数、exe 实测） | 一次性人工验收，已在当时完成；不是长期任务 | `FINISHED.md` §2026-08-02 第二轮 |

## 未收口项

### M-1 `AGENTS.md` 预算债务（本轮只登记，不偿还）

- 测量：`framework_audit`（2026-11-15，本轮最终态）报 **49,400**（工具口径按字节计），soft 12,000 / hard 20,000 → 超 soft **37,400**、超 hard **29,400**。
- 分期：装框架前快照（`.agents/framework/snapshots/2026-11-15T04-15-23-08-00/manifest.json`）记 **45,889 bytes**；框架自有 workflow 块 + 记忆契约与索引 + 路径更新共 **+3,511 bytes**（三节正文一字未动）。
- 最大几节（同一工具读数）：§系统基础功能 **12,637**、§项目脚本 **6,507**、§项目输出形式 **1,686**、§开发流程 **1,331**。
- 本轮决定：**不搬迁任何节**（保守轮规则）。偿还路径与触发条件见 `.agents/memory/FUTURE.md` F-1；候选归属：命令/脚本 → §项目脚本 保留索引 + 明细进模块文档；组件清单与视觉参数 → `ARCHITECTURE.md` / `DESIGN.md`；术语与近义口径 → `TERMS.md`。

### M-2 三个脚本没有进入 `AGENTS.md` §项目脚本

- 事实：`package.json` 里有 `build:banks`、`build:pet-words`、`get:cloze`，`AGENTS.md` 的脚本章节一个都没写（2026-11-15 用 `grep '`pnpm …'` 与 `package.json` 比对得出）。
- 待做：补三行说明（各自用途以前置条件），或在「不再维护」时删除对应脚本。归并与 M-1 的瘦身一起做。

### M-3 审计告警的处置

| 告警 | 处置 |
| --- | --- |
| `E-INDEX-01`：`ARCHITECTURE.md` / `FINISHED.md` 未被 `AGENTS.md` 引用 | 已修：`AGENTS.md` 新增计划/记忆索引，四份记忆文件各一行 |
| `W-COV-01`：8 个源小节无去向 | 已修：覆盖表按源快照的 39 个 `##`/`###` 逐行填全（19 found / 20 declared / 0 open） |
| `W-EVID-01`：`FINISHED.md` 有两节没有证据指针 | 已修：两节都补了指向 `.agents/implementations/` / `specs/PLAN.md` 的证据链口径 |
| `W-BUDGET-01`：`AGENTS.md` 超预算 | 转入 M-1（本轮按债务登记，不偿还） |
| `W-STATE-01`：`.agents/memory/` 尚无被跟踪文件 | 已把 `.agents/memory/` 加入 git 索引（`git add`，`git ls-files` 已能看到四份）；**提交由崔总决定**，Agent 不自行 commit |

## 待定问题（需要崔总拍板）

- **Q-1 组件库选型与实况不符**：`AGENTS.md` §技术选型 写「DaisyUI + HeadlessUI 快速拼组件」，但 `package.json` 与 `pnpm-lock.yaml` 里两者都不存在（2026-11-15 实测）。二选一：补装，或把这行改成实况（当前组件全靠手写 Tailwind）。
- **Q-2 根 `FUTURE.md` 的归属**：本轮把它定为业务延期项的唯一登记处，`.agents/memory/FUTURE.md` 只放框架层事项并留指针（避免两个家）。若要整体迁入 `.agents/memory/`，按 `.agents/memory/FUTURE.md` 的触发条件走。
- **Q-3 `.implementation-report/`（45 份历史报告）的归档时机**：现在保持只读、新记录写 `.agents/implementations/`；何时归档见 `.agents/memory/FUTURE.md` F-2。

## 覆盖说明（原 `PLAN.md` 的内容去哪了）

| 原小节 | 去向 |
| --- | --- |
| Context（两轮） | 事实并入本文件 §现状 与 `FINISHED.md`；deno 时代的产物描述已作废 |
| 用户已确认的决策（5 行） | `ARCHITECTURE.md` D-1、D-3、D-4、D-5、D-7、D-8 |
| 技术调研结论（官方文档确认）4 小节 | `ARCHITECTURE.md` §调研存档：deno desktop（已被 D-2 取代） |
| 架构（deno 图） | `ARCHITECTURE.md` §调研存档（作废草案）+ §分层（现行）+ §分层·界面状态机（阶段机/双轨/两步输入） |
| Files to modify / Reuse | `FINISHED.md`（第一轮交付物清单，含未采用的 DaisyUI 待装项 → Q-1） |
| Steps | `FINISHED.md`（进度表按框架规则不留档） |
| Verification / 验证 | `FINISHED.md`（一次性验收口径） |
| 调研结论（web 性能 / deno desktop 不满足要求） | `ARCHITECTURE.md` D-9、D-2 |
| 实施计划（待审批）§A / §B | `FINISHED.md` §2026-08-02 第二轮；决策见 D-9、D-2 |
