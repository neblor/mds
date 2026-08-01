# 默点啥 mds — 实施计划

## Context

`默点啥`：一个极简的默写辅助工具。用户输入单词列表 → 预生成语音（edge-tts）→ 按计算好的节奏逐词播报 → 用户用笔书写（书写模式）或键盘输入（赛博模式）→ 查看结果对照批改。无数据库/缓存需求（设置用 localStorage）。目标产物：**Windows 免安装可执行程序**（deno desktop）。

规划段已完成：需求分析拆解 ✅、用户澄清 ✅、技术难点资料查询 ✅（均查官方文档，非猜测）。

## 用户已确认的决策

| 决策点 | 结论 |
| --- | --- |
| 包管理/工具链 | **pnpm 管依赖 + vite 构建，deno 负责 desktop 运行与 Windows 打包**（不迁移到 deno 包管理） |
| 每轮时长计算 | `round = max(书写估算, 音频时长×播报遍数) + 1.5s 缓冲`；书写估算 = 字母数 × 系数（**中 0.45s/字母**，快 ×0.6，慢 ×1.8）；释义模式额外 `+ 释义词数 × 0.5s`；最后整体 × `倍率调整`（设置项，默认 1） |
| 对错判断 | **仅赛博模式判断**（书写模式无输入，结果页只显示答案+释义供自查） |
| 对错匹配规则 | **严格匹配**：trim 首尾空白后，大小写/标点/中间空格完全一致才算对（`Hello` ≠ `hello`，`give up` ≠ `giveup`） |
| 播报遍数 | 释义模式必 3 遍；非释义：单词 <6 字母 2 遍，≥6 字母 3 遍 |

## 技术调研结论（官方文档确认）

### deno desktop（docs.deno.com/runtime/desktop/）

- 需 Deno v2.9.0+，本机已装 **deno 2.9.4** ✅
- **原生支持 SolidStart**：检测 `package.json` 里的 `@solidjs/start`，把框架构建产物作为 `Deno.serve()` handler 运行，webview 指向本地 HTTP（端口由 `DENO_SERVE_ADDRESS` 自动分配）
- 流程：先构建框架（vite build + nitro → `.output/`），再 `deno desktop .`；VFS 自解压
- **Windows 交叉编译**：`deno desktop --target x86_64-pc-windows-msvc .` 可在 Linux 主机产出 Windows x86_64 目录（`MyApp.bat` 启动器 + `denort.dll` + CEF 库），无需 Windows 工具链
- 配置在 `deno.json` 的 `desktop` 块：`app.name / app.identifier / app.icons.windows(.ico) / backend / output.windows`
- 窗口：`new Deno.BrowserWindow({ title, width, height })`，默认 800×600

### 发音生成（edge-tts）

- TS 方案：**`edge-tts-universal`**（npm），明确支持 Deno
- **关键限制（v1.4.0+）**：Microsoft TTS 需自定义 WebSocket header，**浏览器环境除 Edge 外无法连接** → TTS 必须在 **Deno 服务端**（Nitro server route）合成，webview 里只负责 `<audio>` 播放
- 语音缓存：按单词存 mp3 到可执行文件同目录的 `voice-cache/`，文件名做转义（`'` 等怪字符），增量生成即缓存命中

### AI 释义生成

- 标准 OpenAI 兼容接口，**服务端 fetch**（避免 CORS、key 不暴露前端），一次请求返回全部单词 JSON 释义（英文）
- 需完整错误处理：配置缺失/网络失败/超时/用量耗尽 → 不卡死、不阻塞 UI，提供中止按钮

### 存储

- 设置 → webview localStorage（deno desktop webview 有持久 profile）
- **风险**：若实测 localStorage 不持久，回退方案 = 服务端 API 读写 exe 同目录 JSON 文件

## 架构

