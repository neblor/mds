# wine 前缀逃逸根因：前缀与 builder 缓存移出仓库

> 日期：2026-10-12 · 方案存档：`plans/wine-prefix-rootfs-escape.md`（含完整根因取证与现场数据）
> 性质：构建/工具链改动，**业务代码零影响**（不触及 `src/` 下任何运行时逻辑）

## 需求

仓库内 `.tmp/wine-prefix/dosdevices/z: -> /` 这条软链，使「递归遍历 + 跟随符号链接 + 无视 ignore」的
工具（VS Code 的 Tailwind / `package.json` / `.gitignore` 配置发现搜索）从 `/` 开始遍历整个文件系统，
连带横扫 9p 挂载上的 822 GB Windows 盘，导致 4 个 `rg` 长驻、17 个核被吃满（load 50）。

临时止血已完成（kill 进程 + `.vscode/settings.json` 兜底，见方案 §4）。本次做**根治**：让 wine 前缀
在物理上不再进入源码树。

## 实现概览

### 落点变更（`src/lib/client-wsl-env.ts`）

- 新增 `defaultCacheRoot(env = process.env)`：`$XDG_CACHE_HOME/mds` → `~/.cache/mds` → `/tmp/mds`；
  非绝对路径或纯空白的 `XDG_CACHE_HOME` 按未设置处理（XDG 规范要求绝对路径），HOME 空则退回 `/tmp`
- `buildWslPackageEnv(projectRoot, uid, pebReady, cacheRoot = defaultCacheRoot())`：
  第 4 参显式可注入，保持纯函数可测；`winePrefix` / `builderCache` 改落 `cacheRoot` 下
  （`<cacheRoot>/wine-prefix`、`<cacheRoot>/eb-cache`）
- `wine32Root`（`.tmp/wine32`）**有意保留在仓库内**：解包出的 i386 PE 集合不含逃逸软链，
  外移会牵动 `ensureWine32PebSet` 的下载/解包路径，收益为零
- `wslNamespaceScript` 中 `export WINEPREFIX=` / `export ELECTRON_BUILDER_CACHE=` 补双引号：
  路径现在派生自 `HOME`，不能再假定无空白字符
- `WslPackageEnv` 接口注释写明「必须在项目目录之外」及其理由，防止后人再挪回去

### 脚本侧（`scripts/package-client-wsl.mjs`）

- 新增 `resolveCacheRoot()`：先 `mkdirSync(root, { recursive: true })` 再 `realpathSync(root)`，
  与既有 `nodeDir` / `pnpmDir` 的处理同思路 —— 避免把 `~/.cache` 这类软链路径写进命名空间脚本
- 顶部文件注释补充「前缀与缓存落在 `~/.cache/mds`」及其理由

### 测试（`src/lib/client-wsl-env.test.ts`）

- 6 处硬编码旧路径的断言同步到显式注入的 `/home/u/.cache/mds`
- **新增本 bug 的护栏**（关键）：`winePrefix` / `builderCache` 一律断言 `startsWith(projectRoot + "/") === false`，
  并额外校验 `wslPrefixInitScript` 的 `rm -rf "<prefix>"` 目标同样落在仓库外
- 新增 `defaultCacheRoot` 用例：XDG 优先 / HOME 回退 / 尾斜杠归一 / 相对路径与空白降级 / 无 HOME 退 `/tmp`，
  以及「真实进程环境下不传 `cacheRoot` 也不得进仓库」

### 清理与验证

| 动作 | 结果 |
| --- | --- |
| `rm -rf .tmp/wine-prefix` | 1.3 GB、含 `z: -> /` 与 `com1..8 -> /dev/ttyS*`，已删除 |
| `.tmp/eb-cache` → `~/.cache/mds/eb-cache` | 用 `mv` 而非删除，保留下载好的 electron/nsis/7zip 缓存 |
| `pnpm test:run` | 49 文件 / 455 用例全绿 |
| 仓库软链扫描 | `find . -type l`（排除 `node_modules`/`.git`）→ 无任何指向仓库外的软链 |
| 落点核对 | `defaultCacheRoot()` 实测 `/home/andares/.cache/mds`，`winePrefix` 在仓库外 |
| `.tmp/` 体积 | 约 2 GB → 727 MB（仅剩 `wine32` 653 MB 与其他小文件） |

### 附带

- `vite.config.ts` 的 watcher 忽略注释改为反映外移后的现状（说明这是纵深防护而非当前必需），
  `ignored` 列表本身不动
- `.vscode/settings.json` 兜底**保留**（用户决策）：`search.followSymlinks: false` +
  `search.exclude`/`files.watcherExclude` 的 `**/.tmp/**`，代价为零，防别的工具踩同类坑
- `AGENTS.md` / `README.md` 经查未提及 `wine-prefix` / `eb-cache` 位置，无需更正

## 关键决策

| 决策 | 说明 |
| --- | --- |
| 前缀落 `~/.cache/mds` 而非 `XDG_RUNTIME_DIR` | 命名空间脚本会用 `mount -t tmpfs tmpfs /run/user/<uid>` 覆盖该目录，前缀放那里会被抹掉 |
| `cacheRoot` 作为显式参数而非读环境 | 保持 `buildWslPackageEnv` 纯函数、单测不依赖宿主环境；默认值仍走 `defaultCacheRoot()` 供脚本零配置使用 |
| 软链解析放在脚本而非纯函数 | `realpathSync` 需要目录已存在，属 I/O 副作用；纯函数只管路径拼装 |
| 删除而非迁移旧前缀 | 前缀的 registry 记录了自身 Unix 路径，跨目录迁移有踩坑风险（`wineboot --init` 重建成本远低于排查成本）；`eb-cache` 内容与路径无关，故用 `mv` 保留 |
| 不做 prune 开关与体检脚本 | §5.4 可选加固：外移后已无必要，且体检脚本可由本报告的一次性扫描替代；如日后仓库再现同类软链，再补脚本不迟 |

## 后续可能处理的部分

> 下列项已全部登记到 `FUTURE.md` §四（待办唯一入口）；本报告不再维护第二份清单。
1. **§6-3 真实打包尚未跑**：下次执行 `pnpm client:package:wsl <bump>` 时会重新初始化前缀
   （`~/.cache/mds/wine-prefix`，约 1.3 GB，需 wine32 + `wineboot --init`，无需重新下载 deb），
   本次未跑以节省一次完整构建。若该路径在命名空间内出现问题，回滚方式是把 `cacheRoot` 参数改回
   `projectRoot/.tmp` 一处即可。
2. **同类风险仍在别处**：任何「递归遍历 + 跟随符号链接」的工具都可能被其他来源的软链引爆
   （`node_modules` 里 pnpm 的软链即是常态）。本次只保证源码树内不再有指向 `/` 的软链。
3. 若希望把 `.tmp/wine32`（653 MB）也移出仓库，需同步改 `ensureWine32PebSet` 的 deb 下载目录与
   `.gitignore` 说明，属可选优化。
