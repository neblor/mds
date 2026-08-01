# 调研报告：web 加载性能 + 桌面端方案（deno desktop vs electron）

日期：2026-08-02

## 一、web 模式载入慢（dev）

### 实测数据（dev，chrome headless，load 事件）

- 请求数 **1752 个**，总 **11.12 MB**，load 事件 2137ms（冷载）
- 构成：JS 10.9MB（97%）| 字体 268KB（2%）| CSS 88KB
- 最大文件：
  - terracotta dev 版 794KB、seroval dev 版 440KB（SolidStart SSR 序列化基建）
  - **lucide-solid 全量：icons/index.jsx 505KB + aliases 3 文件 ~1.5MB，合计 ~2MB**
  - solid-js 预构建 211KB、@vite/client 205KB

### 根因

1. **lucide-solid 全量载入（主要可优化项）**：其 package.json exports 有 `"solid"` 条件 →
   vite-plugin-solid 优先解析到 `dist/source/lucide-solid.jsx`（全量源码入口）。
   dev 模式 vite 不做树摇 → 整个图标库 2MB 展开。build 时会摇掉。
2. **SolidStart dev 基建**：seroval/terracotta 的 development 版（~1.3MB）+ 模块图拆细导致 1752 个请求。这是框架 dev 固有开销。
3. **字体不是主因**（268KB，且 jsDelivr 在线依赖网络，建议本地化但非性能瓶颈）。

### build 产物（树摇验证 ✓）

- `.output/public/_build/assets/`：entry-client 23KB + index 36KB + web 27KB = **88KB 总 JS**
- lucide 全量 2MB 被树摇到仅用到的 ~15 个 icon ✓ 打包产物非常健康

### 优化方案（已实施）

| 项 | 做法 | 效果 |
| --- | --- | --- |
| lucide dev 全量 | 本地 re-export 入口 `src/lib/icons.tsx`（15 个 icon 深路径），vite alias `lucide-solid` → 该文件 | dev 从 2MB → ~15KB |
| 字体本地化 | 下载 subsetted-fonts 的 css+woff2 到 `public/fonts/`，entry-server 改本地 href | 消除 jsDelivr 网络依赖 |
| 死代码 | 删除未引用的 CountdownBar.tsx | 减小打包体积 |

dev 下剩余的大头（seroval/terracotta/solid-js dev 版）为框架基建，无法消除，可接受（build 产物健康）。

## 二、桌面端：deno desktop 现状与评估

### 我们打包出的问题（实测 + 文档确认）

- 产物：`mds-windows.exe` 276KB（启动器）+ `mds-windows.dll` **265MB** + AppIcon.ico
- **265MB 元凶**：打包命令缺 `--exclude-unused-npm`！官方文档：不加该 flag 会把 **lockfile 里全部 npm 快照嵌入**（本机 node_modules 253MB，含 playwright-core/vitest 等 devDeps）。
  加 `--exclude-unused-npm` 后只嵌入模块图可达的包 → 体积骤降。
- 默认后端 = 系统 WebView（webview）；`--backend` 可选 webview / cef / raw

### 官方体积数据（docs.deno.com comparison）

- deno desktop：**~40MB（webview）** / ~150MB（CEF）
- Electron：~100MB+ | Tauri：~2-10MB

### 单文件能力

- `--compress [xz|zstd]`：**自解压单文件**（payload 压缩进 exe，首次启动解压）✓ 可行
- 或目录分发 / .msi（Windows 安装包，文档标注"未支持"，help 里已有该输出类型，存疑）

### 稳定性（关键否决点）

- deno desktop 随 Deno 2.9 刚发布，**未稳定**，GitHub 已有多起 Windows 问题：
  - **#35645**：Windows webview 后端启动失败（stuck empty loading window）
  - **#35562**：Windows webview/raw 后端失败，**仅 CEF 正常**
  - **#35590**：blank window（webview）
  - 我们的"窗口一闪即逝"高度吻合这类 webview 后端 bug 或打包缺 build 产物（deno desktop **不替你 build**，需先 `pnpm build` 产出 `.output/`）
- 文档明确 Windows 缺口：**无 MSI 安装包输出、无自动更新**
- 框架检测：SolidStart 官方支持 ✓（走 `.output/server/index.*`），此点无问题

### deno desktop 结论：暂不满足要求

| 要求 | 状态 |
| --- | --- |
| 单文件 | ✓ 可行（--compress 自解压） |
| 体积明显优于 electron | webview 后端 ~40MB 有优势，但前提是加 --exclude-unused-npm 修复打包；CEF 无优势 |
| 稳定可运行 | ✗ **Windows webview 后端已知 bug 未修**（#35645 开放中）；CEF 稳定但体积无优势 |

→ **建议切 electron**（可保留 web 端为第一优先，桌面端用 electron 包装同一代码库）

## 三、electron 迁移方案（pnpm + electron）

### 为什么 electron

- 成熟稳定：10 年+ 生态，electron-builder 打包/签名/自动更新/安装包全部成熟
- 单文件：electron-builder **portable 模式**（单 exe 自解压，~90-120MB）或 NSIS 安装包（单文件安装）
- 体积：~100MB（含 Chromium+Node），与 deno webview 40MB 相比劣势有限，但**可靠性是决定性因素**
- 技术栈零改动：UI/逻辑/测试（105 个）全部保留

### 架构（最小改动）

```
src/ 现有 SolidStart 代码不变（web 优先，SSR 保留）
electron/
  main.ts        — 主进程：本地起 .output/server（node）或静态文件服务 + BrowserWindow
  preload.ts     — 需要时 IPC
package.json     — electron + electron-builder 配置（main 指向 electron/main.ts）
pnpm build       — 现有 SolidStart build 产出 .output/
pnpm electron:build — electron-builder 打包
```

- 渲染：BrowserWindow 加载 `http://127.0.0.1:<port>`（内置 server）——与现在 deno desktop 思路一致，但由 electron 主进程管理
- 音频/语音缓存路径：`app.getPath("userData")` 下，替代 CWD 方案
- 备选：Tauri（~5MB 单文件）需 Rust 工具链，如未来要极致体积可再评估

### 风险

- SolidStart SSR 在 electron 内置 node server 中运行需验证（.output/server 是 node 产物，electron 主进程可直接跑）
- 若 SSR 有兼容问题，可退化为 client-only 构建（`ssr: false`）+ 静态服务，功能无损（本应用核心是听写流程，SSR 仅首屏优化）

## 四、待办

- [ ] 实施 web 优化（lucide alias + 字体本地化 + 删 CountdownBar）——已在本轮完成，见 git diff
- [ ] 用户确认桌面端方向（deno 再试一次修复 vs 直接切 electron）
- [ ] 若试 deno：加 `--exclude-unused-npm` + 确保先 build + 尝试 `--backend webview` 验证体积
- [ ] 若切 electron：搭建 electron/main.ts + electron-builder 配置
