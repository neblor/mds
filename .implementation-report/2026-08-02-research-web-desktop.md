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

## 实施结果（2026-08-02 晚）

### web 优化（已完成并实测）

- lucide 按需入口 `src/lib/icons.tsx`（15 icon 深路径）+ vite alias（正则精确匹配，避免深路径误替换；rolldown 严格校验 exports，故深路径也加 alias 到实际目录）
- 字体本地化：subsetted-fonts css + 20 个 woff2 → `public/fonts/sarasa-ui-sc/`，entry-server 改本地 href
- 删除死代码 CountdownBar.tsx
- **实测（dev）**：请求 1752→127、总字节 11.12MB→3.07MB、lucide 2MB→75KB、load 2137→1213ms
- build 产物仍 ~88KB，113 测试全绿

### electron 迁移（已完成）

- `electron/main.mjs`：内置 nitro server（import 即监听，端口 4827）+ BrowserWindow（1120x820）+ 错误日志 userData/mds-error.log；MDS_CACHE_DIR → userData/word-cache
- `word-cache.ts` 支持 MDS_CACHE_DIR 环境变量覆盖
- package.json：main/scripts（electron:start、electron:build）/build 配置（portable 单文件、asar:false、npmmirror 镜像）
- 工具链：electron 43.2.0 + electron-builder 26.15.3；pnpm-workspace.yaml（onlyBuiltDependencies: electron/electron-winstaller/esbuild，pnpm 11 不读 package.json pnpm 字段）；Linux 装 wine 9.0 支持交叉打包
- **打包成功：`dist/electron/默点啥-0.1.0-x64.exe` 106MB 单文件**（对比 deno desktop 265MB 非单文件）
- electron 本地验证：xvfb 下 server 启动 ✓、UI 渲染 ✓（像素分析 336 色 + 背景色匹配）、userData 缓存 ✓、localStorage ✓

### deno 移除

- 删除 deno.json、AGENTS.md 工具链改为 pnpm+electron、.gitignore 保留旧产物忽略
- 遗留待用户 Windows 验证：exe 双击运行、音频（edge-tts 网络合成）、localStorage 持久化

## 2026-08-02 晚（续）：code review 修复 + 文件名规则

### 文件及目录名规则（用户明确）

- **任何生成的文件名不得使用中文**（AGENTS.md 注意事项已更新为正向规则）
- 修复：package.json `productName: mds`、`portable.artifactName: mds-${version}-${arch}.exe`（原"默点啥-…"中文名违反）
- 重新打包验证：`dist/electron/mds-0.1.0-x64.exe`（106MB）全英文文件名 ✓
- 清理：删除 deno 残留 dist/mds-windows/、根目录调试脚本、.gitignore 过时 deno 规则

### code review（2026-08-01-web-core-code-review.md）5 项修复全部实施

1. **[P1] 释义字典原型安全**（definitions.ts）：ownString（Object.hasOwn + 非空字符串）统一取值；readDefsCache schema 清洗；AI 解析用 Object.create(null)；只缓存请求词集合内的键（过滤 AI 乱编键）；明显非英文（CJK）释义不入缓存
2. **[P2] 音频错误分类 + 缓存淘汰**：playWithIntervals 返回 completed/aborted/media-error/play-rejected（NotAllowedError 不算错误）；use-dictation 媒体错误时调 `/api/cache-invalidate`（新路由，文件名白名单）删缓存并继续流程；tts.ts 原子写（临时文件+rename）+ mp3 头校验（ID3/帧同步）
3. **[P2] 准备任务 token 竞态隔离**（use-dictation）：prepSeq 递增 token，所有异步回调写状态前校验 alive()（seq 一致且未 abort）；abortPreparation 先递增 token
4. **[P2] 中止 signal 贯穿服务端**：definitions.ts callAi 用 AbortSignal.any([request.signal, 60s timeout])；降级重试前检查中止；写缓存前检查 signal；tts.ts 合成返回后检查 signal 丢弃结果不写缓存
5. **[P2] 部分释义显式保护**：validFresh 只合并请求集合内键；missing 继续返回；测试锁定"不负缓存、下次重试"

### 测试：113 → 125（+12）

- api.test.ts：playWithIntervals 分类断言更新 + NotAllowedError/play-rejected 用例
- definitions.test.ts：+constructor/toString 原型键、AI 乱编键过滤、中文释义全失败(empty)/部分缺失
- 新增 cache-invalidate.test.ts（4 用例：删除/路径穿越 400/幂等/缺 name 400）
- use-dictation.test.ts：+token 竞态（迟到成功/迟到失败均不覆盖新状态）

