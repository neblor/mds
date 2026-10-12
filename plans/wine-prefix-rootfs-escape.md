# wine 前缀 `z: -> /` 令文件遍历工具逃逸出仓库（VS Code 搜索吃满 CPU）

> 状态：**已实施（2026-10-12）**。§5 根治已按本方案落地：`winePrefix` / `builderCache` 移出仓库
> 落 `~/.cache/mds`，旧雷（`.tmp/wine-prefix`，1.3 GB）已删除，单测与仓库软链扫描均通过。
> 实施记录见 `.implementation-report/wine-prefix-out-of-repo.md`。本文保留作根因档案与回归依据。
>
> 已实施范围：**§5.1-5.3 根治 + 清理**（含 `.tmp/eb-cache` 外移）。**§5.4 可选加固未做**（暂不需要）；
> §6-3 的真实打包验证未跑（下次 `client:package:wsl` 时即可端到端复核，失败可回滚到 `.tmp/` 方案）。
>
> 本文只涉及构建/工具链，与 Electron 应用运行时逻辑无关，不改动任何业务代码。

---

## 0. 结论速览

| 项 | 内容 |
| --- | --- |
| **现象** | WSL 里出现 4 个 `rg` 进程满载 CPU，`load average` 50 / 22 核 |
| **根因** | 仓库内 `.tmp/wine-prefix/dosdevices/z: -> /` 这条软链，让「跟随符号链接 + 无视 ignore」的文件遍历工具从 `/` 开始遍历整个文件系统（含 `/mnt/c` 上 822 GB 的 Windows 盘） |
| **触发者** | VS Code Server 的产品内搜索（Tailwind / JS-TS / Git 扩展的「找配置文件」搜索） |
| **为何是 wine 造的** | Electron 打 Windows NSIS 包必须经 wine；wine 前缀按设计必然含 `z: -> /` |
| **根治** | 把 `WINEPREFIX`（和 electron-builder 缓存）移出仓库，落 `~/.cache/mds/` 下 |
| **现状** | 已根治：前缀/缓存落 `~/.cache/mds`，`.tmp/wine-prefix` 已删除；`.vscode/settings.json` 兜底保留 |

---

## 1. 现象与现场数据

2026-10-12 21:45 观测到：

| 指标 | 数值 |
| --- | --- |
| 4 个 `rg` 进程 | PID `13010` / `13091` / `13133` / `13231`，父进程均为 `12879`（VS Code 扩展宿主） |
| 已运行 | 44 分钟 |
| 累计 CPU 时间 | **46,490 秒 ≈ 12.9 小时**（44 分钟墙钟内烧掉 12.9 小时 CPU） |
| 瞬时 CPU | 645% + 438% + 385% + 291% ≈ **1739%**（约 17.4 个核） |
| 系统负载 | `load average: 50.17`（22 核） |
| CPU PSI | `some avg10=47.09` |
| 扩展宿主内存 | `12879` RSS **7.8 GB**；全系统 12 Gi / 15 Gi |

四个进程分别是（`-g` 目标不同，其余完全一致）：

```bash
# PID 13133 —— Tailwind 配置发现（占用最高）
rg --files --hidden --case-sensitive --no-require-git \
   -g '**/{tailwind,tailwind.config,tailwind.*.config,tailwind.config.*}.{js,cjs,ts,mjs,mts,cts}' \
   -g '!**/.git' -g '!**/.svn' -g '!**/.hg' -g '!**/.jj' -g '!**/.DS_Store' -g '!**/Thumbs.db' \
   -g '!/{**/.git,**/.svn,**/.hg,**/.jj,**/.DS_Store,**/Thumbs.db,**/.git/**,**/node_modules/**,**/.hg/**,**/.svn/**}' \
   --no-ignore --follow --no-config --no-ignore-global

# PID 13010 / 13231 —— package.json 发现
rg --files --hidden --case-sensitive --no-require-git -g '**/package.json' \
   ... -g '!**/node_modules/**' --no-ignore --follow --no-config --no-ignore-global

# PID 13091 —— .gitignore 发现
rg --files --hidden --case-sensitive --no-require-git -g '**/.gitignore' \
   ... -g '!**/node_modules/**' --no-ignore --follow --no-config --no-ignore-global
```

注意其中的 **`--follow`**（跟随软链）与 **`--no-ignore`**（无视忽略规则），见 §2。

---

## 2. 根因（完整因果链）

