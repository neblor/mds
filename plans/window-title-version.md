# 窗口标题栏显示版本号（默点啥 v0.2.2）

## Context

打包后的 Windows 程序运行时，窗口标题栏只显示 `默点啥`。需求：标题栏显示 `默点啥 v0.2.2`（程序名 + 版本号）。

原因分析：`electron/main.mjs` 创建 `BrowserWindow` 时未设置 `title`，页面 SSR 的 `<title>默点啥</title>`（`src/entry-server.tsx`）在页面加载后覆盖窗口标题。

**关键事实**：`scripts/package-client.mjs` 打包前会把目标版本写进 `package.json`，electron-builder 将其打进包内 `resources/app/package.json`。因此运行时用 Electron 内置的 `app.getVersion()` 即可拿到正确的打包版本（如 0.2.2），**打包脚本本身无需改动**——标题逻辑属于运行时（主进程），不属于打包脚本。

**已确认决策**：① 开发模式（`pnpm client:start`）与打包后**都**显示版本号，行为一致、mac 本地可验证；② 改动仅限主进程（electron/*.mjs + 测试），package-client.mjs 不动。

## Approach

在主进程中显式设置窗口标题，并阻止页面 document title 覆盖：

1. `electron/window-options.mjs` — `createMainWindowOptions` 增加可选 `version` 参数，设置 `title: \`默点啥 v${version}\``（无版本时保持默认`默点啥`）。
2. `electron/main.mjs` — 创建窗口时传入 `app.getVersion()`；添加 `mainWindow.on("page-title-updated", (e) => e.preventDefault())` 防止 SSR `<title>` 覆盖标题（这是必须的：否则 loadURL 后标题会变回 `默点啥`）。
3. 更新 `src/lib/electron-window-options.test.ts` 覆盖新 `title` 字段。

## Files to modify

- `electron/window-options.mjs`
- `electron/main.mjs`
- `src/lib/electron-window-options.test.ts`

## Reuse

- `app.getVersion()`（Electron 内置）— dev 下返回 package.json 版本，打包后返回包内版本，两者皆正确，无需在打包脚本中生成版本文件。
- `createMainWindowOptions(appPath)` 现有签名与测试保持兼容（version 可选）。

## Steps

- [ ] `electron/window-options.mjs`：`createMainWindowOptions(appPath, version?)` → `title: version ? \`默点啥 v${version}\` : "默点啥"`
- [ ] `electron/main.mjs`：`createMainWindowOptions(app.getAppPath(), app.getVersion())` + `page-title-updated` preventDefault
- [ ] `src/lib/electron-window-options.test.ts`：补充 title 断言（带版本 / 不带版本）
- [ ] `pnpm check`（vitest + build + smoke）通过

## Verification

- `pnpm test:run` 通过（含新增 title 断言）
- `pnpm client:start`（mac 本地 electron）窗口标题栏显示 `默点啥 v0.2.1`（当前 package.json 版本）
- Windows 端 `pnpm client:package patch` 打包后运行，标题栏显示 `默点啥 v0.2.2`
