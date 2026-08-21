# mds

> 默点啥：一个轻巧的英语默写辅助工具。<br>
> A lightweight English dictation companion for handwriting and keyboard practice.

[中文](#中文) · [English](#english)

---

## 中文

mds（默点啥）把单词收集、发音准备、随机默写和结果对照放进一个简单流程里。它既可以陪孩子用纸笔默写，也支持直接在电脑上输入答案；默写内容可在「单词 / 释义 / 中文词」三种模式间滑动切换——释义与中文词模式通过 OpenAI 兼容接口生成内容（英文释义或常用中文对应词）。

### 功能

- 单词、词组和短句的快速录入、批量导入、删除与清空
- 词库自动保存在浏览器本地存储中，刷新或重启后仍会保留
- 书写默写与赛博默写两种模式
- 默写内容三选一：单词、单词+英文释义、中文对应词（两段式：先英文后中文；释义与中文词均由 AI 批改，同义/改述也算对）
- 可滑动、可扩展的选择条组件切换默写内容，支持点击、拖拽与方向键
- 快、中、慢三档节奏及自定义倍率（中文词第二步按字符数 ×5 系数计时）
- Edge TTS 预生成发音，增量缓存，默写时流畅播放
- 可选 AI 内容生成，支持部分结果、超时、中止和兼容降级，中文词独立缓存文件
- 随机顺序、播报进度、倒计时和键盘连续操作
- 释义/中文词模式答完后先经「正在批改」遮罩，一次 AI 请求批改本场全部作答（关 thinking，自动兼容降级），失败/中止自动降级本地匹配
- 结果页按模式通用化：判定字段标红/绿，参考部分（释义对照等）只展示不批改，全对两波星星庆祝
- Windows NSIS 安装包（引导式安装、仅当前用户、可选安装目录、卸载保留用户数据）

### 快速开始

环境要求：Node.js 24+、pnpm。

```bash
pnpm install
pnpm dev
```

开发服务固定运行在 `http://localhost:5199`。

生产构建与检查：

```bash
pnpm build
pnpm check
```

### 使用方式

1. 输入单词、词组或短句，按回车加入词库；也可以点击输入框右侧的“批量导入”。批量文本支持空格、Tab、回车、英文逗号和英文分号。
2. 选择速度，并在「单词 / 释义 / 中文词」选择条上滑动或点击选择默写内容。
3. 选择“开始书写默写”或“开始赛博默写”。
4. 等待语音和 AI 内容准备完成，在 `Let's Go!` 界面点击按钮或按回车开始。
5. 完成后查看答案、正确数量和本轮发音。

启用释义或中文词模式前，需要在应用设置中填写 OpenAI 兼容的 Base URL、API Key 和模型名。配置只保存在本机。

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

### Windows 客户端

```bash
# 构建 Web 产物后启动 Electron
pnpm client:dev

# 测试打包：不改版本号，输出到 dist/electron-test
pnpm client:package test

# 正式打包：选择一种版本递增方式
pnpm client:package patch
```

WSL/受限环境（系统目录只读、无法安装 wine32）时改用：

```bash
pnpm client:package:wsl test
```

它会自动下载解包 wine 32 位运行件到 `.tmp/wine32`，并在用户挂载命名空间内执行与 `client:package` 完全相同的流程。

`bump_type` 是必填参数：`major`、`minor`、`patch` 分别递增大、中、小版本号，其中大版本和中版本会将更低位归零；`test` 不修改版本。正式产物位于 `dist/electron/mds-<version>-setup.exe`，测试产物位于 `dist/electron-test/`。打包会先使用展开目录完成内容校验，成功后删除展开目录、builder 调试文件和旧产物，因此对应输出目录最终只保留本次 EXE。只有正式打包成功后，新版本才会写回 `package.json`；失败会恢复原版本。Linux/WSL 交叉打包 Windows 应用需要 Wine。

### 数据与日志

- Web 默认缓存：`.mds-data/word-cache`（音频 `*.mp3`、释义 `definitions.json`、中文词 `chinese-words.json`）
- 安装版客户端：统一使用 Electron `userData/mds-data/word-cache`（卸载默认保留）
- AI 诊断日志：Client 的 `mds-data/logs/ai-definitions.log`

AI 日志会记录请求失败、兼容降级、响应缺项或截断及缓存写入失败，但不会记录 API Key；达到 1 MiB 后保留一份轮换日志。

### 常用命令

| 命令 | 用途 |
| --- | --- |
| `pnpm dev` | 启动 Web 开发服务 |
| `pnpm test` | 运行全部 Vitest 单元测试 |
| `pnpm check` | 测试、生产构建和 HTTP 冒烟 |
| `pnpm get:explain ...` | 直接诊断 AI 释义接口（`--chinese` 诊断中文词） |
| `pnpm client:dev` | 构建并启动 Electron 客户端 |
| `pnpm client:package <major\|minor\|patch\|test>` | 自动检查、按模式管理版本并构建 Windows NSIS 安装包 |

### 技术栈

SolidStart 2 · SolidJS · TypeScript · Tailwind CSS · Electron · Nitro · Vitest · edge-tts-universal

---

## English

<!-- “mds” comes from the Chinese name “默点啥”, roughly: “What should I dictate?” -->

mds is a small English dictation app that keeps word collection, speech preparation, shuffled practice, and answer review in one focused flow. It works for pen-and-paper practice as well as typed answers, with three dictation content modes — word, English definition, and Chinese equivalent word — toggled by a draggable selector bar.

### Highlights

- Add words, phrases, or short sentences with Enter or the bulk importer
- Keep the word list across refreshes and restarts with local browser storage
- Handwriting and keyboard-based dictation modes
- Content modes: word only, word + English definition (reference only), or AI-fetched Chinese equivalent word (graded)
- Draggable, extensible selector bar with click, drag, and arrow-key support
- Three pacing levels plus a custom speed multiplier
- Pre-generated Edge TTS audio with incremental local caching
- Optional AI-generated content with abort and fallback handling; Chinese words use a separate cache file
- Shuffled rounds, playback progress, countdowns, and keyboard-first interaction
- Mode-aware result review: graded fields in red/green, reference fields ungraded, two-wave star celebration
- A guided Windows NSIS installer (per-user, custom install directory, data kept on uninstall)

### Getting started

Requirements: Node.js 24+ and pnpm.

```bash
pnpm install
pnpm dev
```

The development server runs at `http://localhost:5199`.

For a production build and the full delivery check:

```bash
pnpm build
pnpm check
```

### How to use it

1. Enter a word, phrase, or short sentence and press Enter, or open the bulk importer at the right of the input. Bulk text can be separated by spaces, tabs, line breaks, commas, or semicolons.
2. Choose a pace and pick a dictation content mode on the selector bar: word, definition, or Chinese word.
3. Start handwriting or keyboard dictation.
4. Wait for audio and AI content, then click `Let's Go!` or press Enter.
5. In Chinese-word mode, answers are graded by one AI request behind a "grading" overlay; review answers, scores, and prepared pronunciation afterwards.

Definition and Chinese-word modes require an OpenAI-compatible Base URL, API key, and model name in the app settings. These settings stay on the local machine.

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

### Windows client

```bash
# Build the web app and launch Electron
pnpm client:dev

# Test package: keep the version and write to dist/electron-test
pnpm client:package test

# Release package: choose the intended version bump
pnpm client:package patch
```

On WSL or restricted environments (read-only system dirs, no wine32), use:

```bash
pnpm client:package:wsl test
```

It downloads and extracts the wine 32-bit runtime into `.tmp/wine32` and runs the exact same pipeline inside a user mount namespace.

The required `bump_type` is one of `major`, `minor`, `patch`, or `test`. Major and minor bumps reset lower version positions; test packages keep the current version. Release artifacts go to `dist/electron/mds-<version>-setup.exe`, while test packages go to `dist/electron-test/`. Packaging verifies the expanded app first, then removes the unpacked directory, builder diagnostics, and older artifacts, leaving only the newly built EXE in that output directory. The release version is committed to `package.json` only after a successful package and verification run; failures restore the previous version. Cross-building for Windows from Linux/WSL requires Wine.

### Runtime data and diagnostics

- Web cache: `.mds-data/word-cache` (audio `*.mp3`, `definitions.json`, `chinese-words.json`)
- Installed client cache: Electron `userData/mds-data/word-cache` (kept on uninstall by default)
- Client AI diagnostics: `mds-data/logs/ai-definitions.log`

Diagnostic logs cover request failures, compatibility fallbacks, truncated or incomplete responses, and cache write failures. API keys are never logged, and the file rotates at 1 MiB.

### Main commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the Web development server |
| `pnpm test` | Run all Vitest unit tests |
| `pnpm check` | Run tests, production build, and HTTP smoke test |
| `pnpm get:explain ...` | Diagnose the AI definition provider directly |
| `pnpm client:dev` | Build and launch the Electron client |
| `pnpm client:package <major\|minor\|patch\|test>` | Check, manage the version, and build the Windows NSIS installer |

### Stack

SolidStart 2 · SolidJS · TypeScript · Tailwind CSS · Electron · Nitro · Vitest · edge-tts-universal

## License

Released under the [MIT License](LICENSE).