### 环 1 —— Electron 要出 Windows 安装包，非 Windows 平台绕不开 wine

`.implementation-report/2026-08-03-nsis-installer-output.md` 已查证：

> electron-builder 26.x 在非 Windows 平台会用 wine **运行刚构建的安装器**来抽取卸载器
> （`NsisTarget.js` 中 `wineVm.exec(installerPath)`）。因此 wine 必须具备 32 位支持。

### 环 2 —— wine 前缀被放在**项目目录内部**

`src/lib/client-wsl-env.ts:78`：

```ts
winePrefix: joinPosix(projectRoot, ".tmp/wine-prefix"),
builderCache: joinPosix(projectRoot, ".tmp/eb-cache"),
```

当时这么做的原因是环境约束（同文件 59 / 61 行注释）：

```ts
/** wine 前缀（独立于只读 HOME 缓存） */
/** electron-builder 缓存（默认 ~/.cache 只读时重定向） */
```

**该约束现已不成立** —— 2026-10-12 实测 `~/.cache` 可写（`drwxr-xr-x andares:andares`，写入测试通过）。
这正是根治可行的前提。

### 环 3 —— wine 前缀**必然**含有一条指向 `/` 的软链

`wineboot --init` 生成的 `dosdevices/` 固定包含：

```text
c:        -> ../drive_c
z:        -> /              ← Z: 盘符按 wine 设计就是「宿主根文件系统」
com1..com8 -> /dev/ttyS*
```

这不是配置错误，是 wine 的标准行为。**于是项目目录里物理上躺着一条指向 `/` 的软链。**

### 环 4 —— 前缀会被**永久复用**，雷不会自己消失

`scripts/package-client-wsl.mjs:93-105`：

```js
const prefixHealthy = existsSync(join(env.winePrefix, "drive_c/windows/syswow64/ntdll.dll"));
if (!prefixHealthy) {
    const initStatus = runInNamespace(wslPrefixInitScript(env));
    if (initStatus !== 0) {
        rmSync(env.winePrefix, { recursive: true, force: true });  // ← 仅初始化失败才删
        ...
    }
}
```

即：**首次打包成功后，1.3 GB 的前缀被无限期复用**，没有任何构建后清理。
当前 `.tmp/wine-prefix` 仍是 9 月 3 日那次构建留下的。

### 环 5 —— VS Code 的搜索恰好具备引爆所需的全部条件

| 条件 | VS Code 的实际行为 |
| --- | --- |
| 递归遍历目录树 | 扩展激活时找 `package.json` / `tailwind.config.*` / `.gitignore` |
| **跟随符号链接** | `--follow`，来自 `search.followSymlinks`，**默认 true** |
| **无视忽略规则** | `--no-ignore`，**故意如此** —— 配置发现必须能看见被 gitignore 的目录里的配置 |
| 兜底防护失效 | `.tmp/` 确实写在 `.gitignore:26`，但 `--no-ignore` 把它关掉了 |

三者叠加：`--follow` + `--no-ignore` + 项目内 `z: -> /` ⇒ **rg 从 `/` 开始遍历整个文件系统。**

### 环 6 —— WSL 把这件事放大成灾难

`/mnt/c` 是 9p 挂载（`cache=0x5`，元数据基本不缓存）且 822 GB。每次 `stat` 都要往返 Windows 主机，
遍历在时间上等价于无穷 —— 实测单跑 `find /` 找同类软链，**120 秒即超时**。

结果：rg 永不结束 → 长驻 → 17 个核被吃满。

> **一句话**：Electron 应用本身无辜。是「Windows 安装包 → wine → 前缀生成在源码树内 → 前缀含 `z: -> /`」
> 留下了雷；而「搜索默认跟随软链 + 无视 gitignore」正好是引爆它的那类工具。

---

## 3. 现场证据（可复现）

以下均为 2026-10-12 实测。取证脚本见 §8。

**E1｜逃逸口唯一** —— 全仓库只有这一条指向外部的软链是 `/`：

```console
$ find . -type l | while read -r l; do t=$(readlink "$l"); [ "$t" = "/" ] && echo "$l -> /"; done
./.tmp/wine-prefix/dosdevices/z: -> /
$ stat -c '%n mtime=%y' .tmp/wine-prefix/dosdevices/z:
.tmp/wine-prefix/dosdevices/z: mtime=2026-08-21 11:09:00
```