```
┌─ deno desktop (Deno runtime, Windows/Linux exe) ─────────────┐
│  Deno.serve handler = SolidStart/Nitro 构建产物 (.output/)    │
│  ├─ 前端 SPA（webview 渲染）: 视图状态机 + UI                 │
│  └─ 服务端 API（Nitro server routes, 跑在 Deno 内）:          │
│     POST /api/tts          合成单词语音(edge-tts-universal)    │
│     GET  /api/audio/:file  返回缓存 mp3（含时长探测）          │
│     POST /api/definitions  OpenAI 兼容 → 全部单词释义 JSON     │
│     GET  /api/settings     文件存储回退方案(如需)              │
└───────────────────────────────────────────────────────────────┘
```

- **前端视图状态机**：`idle(词库) → preparing(默写准备中) → ready(准备完成+Let's Go) → dictating(逐轮) → finished → results → idle(保留词库)`
- **每轮时长**：`max(字母数×系数×档位, 音频时长×遍数) + 1.5s`；释义模式加 `释义词数×0.5s`；最终 ×倍率调整。音频时长在准备阶段由 webview 预加载所有音频读 `duration` 得到（真实值，非估算）
- **跳转解耦**：倒计时结束 ≠ 跳转，仅置"倒计时结束"标记；语音播完 ≠ 跳转，仅置"语音结束"标记；两者都结束才进下一轮（需求原话）
- **赛博模式两步输入**（带释义时）：第 1 步输入单词回车 → 显示在屏上 → 第 2 步长输入框输释义回车 → 两者消失进下一轮

## Files to modify（新增为主，模板已建）

- `deno.json`（新增）— desktop 配置 + 名称/图标/输出路径
- `src/lib/timing.ts` — 每轮时长计算（纯逻辑，单测）
- `src/lib/match.ts` — 严格对错匹配（纯逻辑，单测）
- `src/lib/state.ts` — 默写状态机（纯逻辑，单测）
- `src/lib/tts-filename.ts` — 单词→缓存文件名转义（纯逻辑，单测）
- `src/routes/api/tts.ts`、`src/routes/api/definitions.ts` — 服务端 API（Nitro）
- `src/components/` — WordList / PrepareView / DictationView / ResultsView / SettingsPanel / CountdownBar 等
- `src/routes/index.tsx` — 组装主界面
- `public/icons/app.ico` + `app.png` — 应用图标（lucide 黄星星衍生）
- `.design/mds.pen` + `.design/mds.md` — 界面设计（实施段第一步）
- `.implementation-report/` — 实施报告

## Reuse

- SolidStart 2.0 模板（已建）：`@solidjs/start` + vite + tailwindcss v4
- 待装：`daisyui`、`@headlessui/solid`、`lucide-solid`、`edge-tts-universal`
- 服务端 API 用 SolidStart/Nitro 的 `src/routes/api/*.ts` 机制（server-only 代码跑在 Deno 内）

## Steps

- [x] **技术冒烟**：`pnpm build` → `deno desktop .` 跑起模板（验证 SolidStart 检测 + webview 出界面）
- [x] **冒烟 2**：服务端 route 内调 `edge-tts-universal` 合成一个 mp3（验证 Deno 下 WebSocket 兼容性；失败则换 `@ericc/edge-tts`(JSR)）
- [x] **设计**：`.design/mds.pen` 设计全部界面（词库/准备/默写/结果/设置）→ 视觉确认 → 定稿
- [x] 词库管理：输入回车添加、横向 flex-wrap 列表、清空、点击删除
- [x] 设置：AI baseUrl+key（带范例）、倍率调整、倒计时数字开关（localStorage）
- [x] 服务端 TTS：合成 + 按单词缓存 + 转义文件名 + 中止支持
- [x] 服务端释义：一次调用全部单词 JSON 释义 + 完整错误处理
- [x] 默写流程：准备（预生成音频+释义，毛玻璃遮罩+中止）→ 准备完成/Let's Go → 逐轮（进度条+倒计时条+数字开关+语音播报 2-3 遍）
- [x] 跳转解耦逻辑（倒计时/语音双标记）+ 赛博两步输入
- [x] 结果页：答案对照、严格匹配红绿标、`correct/total`、全对撒花效果（lucide）
- [x] 单元测试：timing / match / state / tts-filename（vitest，随功能同步）
- [x] Windows 打包：`deno desktop --target x86_64-pc-windows-msvc .`，验证产物目录结构 + 图标
- [x] 实施报告写入 `.implementation-report/`

