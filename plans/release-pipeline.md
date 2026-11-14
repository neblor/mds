# 发布流水线（`pnpm release`）方案

> 状态：**已确认并实施**（2026-11-14）。
> 批复：① 一条龙发到 GitHub；② 自动更新本轮不做；③ 发布说明手写优先、`git log` 草稿兜底（草稿需过目）；④ 保留 `release-out/` 归档。
> 实施偏差：包内版本核对复用 `client:verify` 已有的 `--version`（不再新增 `--expect-version`）；
> `release:publish` 默认预览、`--execute` 才执行。
> 目标：用 `pnpm release` 一条命令完成「升版 → 构建 → 归档 → 提交 → tag → 推送 → GitHub Release 上传」，
> 取代现在的 `pnpm client:package`（该脚本保留为构建内核与本地测试入口）。
> 参考实现：`/home/andares/repos/c-thun/raybend` 的 `scripts/release.mjs` + `scripts/lib/release-publish.mjs`
> （Tauri 项目，链路比我们多签名/更新清单/crates.io/官网；我们按 Electron + NSIS 裁剪）。

---

## 0. 结论速览

1. **版本只有一处**：`package.json` 的 `version`。release 不新增任何版本文件，也不改 electron-builder 配置。
2. **`pnpm release <bump|X.Y.Z>` 一条龙**：预检 → `pnpm client:package <目标版本>`（沿用现有 check/打包/校验/清理）→
   归档到 `release-out/v<版本>/` → `git commit` + annotated tag + 原子 push → Release 草稿 → 上传 → 核对 → 公开。
   两个刹车：`--dry-run`（只打印计划、不写不改）、`--no-publish`（到归档为止，不碰 git/远端）。
3. **`pnpm release:publish v<版本>` 是续传口**：不重建、只补未完成的部分（提交/tag/上传/公开），
   给「构建成功但上传失败」和「人工验收后再发」用。
4. **失败语义分层**：构建阶段失败 → `client:package` 自己恢复 `package.json`（今天的行为），不留痕；
   一旦进入提交/tag/push，**任何失败都不回滚**，只打印续跑指令（回滚会把工作树顶到 HEAD 之前，重跑必挂）。
5. **不做自动更新**（`electron-updater` / `latest.yml`）：本轮不做，登记 `FUTURE.md`。代价写在 §9。
6. **新增代码只有两处纯逻辑模块 + 一个编排脚本**，其余全部复用现有实现。

---

## 1. 现状盘点

### 1.1 我们有什么

| 项 | 现状 |
| --- | --- |
| 版本来源 | `package.json` → `electron/main.mjs` 读 `app.getVersion()` 写窗口标题；`build.nsis.artifactName = mds-${version}-setup.exe` |
| 打包 | `scripts/package-client.mjs`：`pnpm check` → 写版本 → `electron-builder --win nsis` → `client:verify` → 清理，只留安装包 |
| 产物 | `dist/electron/mds-<ver>-setup.exe`（实测 103 MB）、`dist/electron-test/`（test 模式） |
| WSL | 系统 wine 缺 32 位时 `client:package` 自动切 `unshare` 命名空间 + 自备 wine32（`scripts/package-client-wsl.mjs`） |
| 纯逻辑 | `src/lib/client-package-version.ts`（升版规则）、`src/lib/client-package-cleanup.ts`（清理）——都有单测 |
| git | `origin = git@github.com:neblor/mds.git`，分支 `master`，**无 tag、无 Release**，仓库 public |
| gh | `gh` 在 `/usr/bin/gh`，`GITHUB_TOKEN` 由 `~/.config/fish/conf.d/zz-github-token.fish` 提供（scopes: repo, workflow；`permissions.push/admin = true`） |
| 当前状态 | `package.json` 已改成 `1.0.0`（相对 HEAD `0.12.0`，**仅此一行差异**，未提交）；`dist/electron/mds-1.0.0-setup.exe` 是这次构建留下的 |

### 1.2 raybend 的做法里，哪些值得抄、哪些不抄

