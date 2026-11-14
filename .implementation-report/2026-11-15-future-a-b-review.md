# FUTURE A/B 清理 · 第三方评审报告

> 日期：2026-11-15
> 评审对象：提交 `1c2f6e9` 的 A/B 清理，以及本轮要求的 FUTURE 同步检查。
> 范围：类型检查接入、`registerHooks` 迁移、运行时日志改名、发布归档原子写、打包收尾文案、A/B 条目状态与相关文档。
> 方法：读取实际提交 diff 与当前源码；直接复现日志迁移问题；新增生产函数级测试；运行全量测试、类型检查、生产构建、CLI 与隔离发布场景。

## 总体结论：PASS（评审修正后）

A 组要求的实现均已落地，B 组 11 个验收/产品口径项均已按崔总确认关闭。
评审额外发现并修复了日志迁移覆盖/遗漏、特殊字段脱敏、归档失败丢安装包、活跃暂存目录误删等问题。
最终 `pnpm check`、87 个测试文件 / 939 个用例、隔离发布 8 组场景全部通过。

FUTURE 的 A/B 条目已经同步为当前实现和关闭口径，不再保留「标题已完成、正文仍待做」的矛盾描述。

---

## 1. Requirement coverage

**结论：覆盖完整。**

| 要求 | 核对结果 |
| --- | --- |
| A：类型检查进入 `pnpm check` | `typecheck` 使用项目内显式 `typescript` devDependency；`check` 顺序为 Vitest → `tsc --noEmit` → 生产构建 → 冒烟 |
| A：`module.register()` 迁移 | `scripts/ts-resolve-hook.mjs` 使用同步 `module.registerHooks()`；11 个脚本均在动态 import 前调用 `registerTsResolve()`；这些 CLI 的 `DEP0205` 已消失 |
| A：日志文件名与内容对齐 | Client 使用 `mds-data/logs/runtime.log`，旧 `ai-definitions.log` 与 `.1` 安全迁移；脱敏、轮换、Web 无副作用保持不变 |
| A：归档写入原子化 | 暂存目录完整校验后才 rename 成正式目录；普通失败回退安装包；只清理已退出进程的暂存目录；说明/清单临时文件也会清理 |
| A：首发核对与打包收尾文案 | v1.0.0 已发布并核对；显式同版本正式打包不再误称「测试打包」 |
| B：11 项验收/口径关闭 | FUTURE §五.11、§六.6、§七.1、§七.8、§九.7、§九.8、§九.10、§九.11、§十.2、§十.3、§十.6 均有明确关闭理由与当前口径 |
| FUTURE 同步 | A/B 的结果、路径、脚本数量、迁移边界和测试证据已更新；两处过时的 Pencil 限制改为 paintress；README 的 check 顺序同步 |

## 2. 已确认并修复的问题

| # | 位置 | 问题与证据 | 修复 |
| --- | --- | --- | --- |
| F1（高） | `src/lib/runtime-logger.ts:60` | 原迁移在 `runtime.log` 存在时直接返回，旧 `ai-definitions.log.1` 永远不迁移；实测 `legacyRotatedStillPresent: true`。另一场景中已有 `runtime.log.1` 被旧轮换文件覆盖，实测内容从 `current-rotated` 变成 `legacy-rotated` | 当前文件与 `.1` 分别独立迁移；只在目标不存在时 rename；目标冲突保留旧源文件，单个失败不影响另一个。新增「补齐缺失轮换」和「目标存在不覆盖」测试 |
| F2（中） | `src/lib/runtime-logger.ts:24`、`:36` | 本轮脱敏重构用普通对象赋值，`__proto__` 会改变结果对象原型并吞掉该字段；lens 另报 `sanitizeEndpoint` 返回 `unknown` | 改用 `Map` + `Object.fromEntries` 保留特殊字段；`sanitizeEndpoint` 仅在字符串边界调用并返回 `string`。新增 `__proto__` 单测，lens 错误清零 |
| F3（高） | `scripts/release.mjs:351` | 原 `removeStaleStaging` 按目录名直接删除，另一场同版本发布仍在运行时也会被清掉 | 目录名解析 PID，`process.kill(pid, 0)` 检查活跃状态；仅 ESRCH 视为退出，其他错误保守保留；非目录和异常命名不动。新增真实活跃/退出子进程测试 |
| F4（高） | `scripts/release.mjs:453` | 原失败清理直接 `rmSync(stage)`，安装包已从 dist 移入 stage 后会删除唯一产物 | 失败时优先把安装包移回 `dist/electron`；回退失败则保留整个 stage 并警告，不为了清理而丢产物。新增直接调用生产 `buildAndArchive` 的中途失败测试 |
| F5（低） | `scripts/release.mjs:329` | 临时说明/清单文件在写入或 rename 失败时会残留 | `writeFileAtomic` 增加 `finally` 清理临时文件 |
| F6（低） | `src/lib/release-archive.test.ts` | 真实 git / 子进程夹具在全量并行套件中一次超过默认 5s，出现测试超时；单文件连续复现正常，无死锁或进程泄漏 | 两个真实集成用例设置 15s 超时；单文件连续 3 次通过，最终全量 `pnpm check` 通过 |
| F7（文档） | `FUTURE.md`、`README.md`、`.implementation-report/2026-11-15-future-a-b-cleanup.md` | 多个已完成/已关闭条目正文仍写「做什么 / 触发条件」，并残留旧日志名、旧 Pencil 限制、错别字和过时的 check 顺序 | A/B 条目改成当前实现/关闭口径；修正日志迁移与活跃 PID 清理的真实边界；README 中英文检查顺序同步；报告补评审追加修正 |