**E2｜rg 的 cwd 正常，但它握着的目录句柄在 `/sys`** —— `/sys` 从本仓库无任何正常路径可达：

```console
$ for f in /proc/13133/fd/*; do [ -d "$f" ] && echo "$(readlink $f)"; done | sort -u
/sys/class/bdi
/sys/bus/memory/devices
/sys/devices/system/memory/memory123
/sys/devices/virtual/bdi/9p-9
/sys/class/scsi_disk
```

**E3｜同时在读 `/mnt/c`**（每轮采样路径都在变，说明在活跃遍历）：

```console
$ ls -l /proc/13010/fd | grep -oE '\-> /mnt/[^ ]*'
-> /mnt/c/Windows/WinSxS/Temp/InFlight/...
-> /mnt/c/Users/andar/AppData/Roaming/Code/User/workspaceStorage/.../chatEditingSessions/...
-> /mnt/c/Users/andar/AppData/Roaming/Tencent/xwechat/...
-> /mnt/c/src/lx/lx-web-teacher-h5/public/ueditor/dialogs/insertframe
```

**E4｜直接让 rg 走这条软链，列出的是根文件系统**：

```console
$ rg --files --follow --no-ignore --no-config --hidden .tmp/wine-prefix/dosdevices/z: | head -3
.tmp/wine-prefix/dosdevices/z:/.skip-cloud-init-warning
.tmp/wine-prefix/dosdevices/z:/var/log/auth.log.3.gz
.tmp/wine-prefix/dosdevices/z:/var/log/dpkg.log.6.gz
```

**E5｜Tailwind 扩展自己记了日志**：

```console
$ cat ~/.vscode-server/data/logs/20261012T210533/exthost1/output_logging_*/7-Tailwind\ CSS\ IntelliSense.log
Server was not started. Search for Tailwind CSS-related files was taking too long.
```

**E6｜同一个坑此前已踩过一次** —— `vite.config.ts:43-52` 的注释就是现场记录：

```ts
// 忽略项目内运行时/构建缓存目录：wine 前缀（.tmp/wine-prefix）含
// dosdevices/z: → / 的符号链接，监听器追到根文件系统会撞上符号链接环
// （/run/udev/watch 等）触发 ELOOP 使 dev 服务崩溃。
ignored: ["**/.tmp/**", "**/.output/**", "**/.mds-data/**", "**/dist/**"],
```

Vite 的 chokidar watcher 同属「递归遍历 + 跟随软链」，当时在 Vite 侧堵了，**VS Code 侧从未堵**。

**E7｜为什么"昨天没有"** —— 翻查 `~/.vscode-server/data/logs/`（保留至 10-10）：

| 会话 | 打开的工作区 | 结果 |
| --- | --- | --- |
| 10-10 11:00 | `/opt/zzd/shop` | Tailwind 正常，成功索引 3 个项目 |
| 10-11 00:37 | 无 `mds` | 无异常 |
| 10-12 10:27 | 无 `mds` | 无异常 |
| **10-12 14:17** | **含 `mds`** | **15:42 首次出现 `taking too long`** |
| 10-12 21:05 | 含 `mds` | 再次中招 |

⇒ **不由系统状态变化引起，而是"今天第一次在 VS Code 里打开 `mds`"**。
雷是 8-21 就埋下的，此前没打开该仓库所以未触发。其他常开仓库（`c-thun/koi`、`c-thun/raybend`、
`/opt/zzd/shop`）经查**均无同类逃逸软链**，`mds` 是独一份。

---

## 4. 已完成的临时处置（**不要重做**）

| # | 动作 | 状态 |
| --- | --- | --- |
| A | `kill -TERM 13133 13010 13231 13091` | ✅ 四个进程干净退出；`load 50.17 → 8.38`；扩展宿主 RSS 7.8 GB → 7.0 GB 并持续回落 |
| B | 新建 `.vscode/settings.json`（此前无 `.vscode/` 目录） | ✅ 内容见下 |

```jsonc
{
  "search.followSymlinks": false,
  "search.exclude": { "**/.tmp": true, "**/.tmp/**": true },
  "files.watcherExclude": { "**/.tmp/**": true }
}
```

> **注意，B 只是兜底，不构成根治。** `rg` 是 VS Code 派出去的，若配置未生效或换个工具，仍会复发。
> 且它保护不了别的「递归遍历 + 跟随软链」工具（claude/codex 的 glob、ripgrep CLI、
> 各类文件索引器、备份/同步软件、`tar -h` 等）。

