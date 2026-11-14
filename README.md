# 默点啥 mds

> 一个轻巧的英语听写与默写工具：选词、朗读、作答、对照结果，再按记忆情况安排复习。
> 支持纸笔书写和电脑键盘作答，适合孩子日常练习，也适合自己背单词。

[中文](#中文) · [English](#english)

最新版 Windows 安装包：https://github.com/neblor/mds/releases/latest

---

## 中文

### 它能帮你做什么

- **临时默一批词**：直接输入或批量粘贴单词，马上开始。
- **长期记一批词**：用词库和学习档案安排复习，不用自己记“上次背到哪了”。
- **不止默拼写**：还能练英文释义、中文意思、整句、音标和选词组句，也可以混合练习。
- **纸笔或键盘都行**：孩子在本子上写，或者直接在电脑里输入答案。
- **结果留得下来**：看对错、听发音、回看历史，找到薄弱词再专练。

安装完成后，词库、学习记录、音频缓存和设置都保存在本机。只有生成语音和使用 AI 功能时才需要联网。

### 1. 下载与安装（Windows 10 / 11）

1. 打开最新版发布页：https://github.com/neblor/mds/releases/latest
2. 下载 `mds-<版本号>-setup.exe`，例如 `mds-1.0.1-setup.exe`。
3. 双击安装包，按提示完成安装。安装仅针对当前用户，可以选择安装目录。
4. 从开始菜单打开「默点啥」。安装器不会主动创建桌面快捷方式。

**看到“未知发布者”怎么办？** 目前安装包没有购买代码签名，Windows 的这项提示属于预期情况。发布页同时提供 `SHA256SUMS.txt`，可用于核对下载文件是否完整。

**以后怎么升级？** 目前请在同一发布页下载新版安装包并覆盖安装。卸载时默认保留词库、学习记录和设置。

### 2. 第一次默写：五分钟上手

#### 只想快速默几个词

1. 在顶部选择 **「录入」**。
2. 输入单词、词组或短句，按回车加入；内容较多时点右侧 **「批量导入」**。批量文本可用空格、Tab、换行、英文逗号或英文分号分隔。
3. 选择练习内容和快慢节奏。
4. 点 **「开始书写默写」**（自己在纸上写）或 **「开始赛博默写」**（在电脑上输入）。
5. 等语音和内容准备好，点 **「Let's Go!」** 或按回车开始。
6. 按听到的内容作答。结束后查看答案、对错和发音；点关闭回到词库，刚录入的词仍然保留。

#### 想长期复习一个词库

1. 在顶部选择 **「词表」**，再点当前词表名：可以选内置词库，也可以新建自己的词表。
2. 用 **「本次默」** 选择这一批练几个词，数量为 5–30，每次增减 5 个。
3. 点 **「重新取词」** 换一批，再按上面的步骤开始。
4. 点词表左侧的书本图标，打开 **学习档案**。

> 「本次默」是**这一批取几个词**，不是“今天最多练几个”。重新取词不会改变学习记录。

### 3. 七种练习模式怎么选

| 模式 | 你要做什么 | 需要 AI 吗 | 适合什么情况 |
| --- | --- | --- | --- |
| **单词** | 听发音，写出单词 | 不需要 | 日常拼写、快速过一遍词汇 |
| **释义** | 先写单词，再写英文释义 | 需要 | 不只想记拼写，还想确认是否理解词义 |
| **中文词** | 先写单词，再写中文意思 | 需要 | 检查单词和中文对应关系 |
| **短句** | 听整句、写整句 | 需要 | 把词放进语境里练；目标 3–6 词，最多 8 词 |
| **混合** | 每个词随机练「释义 / 中文词 / 短句」中的两种 | 需要 | 想减少机械重复；20 个词就是 40 轮，同一个词的第二次不再重复考拼写 |
| **音标** | 看单词，点选音标块拼出读音 | 通常不需要 | 练发音与音标；只能赛博默写，内置英式词典和音素试听 |
| **组句** | 从候选词里选词，把句子补完整 | 需要 | 练词语在句子里的用法；只能赛博默写 |

补充说明：

- 除**音标和组句**只能赛博默写外，其它模式都可以选择纸笔书写或键盘作答。
- **释义和中文词**由 AI 辅助生成并批改，意思相同的改述也可以判对。
- **短句**只念整句 3 遍；大小写、标点和多余空格不影响判定，但漏词、错词、词序或词形错误会判错。个别词没生成合格短句时，会自动改成普通单词轮。
- **音标**遇到词典未收录的词时，可以用同一套 AI 配置兜底；没有 AI 时，这些词会改成普通单词轮。

### 4. 词库、复习和学习档案

#### 内置词库

安装包已经带来多套词库，不必自己到处找资源：

- 高频核心 3000
- 中考、高考核心词
- 剑桥 PET 核心词（B1 Preliminary 官方词表）
- CET-4、CET-6、考研
- IELTS、TOEFL、GRE

资源词库可以 **复制为自建词表**，再按需增删；自建词表支持改名、批量导入，以及从当前录入或历史记录导入。

#### 复习是怎么安排的

词表模式会根据学习记录安排取词：**快到复习时间的词优先，新词逐步出现**。它不是每次完全随机抽一批，也不需要你手动维护复习日期。

#### 学习档案里能看什么

- 学习进度与已掌握情况
- 近 7 天、30 天正确率
- 180 天练习热力图
- 未来 14 天到期预测
- 薄弱词、常练词和最近练习
- 一键 **「专练薄弱词」**（单词 + 赛博）

结果页可以逐题对照并重听发音，全对时有庆祝动画；历史记录也可以回看和再次默写。

### 5. AI 功能与设置

**不配置 AI 也能用**：普通单词默写、内置词典覆盖的音标练习、书写/赛博作答、词库和学习档案都不依赖 AI。

需要 AI 的模式是：**释义、中文词、短句、混合、组句**。

配置方法：

1. 打开右上角的 **设置**。
2. 在「AI 释义服务（OpenAI 兼容）」中填写：
   - **服务地址**：服务商提供的 OpenAI 兼容 Base URL，例如 `https://api.example.com/v1`；
   - **API Key**：服务商后台生成的密钥；
   - **模型名**：该服务支持的模型，例如设置页占位示例中的 `gpt-4o-mini`。
3. 选择 **生成级别**，控制 AI 出题和释义的词汇、句法难度，默认初中。
4. 设置会自动保存，不需要点确认按钮。

请注意：

- API Key 只保存在本机，诊断日志也不会记录它；不要把它提交到仓库或发给他人。
- 使用 AI 功能时，相关单词、题目或作答会发送给你配置的服务商，费用和可用额度由该服务商决定。
- **发音不需要 AI Key**。首次生成语音需要联网，音频会缓存在本机，之后重复使用。

### 6. 常见问题

**倒计时结束了，为什么没有马上进入下一题？**
倒计时和语音是两条独立轨道。时间到了但这一遍还没播完时，会等语音播完再走，避免把作答时间截断。

**大小写或标点写错了，短句会判错吗？**
不会。短句判定会忽略大小写、标点和多余空格；它主要检查词序、词形以及有没有漏词、错词。

**AI 暂时不可用，整场会卡死吗？**
不会。准备阶段支持超时、中止和部分结果；短句或音标无法取得合格内容的词，会按规则降级为普通单词轮。释义和中文词批改失败时也会降级为本地匹配，并在结果页提示。

**换电脑或卸载后，学习记录还在吗？**
学习记录和设置默认保存在本机应用数据目录，卸载安装包时默认保留。换电脑目前需要另行迁移数据，跨设备同步尚未提供。

**排查问题时看哪里？**
安装版的诊断日志位于应用数据目录下的 `mds-data/logs/runtime.log`。它记录 AI / TTS 的失败、降级和缓存问题，不记录 API Key。

### 7. 给开发者

#### 环境与启动

需要 Node.js 24+、pnpm 和 Git。安装 pnpm：`npm install -g pnpm`。所有命令都在项目根目录执行。

```bash
git clone https://github.com/neblor/mds.git
cd mds
pnpm install
pnpm dev
```

开发服务固定为 `http://localhost:5199`。首次安装会下载 Electron 运行时；下载慢时可按自己的 shell 语法设置 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 后重试。

#### 常用命令

| 命令 | 用途 |
| --- | --- |
| `pnpm dev` | 启动 Web 开发服务 |
| `pnpm build` / `pnpm start` | 生产构建到 `.output/` / 启动已有构建（默认 `127.0.0.1:3000`） |
| `pnpm test` | 运行全部 Vitest 单元测试 |
| `pnpm typecheck` | 运行 `tsc --noEmit` |
| `pnpm check` | 测试 → 类型检查 → 生产构建 → HTTP 冒烟 |
| `pnpm client:dev` | 构建并启动 Electron 客户端 |
| `pnpm client:start` | 用已有 `.output` 启动 Electron |
| `pnpm client:package <major\|minor\|patch\|test\|x.y.z>` | 检查、管理版本并构建 Windows NSIS 安装包 |
| `pnpm release <major\|minor\|patch\|x.y.z>` | 一键构建、归档、提交、打 tag、推送并上传 GitHub Release |
| `pnpm release:publish v<version> --execute` | 从已有归档续跑发布，默认只读预览 |
| `pnpm get:explain ...` | 诊断 AI 释义（`--chinese` 诊断中文词） |
| `pnpm get:sentences ...` | 诊断短句生成和词数分布 |
| `pnpm get:phonetics ...` | 诊断音标 AI 兜底 |
| `pnpm get:tts ...` | 诊断 Edge TTS 合成与回退 |
| `pnpm db:status` | 只读查看复习 SQLite 状态 |
| `pnpm db:rollback -- --yes` | 回滚到迁移前的 JSON（先退出应用） |

`pnpm start` 不会自动重新构建。监听地址、端口和缓存目录可传参，也支持同名环境变量：

```bash
pnpm start -- --host 0.0.0.0 --port 3000 --cache-dir .mds-data/word-cache
```

#### 诊断 AI 配置

命令行诊断复用应用内的 provider，但不读写业务缓存：

```bash
cp .env.example .env
# 在 .env 中填写服务地址、Key 和模型；该文件已被 Git 忽略
pnpm get:explain apple banana "look forward to"
pnpm get:explain --chinese apple hello
pnpm get:explain --grade "hello=你好" "apple=哈喽"
pnpm get:explain --grade-def "apple=a round fruit"
```

输出包含结果、缺失词、耗时、`finish_reason`、token 用量和兼容降级记录。不要提交真实 Key。

#### 打包与发版

```bash
pnpm client:package test       # 测试包：不改版本，输出到 dist/electron-test/
pnpm client:package patch      # 只打包：按 patch 升版，输出到 dist/electron/
pnpm release patch             # 正式发布：构建并发布到 GitHub Releases
```

`pnpm release` 会先跑完整检查，再构建并校验安装包，归档到 `release-out/v<版本>/`，随后提交版本、创建 annotated tag、原子推送分支与 tag，最后上传并核对 Release 资产后公开。

- `pnpm release <x.y.z> --dry-run`：只预检和打印计划。
- `pnpm release <x.y.z> --no-publish`：停在归档阶段，验收后用 `pnpm release:publish v<x.y.z> --execute`。
- 发布说明放在 `docs/release-notes/<版本>.md`；没有手写文件时会生成 `git log` 草稿并暂停等待确认。
- 项目不向 npm 发布，安装包只在 GitHub Releases 分发。

WSL2 交叉打包时，如果系统 wine 缺少 32 位支持且 `unshare` 可用，脚本会自动下载 wine32 运行件到 `.tmp/wine32`，将 wine 前缀和构建缓存放到 `~/.cache/mds`，再在用户挂载命名空间内完成同一套打包流程。`pnpm client:package:wsl <target>` 是该流程的显式入口。

#### 数据、资源与文档

- Web 缓存：`.mds-data/word-cache`
- 安装版缓存：Electron `userData/mds-data/word-cache`
- 复习状态：`.mds-data/review/review.sqlite`（SQLite/WAL）
- 客户端诊断：`mds-data/logs/runtime.log`（旧 `ai-definitions.log` 会在目标不存在时迁移）
- 词库、IPA 词典、音素音频和字体随仓库提供；需要重新生成时使用 `pnpm build:phonetics` 或 `pnpm build:phoneme-audio`
- 项目约定与完整脚本说明：`AGENTS.md`
- 后续计划：`FUTURE.md`
- 发布说明：`docs/release-notes/`
- 技术栈：SolidStart 2 · SolidJS · TypeScript · Tailwind CSS · Electron · Nitro · Vitest · 自研 Edge TTS 客户端（v2 令牌）

---

## English

mds (“默点啥”) is a small English dictation app for children, students, and anyone reviewing vocabulary. It reads words aloud, accepts pen-and-paper or typed answers, checks results, and keeps a per-bank review history.

### What you can do with it

- Paste or enter a few words for a quick session.
- Use built-in vocabulary banks or create your own for long-term review.
- Practise spelling, English definitions, Chinese meanings, short sentences, IPA, and cloze sentences — or mix several kinds in one session.
- Review answers, replay pronunciation, revisit history, and drill weak words from the learning archive.

Word banks, review data, cached audio, and settings stay on the local machine. Network access is needed to generate speech and to use AI-powered modes.

### Install on Windows 10 / 11

1. Open https://github.com/neblor/mds/releases/latest
2. Download `mds-<version>-setup.exe`.
3. Run the installer. It installs for the current user, lets you choose the directory, and adds a start-menu shortcut named 「默点啥」.
4. Windows may show an **“unknown publisher”** prompt because the installer is not code-signed yet. Each release includes `SHA256SUMS.txt` for integrity checks.

To upgrade, download and install the newer package. Uninstalling keeps user data by default.

### Your first session

1. Choose **录入 (Entry)** and enter words, phrases, or short sentences. Use **批量导入 (Bulk import)** for longer lists separated by spaces, tabs, line breaks, commas, or semicolons.
2. Pick a content mode and pace.
3. Choose **书写默写** to write on paper, or **赛博默写** to type on the computer.
4. Wait for preparation, then click **Let's Go!** or press Enter.
5. Review answers, scores, and pronunciation. Closing the result keeps the current word list.

For long-term practice, choose **词表 (Bank)** instead. Pick a built-in or custom bank, choose how many words to include in this batch, and click **重新取词 (Refresh batch)**. The batch size is not a daily quota. Open the book icon beside the bank name to see the learning archive.

### Seven practice modes

| Mode | What you do | AI required? |
| --- | --- | --- |
| **Word** | Hear a word and spell it | No |
| **Definition** | Write the word, then its English definition | Yes |
| **Chinese word** | Write the word, then its Chinese meaning | Yes |
| **Short sentence** | Hear and write an AI-generated sentence containing the word | Yes |
| **Mixed** | Practise two of definition / Chinese word / short sentence for each word, with a second pass that skips repeated spelling | Yes |
| **Phonetic** | Assemble the pronunciation from IPA chips; keyboard only, with a British dictionary and phoneme playback | Usually no; AI can cover missing words |
| **Cloze** | Choose words to complete AI-generated sentences; keyboard only | Yes |

All modes except Phonetic and Cloze support both paper-and-pencil and keyboard answers. Short sentences target 3–6 words with a hard limit of 8 and are read three times. Case, punctuation, and repeated spaces do not affect the answer check; missing words, wrong forms, and wrong order do. Words without a usable sentence or IPA entry can fall back to ordinary word rounds.

### Vocabulary banks and the learning archive

Bundled banks include high-frequency core words, Chinese high-school exam lists, Cambridge PET, CET-4/6, postgraduate entrance vocabulary, IELTS, TOEFL, and GRE. You can copy a resource bank into an editable custom bank, import words in bulk, or import from entry/history.

Review scheduling prioritises words that are due while gradually introducing new ones. The archive shows mastery progress, 7/30-day accuracy, a 180-day heatmap, a 14-day due forecast, recent sessions, and weak or frequently practised words. A one-click weak-word drill starts a word + keyboard session.

### AI settings and privacy

Word dictation, dictionary-covered IPA practice, banks, and the learning archive work without AI. Definition, Chinese-word, short-sentence, mixed, and cloze modes need an OpenAI-compatible provider.

Open **Settings** and enter the provider's Base URL (for example `https://api.example.com/v1`), API key, and model name. Choose a generation level to constrain vocabulary and sentence difficulty. Settings save automatically.

The key stays on the local machine and is excluded from diagnostic logs. When AI features are used, relevant words, prompts, or answers are sent to the configured provider; usage and charges depend on that provider. Speech generation does not require an AI key, and generated audio is cached locally.

### For developers

Requirements: Node.js 24+, pnpm, and Git. Install pnpm with `npm install -g pnpm`, then run everything from the repository root.

```bash
git clone https://github.com/neblor/mds.git
cd mds
pnpm install
pnpm dev
```

The dev server is `http://localhost:5199`. If downloading Electron is slow, set `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` using your shell's syntax and retry.

| Command | Purpose |
| --- | --- |
| `pnpm build` / `pnpm start` | Build into `.output/` / serve the existing build at `127.0.0.1:3000` |
| `pnpm test` / `pnpm typecheck` | Vitest tests / `tsc --noEmit` |
| `pnpm check` | Tests → type check → production build → HTTP smoke test |
| `pnpm client:dev` / `pnpm client:start` | Build then launch Electron / launch against the existing `.output` |
| `pnpm client:package <major\|minor\|patch\|test\|x.y.z>` | Check, manage the version, and build the Windows NSIS installer |
| `pnpm release <major\|minor\|patch\|x.y.z>` | Build, archive, commit, tag, push, and upload the GitHub Release |
| `pnpm release:publish v<version> --execute` | Resume publishing from an existing archive; preview by default |
| `pnpm get:explain` / `get:sentences` / `get:phonetics` / `get:tts` | Diagnose the corresponding production providers without using business caches |
| `pnpm db:status` | Read-only review SQLite status |
| `pnpm db:rollback -- --yes` | Restore the pre-migration JSON files after quitting the app |

`pnpm start` accepts `--host`, `--port`, and `--cache-dir`, or their matching environment variables. To test AI settings, copy `.env.example` to `.env`, fill in the endpoint, key, and model, then run `pnpm get:explain apple banana`. `.env` is ignored by Git; never commit a real key.

For packaging, use `pnpm client:package test` for a non-versioned test build or `pnpm release patch` for a real release. The release pipeline runs checks, verifies the installer, archives it with checksums and notes, commits and tags the version, pushes atomically, uploads the assets, verifies them, and only then publishes. Use `--dry-run` for preflight or `--no-publish` to stop after archiving. Release notes live in `docs/release-notes/<version>.md`.

On WSL2, packaging automatically handles a missing 32-bit wine environment when `unshare` is available: it prepares wine32 under `.tmp/wine32`, keeps the wine prefix and builder cache under `~/.cache/mds`, and runs the same build in a user mount namespace. `pnpm client:package:wsl <target>` is the explicit entry point.

Runtime locations:

- Web cache: `.mds-data/word-cache`
- Installed client cache: Electron `userData/mds-data/word-cache`
- Review state: `.mds-data/review/review.sqlite` (SQLite/WAL)
- Client diagnostics: `mds-data/logs/runtime.log` (legacy `ai-definitions.log` is migrated when the destination does not exist)

Project conventions and the full command reference are in `AGENTS.md`; planned work is tracked in `FUTURE.md`. Built-in assets can be regenerated with `pnpm build:phonetics` and `pnpm build:phoneme-audio` when needed.

Stack: SolidStart 2 · SolidJS · TypeScript · Tailwind CSS · Electron · Nitro · Vitest · custom Edge TTS client (v2 token)

## License

Released under the MIT License; see `LICENSE`. Third-party notices are listed in `THIRD_PARTY_NOTICES.md`.