| raybend 做法 | 我们怎么办 | 理由 |
| --- | --- | --- |
| 版本编辑先快照 before/after、并发修改即拒绝、失败只恢复自己写过的文件 | **抄**（但落点在 `client:package`，不是 release） | 防止把并行编辑覆盖掉 |
| 发布前记 `gitHash` + `sourceFiles` 哈希，发布时核对 HEAD 未离开构建来源 | **抄精简版**：归档里记 `gitHash`（构建来源 commit），发布时要求 `HEAD` 就是它或它的子提交 | 防止「构建的是 A、发的是 B」 |
| `release`（准备）与 `release:publish`（发布）两个入口，同一函数 | **抄** | 失败可续、人工验收后可续 |
| 发布默认只读预览，必须 `--execute` | **部分抄**：一条龙入口不再要 `--execute`；`release:publish` 续传口默认预览 | 主命令要一条命令能走完，续传口才需要二次确认 |
| `--dry-run` 打印计划 + 阻断项 | **抄** | |
| Release 先建 **draft** → 上传 → 逐个核对 size/sha256 → 公开 | **抄** | 中途失败不会露出半成品 |
| 列表端点读 Release（`/releases/tags/<tag>` 对 draft 固定 404） | **抄** | 真踩过的坑 |
| `git push --atomic` 同时推 master + tag | **抄** | 分支推上了 tag 没上，会造成「发了版本但没有 tag」 |
| 建 Release 后列表有秒级索引延迟 → 轮询 | **抄** | 同上 |
| 源码/许可锁哈希校验、Authenticode、更新签名、crates.io、官网 Actions、Windows 本地盘构建、盘符路径映射 | **不抄** | 我们没有这些面：无 cargo、无签名证书、无更新产物、无官网 |

---

## 2. 命令面

```bash
pnpm release <patch|minor|major|X.Y.Z|vX.Y.Z> [--dry-run] [--no-publish] [--skip-build] [--notes <file>]
pnpm release:publish <vX.Y.Z> [--dry-run] [--execute]
```

### 2.1 `pnpm release` 参数

| 参数 | 作用 |
| --- | --- |
| `patch` / `minor` / `major` | 按现有规则自增（`major` 归零后两位，`minor` 归零第三位，`patch` 只加第三位） |
| `X.Y.Z` / `vX.Y.Z` | 指定目标版本。**必须 ≥ 当前版本**；等于当前版本时只在「`v<版本>` tag 尚不存在」时允许（首次发布 1.0.0 就走这条） |
| `--dry-run` | 只做预检并打印计划（版本、脏文件、tag/Release 是否存在、将执行的命令），不写文件、不构建、不联网改动 |
| `--no-publish` | 构建 + 归档后就停，打印后续指令（人工装一遍验收时用） |
| `--skip-build` | 跳过构建，直接用 `dist/electron/mds-<版本>-setup.exe`（只能核对文件头/大小，核不到包内内容，会明确警告） |
| `--notes <file>` | 指定发布说明文件，覆盖默认路径 `docs/release-notes/<版本>.md` |

不接受的输入直接报用法并退出：`test`（发布不能用测试通道，本地测试仍走 `pnpm client:package test`）、
多个位置参数、未知 flag、`--dry-run` 与 `--skip-build` 同时给且无产物。

### 2.2 `pnpm release:publish`

| 参数 | 作用 |
| --- | --- |
| `v<版本>`（或 `X.Y.Z`） | 读取已有 `release-out/v<版本>/` |
| 默认 | **只读预览**：核对归档与远端状态，打印将执行的 git/gh 动作 |
| `--execute` | 真正提交/tag/push/上传/公开 |
| `--dry-run` | 同默认，显式写法 |

---

## 3. 一条龙的阶段与失败语义

### P0 预检（不写任何东西）

| 检查 | 不满足时 |
| --- | --- |
| 参数/版本合法、目标 ≥ 当前、显式版本时 tag 不存在 | 报用法退出 |
| 当前分支 = `master` | 阻断（不自动切分支、不合并） |
| `origin` = `github.com:neblor/mds` 或 `https://github.com/neblor/mds`（两种写法都认） | 阻断（防止推到别人仓库） |
| 工作树**只有** `package.json` 的 version-only 差异 | 阻断，列出所有脏文件 |
| `v<目标版本>` 本地 tag：不存在，或已存在且指向 HEAD（续传） | 若指向别的提交 → 阻断，不覆盖 |
| `gh auth status` 通过且对仓库有 push 权限 | 阻断，提示 `GITHUB_TOKEN` 未设置 |
| 发布说明：`docs/release-notes/<版本>.md` 存在，或能从 git log 生成 | 生成草稿后**阻断**一次，让人确认/编辑（见 §7 待确认 Q3） |
| `release-out/v<版本>/` 不存在 | 阻断（不覆盖历史归档，先人工核对/清理） |

`--dry-run` 在 P0 结束后打印计划并退出。

### P1 构建

调 `pnpm client:package <目标版本>`，复用现有全部逻辑：

1. `pnpm check`（Vitest → Web 生产构建 → 冒烟）
2. 写 `package.json` 版本（target == current 时不写）
3. `electron-builder --win nsis`（WSL 缺 wine32 时自动进命名空间，行为不变）
4. `pnpm client:verify`（**本轮增强**：新增 `--expect-version`，核对 `win-unpacked/resources/app/package.json` 的版本 = 目标版本）
5. 清理输出目录，只留 `mds-<版本>-setup.exe`

失败 → `client:package` 恢复 `package.json`，release 以非 0 退出，**不产生任何 git 记录**。

