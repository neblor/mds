# 发布流水线第三方评审报告

> 日期：2026-11-14
> 范围：仅本轮 `pnpm release` / `release:publish`、显式版本打包、包内版本校验及相应文档与测试。
> 方法：读取实际 diff 与源码；运行 Vitest、生产构建/冒烟；在临时 Git 仓库、本地 bare remote 和假 `gh` 中直接执行生产发布脚本。未向真实 GitHub 推送、未创建真实 tag 或 Release。

## 总体结论：PASS（评审修正后）

需求主链已完整实现：`pnpm release <bump|X.Y.Z>` 复用现有 `client:package` 构建 Windows NSIS 安装包，
随后归档、提交版本、创建 annotated tag、原子推送分支与 tag，并把安装包和 `SHA256SUMS.txt` 上传到同一 tag 的 GitHub Release。
项目通过 `private: true` 明确不走 npm 发布。

初评发现的安全边界与续跑问题均已在本轮范围内修复；全量测试和隔离端到端场景通过。
没有遗留的已知阻断性逻辑错误。真实首发与 Windows 安装验收仍是必要的人工步骤。

---

## 1. Requirement coverage

**结论：覆盖完整，实现与需求一致。**

| 需求 | 实现核对 |
| --- | --- |
| 一个 `pnpm release` 代替手工发布流程 | `package.json` 新增入口；`scripts/release.mjs` 完成预检 → 构建 → 归档 → 提交/tag → 原子 push → Release 公开 |
| 版本同步到 GitHub 并打版本 tag | 版本仍只有 `package.json` 一处来源；发布提交只接受版本号差异与本次说明；tag 为 `vX.Y.Z`，与 master 一起 `--atomic` 推送 |
| 编译后的 Windows 安装包随 tag 上传 | 复用 `client:package` 与 `client:verify`；上传 `mds-X.Y.Z-setup.exe`，Release 先草稿，核对完整后才公开 |
| 安装包可校验、失败可续跑 | 同步上传 `SHA256SUMS.txt`；归档记录实际字节数/sha256/baseCommit；`release:publish` 只补缺失资产，不重传已核对资产 |
| 不走 npm 安装/发布 | `package.json` 增加 `private: true`，未加入任何 npm publish 流程 |
| 简单流程，不照搬 raybend 的复杂度 | 未引入签名、自动更新、crates.io、官网 Actions 或第二套打包链；未新增依赖 |

## 2. 已确认并修复的问题

| # | 位置 | 问题 | 修复 |
| --- | --- | --- | --- |
| F1（高） | `src/lib/release-plan.ts:105`、`scripts/release-publish.mjs` | `release:publish --dry-run --execute` 原先会接受两个参数并真正执行，预览名义下可能产生发布副作用 | 新增纯函数 `parsePublishArgs`，两个开关互斥；重复/未知参数也拒绝。补单测并用生产 CLI 验证 |
| F2（高） | `scripts/release.mjs:509` | 远端资产没有 `digest` 时，原先只比较文件大小，不能兑现「核对 sha256」；同大小错误内容会被放行 | 无 digest 时通过 `gh api ... Accept: application/octet-stream` 下载远端字节并计算 sha256；错误内容会阻断公开 |
| F3（高） | `scripts/release.mjs:278`、`src/lib/release-artifacts.ts:37` | 归档只检查 `SHA256SUMS.txt` 是否存在，不检查其内容；损坏的校验文件可能被上传 | 读取归档时要求校验和文本与实际安装包摘要逐字一致；同时拒绝空发布说明。补纯函数单测 |
| F4（高） | `scripts/release.mjs:662` | 原实现允许 HEAD 是 `baseCommit` 后的任意一个提交，可能把构建后另做的业务提交包含进 tag，形成「二进制是 A、tag 是 B」 | 该提交只允许 `package.json` 与本次说明；`package.json` 在 base..HEAD 间也必须只有一删一增的版本行。业务文件出现即阻断 |
| F5（中） | `scripts/release.mjs:749` | 自动草稿后按提示补写 `docs/release-notes/<版本>.md`，直接跑 `release:publish --execute` 仍会因 manifest 标记 draft 而失败 | 真正执行续跑时重新吸收手写说明并更新归档；默认预览仍不写文件 |
| F6（中） | `scripts/release.mjs:376` 及主流程预检 | `--notes` 路径错误原先要到构建、移动安装包之后才报错，可能留下半成品归档 | 在 dry-run/构建前统一检查说明来源存在、是普通文件、可读且非空；缺失路径现在立即失败 |
| F7（中） | `scripts/release.mjs:154` | 首次新建整个 `docs/release-notes/` 时，git 默认只报未跟踪目录 `docs/`，合法的新说明被误判为未知改动 | `git status` 改为 `--untracked-files=all`，按实际文件路径执行白名单；隔离场景已验证 |
| F8（中） | `src/lib/client-package-version.ts:21` | 版本比较直接转 Number，超过安全整数时不同版本可能被判相等，从而绕过低版本阻断；递增也可能溢出 | 各版本段必须是安全整数，递增结果也复核；补精度与溢出用例 |
| F9（中） | `scripts/release.mjs:749` | 直接续跑旧归档可能把旧版本标成 GitHub `latest` | 续跑与主入口共用「目标不得低于当前 package.json 版本」规则 |
| F10（低） | `scripts/release.mjs:509` | Release 列表只读前 100 条；旧草稿在后续页时可能误判不存在并尝试重复创建 | 列表端点按页读取，找到目标或最后一页为止；用 100 个前置 Release 的夹具验证 |
| F11（低） | `scripts/package-client.mjs:91`、`README.md`、`AGENTS.md` | 显式发布当前版本时日志误称「测试打包」；文档仍写打包目标只能四种 bump | 区分 test 与按当前版本正式打包；中英文档同步显式版本及续跑参数口径 |

