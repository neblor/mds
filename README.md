<div align="center">

<img src="public/icons/app.png" alt="默点啥 mds" width="128" />

# 默点啥 mds

**记单词 · 听写 · 默写小帮手**

一个轻巧的英语听写与默写工具：选词、朗读、作答、对照结果，再按记忆情况安排复习。支持纸笔书写和电脑键盘作答，适合孩子日常练习，也适合自己背单词。

7 种练习模式 · 10 套内置词表 · 按记忆算法安排复习 · 数据只保存在本机

[![下载 Windows 安装包](https://img.shields.io/github/v/release/neblor/mds?style=for-the-badge&label=%E4%B8%8B%E8%BD%BD%20Windows%20%E5%AE%89%E8%A3%85%E5%8C%85&color=4EA3A0&labelColor=2E353B)](https://github.com/neblor/mds/releases/latest)

[![License: MIT](https://img.shields.io/badge/License-MIT-EFC055?style=flat-square&labelColor=2E353B)](LICENSE) ![Windows 10 / 11](https://img.shields.io/badge/Windows-10%20%7C%2011-4EA3A0?style=flat-square&labelColor=2E353B)

[中文](#中文) · [English](#english)

</div>

---

## 中文

<sub>[下载安装](#下载安装) · [五分钟上手](#五分钟上手) · [七种练习模式](#七种练习模式) · [词库与学习档案](#词库与学习档案) · [设置与 AI](#设置与-ai) · [常见问题](#常见问题) · [给开发者](#给开发者)</sub>

### 它能帮你做什么

- **临时默一批词**：直接输入或批量粘贴单词，马上开始。
- **长期记一批词**：用词库和学习档案安排复习，不用自己记“上次背到哪了”。
- **不止默拼写**：还能练英文释义、中文意思、整句、音标和选词组句，也可以混合练习。
- **纸笔或键盘都行**：孩子在本子上写，或者直接在电脑里输入答案。
- **结果留得下来**：看对错、听发音、回看历史，找到薄弱词再专练。

安装完成后，词库、学习记录、音频缓存和设置都保存在本机。只有生成语音和使用 AI 功能时才需要联网。

### 下载安装

适用 Windows 10 / 11。

1. 打开最新版发布页：https://github.com/neblor/mds/releases/latest
2. 下载 `mds-<版本号>-setup.exe`，例如 `mds-1.1.0-setup.exe`。
3. 双击安装包，按提示完成安装。安装仅针对当前用户，可以选择安装目录。
4. 从开始菜单打开「默点啥」。安装器不会主动创建桌面快捷方式。

**看到“未知发布者”怎么办？** 目前安装包没有购买代码签名，Windows 的这项提示属于预期情况。发布页同时提供 `SHA256SUMS.txt`，可用于核对下载文件是否完整。

**以后怎么升级？** 目前请在同一发布页下载新版安装包并覆盖安装。卸载时默认保留词库、学习记录和设置。

### 五分钟上手

#### 只想快速默几个词

1. 在顶部选择 **「录入」**。
2. 输入单词、词组或短句，按回车加入；内容较多时点右侧 **「批量导入」**。批量文本可用空格、Tab、换行、英文逗号或英文分号分隔。
3. 选择练习内容和快慢节奏。
4. 点 **「开始书写默写」**（自己在纸上写）或 **「开始赛博默写」**（在电脑上输入）。
5. 等语音和内容准备好，点 **「Let's Go!」** 或按回车开始。
6. 按听到的内容作答。结束后查看答案、对错和发音；点关闭回到词库，刚录入的词仍然保留。

#### 想长期复习一个词库

1. 在顶部选择 **「词表」**。第一次使用先点 **「选择词表」**，下载一套内置词表或新建自己的词表；之后点当前词表名就能更换。
2. 用 **「本次默」** 选择这一批练几个词，数量为 5–30，每次增减 5 个。
3. 点 **「重新取词」** 换一批，再按上面的步骤开始。
4. 点词表左侧的书本图标，打开 **学习档案**。

> 「本次默」是**这一批取几个词**，不是“今天最多练几个”。重新取词不会改变学习记录。

#### 键盘操作

默写流程可以全程用键盘完成，不用在手写、键盘和鼠标之间来回切换：

| 按键 | 作用 |
| --- | --- |
| `Enter` | 添加单词、提交本轮作答、关闭结果页 |
| `空格` | 书写默写中直接跳到下一轮（语音没有在发声时） |
| `Esc` | 关闭设置、默写记录或结果页；准备阶段取消本次默写 |
| `Ctrl` / `Cmd` + `Enter` | 批量导入弹层里确认导入；音标轮里提交答案 |
| 方向键 | 切换录入 / 词表和内容模式；在音标池里移动 |
| `F1` | 音标模式打开全屏音标表 |

### 七种练习模式

| 模式 | 你要做什么 | 作答 | 需要 AI | 适合什么情况 |
| --- | --- | --- | --- | --- |
| **单词** | 听发音，写出单词 | 纸笔 / 键盘 | 不需要 | 日常拼写、快速过一遍词汇 |
| **释义** | 先写单词，再写英文释义 | 纸笔 / 键盘 | 需要 | 不只想记拼写，还想确认是否理解词义 |
| **中文词** | 先写单词，再写中文意思 | 纸笔 / 键盘 | 需要 | 检查单词和中文对应关系 |
| **短句** | 听整句、写整句 | 纸笔 / 键盘 | 需要 | 把词放进语境里练；目标 3–6 词，最多 8 词 |
| **混合** | 每个词随机练「释义 / 中文词 / 短句」中的两种 | 纸笔 / 键盘 | 需要 | 想减少机械重复；20 个词就是 40 轮，同一个词的第二次不再重复考拼写 |
| **音标** | 看单词，点选音标块拼出读音 | 仅键盘 | 通常不需要 | 练发音与音标；内置英式词典和音素试听 |
| **组句** | 从候选词里选词，把句子补完整 | 仅键盘 | 需要 | 练词语在句子里的用法；一轮里可能有多个空 |

补充说明：

- **书写默写**不评分，结果页给出标准答案供自检；**赛博默写**自动判分，并把对错写回复习计划。
- **释义和中文词**由 AI 辅助生成并批改，意思相同的改述也可以判对。
- **短句**只念整句 3 遍；大小写、标点和多余空格不影响判定，但漏词、错词、词序或词形错误会判错。个别词没生成合格短句时，会自动改成普通单词轮。
- **音标**遇到词典未收录的词时，可以用同一套 AI 配置兜底；没有 AI 时，这些词会改成普通单词轮。

### 词库与学习档案

#### 内置词库

安装包已经带来 10 套词表，不必自己到处找资源：

| 词表 | 词数 | 词表 | 词数 |
| --- | ---: | --- | ---: |
| 高频核心 3000 | 3,000 | CET-6 核心词 | 5,407 |
| 中考核心词 | 1,603 | 考研核心词 | 4,801 |
| 高考核心词 | 3,677 | IELTS 核心词 | 5,040 |
| 剑桥 PET 核心词（B1 Preliminary 官方词表） | 3,380 | TOEFL 核心词 | 6,974 |
| CET-4 核心词 | 3,849 | GRE 核心词 | 7,504 |

词表数据来自 ECDICT（MIT）和剑桥 B1 Preliminary 官方词表，各表之间有重复。

- **资源词表**随包提供、只读。想要自己的版本，点词表右侧的「编辑」→ **复制为自建词表**，再按需增删。
- **自建词表**支持改名、逐个加词，也能把当前录入的词或历史记录里的词导进来。要一次加很多词，先在「录入」里批量导入，再到词表详情点「从录入的词加入」。
- **检查清单更新**：可以填写自定义词库清单地址（http / https）来下载更多词表。更新资源词表不会影响自建词表，也不会丢复习进度。

#### 复习是怎么安排的

词表模式按 FSRS 记忆算法安排取词：**快到复习时间的词优先，新词逐步出现**。它不是每次完全随机抽一批，也不需要你手动维护复习日期。

赛博默写结算后，对错会写回复习计划，结果页会提示复习计划已更新、有几个词已排期；想调整复习频率，改设置里的「复习期望保持率」。书写默写只记录练习、不打分，不影响排期。

#### 学习档案里能看什么

- 学习进度与已掌握情况
- 近 7 天、30 天正确率
- 180 天练习热力图
- 未来 14 天到期预测
- 薄弱词、常练词和最近练习
- 一键 **「专练薄弱词」**（单词 + 赛博）

结果页可以逐题对照并重听发音，全对时有庆祝动画。右上角的「默写记录」保留最近 5 场，可以回看当时的结算画面，或用当时的词表再默一次。

### 设置与 AI

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

#### 设置项一览

| 设置 | 说明 |
| --- | --- |
| AI 释义服务 | OpenAI 兼容的服务地址、API Key 和模型名 |
| 生成级别 | 小学 / 初中 / 高中 / 大学，默认初中 |
| 语音音色 | 12 种音色（9 种美式、3 种英式）；音标模式默认改用英式音色 |
| 默写速度倍率调整 | 0.3–3.0，默认 1.0；在算出的每轮时长上再乘这个系数 |
| 每轮倒计时显示数字 | 精确到 0.1 秒；关掉后只显示进度条 |
| 复习期望保持率 | 0.70–0.97，默认 0.90；越高复习越频繁 |

请注意：

- API Key 只保存在本机，诊断日志也不会记录它；不要把它提交到仓库或发给他人。
- 使用 AI 功能时，相关单词、题目或作答会发送给你配置的服务商，费用和可用额度由该服务商决定。
- **发音不需要 AI Key**。首次生成语音需要联网，音频会缓存在本机，之后重复使用。
- 「语音音色」下拉右边有 **试听**：会用当前选中的声音随机念一句英文台词（不会连着重复同一句），确认喜欢再选；播放中按钮变成 **停止**，换音色或关掉设置就立即停。每句台词首次合成需要联网，已缓存的之后直接本机播放。

### 常见问题

**倒计时结束了，为什么没有马上进入下一题？**
倒计时和语音是两条独立轨道。时间到了但这一遍还没播完时，会等语音播完再走，避免把作答时间截断。

**倒计时太快或太慢？**
到设置里调「默写速度倍率调整」，每轮时长会整体按这个系数放大或缩小。

**大小写或标点写错了，短句会判错吗？**
不会。短句判定会忽略大小写、标点和多余空格；它主要检查词序、词形以及有没有漏词、错词。

**AI 暂时不可用，整场会卡死吗？**
不会。准备阶段支持超时、中止和部分结果；短句或音标无法取得合格内容的词，会按规则降级为普通单词轮。释义和中文词批改失败时也会降级为本地匹配，并在结果页提示。

**语音一直生成不出来？**
生成语音需要联网。等太久可以点 **「中止」** 返回重试；缓存里损坏的音频会被自动清理，下次准备时重新生成。

**换电脑或卸载后，学习记录还在吗？**
学习记录和设置默认保存在本机应用数据目录，卸载安装包时默认保留。换电脑目前需要另行迁移数据，跨设备同步尚未提供。

**排查问题时看哪里？**
安装版的诊断日志位于应用数据目录下的 `mds-data/logs/runtime.log`。它记录 AI / TTS 的失败、降级和缓存问题，不记录 API Key。

### 给开发者

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
| `pnpm web:smoke:hydration` | 二次启动水合回归（需本机有 Chromium / Chrome） |
| `pnpm client:dev` | 构建并启动 Electron 客户端 |
| `pnpm client:start` | 用已有 `.output` 启动 Electron |
| `pnpm client:package <major\|minor\|patch\|test\|x.y.z>` | 检查、管理版本并构建 Windows NSIS 安装包 |
| `pnpm release <major\|minor\|patch\|x.y.z>` | 一键构建、归档、提交、打 tag、推送、上传 GitHub Release，完成后再清掉本机旧归档 |
| `pnpm release:publish v<version> --execute` | 从已有归档续跑发布，默认只读预览 |
| `pnpm get:explain ...` | 诊断 AI 释义（`--chinese` 诊断中文词） |
| `pnpm get:sentences ...` | 诊断短句生成和词数分布 |
| `pnpm get:cloze ...` | 诊断组句出题 |
| `pnpm get:phonetics ...` | 诊断音标 AI 兜底 |
| `pnpm get:tts ...` | 诊断 Edge TTS 合成与回退 |
| `pnpm db:status` | 只读查看复习 SQLite 状态 |
| `pnpm db:rollback -- --yes` | 回滚到迁移前的 JSON（先退出应用） |

`pnpm start` 不会自动重新构建。监听地址、端口和缓存目录可传参，也支持同名环境变量；`--host 0.0.0.0` 可以让局域网里的其它电脑直接用浏览器访问：

```bash
pnpm start -- --host 0.0.0.0 --port 3000 --cache-dir .mds-data/word-cache
```

<details>
<summary>诊断 AI 配置</summary>

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

</details>

<details>
<summary>打包与发版</summary>

```bash
pnpm client:package test       # 测试包：不改版本，输出到 dist/electron-test/
pnpm client:package patch      # 只打包：按 patch 升版，输出到 dist/electron/
pnpm release patch             # 正式发布：构建并发布到 GitHub Releases
```

`pnpm release` 会先跑完整检查，再构建并校验安装包，归档到 `release-out/v<版本>/`，随后提交版本、创建 annotated tag、原子推送分支与 tag，最后上传并核对 Release 资产后公开 —— **一条指令到底，没有中途确认**。发布成功后本机归档只保留这一版（旧版本只有远端已公开才删）。

- `pnpm release <x.y.z> --dry-run`：只预检和打印计划。
- `pnpm release <x.y.z> --no-publish`：停在归档阶段（显式选择），验收后用 `pnpm release:publish v<x.y.z> --execute`。
- 发布说明放在 `docs/release-notes/<版本>.md`（可选）；没有手写文件时按 `git log` 自动生成并直接发布。
- 项目不向 npm 发布，安装包只在 GitHub Releases 分发。

WSL2 交叉打包时，如果系统 wine 缺少 32 位支持且 `unshare` 可用，脚本会自动下载 wine32 运行件到 `.tmp/wine32`，将 wine 前缀和构建缓存放到 `~/.cache/mds`，再在用户挂载命名空间内完成同一套打包流程。`pnpm client:package:wsl <target>` 是该流程的显式入口。

</details>

<details>
<summary>数据、资源与文档</summary>

- 数据目录：Web 默认在项目的 `.mds-data/`，安装版在 Electron `userData/mds-data/`；可用环境变量 `MDS_DATA_DIR` 整体指定。
  - `banks/` 词库 · `review/review.sqlite` 复习状态（SQLite / WAL）· `word-cache/` 音频与释义缓存
- 客户端诊断：`mds-data/logs/runtime.log`（旧 `ai-definitions.log` 会在目标不存在时迁移）
- 词库、IPA 词典、音素音频和字体随仓库提供；需要重新生成时使用 `pnpm build:phonetics` 或 `pnpm build:phoneme-audio`
- 项目约定与完整脚本说明：`AGENTS.md`
- 后续计划：`FUTURE.md`
- 发布说明：`docs/release-notes/`
- 技术栈：SolidStart 2 · SolidJS · TypeScript · Tailwind CSS 4 · Electron · Nitro · ts-fsrs（FSRS-6）· Lucide · Vitest · 自研 Edge TTS 客户端（v2 令牌）

</details>

---

## English

<sub>[Install](#install) · [First session](#your-first-session) · [Practice modes](#seven-practice-modes) · [Banks & archive](#vocabulary-banks-and-the-learning-archive) · [AI settings](#ai-settings-and-privacy) · [For developers](#for-developers)</sub>

### What you can do with it

mds (“默点啥”) is a small English dictation app for children, students, and anyone reviewing vocabulary. It reads words aloud, accepts pen-and-paper or typed answers, checks results, and keeps a per-bank review history.

- Paste or enter a few words for a quick session.
- Use built-in vocabulary banks or create your own for long-term review.
- Practise spelling, English definitions, Chinese meanings, short sentences, IPA, and cloze sentences — or mix several kinds in one session.
- Review answers, replay pronunciation, revisit history, and drill weak words from the learning archive.

Word banks, review data, cached audio, and settings stay on the local machine. Network access is needed to generate speech and to use AI-powered modes.

### Install

Windows 10 / 11.

[![Download for Windows](https://img.shields.io/github/v/release/neblor/mds?style=for-the-badge&label=Download%20for%20Windows&color=4EA3A0&labelColor=2E353B)](https://github.com/neblor/mds/releases/latest)

1. Open https://github.com/neblor/mds/releases/latest
2. Download `mds-<version>-setup.exe`, for example `mds-1.1.0-setup.exe`.
3. Run the installer. It installs for the current user, lets you choose the directory, and adds a start-menu shortcut named 「默点啥」. No desktop shortcut is created.
4. Windows may show an **“unknown publisher”** prompt because the installer is not code-signed yet. Each release includes `SHA256SUMS.txt` for integrity checks.

To upgrade, download and install the newer package. Uninstalling keeps user data by default.

### Your first session

1. Choose **录入 (Entry)** and enter words, phrases, or short sentences. Use **批量导入 (Bulk import)** for longer lists separated by spaces, tabs, line breaks, commas, or semicolons.
2. Pick a content mode and pace.
3. Choose **书写默写** to write on paper, or **赛博默写** to type on the computer.
4. Wait for preparation, then click **Let's Go!** or press Enter.
5. Review answers, scores, and pronunciation. Closing the result keeps the current word list.

For long-term practice, choose **词表 (Bank)** instead. The first time, click **选择词表 (Choose bank)** to download a built-in bank or create your own. Pick how many words to include in this batch, and click **重新取词 (Refresh batch)** to draw another one. The batch size is not a daily quota. Open the book icon beside the bank name to see the learning archive.

Once your hands are on the keyboard, you can stay there:

| Key | Action |
| --- | --- |
| `Enter` | Add a word, submit the round, close the result page |
| `Space` | In handwriting mode, skip to the next round while no audio is playing |
| `Esc` | Close settings, history, or the result page; cancel while preparing |
| `Ctrl` / `Cmd` + `Enter` | Confirm bulk import; submit in a phonetic round |
| Arrow keys | Switch entry / bank and content mode; move inside the phonetic pool |
| `F1` | Open the full-screen IPA chart in phonetic mode |

### Seven practice modes

| Mode | What you do | Answer by | AI required? |
| --- | --- | --- | --- |
| **Word** | Hear a word and spell it | Paper / keyboard | No |
| **Definition** | Write the word, then its English definition | Paper / keyboard | Yes |
| **Chinese word** | Write the word, then its Chinese meaning | Paper / keyboard | Yes |
| **Short sentence** | Hear and write an AI-generated sentence containing the word | Paper / keyboard | Yes |
| **Mixed** | Practise two of definition / Chinese word / short sentence for each word, with a second pass that skips repeated spelling | Paper / keyboard | Yes |
| **Phonetic** | Assemble the pronunciation from IPA chips; keyboard only, with a British dictionary and phoneme playback | Keyboard only | Usually no; AI can cover missing words |
| **Cloze** | Choose words to complete AI-generated sentences; a round may contain several blanks | Keyboard only | Yes |

Handwriting sessions are not scored — the result page shows the expected answers for self-checking — and do not affect the review schedule. Typed sessions are scored and written back to the review plan. Definition and Chinese-word answers are graded by AI, so paraphrases count as correct. Short sentences target 3–6 words with a hard limit of 8 and are read three times. Case, punctuation, and repeated spaces do not affect the answer check; missing words, wrong forms, and wrong order do. Words without a usable sentence or IPA entry can fall back to ordinary word rounds.

### Vocabulary banks and the learning archive

Ten banks ship with the installer: high-frequency core 3,000 words, junior-high (中考) and senior-high (高考) exam lists, Cambridge PET, CET-4, CET-6, postgraduate entrance (考研), IELTS, TOEFL, and GRE — about 45,000 entries in total, with some overlap. Most lists come from ECDICT (MIT); the PET list comes from the official Cambridge B1 Preliminary vocabulary list.

Resource banks are read-only. Use **编辑 (Edit) → 复制为自建词表 (copy to a custom bank)** to derive your own, then rename it and add words — one by one, from the current entry list, or from your history. **检查清单更新 (Check manifest updates)** accepts a custom bank manifest URL for additional banks; updating a resource bank keeps custom banks and review progress.

Review scheduling follows the FSRS algorithm: words that are due come first and new words are introduced gradually. After a typed session the result page confirms that the review plan was updated and how many words were scheduled; the **复习期望保持率 (requested retention)** setting controls how frequent reviews are.

The archive shows mastery progress, 7-day and 30-day accuracy, a 180-day heatmap, a 14-day due forecast, recent sessions, and weak or frequently practised words. A one-click weak-word drill starts a word + keyboard session. The **默写记录 (History)** list keeps the last five sessions; you can reopen the result page or dictate the same word list again.

### AI settings and privacy

Word dictation, dictionary-covered IPA practice, banks, and the learning archive work without AI. Definition, Chinese-word, short-sentence, mixed, and cloze modes need an OpenAI-compatible provider.

Open **Settings** and enter the provider's Base URL (for example `https://api.example.com/v1`), API key, and model name. Settings save automatically.

| Setting | What it does |
| --- | --- |
| AI service | OpenAI-compatible Base URL, API key, and model name |
| Generation level | Primary / junior high / senior high / college; junior high by default |
| Voice | 12 Edge TTS voices (9 US, 3 UK) with a **试听 (preview)** button; phonetic mode uses a UK voice by default |
| Speed multiplier | 0.3–3.0, 1.0 by default; scales the computed length of every round |
| Countdown number | Shows the remaining time to 0.1 s; turn it off to keep only the bar |
| Requested retention | 0.70–0.97, 0.90 by default; higher means more frequent reviews |

The key stays on the local machine and is excluded from diagnostic logs. When AI features are used, relevant words, prompts, or answers are sent to the configured provider; usage and charges depend on that provider. Speech generation does not require an AI key, and generated audio is cached locally.

**The countdown ended — why did the next word not start right away?** The countdown and the audio are two independent tracks. If a repeat is still playing, the round waits for it to finish.

**Will the whole session hang if AI is unavailable?** No. Preparation supports timeouts, abort, and partial results; words without a usable sentence or IPA entry fall back to word rounds, and failed grading falls back to local matching with a note on the result page.

**Does my data survive an uninstall or a new computer?** Uninstalling keeps user data by default. Moving to another computer currently means migrating the data folder yourself; there is no cross-device sync yet.

**Where do I look when something goes wrong?** The installed client writes AI / TTS failures and degradations to `mds-data/logs/runtime.log` in the app data directory. It never logs the API key.

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
| `pnpm web:smoke:hydration` | Second-launch hydration regression (needs a local Chromium / Chrome) |
| `pnpm client:dev` / `pnpm client:start` | Build then launch Electron / launch against the existing `.output` |
| `pnpm client:package <major\|minor\|patch\|test\|x.y.z>` | Check, manage the version, and build the Windows NSIS installer |
| `pnpm release <major\|minor\|patch\|x.y.z>` | Build, archive, commit, tag, push, upload the GitHub Release, then prune old local archives |
| `pnpm release:publish v<version> --execute` | Resume publishing from an existing archive; preview by default |
| `pnpm get:explain` / `get:sentences` / `get:cloze` / `get:phonetics` / `get:tts` | Diagnose the corresponding production providers without using business caches |
| `pnpm db:status` | Read-only review SQLite status |
| `pnpm db:rollback -- --yes` | Restore the pre-migration JSON files after quitting the app |

`pnpm start` accepts `--host`, `--port`, and `--cache-dir`, or their matching environment variables. Use `--host 0.0.0.0` to let other devices on the LAN open the app in a browser.

<details>
<summary>Diagnosing the AI configuration</summary>

Copy `.env.example` to `.env`, fill in the endpoint, key, and model, then run `pnpm get:explain apple banana` (add `--chinese`, `--grade "hello=你好"`, or `--grade-def "apple=a fruit"` for the other prompts). The scripts reuse the production providers, report timing, missing words, and degradations, and never print the key. `.env` is ignored by Git; never commit a real one.

</details>

<details>
<summary>Packaging and releases</summary>

Use `pnpm client:package test` for a non-versioned test build or `pnpm release patch` for a real release. The release pipeline runs checks, verifies the installer, archives it with checksums and notes, commits and tags the version, pushes atomically, uploads the assets, verifies them, and only then publishes — in one go, without a pause for confirmation. Afterwards only the current archive is kept locally (older ones are removed only once they are public remotely). Use `--dry-run` for preflight or `--no-publish` to stop after archiving, then resume with `pnpm release:publish v<x.y.z> --execute`. Release notes live in `docs/release-notes/<version>.md`; without a handwritten file they are generated from `git log`.

On WSL2, packaging automatically handles a missing 32-bit wine environment when `unshare` is available: it prepares wine32 under `.tmp/wine32`, keeps the wine prefix and builder cache under `~/.cache/mds`, and runs the same build in a user mount namespace. `pnpm client:package:wsl <target>` is the explicit entry point.

</details>

<details>
<summary>Runtime locations and resources</summary>

- Data directory: `.mds-data/` in the project for Web, `userData/mds-data/` for the installed client; override it with `MDS_DATA_DIR`. It holds `banks/` (word banks), `review/review.sqlite` (review state, SQLite/WAL), and `word-cache/` (audio and definition cache).
- Client diagnostics: `mds-data/logs/runtime.log` (legacy `ai-definitions.log` is migrated when the destination does not exist).
- Built-in assets can be regenerated with `pnpm build:phonetics` and `pnpm build:phoneme-audio` when needed.
- Project conventions and the full command reference are in `AGENTS.md`; planned work is tracked in `FUTURE.md`.

Stack: SolidStart 2 · SolidJS · TypeScript · Tailwind CSS 4 · Electron · Nitro · ts-fsrs (FSRS-6) · Lucide · Vitest · custom Edge TTS client (v2 token)

</details>

---

## 反馈 · Feedback

发现问题、或有想加的功能，欢迎提 Issue。Found a bug or have an idea? Please open an issue:

https://github.com/neblor/mds/issues

## License

Released under the MIT License; see `LICENSE`. Third-party notices are listed in `THIRD_PARTY_NOTICES.md`.