### P2 归档

`release-out/v<版本>/`（gitignore）：

| 文件 | 内容 |
| --- | --- |
| `mds-<版本>-setup.exe` | 从 `dist/electron/` **移动**过来（不复制，避免 200 MB 双份） |
| `SHA256SUMS.txt` | GNU 格式 `sha256␠␠文件名`，随 Release 一起上传 |
| `RELEASE-NOTES.md` | 手写文件抄过来，或从 git log 生成 |
| `release.json` | `{schema, version, gitHash, builtAt, artifact:{name, bytes, sha256}, unsigned:true}` |

同名目录已存在 → 阻断（保留现场，先核对）。

### P3 提交 + tag

- 只有 `package.json` 有差异时才 `git add package.json && git commit -m "chore: release v<版本>"`；
  目标版本 == 当前且工作树已干净时**不造空提交**。
- `git tag -a v<版本> -m "默点啥 v<版本>"`。
- 提交后核对：`git show HEAD:package.json` 的 version == 目标、`git status --porcelain` 为空。

### P4 推送

`git push --atomic origin HEAD:refs/heads/master refs/tags/v<版本>:refs/tags/v<版本>`

**从这一步起不再回滚。**（回滚 package.json 会让工作树倒退到 HEAD 之前，重跑升版校验必然失败——
raybend 2026-10-31 v0.1.4 实际踩过。）

### P5 GitHub Release

1. `gh api repos/neblor/mds/releases?per_page=100` 找 tag（**列表端点**才能读到 draft）。
2. 不存在 → `gh release create v<版本> --draft --verify-tag --title "默点啥 v<版本>" --notes-file ... --latest`
   （建完轮询几次再判失败：刚建的草稿有秒级索引延迟）。
3. 草稿存在 → 逐个核对已有资产的 `size` + `digest`；不一致 → 阻断；缺失 → 只补传缺失的。
4. 全部核对通过 → `gh release edit v<版本> --draft=false --latest`。
5. 打印：Release 页 URL、安装包直链、sha256。

### 3.1 失败矩阵

| 阶段 | 失败后状态 | 重跑 |
| --- | --- | --- |
| P0–P2 | 无 git 痕迹，`package.json` 已恢复（P1）或保留新版本（P2 之后构建已成功） | 直接重跑 `pnpm release ...` |
| P3 中途（commit 成功、tag 失败） | 有一个发布提交，无 tag | `pnpm release:publish v<版本> --execute` |
| P4（push 失败） | 本地提交+tag 在，远端没有 | 同上（脚本会重试同一原子 push） |
| P5（上传中断） | 远端是 draft、可能半套资产 | 同上（只补缺失资产，不重传已核对的） |

---

## 4. 代码落点

| 文件 | 性质 | 说明 |
| --- | --- | --- |
| `src/lib/release-plan.ts` | 新增（纯函数） | 参数解析、版本计算、tag/notes/归档路径、闸门判定（blockers/warnings）。无 `node:*` 依赖 |
| `src/lib/release-plan.test.ts` | 新增 | 单测，见 §6 |
| `src/lib/release-artifacts.ts` | 新增（纯函数） | `SHA256SUMS` 文本生成、git log → 发布说明草稿、`release.json` 校验 |
| `src/lib/release-artifacts.test.ts` | 新增 | 单测 |
| `scripts/release.mjs` | 新增（编排 ~200 行） | 预检 → 构建 → 归档 → git → gh；`run`/`log` 可注入 |
| `scripts/release-publish.mjs` | 新增（薄壳） | 解析参数 → 读 `release-out/v<版本>/` → 调同一套发布函数 |
| `src/lib/client-package-version.ts` | **扩展** | `createPackagePlan` 接受显式版本（`X.Y.Z`），target == current 时 `changesVersion=false` |
| `scripts/verify-electron-package.mjs` | **扩展** | 复用已有 `--version`：核对包内 `resources/app/package.json` 的 version（原先只核文件名） |
| `package.json` | 修改 | 新增 `"release"`、`"release:publish"` 两个 script（现有 `client:package*` 全部保留） |
| `.gitignore` | 修改 | 加 `release-out/` |
| `docs/release-notes/1.0.0.md` | 新增 | 首个发布说明（用户视角：本轮有什么） |
| `README.md` | 修改 | 加「下载」段：`https://github.com/neblor/mds/releases/latest` |
| `AGENTS.md` | 修改 | 脚本表加 `pnpm release` / `release:publish`；写明「发布由崔总执行」与失败不回滚纪律 |
| `FUTURE.md` | 修改 | 登记 §9 的未做项 |

**复用清单（不新造轮子）**：升版规则、清理逻辑、WSL/wine32 命名空间、`check` 链、`client:verify`、`electron-builder` 配置——
一条 `pnpm client:package <target>` 全部带过来，release 只负责它没有的：git、tag、Release。

