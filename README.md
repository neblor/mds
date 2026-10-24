# mds

> 默点啥：一个轻巧的英语默写辅助工具。<br>
> A lightweight English dictation companion for handwriting and keyboard practice.

[中文](#中文) · [English](#english)

---

## 中文

mds（默点啥）把单词收集、发音准备、随机默写和结果对照放进一个简单流程里。它既可以陪孩子用纸笔默写，也支持直接在电脑上输入答案；默写内容可在「单词 / 释义 / 中文词 / 短句 / 音标 / 组句」六种模式间切换；释义、中文词、短句和组句通过 OpenAI 兼容接口生成内容，音标使用内置英式词典（未收录词可用 AI 兜底）。

### 功能

- 单词、词组和短句的快速录入、批量导入、删除与清空
- 录入模式的词表保存在浏览器本地存储；词表模式（SRS）的词库保存在应用数据目录，刷新或重启后仍会保留
- 书写默写与赛博默写两种模式
- 六种默写内容：单词、单词+英文释义、中文对应词、短句、音标、组句；释义/中文词由 AI 批改（同义/改述也算对），短句按整句归一化判定，组句选词作答（仅赛博）
- 音标默写（仅赛博）：从音标块池拼出读音，主重音必须正确；内置英式音标词典、音素试听和全屏音标表
- 可滑动、可扩展的选择条组件切换默写内容，支持点击、拖拽与方向键；选择条右侧是按模式变化的操作区，短句模式可一键`更新短句`（清掉当前这批词的短句缓存，下次准备重新生成）
- 快、中、慢三档节奏及自定义倍率（中文词第二步按字符数 ×5 系数计时）
- Edge TTS 预生成发音，增量缓存，默写时流畅播放
- 可选 AI 内容生成，支持部分结果、超时、中止和兼容降级，中文词独立缓存文件
- 随机顺序、播报进度、倒计时和键盘连续操作
- 释义/中文词模式答完后先经「正在批改」遮罩，一次 AI 请求批改本场全部作答（关 thinking，自动兼容降级），失败/中止自动降级本地匹配
- 结果页按模式通用化：判定字段标红/绿，参考部分（释义对照等）只展示不批改，全对两波星星庆祝
- 词表模式 + FSRS 取词队列（按本次数量取词）；每个词表有学习档案：掌握进度、近 7/30 天正确率、180 天练习热力、14 天到期预测、薄弱/常练词，并可一键专练薄弱词
- Windows NSIS 安装包（引导式安装、仅当前用户、可选安装目录、卸载保留用户数据）

### 快速开始

本地安装与编译需要：Node.js 24+、pnpm 和 Git；Windows 10/11 或 WSL2 均可（WSL 下交叉打包见下文）。`pnpm` 可用 `npm install -g pnpm` 安装；所有命令都在项目根目录执行，不要换成 npm、npx 或 Deno。

```bash
git clone https://github.com/neblor/mds.git
cd mds
pnpm install
pnpm dev
```

开发服务固定运行在 `http://localhost:5199`。首次 `pnpm install` 会下载 Electron 运行时；下载缓慢时可按自己的 shell 语法设置环境变量 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 后重试。

### 本地编译与运行

```bash
pnpm build   # 生成 Web/Nitro 生产产物到 .output/
pnpm start   # 启动已有构建，默认 http://127.0.0.1:3000
pnpm test    # 运行全部 Vitest 单元测试
pnpm check   # 测试 → 生产构建 → HTTP 冒烟，交付前完整检查
```

`pnpm start` 只启动已有 `.output`，不会自动构建；改完代码要先 `pnpm build`。监听地址、端口和缓存目录可传参，也兼容同名环境变量：

```bash
pnpm start -- --host 0.0.0.0 --port 3000 --cache-dir .mds-data/word-cache
```

桌面端不必先打安装包也能在本地运行：

```bash
pnpm client:dev           # 先构建再启动 Electron
pnpm client:start         # 只启动已有 .output
pnpm client:package:dir   # 生成 win-unpacked/ 解包目录，仅用于排查，不是交付形式
```

内置资源（词库、音标词典、音素音频、字体）已随仓库提供。只有需要重新生成时才用 `pnpm build:phonetics`（英式音标词典）或 `pnpm build:phoneme-audio`（45 个音素 MP3），两者默认下载到 `.tmp/`，需要网络。

### 使用方式

1. 输入单词、词组或短句，按回车加入词库；也可以点击输入框右侧的“批量导入”。批量文本支持空格、Tab、回车、英文逗号和英文分号。
2. 选择速度，并在「单词 / 释义 / 中文词 / 短句 / 音标 / 组句」选择条上滑动或点击选择默写内容。短句模式下选择条右侧会出现`更新短句`：清掉当前这批词已生成的短句，下次准备时换成新句子。音标模式只能配合赛博默写。
3. 选择“开始书写默写”或“开始赛博默写”。
4. 等待语音和 AI 内容准备完成，在 `Let's Go!` 界面点击按钮或按回车开始。
5. 完成后查看答案、正确数量和本轮发音。

启用释义、中文词、短句或组句模式前，需要在应用设置中填写 OpenAI 兼容的 Base URL、API Key 和模型名；音标模式遇到词典未收录的词也会用同一配置兜底。配置只保存在本机。

### 人工测试 AI 释义

命令行诊断会直接调用与应用相同的 provider，但不会读写业务缓存，适合判断问题来自 AI 响应还是缓存链路。

```bash
cp .env.example .env
# 编辑 .env，填写服务地址、Key 和模型
pnpm get:explain apple banana "look forward to"
# 抓取中文对应词
pnpm get:explain --chinese apple hello
# AI 批改中文作答（word=学生答案）
pnpm get:explain --grade "hello=你好" "apple=哈喽"
```

输出包含释义（或中文词/批改结果）、缺失词、耗时、`finish_reason`、token 用量和兼容降级记录。`.env` 已被 Git 忽略，请勿提交真实 Key。

### 打包 Windows 安装包

```bash
# 测试打包：不改版本号，产物在 dist/electron-test/
pnpm client:package test

# 正式打包：按需选择版本递增方式，产物在 dist/electron/
pnpm client:package patch
```

`bump_type` 必填，只能是 `major`、`minor`、`patch` 或 `test`：前三种分别递增主、次、修订号（主、次递增会把低位归零），`test` 保持当前版本。命令会先跑 `pnpm check`，再打包、校验包内容并清理临时文件，最终输出目录只保留 `mds-<version>-setup.exe`。只有正式打包成功后才把新版本写回 `package.json`，失败会恢复原版本。

**WSL2 下可以直接执行 `pnpm client:package <bump_type>`。** NSIS 安装器是 32 位 PE，Linux/WSL 交叉打包需要 32 位 wine；检测到系统 wine 缺少 32 位支持且 `unshare` 可用时，命令会自动切换到受限环境流程：首次运行把 wine32 运行件下载解包到 `.tmp/wine32`，wine 前缀与 electron-builder 缓存放在 `~/.cache/mds`（不写入仓库），然后在用户挂载命名空间内执行与正常打包完全相同的步骤，产物一致。因此 WSL 下不需要特意换命令；`pnpm client:package:wsl <bump_type>` 是同一流程的显式入口，产物也相同。首次自动准备需要网络以及 `curl`、`dpkg`。

生成的 EXE 可以直接安装：引导式 NSIS 安装包，仅当前用户、可选安装目录、开始菜单快捷方式「默点啥」、不建桌面快捷方式，卸载默认保留用户数据。WSL 里的产物可从 Windows 资源管理器用 `\\wsl.localhost\<发行版>\...` 路径打开。

### 数据与日志

- Web 默认缓存：`.mds-data/word-cache`（音频 `*.mp3`、释义 `definitions.json`、中文词 `chinese-words.json`）
- 安装版客户端：统一使用 Electron `userData/mds-data/word-cache`（卸载默认保留）
- 复习状态：`.mds-data/review/review.sqlite`（SQLite/WAL）；旧 JSON 首次启动自动迁移，归档到 `review/migrated-v1/`
- AI 诊断日志：Client 的 `mds-data/logs/ai-definitions.log`

AI 日志会记录请求失败、兼容降级、响应缺项或截断及缓存写入失败，但不会记录 API Key；达到 1 MiB 后保留一份轮换日志。

### 常用命令

| 命令 | 用途 |
| --- | --- |
| `pnpm dev` | 启动 Web 开发服务 |
| `pnpm build` | 生产构建到 `.output/` |
| `pnpm start` | 启动已有生产构建（默认 `127.0.0.1:3000`） |
| `pnpm test` | 运行全部 Vitest 单元测试 |
| `pnpm check` | 测试、生产构建和 HTTP 冒烟 |
| `pnpm db:status` | 只读查看复习 SQLite 状态（schema/条数/归档/quick_check） |
| `pnpm db:rollback -- --yes` | 回滚到迁移前的 JSON（先退出应用） |
| `pnpm get:explain ...` | 直接诊断 AI 释义接口（`--chinese` 诊断中文词） |
| `pnpm get:sentences ...` | 诊断短句生成（词数分布、超长收紧） |
| `pnpm get:phonetics ...` | 诊断音标 AI 兜底 |
| `pnpm get:tts ...` | 诊断 Edge TTS 合成与回退 |
| `pnpm client:dev` | 构建并启动 Electron 客户端 |
| `pnpm client:package <major\|minor\|patch\|test>` | 自动检查、按模式管理版本并构建 Windows NSIS 安装包 |

### 技术栈

SolidStart 2 · SolidJS · TypeScript · Tailwind CSS · Electron · Nitro · Vitest · 自研 Edge TTS 客户端（v2 令牌）

---

## English

<!-- “mds” comes from the Chinese name “默点啥”, roughly: “What should I dictate?” -->

mds is a small English dictation app that keeps word collection, speech preparation, shuffled practice, and answer review in one focused flow. It works for pen-and-paper practice as well as typed answers, with six dictation content modes — word, English definition, Chinese equivalent, short sentence, phonetic, and cloze — toggled by a draggable selector bar.

### Highlights

- Add words, phrases, or short sentences with Enter or the bulk importer
- Entry-mode word lists persist in browser storage; SRS banks live in the app data directory across restarts
- Handwriting and keyboard-based dictation modes
- Content modes: word, word + English definition, AI-fetched Chinese equivalent, AI-generated short sentence, phonetic, or cloze (select words; keyboard mode only)
- Phonetic dictation (keyboard only): assemble the pronunciation from IPA chips, with a built-in British dictionary, phoneme playback, and a full-screen IPA chart
- Draggable, extensible selector bar with click, drag, and arrow-key support
- Three pacing levels plus a custom speed multiplier
- Pre-generated Edge TTS audio with incremental local caching
- Optional AI-generated content with abort and fallback handling; Chinese words use a separate cache file
- Shuffled rounds, playback progress, countdowns, and keyboard-first interaction
- Mode-aware result review: graded fields in red/green, reference fields ungraded, two-wave star celebration
- A guided Windows NSIS installer (per-user, custom install directory, data kept on uninstall)
- Per-bank learning archive: mastery progress, 7/30-day accuracy, 180-day practice heatmap, 14-day due forecast, weak/most-practiced words, and one-click weak-word drill

### Getting started

Local install and build require Node.js 24+, pnpm, and Git. Windows 10/11 and WSL2 both work (cross-packaging from WSL is covered below). Install pnpm with `npm install -g pnpm`, and run every command from the project root — do not substitute npm, npx, or Deno.

```bash
git clone https://github.com/neblor/mds.git
cd mds
pnpm install
pnpm dev
```

The development server runs at `http://localhost:5199`. The first `pnpm install` downloads the Electron runtime; if that is slow, set an `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` environment variable (use your shell's syntax) and retry.

### Local build and run

```bash
pnpm build   # production Web/Nitro output in .output/
pnpm start   # serve the existing build at http://127.0.0.1:3000
pnpm test    # all Vitest unit tests
pnpm check   # tests → production build → HTTP smoke test
```

`pnpm start` only serves an existing `.output` build and never rebuilds, so run `pnpm build` after changes. Host, port, and cache directory accept flags or matching environment variables:

```bash
pnpm start -- --host 0.0.0.0 --port 3000 --cache-dir .mds-data/word-cache
```

You can run the desktop shell locally without packaging an installer:

```bash
pnpm client:dev           # build the web app, then launch Electron
pnpm client:start         # launch Electron against the existing .output
pnpm client:package:dir   # win-unpacked/ unpacked directory, for inspection only
```

Built-in assets (word banks, IPA dictionary, phoneme audio, fonts) ship with the repository. Regenerate them only when needed: `pnpm build:phonetics` for the British IPA dictionary and `pnpm build:phoneme-audio` for the 45 phoneme MP3 files. Both download into `.tmp/` and need network access.

### How to use it

1. Enter a word, phrase, or short sentence and press Enter, or open the bulk importer at the right of the input. Bulk text can be separated by spaces, tabs, line breaks, commas, or semicolons.
2. Choose a pace and pick a content mode on the selector bar: word, definition, Chinese word, short sentence, phonetic, or cloze. Phonetic mode only supports keyboard dictation.
3. Start handwriting or keyboard dictation.
4. Wait for audio and AI content, then click `Let's Go!` or press Enter.
5. Review answers, scores, and prepared pronunciation afterwards. Definition, Chinese-word, and cloze answers are graded by one AI request behind a "grading" overlay (with local fallback); short sentences are compared after normalization; phonetic answers are compared token by token.

Definition, Chinese-word, short-sentence, and cloze modes require an OpenAI-compatible Base URL, API key, and model name in the app settings; phonetic mode uses the same configuration for words missing from the built-in dictionary. These settings stay on the local machine.

### Testing the definition provider

The diagnostic command calls the same provider used by the app while bypassing the application cache. This makes it easier to separate upstream AI response problems from cache problems.

```bash
cp .env.example .env
# Fill in the endpoint, key, and model in .env
pnpm get:explain apple banana "look forward to"
# Fetch Chinese equivalent words instead
pnpm get:explain --chinese apple hello
# AI-grade answers (word=student answer)
pnpm get:explain --grade "hello=你好" "apple=哈喽"
pnpm get:explain --grade-def "apple=a round fruit"
```

The output includes definitions (or Chinese words / grades), missing words, elapsed time, `finish_reason`, token usage, and compatibility fallbacks. `.env` is ignored by Git; never commit a real API key.

### Packaging the Windows installer

```bash
# Test package: keep the version, write to dist/electron-test/
pnpm client:package test

# Release package: choose the intended version bump, write to dist/electron/
pnpm client:package patch
```

`bump_type` is required and must be `major`, `minor`, `patch`, or `test`. Major and minor bumps reset lower positions, while `test` keeps the current version. The command runs `pnpm check`, packages, verifies the app contents, and cleans temporary files, leaving only `mds-<version>-setup.exe` in the output directory. The new version is written back to `package.json` only after a successful release package; failures restore the previous version.

**`pnpm client:package <bump_type>` works directly under WSL2.** The NSIS installer is a 32-bit PE, so cross-building on Linux/WSL needs 32-bit wine. When the system wine lacks 32-bit support and `unshare` is available, the command switches automatically to a restricted-environment flow: the first run downloads and extracts the wine32 runtime into `.tmp/wine32`, keeps the wine prefix and electron-builder cache under `~/.cache/mds` (outside the repo), then runs the exact same pipeline inside a user mount namespace with identical output. WSL users therefore do not need a different command; `pnpm client:package:wsl <bump_type>` is an explicit entry point for the same flow with the same artifact. The first automatic setup needs network access plus `curl` and `dpkg`.

The resulting EXE installs as a guided NSIS package: per-user install, optional install directory, a start-menu shortcut named 「默点啥」, no desktop shortcut, and user data kept on uninstall. From WSL, open the artifact in Windows Explorer via a `\\wsl.localhost\<distro>\...` path.

### Runtime data and diagnostics

- Web cache: `.mds-data/word-cache` (audio `*.mp3`, `definitions.json`, `chinese-words.json`)
- Installed client cache: Electron `userData/mds-data/word-cache` (kept on uninstall by default)
- Review state: `.mds-data/review/review.sqlite` (SQLite/WAL); legacy JSON is migrated on first start and archived under `review/migrated-v1/`
- Client AI diagnostics: `mds-data/logs/ai-definitions.log`

Diagnostic logs cover request failures, compatibility fallbacks, truncated or incomplete responses, and cache write failures. API keys are never logged, and the file rotates at 1 MiB.

### Main commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the Web development server |
| `pnpm build` | Production build into `.output/` |
| `pnpm start` | Serve the existing production build (default `127.0.0.1:3000`) |
| `pnpm test` | Run all Vitest unit tests |
| `pnpm check` | Run tests, production build, and HTTP smoke test |
| `pnpm db:status` | Read-only review SQLite status (schema, counts, archive, `quick_check`) |
| `pnpm db:rollback -- --yes` | Roll back to the pre-migration JSON files (quit the app first) |
| `pnpm get:explain ...` | Diagnose the AI content provider directly |
| `pnpm get:sentences ...` | Diagnose short-sentence generation (word-count distribution, retries) |
| `pnpm get:phonetics ...` | Diagnose the AI IPA fallback |
| `pnpm get:tts ...` | Diagnose Edge TTS synthesis and fallbacks |
| `pnpm client:dev` | Build and launch the Electron client |
| `pnpm client:package <major\|minor\|patch\|test>` | Check, manage the version, and build the Windows NSIS installer |

### Stack

SolidStart 2 · SolidJS · TypeScript · Tailwind CSS · Electron · Nitro · Vitest · custom Edge TTS client (v2 token)

## License

Released under the [MIT License](LICENSE).