## Verification

- `pnpm build` 通过；`deno desktop .` Linux 冒烟出界面（有 DISPLAY）
- `deno desktop --target x86_64-pc-windows-msvc .` 产物含 `.bat` 启动器 + `denort.dll` + CEF 库，图标生效
- `pnpm test`（vitest）全绿，覆盖时间计算/匹配/状态机/文件名转义边界
- 端到端手测：输词 → 生成语音 → 默写 → 结果批改；释义模式含失败/中止路径
- 设置持久化验证（localStorage 或回退文件方案）

---

# 2026-08-02 更新：web 性能 + 桌面端调研（本轮）

## Context

用户报告两个问题：① dev 模式浏览器载入慢（怀疑 lucide 全量/字体）；② deno desktop 打出的 Windows 程序闪退且非单文件（265MB dll）。
本轮完成调研（详见 `.implementation-report/2026-08-02-research-web-desktop.md`），结论如下，实施计划待审批。

## 调研结论

### web 性能（已实测）

- **原因**：lucide-solid exports 的 `"solid"` 条件让 vite-plugin-solid 解析到全量源码入口，dev 不树摇 → 2MB 全量载入；SolidStart dev 基建（seroval/terracotta dev 版 ~1.3MB）为框架固有。**字体不是主因**（268KB）。
- **build 树摇成功**：客户端总 JS 仅 88KB，产物健康 ✓
- 优化方案：lucide 深路径按需入口 + vite alias；字体本地化；删死代码 CountdownBar.tsx

### deno desktop（不满足要求）

- 265MB 元凶：打包缺 `--exclude-unused-npm` → lockfile 全部 npm 快照嵌入（本机 node_modules 253MB）
- 单文件：`--compress` 自解压可做到单 exe
- 体积：webview 后端官方 ~40MB（需加 exclude-unused-npm）；CEF ~150MB 无优势
- **否决点：Windows webview 后端已知 bug 未修**（denoland/deno #35645/#35562/#35590 空窗口/启动失败），CEF 稳定但体积无优势；Windows 无 MSI/自动更新；deno desktop 刚发布未稳定
- **结论：建议切 electron**（成熟稳定，electron-builder portable 单 exe ~100MB，UI/逻辑/测试零改动）

## 实施计划（待审批）

### A. web 优化（立即可做）

1. `src/lib/icons.tsx` — lucide 按需 re-export 15 个 icon（深路径），`src/lib/icons.d.ts` 补类型声明
2. `vite.config.ts` — alias `lucide-solid` → `src/lib/icons.tsx`
3. 字体本地化 — 下载 subsetted-fonts@1.0.5 的 css+woff2 到 `public/fonts/`，`entry-server.tsx` href 改本地
4. 删除未引用的 `src/components/CountdownBar.tsx`
5. 验证：vitest 105 用例 + build + dev 实测请求数/字节下降

### B. 桌面端（需用户拍板方向）

- **方向 1（推荐）：切 electron** — 搭 `electron/main.ts`（内置 node server 跑 `.output/server` + BrowserWindow）+ electron-builder 配置（portable 单 exe）
- **方向 2：deno 最后尝试** — 打包命令加 `--exclude-unused-npm`、确认先 build、`--backend webview` 重打，验证体积与闪退；若仍闪退则放弃

## 验证

- A：dev 请求数从 1752 → 预期大幅下降；lucide 2MB → ~15KB；build 产物仍 ~88KB
- B：用户 Windows 实测 exe（体积、启动、音频、localStorage）
