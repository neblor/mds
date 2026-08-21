# 输出形式切换为 Windows NSIS 安装包

## 需求

将 Electron 交付形式从单文件 portable EXE 改为 NSIS 安装包（按用户确认的参数：引导式安装、仅当前用户、可选安装目录、不建桌面快捷方式、安装完成不自动运行、卸载保留用户数据、产物名 `mds-<version>-setup.exe`、完全替换 portable、不展示许可页）。

## 关键决策

### 安装器配置（package.json `build.nsis`）

- `oneClick: false` + `allowToChangeInstallationDirectory: true`：引导式向导，可改安装目录
- `perMachine: false`：仅当前用户，无需 UAC；`allowElevation` 保持默认
- `createDesktopShortcut: false`、`createStartMenuShortcut: true`：按用户选择不建桌面快捷方式
- `runAfterFinish: false`：安装完成不自动运行
- `deleteAppDataOnUninstall: false`：卸载保留 `userData`（词库 localStorage、音频/释义/中文词缓存、AI 日志）
- `language: "2052"`：安装向导界面为简体中文（与全中文应用一致）
- `uninstallDisplayName: "默点啥"`：控制面板卸载列表显示中文名（不受"产物文件名不用中文"约束，这是显示名）
- 产物名 `mds-${version}-setup.exe`；`win.target` 从 `portable` 改为 `nsis`，删除 `portable` 配置块

### 运行时数据路径简化（electron/runtime-paths.mjs）

portable 的 `PORTABLE_EXECUTABLE_DIR` 机制在 NSIS 下不存在（该环境变量只由 portable 目标注入），原逻辑成为死分支。安装版统一使用 `userData/mds-data`：符合 Windows 惯例（per-user 安装的数据放用户目录）、配合 `deleteAppDataOnUninstall: false` 卸载保留、不在安装目录留数据残渣。`clientDataDirCandidates` 相应简化为单候选；`ensureWritableDataDir` 保留（写探测仍是有用的防御）。

### 工具链适配（scripts、client-package-version）

- `package-client.mjs`：`electron-builder --win portable` → `--win nsis`
- `verify-electron-package.mjs`：产物名 `mds-<v>-setup.exe`，文案改"安装包"
- `client-package-version.ts`：`artifactName` 改 `mds-<version>-setup.exe`（同步两处测试与 cleanup 测试）
- 校验内容不变：MZ 头、包内运行文件（`.output/server/index.mjs`、`electron/*`）、无 `node_modules`/`word-cache`；清理逻辑不变（仅保留最终 setup.exe）

### 为什么绕不开 wine32（资料查证结论）

NSIS 3.x 只能产出 32 位 PE 安装器壳（所以才能同时支持 32/64 位 Windows）；electron-builder 26.x 在非 Windows 平台会用 wine **运行刚构建的安装器**来抽取卸载器（`NsisTarget.js` 中 `wineVm.exec(installerPath)`）。因此 wine 必须具备 32 位支持。electron-builder 的 NSIS 配置（本地 scheme.json 全部 44 项）无任何位数/架构开关；NSISBI 分支的 README 也明确 Linux 构建需 `wine wine32 libwine`。唯一理论跳过路径是自定义整套 `installer.nsi`（同时放弃其卸载器生成），等于 fork 官方模板，不可维护，不采用。

### WSL 受限环境的免 root 方案（client:package:wsl）

本沙箱无 root、系统目录只读、`/run/user/<uid>` 只读、`~/.cache` 只读，但用户命名空间可用。方案：

1. 下载并**解包**（非安装）Ubuntu `libwine:i386` + `wine32:i386` deb 到 `.tmp/wine32/root`，得到 785 个 32 位 PE 文件
2. 关键补丁：Debian 的 `libwine:i386` 不含 `zlib1.dll`（32 位 wow64 进程链需要），而系统 `libwine:amd64` 恰好附带这一个 32 位 `zlib1.dll`——将其合并进 PE 集合
3. 在 `unshare --map-root-user --mount` 命名空间内：bind-mount PE 集合到 `/usr/lib/x86_64-linux-gnu/wine/i386-windows`，tmpfs 覆盖 `/run/user/<uid>`（wineserver socket 目录）
4. wine 前缀与 electron-builder 缓存重定向到项目 `.tmp`（`WINEPREFIX`/`ELECTRON_BUILDER_CACHE`）
5. PATH 显式指向 node/pnpm 真实安装目录（fnm 通过 `/run/user` 符号链接提供 shim，会被 tmpfs 覆盖）
6. 命名空间内执行与 `client:package` 完全相同的 `pnpm client:package <bump_type>`

纯逻辑（deb URL 常量、路径环境组装、命名空间脚本生成）抽到 `src/lib/client-wsl-env.ts` 并单测（4 个用例）；入口 `scripts/package-client-wsl.mjs` + `pnpm client:package:wsl <bump_type>`。

## 结果

- `pnpm client:package:wsl test` 端到端成功：`dist/electron-test/mds-0.2.1-setup.exe`（约 102 MB），校验通过（MZ 头/包内运行文件/无多余目录），清理后仅保留安装包，版本未变；首次运行自动下载解包 wine32（约 100 MB，落 `.tmp`），之后复用
- 32 位 wine 验证：前缀 syswow64 填充 813 文件，32 位 `reg.exe` 正常返回注册表数据
- `pnpm check` 全绿；单测 285 个（34 文件）全部通过
- AGENTS.md / README 已同步安装包说明与 WSL 打包入口

## 后续可处理

- 正式发布仍由用户执行 `pnpm client:package major|minor|patch`（或 `client:package:wsl`）；建议首个安装包版本用 `minor`（0.2.x → 0.3.0）以区分输出形式变化
- 从 portable 升级到安装版的用户无自动迁移：旧 exe 旁的 `mds-data` 不会被新安装版读取，必要时可加一次性迁移逻辑（当前用户量小，暂不做）
- `latest.yml`/blockmap 是 electron-builder 自动生成的更新元数据，若将来做自动更新（publish 配置）可直接复用