**遗留待决（已解决）**：该文件曾带说明注释（JSONC），被 `pi-lens` 的严格 JSON 规则报
`Comments are not permitted in JSON`。**处理结果（2026-10-12）**：注释已删除（理由由本文与
`.implementation-report/wine-prefix-out-of-repo.md` 承载），文件现为纯净 JSON，三条设置保留作纵深防护。

---

## 5. 待做：根治（把 wine 前缀与 builder 缓存移出仓库）

### 5.1 改 `src/lib/client-wsl-env.ts`

`buildWslPackageEnv` 目前签名 `(projectRoot, uid, pebReady)`，第 70-84 行。建议**新增显式参数**保持纯函数可测：

```ts
export function buildWslPackageEnv(
    projectRoot: string,
    uid: number,
    pebReady: boolean,
    cacheRoot: string = defaultCacheRoot(),   // 新增
): WslPackageEnv {
    const wine32Root = joinPosix(projectRoot, ".tmp/wine32");   // 可继续留在仓库内
    return {
        wine32Root,
        pebDir: joinPosix(wine32Root, "root/usr/lib/i386-linux-gnu/wine/i386-windows"),
        systemPebDir: SYSTEM_WINE_PEB_DIR,
        runtimeDir: `/run/user/${uid}`,
        winePrefix: joinPosix(cacheRoot, "wine-prefix"),        // ← 从 .tmp/ 移出
        builderCache: joinPosix(cacheRoot, "eb-cache"),         // ← 从 .tmp/ 移出
        pebReady,
    };
}
```

`defaultCacheRoot()` 建议：

```ts
function defaultCacheRoot(): string {
    const base = process.env.XDG_CACHE_HOME
        ?? (process.env.HOME ? joinPosix(process.env.HOME, ".cache") : "/tmp");
    return joinPosix(base, "mds");
}
```

### 5.2 施工约束（务必先看）

1. **不要用 `XDG_RUNTIME_DIR` 作为落点。** `wslNamespaceScript` / `wslPrefixInitScript` 都会
   `mount -t tmpfs tmpfs /run/user/<uid>`，该目录在命名空间内被 tmpfs 覆盖
   （`buildWslPackageEnv` 里 `runtimeDir` 的用途就是这个）。
2. **`HOME` 在命名空间内可用**：`wslNamespaceScript` 第 111 行有
   `export HOME=${process.env.HOME ?? "/root"}`。但更稳妥的做法是在**命名空间外**把最终绝对路径算好
   再传进脚本 —— `scripts/package-client-wsl.mjs` 对 `nodeDir` / `pnpmDir` 已是这个套路
   （用 `realpathSync` 解析，避开 fnm 的 `/run/user` shim 符号链接问题）。**cacheRoot 也应
   `realpathSync` 解析后再用**，否则可能把符号链接路径写进脚本。
3. **wine 前缀是 32 位 PE 集合，体积 1.3 GB** —— 外移后不再计入仓库体积，`.gitignore:26` 的
   `.tmp/` 条目对 `wine32` 仍然需要，**不要删**。
4. `.tmp/wine32`（653 MB，解包的 i386 PE 集合）**不含逃逸软链，可以继续留在仓库内**，
   本次不必动（如需一并外移，属可选优化，会牵动 `ensureWine32PebSet` 与首次下载路径）。
5. **改动后必须清理旧前缀**，否则旧雷照旧躺在 `.tmp/wine-prefix`：
   ```bash
   rm -rf .tmp/wine-prefix      # 1.3 GB，含 z: 软链
   ```
6. 同步排查 `AGENTS.md`（第 107 行附近提到 `ELECTRON_MIRROR` / 打包镜像）与 `README.md`
   中关于 `.tmp` 布局的描述，若提及 `wine-prefix` / `eb-cache` 位置需一并更正。

### 5.3 同步更新单测 `src/lib/client-wsl-env.test.ts`

现有断言硬编码了旧路径，改完必然失败，需要同步（共 104 行）：