## 3. Anything missing / 未直接修复项

| # | 位置 | 描述 | 建议 |
| --- | --- | --- | --- |
| N1 | `scripts/release.mjs:405` `buildAndArchive` | 归档写入不是事务性的。进程强杀、磁盘写满或外部在构建期间删除说明文件，仍可能留下不完整目录。当前下次运行会检测并阻断，不会误发，但需人工清理 | 用临时目录准备全部文件，校验后原子 rename；重跑时识别唯一暂存目录。已登记 `FUTURE.md` §十三.8 |
| N2 | `.tmp/release-review/integration.mjs` | 隔离集成测试已执行，但尚未固化进 Vitest，未来 CI 不会自动重跑这些生产编排场景 | 精简并固化临时 Git + 假 `gh` 夹具，处理 Windows 可执行 shim。已登记 `FUTURE.md` §十三.9 |
| N3 | 真实 GitHub / Windows 环境 | 本轮按权限纪律没有真实 push、上传或重新生成/安装 103 MB NSIS 包，因此真实首发与安装体验仍需验收 | 首次发版后核对 tag/commit、资产下载与 sha256，并在 Windows 安装启动。已有 `FUTURE.md` §十三.7 |

## 4. Anything wrong / 正确性、兼容性与风险结论

- 修复后未发现剩余的已知逻辑错误、类型错误或语法错误。
- 外部命令均使用参数数组，版本/tag 经过严格校验；未发现 shell 注入面。
- `gh` 凭据不打印；日志只包含版本、路径、哈希和 Release URL。
- 大文件 sha256 与无 digest 下载会占用约一个安装包大小的内存（约 100 MB），对本地发布工具可接受；无 digest 的重复核对会增加一次下载，但这是保证完整性的必要代价。
- `--skip-build` 仍是有意保留的弱校验通道：只核文件头/大小并明确警告，不能证明包内容来自 HEAD。正式首发优先走完整构建。
- 构建日志里的 `module.register()` deprecation 是既有工具链事项，非本轮改动，已存在 `FUTURE.md` §五.15，不在本轮处理。

## 5. 验证证据

### 自动测试与静态检查

- `pnpm test:run`：**86 files / 933 tests，全绿**。
- `pnpm check`：再次全量 Vitest → Web 生产构建 → HTTP 冒烟，**通过**。
- `node --check`：`release.mjs`、`release-publish.mjs`、两个打包脚本和包校验脚本均通过。
- `git diff --check`：通过。
- `pnpm release 1.0.0 --dry-run`：正确列出版本/tag/归档/手写说明，并因当前工作树尚未收口而阻断；未构建、未写 git、未上传。

### 直接执行生产脚本的隔离场景

夹具：`.tmp/release-review/integration.mjs`；临时 Git 仓库 + 本地 bare remote + 假 `gh`，不接触真实 GitHub。

1. 完整发布：提交/tag/原子 push、安装包与校验和上传、手写说明、公开状态。
2. 已公开发布幂等续跑：不新增提交、不重复上传。
3. `--dry-run + --execute`：拒绝且零 gh 调用。
4. 无远端 digest：同大小错误内容被 sha256 核对拦截，恢复正确内容后通过。
5. Release 超过 100 条：分页找到目标，不重复创建。
6. 归档校验和被篡改：预览即阻断。
7. 草稿后补手写说明：`release:publish --execute` 接手并公开。
8. `--notes` 缺失：构建前失败；无归档、无 tag、安装包仍留在 dist。
9. 构建后出现业务提交：拒绝打 tag、拒绝创建 Release。

（输出按场景为 8 组，其中完整发布与幂等续跑合并在第一组。）
