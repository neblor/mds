# 远期与延期

> 每条必须写清：是什么、为什么等、什么条件会把它拉回来（触发条件）。
> 被采纳的条目移入 `specs/PLAN.md`，这里留一行指针。

## 本项目「现在不做」的唯一登记处是根目录 `FUTURE.md`

- 事实：根 `FUTURE.md`（2026-11-15 实测 60,451 字节）是崔总 2026-10-12 起登记的延期/未来项清单，`AGENTS.md` §项目文档 明确它是「先存后显」的唯一入口。
- 因此：**本文件不重复登记业务延期项**（那是第二个家）。业务层延期项写根 `FUTURE.md`。
- 本文件只登记**与 agent 记忆/框架自身有关**的延期决定。
- 触发条件：若要把根 `FUTURE.md` 整体迁进 `.agents/memory/`，先做「一个事实一个家」的合并，再改 `AGENTS.md` §项目文档 的指针；该项工作作为未收口项登记在 `specs/PLAN.md`。

## 框架层延期项

### F-1 `AGENTS.md` 正文瘦身

- 是什么：把 §系统基础功能（12,637 字节）、§项目脚本（6,507 字节）等正文迁进各自的记忆文件，`AGENTS.md` 只留索引与硬规则。
- 为什么等：v1 采纳是保守轮，明确「不重写不属于任务的散文」；预算超限按债务登记，不在本轮偿还。
- 代价/前置：要逐节判断归属（`FUNCTION-<MODULE>.md` / `TERMS.md` / `ARCHITECTURE.md` / `DESIGN.md`），并保证每个迁移句有覆盖行。
- 触发条件：崔总要求 `/ask-init` 第二轮回填，或 `AGENTS.md` 再增长到影响会话可用性时。
- 相关落点：`specs/PLAN.md`「预算债务」。

### F-2 `.implementation-report/`（45 份）与 `.agents/implementations/` 的关系

- 是什么：历史实施报告在 `.implementation-report/`（2026-08-01 起），框架的变更记录目录是 `.agents/implementations/`（新记录按 `YYYY-MM-DD_HHMM_slug.md` 命名）。
- 为什么等：本轮不允许自行搬目录；两处内容都是真实档案，先保持现状并明确「旧档只读、新记录进 `.agents/`」。
- 触发条件：做 `.agents/implementations/` 的 200 份上限滚动或需要统一检索时，再按里程碑把旧报告归档进 `.agents/implementations/archive/<year>/`。
- 相关落点：`.agents/memory/README.md` §Budgets；`AGENTS.md` §开发目录定义。