| 行号 | 现有断言 |
| --- | --- |
| 27 | `expect(env.wine32Root).toBe("/repo/.tmp/wine32")` |
| 29 | `pebDir` 为 `/repo/.tmp/wine32/root/usr/lib/i386-linux-gnu/wine/i386-windows` |
| 32 | `expect(env.winePrefix).toBe("/repo/.tmp/wine-prefix")` |
| 33 | `expect(env.builderCache).toBe("/repo/.tmp/eb-cache")` |
| 55 | `expect(script).toContain("export WINEPREFIX=/repo/.tmp/wine-prefix")` |
| 57 | `expect(script).toContain("export ELECTRON_BUILDER_CACHE=/repo/.tmp/eb-cache")` |

**建议新增回归断言**（这条是本 bug 的护栏，务必加）：

```ts
// 前缀必须落在仓库之外 —— 见 plans/wine-prefix-rootfs-escape.md
// wine 前缀含 dosdevices/z: -> /，一旦落在仓库内会让跟随软链的遍历工具逃逸到根文件系统
expect(env.winePrefix.startsWith(projectRoot + "/")).toBe(false);
expect(env.builderCache.startsWith(projectRoot + "/")).toBe(false);
```

（`wine32Root` 属于有意留在仓库内，不在此断言范围。）

### 5.4 可选加固（若希望彻底不留余地）—— **本轮未做，已登记到 `FUTURE.md` §四**

- 在 `scripts/package-client-wsl.mjs` 打包成功后增加**可选清理**（如
  `rm -rf "$WINEPREFIX"`，或加 `--prune-prefix` 开关）。但这会牺牲下次构建的复用速度
  （前缀初始化约需下载/解包 + `wineboot`），**不建议默认开启** —— §5.1 外移后已无必要。
- 若担心仍有其他工具踩坑，可在 `plans/` 之外加一个 `pnpm` 可执行的体检脚本
  （符合 `AGENTS.md:140` 对诊断脚本的要求）：扫描仓库内指向仓库外的软链并告警。

---

## 6. 验证方式

1. `pnpm test:run` —— 单测全绿（确认 §5.3 的断言已生效）。
2. `pnpm check` —— 按 `package.json` 的 `check` 脚本跑完整链路。
3. **跑一次真实打包**（复用已有 `.tmp/wine32`，只需重新初始化前缀）：
   ```bash
   pnpm client:package:wsl test
   ```
4. 确认新前缀落在仓库外且**仓库内不再有任何指向 `/` 的软链**：
   ```bash
   ls -la ~/.cache/mds/wine-prefix/dosdevices/     # 应看到 c: / z: / com1..8
   find . -type l -not -path './node_modules/*' \
     | while read -r l; do t=$(readlink "$l"); [ "$t" = "/" ] && echo "残留: $l"; done
   # 期望：无输出
   ```
5. 确认旧前缀已清空：`ls .tmp/` 中**不应再有 `wine-prefix`**。
6. 关掉再打开 VS Code 的该工作区，确认不再出现 rg 长驻：
   ```bash
   pgrep -a rg                 # 期望：无输出，或短暂出现后自行退出
   cat /proc/loadavg           # 期望：1 分钟负载回到个位数
   ```
7. 顺带确认 Tailwind 恢复可用：`~/.vscode-server/data/logs/<会话>/exthost1/output_logging_*/7-Tailwind CSS IntelliSense.log`
   不再出现 `Search for Tailwind CSS-related files was taking too long.`，且能正常建出项目索引。

> 完成根治后，§4 的 `.vscode/settings.json` 可**保留**（纵深防护，代价为零）也可删除。
> **实际决策：保留**（文件已是纯 JSON，无注释）。

---

## 7. 影响面提示

- **同类工具都会中招**：任何「递归遍历 + 跟随符号链接」的软件 —— 其他编辑器/IDE 的全局搜索、
  文件索引与同步工具、备份软件、`tar -h`、`rsync -L` 等。本次只是 VS Code 先撞上。
- **`/mnt/c` 是重灾区**：9p 挂载 + 822 GB，遍历代价极高，且会把 Windows 宿主机一起拖慢。
- **仓库体积**：外移后 `.tmp/` 从约 2 GB 降到约 670 MB（`wine32` 653 MB + `eb-cache` 20 MB）。
- **业务代码零影响**：改动仅限构建脚本与单测，不触及 `src/` 下任何运行时逻辑。

---

## 8. 附录：取证脚本

需要再次取证时（只读，安全）：