### 验证

- 125 测试全绿（10 文件）；pnpm build 通过
- electron 重新打包：mds-0.1.0-x64.exe（106MB）英文文件名 ✓

### 遗留

- AGENTS.md"默完后先显示默完了再查看结果"的流程差异仍待产品确认（报告已注明）

## 2026-08-02 晚（续2）：赛博间隔区跳过 + 无释义标签 + 字体 404

### 赛博模式"自动跳没有了"（根因 + 修复）

- **根因**（用户指出的）：赛博模式输入完成后，播放后的间隔区没有处理——只能干等语音轨全部走完（剩余遍数+间隔），感知为"自动跳没了"；书写模式间隔区有空格跳所以无感
- **修复**（use-dictation.ts checkAdvance）：赛博输入完成后——语音未发声（间隔区）→ 立即中止余下播报并跳转；正在发声 → 等当前遍播完（onAudioState(false) 时再触发 checkAdvance）→ 立即跳
- 单元测试：新增"发声期间输入完成等当前遍"+"间隔区输入完成立即跳"两个用例（126 全绿）

### 无释义时不显示"第 1 步"

- DictatingView.tsx：WordRow 的"第 1 步"badge 用 `<Show when={props.withDefinition}>` 包裹（无释义只有一步输入，不需要步骤标记）

### 字体 404（浏览器刷新一堆 fonts 404）

- 根因：subsetted-fonts css 引用 **97 个** unicode-range 分段（0-96），此前只下载了 20 个 → 浏览器按需加载缺段 404
- 修复：补齐 0-96 全部 woff2（public/fonts/sarasa-ui-sc/ 共 97 文件 2.5MB）；完整性校验 css 引用 vs 本地文件 0 缺失

### 验证

- 126 单测全绿（10 文件）；build 通过
- e2e 抽查（用户要求以单测为主）：无释义"第 1 步"隐藏 ✓、书写空格跳 ✓、字体无 404 ✓

## 2026-08-02 晚（续3）：音频串流 bug 修复 + 状态机重构（用户方法论要求）

### Bug：赛博模式音频串流（第二个第三个一起播）

- **现象**：答完第一个进第二轮后跳到第三个，二、三音频同时播放，出结果还在放
- **根因（重构前静态分析 + 引擎插桩确认）**：
  1. 上一轮加的 `onAudioState(false) → checkAdvance` 回调与 checkAdvance 内部 `clearRoundRuntime → abort → stop() → onAudioState(false)` 形成**重入**：推进过程中中止音频，abort 同步触发 stop 的 onAudioState(false)，再次进入 checkAdvance → startRound/setPhase 可能执行两次 → 两个音频实例同时播放
  2. 附发现：`engine.mode` 未同步（go() 未把 mode 写入引擎，赛博流程实际按 writing 判定）——插桩定位
- **修复**：抽取纯逻辑状态机 + 事件入口防重入（stepping 标志，advance 中止音频引发的嵌套回调被忽略）

### 重构：核心编排抽成独立纯逻辑模块（可单测，不再依赖 e2e）

- 新增 `src/lib/dictation-engine.ts`：纯函数状态机 `stepEngine(state, event) → {state, action}`（wait/advance/finish），无 UI/定时器依赖；事件：submit/audio-state/speech-end/countdown-end/space-skip；状态不可变快照
- `use-dictation.ts` 降为薄适配层：runStep（stepping 防重入）→ 引擎判定 → 执行动作（clearRoundRuntime + startRound/setPhase）→ 同步 SolidJS 信号；checkAdvance/手工 setSpeechDone 全部删除
- 新增 `dictation-engine.test.ts`（18 用例）：双轨全时序、间隔区立即推进、发声等待、空格跳、最后一轮 finish、状态不可变
- use-dictation.test.ts 增"推进时中止音频重入 → 只推进一次"（模拟真实 abort→stop→onAudioState 链，断言 playWithIntervals 恰好调用 2 次，无第三个音频实例）

### 测试：126 → 145（+19）

- 11 文件全绿；build 通过
- 核心时序现在全部由纯函数单测锁定，e2e 仅作抽查

### 遗留

- engine.mode 同步点：go() 写入（startDictation 只更新 UI 信号）——已在重构中修复