**新增文件共 6 个**（3 个纯逻辑模块、2 个脚本、1 个发布说明），无新增组件、无新增依赖。

---

## 5. 发布纪律（写进 AGENTS.md）

1. `pnpm release` 只在**任务清单里真有发版任务**时跑（构建 5–10 分钟 + 103 MB 上传）。
2. 发布动作由崔总执行；Agent 只准备与验证。
3. 一旦 `pnpm release` 进入 P3，**不要动工作树**（任何改动都会让提交后校验中断）。
4. 失败按 §3.1 重跑同一指令，**不要手工删 tag、不要删草稿、不要 force push**。

---

## 6. 测试计划

Vitest（`src/**/*.test.ts`，随 `pnpm test:run` / `pnpm check` 跑）：

- `release-plan.test.ts`
  - 升版：`1.0.0` + patch/minor/major → `1.0.1` / `1.1.0` / `2.0.0`
  - 显式版本：`v1.2.3` / `1.2.3` 归一；低于当前 → 抛错；等于当前且 tag 存在 → 抛错
  - `test` 通道被拒；未知 flag、重复 flag、多位置参数 → 抛错
  - 脏文件判定：只有 `package.json` version 差异 → 通过；多一个文件 → 阻断并点名
  - 归档路径/资产名/发布说明路径
  - 续传判定：tag 指向 HEAD → `skipCommit`；tag 指向其它提交 → 阻断
- `release-artifacts.test.ts`
  - `SHA256SUMS` 格式与排序
  - git log 文本 → 发布说明草稿（含 merge/空行/关联提交链接）
  - `release.json` 校验：版本/哈希/size 不匹配时报错
- `client-package-version.test.ts`：补显式版本用例（现有用例保持）
- `verify-electron-package --expect-version`：手工核对（脚本无单测，与现在一致）

---

## 7. 已确认的决策（2026-11-14）

| # | 问题 | 结论 |
| --- | --- | --- |
| Q1 | `pnpm release` 默认走到哪一步 | **一条龙**：构建 + 归档 + 提交 + tag + push + 上传 + 公开；`--no-publish` / `--dry-run` 为刹车 |
| Q2 | 自动更新 | **本轮不做**，登记 `FUTURE.md` §十三.1（代价：1.0.x 用户将来需手动重装一次） |
| Q3 | 发布说明来源 | **手写优先，`git log` 草稿兜底**；草稿生成后停下等人工改写（或 `--use-draft-notes` 明确接受） |
| Q4 | `release-out/` 本地归档 | **保留**（约 100 MB/版，不入库），续传与追溯都靠它 |

---

## 8. 首次 1.0.0 的操作序列

```bash
pnpm release 1.0.0 --dry-run     # 看计划：target == current，脏文件只有 package.json 的版本行，无 tag/Release
pnpm release 1.0.0               # 构建 → 归档 → commit → tag v1.0.0 → push → Release 公开
```

`dist/electron/mds-1.0.0-setup.exe` 就是 `f102c76 + 版本号` 这一版的产物，首次可用
`pnpm release 1.0.0 --skip-build` 省掉一次 10 分钟构建（脚本会警告：只核文件头与大小）。

之后的版本：`pnpm release patch` / `minor` / `major`，并在 `docs/release-notes/<版本>.md` 写发布说明。

> 前置：发版前工作树必须是干净的（只允许 `package.json` 的版本行与本次发布说明未提交）。
> 发布动作由崔总执行；Agent 只准备与验证。

---

## 9. 不做 / 登记 FUTURE

| 项 | 为什么现在不做 | 将来做的代价 |
| --- | --- | --- |
| `electron-updater` 自动更新 | 需要 `latest.yml` + 运行时更新流程 + 失败回滚 + 真机验证，是一整套功能，不是一个脚本 | 装了 1.0.x 的用户**要手动重装一次**才能进入自动更新链；之后不再需要 |
| Authenticode 代码签名 | 需要购买证书（OV/EV），个人项目暂无 | SmartScreen 会提示「未知发布者」，发布页需如实说明 |
| 便携版 / 绿色版 zip | 暂无需求 | 上传脚本加一个资产即可 |
| CI（GitHub Actions 自动构建） | 交叉打包依赖 wine32 与本地缓存，跑在 Actions 上要另配一套 | 与本地脚本并行维护两条链 |
| 版本徽章 / 官网下载页 | 暂无官网 | README 用 `releases/latest` 直链即可 |
| 发布说明从 commit 自动生成（半自动） | 本轮先用手写 + git log 兜底 | 见 Q3 结论 |
| 旧版本清理（只留最近 N 个） | 每版 103 MB，暂时可接受 | 加一条 `pnpm clean:releases --keep 3` |