```bash
# 1) 谁在吃 CPU
ps -eo pid,ppid,etime,time,stat,%cpu,%mem,args --sort=-%cpu | grep -E 'rg|ripgrep' | grep -v grep

# 2) rg 真正在走哪里 —— 目录句柄是决定性证据
#    出现 /sys/** 或 /mnt/** 即证明已逃出工作区
for p in $(pgrep -x rg); do
  echo "--- PID $p cwd=$(readlink /proc/$p/cwd) ---"
  for f in /proc/$p/fd/*; do [ -d "$f" ] && readlink "$f"; done | sort -u
done

# 3) 仓库内指向仓库外的软链（逃逸口排查）
cd <repo> && find . -type l -not -path './node_modules/*' | while read -r l; do
  t=$(readlink "$l"); case "$t" in /*) echo "ESCAPE $l -> $t";; esac
done

# 4) 最小复现（复刻 Tailwind 扩展那条命令，12 秒自断）
timeout 12 rg --files --follow --no-ignore --no-config --hidden .tmp/wine-prefix/dosdevices/z: | head
```

---

## 9. 关键事实速查表
| 事实 | 值 |
| --- | --- |
| 逃逸软链 | `.tmp/wine-prefix/dosdevices/z: -> /`（2026-08-21 生成） |
| 次要逃逸点 | `.tmp/wine-prefix/dosdevices/com1..com8 -> /dev/ttyS*`（危害小，同批生成） |
| 前缀定义处 | `src/lib/client-wsl-env.ts:78`（`winePrefix`）、`:79`（`builderCache`） |
| 前缀初始化 | `src/lib/client-wsl-env.ts:118` `wslPrefixInitScript`（`rm -rf` + `wineboot --init`） |
| 前缀复用逻辑 | `scripts/package-client-wsl.mjs:93-105`（仅失败时清理） |
| 单测 | `src/lib/client-wsl-env.test.ts`（104 行，6 处路径断言需同步） |
| 既有同类修复 | `vite.config.ts:43-52`（watcher 侧早已堵住） |
| VS Code 配置 | `search.followSymlinks` 默认 `true`；配置发现类搜索强制 `--no-ignore` |
| 落点建议 | `$XDG_CACHE_HOME` 或 `~/.cache` + `/mds`（**不可用** `XDG_RUNTIME_DIR`，见 §5.2-1） |
| 当前前缀体积 | 根治后 `.tmp/` 仅剩 `wine32` 653 MB；前缀与 `eb-cache` 均在 `~/.cache/mds` |
| `~/.cache` 可写性 | 2026-10-12 实测**可写**（当初"只读"约束已失效） |

---

## 10. 实施结果（2026-10-12）

| 项 | 结果 |
| --- | --- |
| `src/lib/client-wsl-env.ts` | 新增 `defaultCacheRoot(env?)`（`$XDG_CACHE_HOME/mds` → `~/.cache/mds` → `/tmp/mds`，非绝对路径/空白按未设置处理）；`buildWslPackageEnv` 新增第 4 参 `cacheRoot`（默认取 `defaultCacheRoot()`），`winePrefix`/`builderCache` 改落 `cacheRoot` 下；两处 `export WINEPREFIX`/`ELECTRON_BUILDER_CACHE` 补引号（路径现在派生自 `HOME`） |
| `scripts/package-client-wsl.mjs` | 新增 `resolveCacheRoot()`：先 `mkdirSync` 再 `realpathSync`（与 nodeDir/pnpmDir 同思路），避免软链路径写进命名空间脚本 |
| `src/lib/client-wsl-env.test.ts` | 6 处旧路径断言同步 + 新增护栏：前缀/缓存必不在 `projectRoot` 内（含 `rm -rf` 目标校验）、`defaultCacheRoot` 各分支与 `XDG` 相对路径降级 |
| 清理 | `.tmp/wine-prefix`（1.3 GB，含 `z: -> /`）已 `rm -rf`；`.tmp/eb-cache`（20 MB）迁至 `~/.cache/mds/eb-cache` 保留下载缓存 |
| 验证 | `pnpm test:run` 49 文件 / 455 用例全绿；仓库软链扫描无输出（无指向仓库外的软链）；`.tmp/` 1.3 GB → 727 MB |
| 未做 | §5.4 可选加固（体检脚本、prune 开关）；§6-3 真实打包复核 —— 均已登记到 `FUTURE.md` §四，不在本文件另立第二份待办 |
| 附带 | `vite.config.ts` 注释改为反映外移后的现状（忽略列表保留作纵深防护）；`.vscode/settings.json` 兜底保留 |
