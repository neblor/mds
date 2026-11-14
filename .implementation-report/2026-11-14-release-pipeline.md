# 发布流水线（`pnpm release`）实施报告

> 日期：2026-11-14
> 方案：`plans/release-pipeline.md`（已确认并实施）
> 需求：把版本同步打到 GitHub 并打 tag，编译好的 Windows 安装包作为 Release 资产上传；用一个 `pnpm release` 取代原来的 `client:package`。项目不发布到 npm。
> 参考：`/home/andares/repos/c-thun/raybend` 的 `scripts/release.mjs` / `scripts/lib/release-publish.mjs`（Tauri，复杂度高得多）。
> 评审修订：第三方评审发现的安全边界问题已修复，详见 `.implementation-report/2026-11-14-release-pipeline-review.md`。

---

## 1. 交付物

### 1.1 新增

| 文件 | 作用 |
| --- | --- |
| `src/lib/release-plan.ts` | 发布参数解析、闸门判定（分支 / origin / 工作树 / 暂存区 / tag / 远端 tag）、路径命名、发布计划与续跑判定（纯函数，不依赖 `node:*`） |
| `src/lib/release-plan.test.ts` | 上面的单测（参数、路径、五类阻断、续跑、草稿、`--skip-build`、publish 计划） |
| `src/lib/release-artifacts.ts` | `SHA256SUMS.txt` 生成、`git log` 解析与发布说明草稿、归档清单校验（纯函数） |
| `src/lib/release-artifacts.test.ts` | 上面的单测 |
| `scripts/release.mjs` | 编排：预检 → `client:package` 构建 → 归档 → 提交 + tag → 原子 push → GitHub Release |
| `scripts/release-publish.mjs` | 从已有归档续跑（默认只读预览，`--execute` 才动 git/远端） |
| `docs/release-notes/1.0.0.md` | 首个版本的发布说明（用户视角，手写） |

### 1.2 改动

| 文件 | 改动 |
| --- | --- |
| `src/lib/client-package-version.ts` | 新增 `PackageTarget`（自增类型或显式 `x.y.z`）、`parsePackageTarget`、`compareVersions`、`normalizeVersion`；`createPackagePlan` 接受显式版本并拒绝低于当前版本 |
| `src/lib/client-package-version.test.ts` | 跟着改（原 `parseBumpType` 用例迁到 `parsePackageTarget` + 显式版本用例） |
| `src/lib/client-wsl-env.ts` / `.test.ts` | 命名空间脚本参数 `bumpType` → `target`（要能把显式版本透传进去） |
| `scripts/package-client.mjs` / `package-client-wsl.mjs` | 改用 `parsePackageTarget`；`package.json` 解析失败给出可读错误 |
| `scripts/verify-electron-package.mjs` | 增加「包内 `resources/app/package.json` 版本 = 期望版本」核对（原先只核文件名） |
| `package.json` | 新增 `release` / `release:publish` script；加 `private: true`（仓库不向 npm 发布） |
| `tsconfig.json` | `allowImportingTsExtensions`（`release-plan.ts` 用 `.ts` 后缀导入同目录模块，Node 直接跑脚本时才能解析） |
| `.gitignore` | 忽略 `release-out/` |
| `README.md` | 新增「下载」段（`releases/latest`）与发版说明；命令表补 `release` / `release:publish` |
| `AGENTS.md` | 脚本表、版本语义、公开分发口径；新增「发版（`pnpm release`）」纪律小节 |
| `FUTURE.md` | 新增 §十三「发布流水线遗留」 |

**新增 UI 组件：0 个**（本轮不涉及界面）。新增依赖：0 个。

---

## 2. 关键决策

