# 2026-11-24T03:08+08:00 — 发版收尾自动清理本机旧归档（只保留最新一版）

产物从 `dist/electron/` 搬到 `release-out/v<版本>/` 之后，`cleanupPackageOutput()`（只扫本次输出目录）再也覆盖不到旧版本，本机归档只增不减：v1.0.0 / v1.0.1 / v1.1.0 各 103 MB，共 309 MB。加 GitHub 上传是加法，不该丢掉「产物出完就清理」这条既有保证 —— 本次把它在归档层补回，并且写进脚本而不是靠人工。

## 实现

- 新增纯判定模块 `src/lib/release-prune.ts`（不 import `node:*`，与 `release-plan.ts` 同约定）：
  - `planArchivePrune()` 输入本次 tag + 归档清单 + 远端状态表，输出 keep/remove/freedBytes；
  - `RELEASE_ARCHIVE_RETENTION = 1`（本机只留最新一版，改大可多留）；
  - `RELEASE_TAG_PATTERN`、`tagVersion()`、`parseStagingName()` 供脚本复用。
- `scripts/release.mjs` 新增 I/O：`listArchiveEntries()`、`directoryBytes()`、`remoteReleaseStates()`（`gh api` 分页查 draft/public）、`removeAllStaleStaging()`（按 PID 判活清所有 tag 的 `.staging-*`）、`pruneReleaseArchives()`。
- 挂载点：`publishRelease()` 在 `executePublish()` 成功返回之后调用一次。`--dry-run`、`--no-publish`、停在草稿说明、任何 P3 之后失败的路径都不会执行删除。

## 删除判定的安全边界（宁留不误删）

1. 本次发布的归档永远保留；
2. 版本号比本次更新的一律保留；
3. 更旧的归档只有远端 Release 为 **public** 才删 —— 草稿 / missing / gh 不可用（unknown）都保留并打日志说明，因为它是 `pnpm release:publish <tag> --execute` 的唯一续跑依据；
4. `.staging-*` 只清已退出进程的（PID 复用宁可保守）；
5. 清理异常只告警，不得把已完成的发布变成失败。

## 本机现状

已在本次会话手工清掉 `release-out/v1.0.0`、`v1.0.1`（GitHub 资产 sha256/大小逐个核对一致）与 746 MB `.tmp/`，仓库 1.8 G → 849 MB。仓库外 `~/.cache/mds`、`~/.cache/electron*` 按崔总指示未动。

## 验证

- `pnpm test:run`：90 文件 / 975 测试全绿（新增 `release-prune.test.ts` 10 例 + `release-archive.test.ts` 4 例集成，真实临时目录 + 注入远端状态）；
- `pnpm typecheck`：通过；
- `node scripts/release.mjs 1.1.0 --dry-run`：计划打印正常、不写盘。
