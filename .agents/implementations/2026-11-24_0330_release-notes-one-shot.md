# 2026-11-24T03:30+08:00 — 发版去掉发布说明人工确认，恢复一条指令到底

发版曾有一个「发布说明确认」闸门：`docs/release-notes/<版本>.md` 不存在时按 `git log` 生成草稿，然后**停下**，等人改写后用 `--use-draft-notes` 重跑。对一个人的小项目来说这是纯摩擦 —— 发一版要走两趟。本次把该闸门整体移除，发版恢复成一条指令到底。

## 改动

- `src/lib/release-plan.ts`：删除 `--use-draft-notes`（release 与 release:publish 两处）、`ReleaseArgs.useDraftNotes`、`PublishArgs.allowDraftNotes`、`ReleasePlan.notesNeedsReview`、`ReleasePlanInput.notesSourceAvailable`；用法串同步。
- `scripts/release.mjs`：删除「⏸ 停在归档阶段：发布说明还是自动草稿」整段早退、`assertReleaseNotesReady()`，以及 `publishRelease({ allowDraftNotes })` 参数；`runRelease` 仍然在构建前校验显式/手写说明（存在但不可读/为空照样抛错）。
- `scripts/release-publish.mjs`：同步去掉参数透传。
- 保留的能力一个没少：手写 `docs/release-notes/<版本>.md`、`--notes <文件>`、`--dry-run`、`--no-publish`（显式选择停在归档）、`release:publish --execute` 续跑。归档清单仍记 `notesSource`（handwritten/custom/draft）以便回溯。
- 文档：AGENTS.md 发版小节改成「一键到底，中间不停」；README.md 的「打包与发版」同步；FUTURE.md §八.6 注明草稿不再拦。

## 现在的链路

预检 → 构建 → 归档（说明：手写优先，否则 git log 自动生成）→ 提交 + tag → 原子 push → Release 草稿 → 上传 → 逐个核对 → 公开 → 清理本机旧归档。中途不再有人工确认点；只有 `--dry-run` / `--no-publish` 这两种显式选择会提前返回。

## 验证

- `pnpm test:run`：90 文件 / 975 测试全绿（`release-plan.test.ts` 已改为断言 `--use-draft-notes` 报「未知参数」，`notesNeedsReview` 相关用例删除）。
- `pnpm typecheck`：通过。
- `node scripts/release.mjs 1.1.0 --dry-run`：打印「说明 … 不存在 → 按 git log 自动生成（不再停下等改写）」，不写盘。
- `node scripts/release.mjs 1.1.0 --use-draft-notes`：`✗ 未知参数：--use-draft-notes`。