1. **版本唯一来源仍是 `package.json`**。`renderer`/主进程都从 `app.getVersion()` 取，release 不引入第二份版本文件。
2. **构建内核复用 `client:package`**，release 只做它没有的事（git / tag / Release）。因此 `pnpm check`、WSL wine32 自动切换、`win-unpacked` 包内容校验、临时产物清理全部照旧，没有第二套打包路径。
3. **版本写入的唯一执行者仍是 `client:package`**：release 只把目标版本作为参数传下去，失败由它恢复 `package.json`。release 自己不写版本文件，避免两个写者。
4. **一条龙 + 两个刹车**（崔总确认）：`--dry-run`（只看计划）与 `--no-publish`（到归档为止）；`pnpm release:publish v<版本> --execute` 是续跑口。
5. **失败分层**：P1/P2 失败不留痕；**进入提交阶段后一律不回滚**——回滚版本文件会让工作树落后于 HEAD，重跑升版校验必然失败（raybend 2026-10-31 实际踩过）。
6. **发布前核对构建来源**：归档里记 `baseCommit`，发布时要求 `HEAD` 就是它或只比它多一个发布提交，防止「构建的是 A、发的是 B」。
7. **Release 先草稿、逐个核对 size/sha256 再公开**；已公开且资产一致时重跑是幂等的，不重传 100 MB。
8. **发布说明手写优先**（`docs/release-notes/<版本>.md`），缺文件时按 `git log`（上一 tag..HEAD）生成草稿并**停下**等人工改写，`--use-draft-notes` 才直接用草稿。
9. **不做自动更新**（崔总确认）：代价是将来上线 `electron-updater` 时，1.0.x 用户要手动重装一次才能进入更新链，已登记 FUTURE §十三.1。

---

## 3. 流程与产物

```text
pnpm release <patch|minor|major|X.Y.Z>
  P0 预检   分支 master / origin neblor/mds / 工作树只允许 package.json 版本差异 + 本次发布说明
            / 暂存区为空 / tag 不存在 / gh 已登录
  P1 构建   pnpm client:package <目标版本>（check → electron-builder → verify → cleanup）
  P2 归档   release-out/v<版本>/：安装包、SHA256SUMS.txt、RELEASE-NOTES.md、release.json
  P3 提交   git commit "chore: release v<版本>"（版本号没变则不造空提交）+ annotated tag
  P4 推送   git push --atomic origin HEAD:refs/heads/master refs/tags/v<版本>
  P5 发布   gh release create --draft → 上传缺失资产 → 核对 size/digest → edit --draft=false --latest
```

- 归档格式：`release.json` = `{schema, version, baseCommit, builtAt, notesSource, artifact{name,bytes,sha256}}`。
- `release-out/` 不入库（每版约 100 MB），续传与追溯都靠它。
- 安装包上传为 `mds-<版本>-setup.exe` + `SHA256SUMS.txt`；发布说明是 Release 正文，不额外传资产。

---

## 4. 测试

- `pnpm test:run`：**86 个测试文件 / 933 个用例全部通过**（含评审后新增的参数冲突、来源约束、校验和与版本精度用例）。
- `pnpm check`：Vitest → 生产构建 → HTTP 冒烟通过（发版时 `client:package` 会再跑一次）。
- 干跑：`node scripts/release.mjs 1.0.0 --dry-run` 正确输出计划、命中「工作树未收口」阻断（当时改动未提交）；
  `node scripts/release-publish.mjs v1.0.0` 正确报「找不到归档」；
  `pnpm release test` / 缺参数 / 版本低于当前 都按预期报错。
- 已用假归档跑通 `release:publish` 的预览路径（打印计划 + 阻断项，未写 git、未联网）。

**编排验证**：评审后使用临时 Git 仓库、本地 bare remote 与假 `gh` 直接执行生产脚本，完整发布、幂等续跑、摘要核对、分页、补写说明、缺失说明预检与并行提交阻断均通过；固化集成测试登记在 `FUTURE.md` §十三.9。

---

## 5. 首次发版（崔总执行）

前置：把本轮改动（含 `package.json` 的 `1.0.0`）提交，工作树干净。

```bash
pnpm release 1.0.0 --dry-run   # 看计划
pnpm release 1.0.0             # 构建 → 归档 → tag v1.0.0 → push → Release 公开
```

`dist/electron/mds-1.0.0-setup.exe` 是 `f102c76 + 版本号` 这一版的产物，若不想重跑 10 分钟构建可用
`pnpm release 1.0.0 --skip-build`（脚本会警告：只核文件头与大小，核不到包内内容）。

之后每版：写 `docs/release-notes/<版本>.md` → `pnpm release patch`（或 `minor` / `major`）。

---

## 6. 后续可能要处理的部分

全部登记在 `FUTURE.md` §十三：自动更新（`electron-updater` + `latest.yml`）、Authenticode 签名、
便携版 zip、CI 自动构建、旧归档清理、发布说明半自动化、首次真发后的端到端核对、归档中断恢复与集成测试固化。
