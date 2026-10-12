# Web dev 模式水合失败修复（nitro 资产白名单缺 json）

> 日期：2026-08-29 · 排查触发：用户在 WSL 下 `pnpm web:dev --host` 后 Windows 浏览器打开页面无响应

## 症状

- 浏览器控制台：`已拦截加载自 ".../node_modules/.pnpm/@solidjs+start@.../package.json?import" 的模块，它使用了不允许的 MIME 类型（"text/html"）`
- 页面可见（SSR 输出）但完全不水合：点击无响应、回车无效

## 排查链路

1. 三链路对照 curl（WSL localhost / WSL eth0 IP / Windows `curl.exe` 不走代理）对该模块 URL **都**返回 `200 text/html` → 排除代理与 Windows 网络因素，锁定 dev server 自身
2. URL 对照实验：`.pnpm` 深路径 `.jsx` → `text/javascript` 正常；仅 `.json` → `text/html` → 排除 pnpm 深路径/`+` 号编码因素，锁定文件类型
3. vite DEBUG 日志：失败请求在 `vite:transform/vite:load` 里**零输出** → 请求根本没到 vite，被更早的中间件消费
4. 源码定位 `node_modules/nitro/dist/_build/vite.dev.mjs`：`ASSET_EXT_RE` 白名单不含 `json` → `.json?import` 不被视作资产 → 命中 SPA `/**` 兜底路由 → `nitroDevMiddleware` SSR 渲染返回 `text/html`

与已记录的 `/api/audio` Sec-Fetch-Dest 问题同源（nitro beta dev 分流缺陷），方向相反。

## 修复

`scripts/vite-api-media-route.mjs` 的 dev-only 前置中间件追加第二个改写（与 audio 改写同构、同注册点）：

- `isJsonImportRequest(url)`：路径 `.json` 结尾且查询串含 `import`（含 `?t=...&import` 组合）
- `normalizeJsonImportFetchDest(request)`：把该类请求的 `Sec-Fetch-Dest` 改写为 `script` → nitro 视作资产放行 → vite transform 的 `isImportRequest` 分支正确返回 `text/javascript`

不碰 `vite.config.ts`（折进现有 `apiAudioNitroDevPlugin` 的中间件）；仅 dev `configureServer` 生效，生产 Nitro/Electron 路由不受影响。

## 验证

- 单测：`src/lib/vite-api-media-route.test.ts` 新增 5 例（识别 `?import` 组合、无/empty dest 改写、script 与非 JSON 不动）
- HTTP：用户报错的原始 URL 修复后 `200 text/javascript`
- 浏览器（playwright-core + 本地 chromium，dev 模式 5198）：输单词回车出 chip、历史/设置/批量导入弹窗全部可交互、页面错误 0
- `pnpm check` 全绿：37 文件 321 例 + 生产构建 + 冒烟

## 附带结论（环境侧，非代码问题）

- WSL2 NAT 的 localhost 转发在该机器失效（Windows curl `localhost:5199` = 000）；Windows 直连 WSL IP（`172.24.47.146:5199`）正常。修 localhost 需 `wsl --shutdown`（PowerShell），与本修复无关
- Ctrl+C 退出 pnpm 脚本出现的 `[ELIFECYCLE] Command failed.` 是正常中断提示
- Node 26 的 `ExperimentalWarning: localStorage is not available...` 是 SSR 触碰 `localStorage` global 的一次性提示；业务侧全部有 `typeof` 守卫（实测 `typeof localStorage === "undefined"`），无功能影响

## 后续

- 依赖 nitro beta 版本，升级 nitro/vite 后可回归验证是否已在上游修复（`ASSET_EXT_RE` 补 json），届时可移除该补偿