## 3. 未直接修复 / 范围外记录

| # | 位置 | 描述 | 建议 |
| --- | --- | --- | --- |
| N1 | `scripts/release.mjs:477` 附近的 dist 检查与暂存恢复路径 | 进程被硬杀时无法执行 `finally`。若安装包已移入 stage，下一次 `--skip-build` 会因 dist 缺包而安全失败；不会误用半成品，但也不会自动从 stage 恢复。完整重建可继续，死进程 stage 会在有可用新包后清理 | 保持安全默认。若要自动恢复，必须先用完整清单 + sha256 验证 stage 完整性，不能仅凭 MZ 头或文件大小恢复可能未复制完的文件。已登记 `FUTURE` §十三.10 |
| N2 | `scripts/release.mjs:340` | PID 复用时可能把陈旧 stage 误判为活跃，结果是保守保留而不是误删，长期可能占磁盘 | 已纳入 `FUTURE` §十三.5 的归档清理，增加按年龄清理；不要为追求清理率降低活跃判断的安全性 |
| N3 | `node_modules/vite/dist/node/chunks/node.js:516`（依赖内部，未修改） | `pnpm web:build` 仍打印上游 `DEP0205`。本地 11 个 CLI 已无该警告；Vite 自身保留旧 `module.register()` 兼容回退 | 跟踪 Vite 升级，不修改 `node_modules`，不把上游警告误报为本地脚本迁移遗漏 |
| N4 | `FUTURE.md:214` §五.17 | 这是本轮之前的历史文档漏标：短句模式实际已经上线，但该旧条目尚未标完成。它不属于本次 A/B 组变更，按评审范围约束未改 | 另做一次小的 FUTURE 状态校订，链到 `.implementation-report/2026-10-17-sentence-mode.md`；不要与本轮 A/B 关闭项混写 |

## 4. 验证证据

- `pnpm check`：**通过**
  - 87 个测试文件 / **939 个用例**全绿；
  - `tsc --noEmit` 通过；
  - Web 生产构建通过；
  - HTTP 生产冒烟通过。
- `src/lib/release-archive.test.ts`：直接覆盖生产 `buildAndArchive` 与 `removeStaleStaging`，连续 3 次单文件通过；全量并行也通过。
- `.tmp/release-review/integration.mjs`：8 组隔离发布场景全部通过，覆盖完整发布、幂等续跑、digest、分页、校验和、说明补写、缺失说明预检和并行提交阻断。
- 11 个迁移脚本及发布/打包脚本 `node --check` 全部通过。
- `get:explain` / `get:cloze` / `get:sentences` / `get:tts --help` / `pnpm db:status` 实测无 `DEP0205` 或 `DeprecationWarning`。
- `git diff --check` 通过；LSP 本轮错误清零，仅剩项目既有的 extensionless import 风格提示。

## 5. 剩余风险结论

没有剩余的已知阻断性逻辑错误。原子归档现在保证「正式目录只会完整出现」，普通失败也不会丢唯一安装包；硬杀场景采取安全阻断而不是冒险恢复，属于可接受的剩余人工恢复成本。
日志迁移在目标冲突时选择保留双方文件，不会为追求「迁移干净」覆盖较新的诊断记录。
