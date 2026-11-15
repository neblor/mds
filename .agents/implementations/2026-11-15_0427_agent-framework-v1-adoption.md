# 2026-11-15T04:27+08:00 — 采纳 agent-framework v1：记忆契约与索引、PLAN 重构、决策/收口归档

框架 v1 采纳（保守轮），承接 `/ask-init` 已跑完的确定性步骤。

## 做了什么

- `AGENTS.md`：新增 3 行记忆契约 + §计划与记忆索引（`specs/PLAN.md`、`specs/<unit>.md`、`.agents/memory/` 四份、`.agents/implementations/` 各一行）；§开发目录定义 加 `.agents`、把 `.implementation-report` 标为只读历史档；§项目文档 补一句「`.agents/memory/FUTURE.md` 只管框架层，业务延期只写根 `FUTURE.md`」；§实施段 末条改为新记录进 `.agents/implementations/`。三节正文其余一字未动，`<!-- ask-init begin/end workflow -->` 块完整。
- `specs/PLAN.md`：从原 `PLAN.md` 逐字副本重写为「只放未收口项」——现状（版本/栈/模式/发版/检查入口）、原计划的收口核对表（无遗留）、未收口项 M-1/M-2/M-3、待定问题 Q-1/Q-2/Q-3、覆盖说明；进度表与已完成项清除。
- `.agents/memory/ARCHITECTURE.md`：证据型分层表 + 界面状态机 + 版本基线 + 9 条决策记录（D-1…D-9，D-5 标「已被取代」）+ deno 调研存档 + 已知漂移表。
- `.agents/memory/FINISHED.md`：两轮收口摘要 + 2026-08-03～11-15 里程碑指针 + 本次采纳的历史附录。
- `.agents/memory/FUTURE.md`：确定根 `FUTURE.md` 为业务延期唯一登记处（留指针），只保留框架层 F-1/F-2 两条带触发条件的延期项。
- 覆盖表 39 行（19 found / 20 declared / 0 open），`framework_audit` 从 4 warnings 降到 1（仅预算债务）。

## 证据

- `framework_audit` 最终：`0 errors, 1 warnings`，唯一告警 `W-BUDGET-01 AGENTS.md is 49400 chars`，已作为债务 M-1 记入 `specs/PLAN.md`。
- `AGENTS.md` 49,400 bytes / 25,986 codepoints（装框架前快照 45,889 bytes，本次 +3,511）。
- 命令核对：`AGENTS.md` 里 33 条 `pnpm <script>` 全部存在于 `package.json`；反向发现 3 条脚本未被收入（M-2）。
- 实测漂移：`daisyui` / `headlessui` 不在 `package.json` 也不在 `pnpm-lock.yaml`（Q-1）；`timing.ts` 的 `LETTER_SECONDS=0.3`、`SPEED_RATE=0.85/1.0/1.3` 与原 PLAN 决策表不符（D-5 归档）。
- 未提交：`.agents/memory/` 已 `git add` 入索引，commit 留给崔总。
