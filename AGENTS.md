# 默点啥 mds

`默点啥`项目，一个简单的默写辅助工具。

## 开发目录定义

以下定义了项目根目录下设哪些目录用于做什么，这里往往是与项目本身运行无关的目录定义：

- `.design` 设计目录，项目中需要用到界面设计时，在这里创建`.pen`文件，然后调用pencil mcp来操作
  - 设计目录下每一套设计至少由2个文件组成，一个是`.pen`文件，以及文件主名与之相同的`.md`文件为设计和功能做说明注解，阅读时一起对照理解
- `.implementation-report` 实施报告目录，也可供自己回顾之前的改动

## 项目文档

- **[FUTURE.md](FUTURE.md) —— 「现在不做、但以后要做的事」的唯一登记处**，核心原则是「先存后显」：
  未来功能要用的数据，现在就必须完整落盘，界面上先不做过多展示，不允许出现「可惜当初没存」。
  - 每条写清：要做成什么样、触发条件（什么时候值得做）、代价/前置、相关落点或引用。
  - **本轮没做的额外项**（可选加固、被砍的优化、一次性待复核、Agent 建议）**必须登记到这里**；
    `.implementation-report` 与 `plans/` 是回顾档案，不是待办清单 —— 只写在那边等于没记。
  - 做掉某条时：标注「已完成」并链到对应实施报告，不静默删除（后来者需要知道为何不再做）。

## 技术选型

- 项目实际使用`pnpm`管理依赖和执行 Web 开发、构建工具链，单元测试使用`Vitest`并通过`pnpm`执行
- `electron`负责 Desktop 运行与 Windows 打包（`pnpm electron:build` 产出 NSIS Windows 安装包）；Web 业务开发和测试用 pnpm 工具链
- 库选型：
  - solidstart 2.0 **框架已经创建**
  - tailwindcss
  - DaisyUI + HeadlessUI 快速拼出要用的组件降低开发量
  - Lucide Icon (for solid version)

## 项目脚本

所有开发、测试、构建、运行和打包命令都必须从项目根目录通过`pnpm`执行，不使用`npm`、`npx`或 Deno 代替已有脚本。

### 通用入口

| 命令 | 用途 |
| --- | --- |
| `pnpm dev` | `pnpm web:dev`的常用别名 |
| `pnpm build` | `pnpm web:build`的常用别名 |
| `pnpm start` | `pnpm web:start`的常用别名，只启动已有生产构建 |
| `pnpm preview` | `pnpm web:preview`的常用别名 |
| `pnpm test` | `pnpm test:run`的常用别名，单次运行全部 Vitest |
| `pnpm check` | 完整 Web 交付检查：Vitest → Web 生产构建 → Web 生产冒烟 |
| `pnpm get:explain word1 word2 ...` | 直接调用独立 AI 释义服务做人工诊断；读取项目`.env`中的`MDS_AI_BASE_URL`、`MDS_AI_API_KEY`、`MDS_AI_MODEL`，不读写业务缓存 |
| `pnpm get:sentences word1 word2 ...` | 短句模式诊断：复用生产生句链路（含超长收紧重试），逐词输出句子/词数/是否偏长，并汇总长度分布（目标 3–6 词、硬上限 8 词），不写业务缓存 |
| `pnpm get:tts word1 word2 ...` | 语音合成诊断：复用生产 Edge TTS provider，逐词输出命中端点/是否回退/耗时/字节数/mp3 头/失败原因，不写业务缓存。403 优先查系统时间（令牌按 5 分钟窗口），见`.implementation-report/2026-10-17-edge-tts-v2-and-hydration-crash.md`§六 |
| `pnpm db:status` | 只读查看复习 SQLite：schema v1、各库 cards/logs/sessions 条数、`migrated-v1/` 归档、WAL、`quick_check`；不启动服务、不触发迁移 |
| `pnpm db:rollback -- --yes` | 回滚学习状态：先把 `review.sqlite*` 备份为 `review.sqlite.bak-<时间戳>`，再把 `review/migrated-v1/` 旧文件搬回 `review/`；执行前必须退出应用 |

### Web 模式

| 命令 | 用途与前置条件 |
| --- | --- |
| `pnpm web:dev` | 启动 Vite/SolidStart 开发服务，固定端口`5199` |
| `pnpm web:build` | 生成 Web/Nitro 生产产物到`.output/` |
| `pnpm web:start` | 启动已有`.output`生产服务；默认`127.0.0.1:3000`，不会自动构建 |
| `pnpm web:prod` | 先生产构建，再启动 Web 生产服务 |
| `pnpm web:preview` | 使用 Vite preview 预览已有构建，仅用于本地检查，不作为正式生产启动方式 |
| `pnpm web:smoke` | 对已有`.output`使用随机本机端口做 HTTP 200 与缓存路由冒烟，完成后自动停止；通常由`pnpm check`调用 |
| `pnpm web:smoke:hydration` | 二次启动水合回归（无头浏览器 + 真实 SSR/hydration）：导入最小内置词表→写入`mds.vocab.v1`的`mode:"bank"`→重载，断言无`Uncaught Client Exception`且词表名已恢复。需本机有 Chromium/Chrome（可用`MDS_SMOKE_BROWSER_PATH`指定），缺失时打印提示并跳过；不进`pnpm check` |

`web:start`支持命令行参数，也兼容同名环境变量：

```bash
pnpm web:start -- --host 0.0.0.0 --port 3000 --cache-dir /data/mds/word-cache
```

- 参数：`--host`、`--port`、`--cache-dir`。
- 环境变量：`HOST`/`NITRO_HOST`、`PORT`/`NITRO_PORT`、`MDS_CACHE_DIR`。
- 命令行参数优先于环境变量；未指定缓存目录时使用项目`.mds-data/word-cache`。
- 当前 Nitro 3 beta 的 node-server listener 不会单独维持 Node 事件循环，生产启动必须经过`scripts/start-web.mjs`保活，不得退回直接执行`node .output/server/index.mjs`。
- Nitro 3 beta 的 Vite 开发中间件有两类分流缺陷，均由`scripts/vite-api-media-route.mjs`的 dev-only 前置中间件补偿，不得进入或改变生产 Nitro/Electron 路由：
  - 会把浏览器`Sec-Fetch-Dest: audio`请求当作静态资源并跳过动态路由；中间件只在`configureServer`阶段将`/api/audio`改写为普通 fetch，保证 Web dev 可播放
  - 资产扩展名白名单不含`json`：`?import`的 JSON 模块（如 pnpm 深路径的`package.json?import`）会被当成页面路由 SSR 返回`text/html`，浏览器拒绝执行导致整条 import 链断裂、界面不水合；中间件将这类请求的`Sec-Fetch-Dest`改写为`script`，让 Nitro 放行给 Vite transform

### 测试

| 命令 | 用途 |
| --- | --- |
| `pnpm test:run` | 单次运行全部 Vitest，适用于交付与 CI |
| `pnpm test:watch` | 启动 Vitest watch，适用于开发过程 |
| `pnpm test:run -- src/lib/example.test.ts` | 只运行指定测试文件 |

测试统一通过`scripts/run-vitest.mjs`启动，并把`TEMP`、`TMP`、`TMPDIR`指向已忽略的`.tmp/vitest`，避免 WSL 继承 Windows 临时目录导致测试池启动失败。不要绕过该入口直接调用 Vitest。

### Electron Client 模式

| 命令 | 用途与输出 |
| --- | --- |
| `pnpm client:start` | 使用当前已有`.output`启动 Electron；不会自动重新构建 |
| `pnpm client:dev` | 先执行 Web 生产构建，再启动 Electron，适合本地联调 |
| `pnpm client:package:dir` | 构建并生成快速调试用`dist/electron/win-unpacked/`，不生成交付 EXE |
| `pnpm client:package <bump_type>` | 统一打包入口；`bump_type`必填且只能是`major`/`minor`/`patch`/`test`，依次执行`check` → Windows NSIS 安装包打包 → 包内容校验 → 清理临时产物 |
| `pnpm client:package:wsl <bump_type>` | WSL/受限环境打包入口；自动准备 wine 32 位运行件（下载解包 i386 deb 到`.tmp/wine32`）并在用户挂载命名空间内执行与`client:package`完全相同的流程，产物一致 |
| `pnpm client:verify` | 打包清理前使用`win-unpacked`校验安装包 EXE 的 MZ 头、必要运行文件，以及包内无`node_modules`和`word-cache` |
| `pnpm electron:start` | `pnpm client:start`的兼容别名 |
| `pnpm electron:build <bump_type>` | `pnpm client:package <bump_type>`的兼容别名，同样必须传入参数 |

- `package.json`的`version`是客户端版本的唯一数据源。`major`递增第一位并将后两位归零，`minor`递增第二位并将第三位归零，`patch`只递增第三位；例如`0.1.45`执行`major`后为`1.0.0`，执行`minor`后为`0.2.0`，执行`patch`后为`0.1.46`。
- 正式发布必须由用户使用`pnpm client:package major|minor|patch`或其`electron:build`别名触发；打包成功后自动写回新版本，产物为`dist/electron/mds-<version>-setup.exe`。打包失败必须恢复原版本。
- `pnpm client:package test`不修改版本号，测试产物固定输出到`dist/electron-test/`。Agent 做任何测试打包时只能使用`test`模式，禁止自行使用`major`、`minor`或`patch`；后三种发布递增值只允许用户决定和执行。
- `client:package`必须先完成包内容校验，再删除对应输出目录中的`win-unpacked`、builder 调试文件、旧 EXE 等所有临时或历史项目；成功结束后输出目录只能保留本次生成的最终`mds-<version>-setup.exe`。
- `client:package:dir`仅用于快速排查 Electron 启动与包内容，不是交付形式。
- Client 启动依赖`.output`，需要最新业务代码时使用`client:dev`，不要直接运行可能陈旧的`client:start`。
- electron-builder 下载运行时和 NSIS 资源时需要网络；Linux/WSL 交叉构建 Windows 产物还需要可用的 Wine 环境（NSIS 安装器是 32 位 PE，electron-builder 需用 wine 运行安装器抽取卸载器，因此 wine 需具备 32 位支持）。系统目录只读/无法安装 wine32 时使用`client:package:wsl`。

## 项目输出形式

项目使用`electron`方案输出为 **NSIS 安装包**（引导式安装、仅当前用户、可选安装目录、不建桌面快捷方式、卸载保留用户数据）的 Windows 桌面应用（暂不考虑其他平台）:

- 主进程：`electron/main.mjs` — 启动内置 nitro server（`.output/server/index.mjs`，import 即监听）+ BrowserWindow 加载 `http://127.0.0.1:<port>`；端口由 `electron/port-picker.mjs` 动态挑选（首选 4827，被 Windows 动态保留段拒绝时由 OS 分配空闲端口，避免 srvx 静默吞掉 listen 失败导致"启动超时"）
- 运行时缓存不得写入或打包进静态 `public`：Web 默认使用项目 `.mds-data/word-cache`（部署时可用 `MDS_CACHE_DIR` 覆盖）；Electron 安装版统一使用 `userData/mds-data/word-cache`（卸载默认保留）
- 复习状态使用 `mds-data/review/review.sqlite`（SQLite/WAL）：首次启动自动迁移旧 `cards.json` / `log.jsonl` / `sessions.jsonl`，旧文件归档到 `review/migrated-v1/`；迁移失败进入兼容模式（默写/队列/结算可用，统计 503）。`daily.json` 已移除，今日进度由 `review_log` 按库/日聚合
- Client 主进程必须在启动内置服务前设置 `MDS_RUNTIME_MODE=client` 和 `MDS_CACHE_DIR`；业务层通过 `/api/audio` 动态读取外置音频，不依赖静态目录
- Client 模式下第三方 AI 释义调用的降级、错误、缺词/截断及缓存写入失败记录到外置 `mds-data/logs/ai-definitions.log`，日志达到 1 MiB 时轮换一份 `.1`；日志不得记录 API Key
- Electron 主窗口默认及最大尺寸为 `1120×820`，最小尺寸为各边约三分之二的 `747×547`；允许在该范围内缩放，但必须禁用最大化和全屏
- 音频与释义缓存的命中、读取、原子写入和失效必须通过统一的 runtime cache storage 接口完成，由工厂按 Web/Client 环境选择实现；业务路由不得直接操作缓存文件或自行判断运行环境
- 打包：`pnpm client:package <major|minor|patch|test>`（`pnpm electron:build <bump_type>`为兼容别名）；发布模式产出`dist/electron/mds-<version>-setup.exe`，测试模式产出`dist/electron-test/mds-<version>-setup.exe`，两个输出目录在成功后都只保留该最终安装包
- 交叉打包（Linux → Windows）需要 wine；Windows 上使用相同的带`bump_type`命令
- 打包下载镜像：`ELECTRON_MIRROR`/`ELECTRON_BUILDER_BINARIES_MIRROR` 指向 npmmirror 加速

> 如果某个技术点不确定不要纯自己猜，一定要上网查文档

## 注意事项

- **生成的文件及目录名不得使用中文**（包括打包产物、配置/脚本产出的文件名；界面显示名如窗口标题不受此限）
  - 例外（用户已确认）：NSIS 安装器的**开始菜单快捷方式名**用中文「默点啥」（用户在系统菜单中将其理解为应用名而非文件名），由 `build.nsis.shortcutName` 控制；产物文件名仍保持英文 `mds-<version>-setup.exe`。

## 开发流程

严格遵循以下开发流程：

### 规划段

> 注意目前本项目使用plannotator插件进行本阶段流程

- 收到需求，分析拆解
- 对不理解或是描述有冲突的地方向用户询问
- 确认技术难点，进行前期的资料查询，若有技术过于困难或不合理的地方，向用户提出确认
- 将整理的方案记录plan

### 实施段

- 涉及界面部分的，先在`.design`目录下建对应的pen文件进行设计，通过视觉确认设计无误后，再根据视觉设计去实现
  - 注意，当项目内已经有同类实现时，设计稿的表达与实际的css实现可能会有些许差异（比如背景模糊度啊，倒角值啊什么的），当出现设计与已经明确已有实现的方案有同方向（即不是本质设计上的，而是参数值上的细节处理）冲突时，优先以已有实现方案为准
- **键盘交互铁律**：设计界面交互时，时刻思考用户当前键盘需要输入的区域在哪里，控制好 input 的自动化 focus 流程。尽管不是 CLI 应用，仍要避免让用户不断在键盘和鼠标间反复来回切换的界面。用户一旦进入键盘操作，如果接下来的操作还是键盘，就要让用户能一直只用键盘走完流程（例如最终关闭：直接捕获回车键关闭，而不是 Tab 把 focus 移到关闭按钮再回车）。同时保持输入框位置稳定，提示信息不能把输入框顶得来回移动
- 编码实现过程遇到不确定的部分也需要积极查文档
- 对任何项目都需要配置单元测试，e2e测试在没有明确需求的情况下可以省略，但单元测试必须与功能同步实现，考虑到多个边界并最终通过`pnpm + Vitest`跑通
- 涉及复杂流程控制、键盘状态或持久化时序的逻辑，优先抽成纯函数或可注入的编排模块扩大单元测试覆盖；E2E 只做必要的轻量冒烟，浏览器自动化不稳定时不得在其上持续消耗排查时间，可将完整端到端体验留给用户人工验证
- 核心业务存在流程编排层时，单元测试必须直接覆盖生产实际调用的编排实现，不能只测试一套未被生产代码使用的平行状态模型
- 第三方服务调用必须从 API 路由中独立封装为可复用、可注入 mock 的 provider/service；路由只负责参数校验和 HTTP 适配，业务单元测试直接覆盖生产实际调用的封装
- AI 释义功能的批量回归测试至少覆盖 20 个单词，并同时验证请求解析、请求词对齐、缓存写入及写后复读；不得只测试少量理想输入
- 需要人工排查的第三方功能应提供项目根目录下可通过`pnpm`执行的诊断脚本；脚本必须复用生产 provider、输出耗时/缺项/降级等诊断信息，且不得在命令输出或日志中泄露 Key
- 第三方调用即使存在自动降级也必须留下诊断记录；Client 模式统一写入外置`mds-data/logs`，至少记录网络/HTTP/超时、兼容降级、响应截断或缺项、缓存写入失败，并控制日志轮换大小
- 完成后汇总实施报告存到`.implementation-report`，涉及到当前实现的需求，实现中的关键决策，以及结果，是否有后续可能要处理的部分；报告里「后续可能要处理的部分」必须同步登记到 [FUTURE.md](FUTURE.md)（那里是待办唯一入口）

## 系统基础功能

因为该项目功能极其简单，所以没有单独的实现文档，需求直接写这里了：

- 功能入口简单，但复习状态需要按词库/天/模式统计，因此使用本地 SQLite（见下「词库 / 复习 / 学习档案」）；录入模式的单词表仍用浏览器`localStorage`持久化，Web 刷新或 Electron 重启后自动恢复
  - 列表可以用横向瀑布流，单词有长有短无所谓就横向排列，到头了放不下自然换行
  - 单词允许是词组或短句，这个无所谓
  - 提供清空功能，提供点击删除单个单词功能
  - 单词输入框最右侧提供`批量导入`按钮；弹层背景与设置界面一致，打开后自动聚焦输入区，支持遮罩点击或 Escape 关闭、`Ctrl/Cmd + Enter`确认导入
  - 批量文本以任意空白字符（包括空格、Tab、回车等）、英文逗号或英文分号分隔；自动丢弃空项，并忽略本批次内以及现有词库中的重复项
- 提供默写速度选项，分快中慢三档，还有个开关框，表示是否默写单词释义
  - 快中慢三档不是死值，是评估值，对应的是`非常流利的书写`，`正常小朋友的书写`，`需要思考才能找到答案的书写`的速率倍率
  - 当用户点击开始默写时，根据单词的长短来计算出每个单词适合的时间，这个时间肯定不能短于音频的时间，所以中间还是要有间隔，要计算的准确一点
  - 在设置中提供一个`倍率调整`默认是1，方便在你计算出时长之后，再乘上这个系数来控制实际时长
  - 当勾选了默写释义后，则默写间隔时间要加上释义的时间，这里要用到AI调用来为所有要默的单词生成释义答案
- 有两个开始默写按钮`开始书写默写`和`开始赛博默写`，两者区别是前者不提供输入框，等用户自己用笔默，后者提供输入框让用户打字
- 开始默写后
  - 为了默写流畅，使用预生成音频，显示`默写准备中`，预生成的音频设计一个方案，存在某个目录下，比如当前执行文件目录下建一个目录存各个单词的语音
    - 语音按单词作为文件名保存（考虑到一些单词可能会有些怪字词比如`'`这种，需要对实际文件名进行转义），这样优点是每次只生成增量，相当于有一个缓存了
  - 如果有释义，则会同时还要请求AI获取释义信息，此时提示层下方的全屏背景给毛玻璃遮罩，注意这里提供一个中止按钮，如果出意外可以主动中断
    - 这里涉及AI远程调用，可能出错、可能调用失败、可能配置不对、可能用量没了等等，要处理仔细，不要卡死或是导致界面其他bug
    - 在释义模式下拿到释义后才能最终评估每一行的默写时间
  - 默写准备过程生成音频可能需要不少时间，所以默写准备完成后，不是马上开始，而是显示`准备完成`，下面提供一个`Let's Go!`按钮，由用户点击触发开始
  - 默写顺序必然是打乱的，每轮默写时播报单词语音2-3遍，中间有明显间隔，这里报几遍的判断根据2点来：
    - 第一是释义模式，必然播报3遍
    - 第二单词小于6个字母时，播报2遍
  - 如果是赛博默写，则每轮提供输入框，默完的单词不显示，如果是勾了带释义则要分2步输入，输入完一个打回车将刚输入的单词显示在屏幕上，再提供长的输入框输入释义，释义输入完了打回车这两个要消失掉不留屏进入下一轮输入
  - 每轮默写时，屏幕上的元素：
    - 默写进度条，一共几个单词，当前默了第几个等
    - 当前该轮的倒计时，可以用一个不断缩短的进度条动画来展示，可以是圆环可以是长条
  - 倒计时与跳转到下一轮的概念
    - 倒计时的显示，只与计算后的每轮时长（乘上`倍率调整`系数后）相关
    - 但是倒计时结束时，不是必然跳到下一轮，而是`允许跳到下一轮`，跳不跳，还要看语音播报有没有结束
    - 这样的优点是，把语音播报与倒计时解耦了，你不需要纠结要不要去计算语音时长，只需要：
      - 倒计时结束时，检查语音放完了没，没放完只标记倒计时结束了，放完了跳下一轮
      - 语音播放结束时，检查倒计时结束没？没结束只标记语音结束了，结束了跳下一轮
    - 上述双轨判断是自动推进的默认规则，以下为用户明确要求的人工快速跳过例外：
      - 赛博默写中，用户完成当前轮要求的全部输入并提交后，可以忽略尚未结束的倒计时；语音轨结束后立即进入下一轮
      - 书写默写中，语音未处于实际发声状态时按空格，可以忽略倒计时并中止当前轮余下播报，直接进入下一轮
    - 赛博默写倒计时结束时，必须一次性提交本轮当前的单词和释义输入；未输入的字段以空字符串提交并视为输入完成，不得停留在单词或释义输入框等待用户继续操作。之后仍按语音轨状态决定立即推进或等待当前发声结束
  - 音频加载或播放失败时不能让整场默写永久卡住，应结束当前轮的语音等待并允许流程继续；如果失败可归因于缓存文件缺失、损坏或格式错误，必须清除对应缓存，避免错误文件被持续命中，后续准备时重新生成
  - TTS 接口只有在确认响应中列出的每个音频文件已经写入并可读取后才能返回成功；请求中止、合成失败或写入失败都不得返回一个并不存在的缓存文件名
  - AI 只返回部分释义、非标准内容块或无法解析的内容时不能因此卡死整个准备流程，可以带着已取得的释义继续；只缓存经过校验的有效英文释义，不得把缺失项或失败状态作为负缓存，保证下次准备仍会重新请求缺失释义
- 全部默完后，显示默完了，提供`查看结果`按钮：
  - 点击后显示答案，如果是赛博模式，每个答案上面显示用户输入内容做对照
  - 每个结果单词右侧提供 Lucide 发音图标，点击后单独播放一次该词在本轮准备阶段生成的发音；同一时间只播放一个试听，关闭结果页时停止，媒体失败仍需淘汰对应缓存
  - 对单词部分做对错判断，错误的可以做个背景标浅红，对的标浅绿等
  - 释义部分由 AI 批改（与中文词模式同构：意思相同即算对，改述可接受；AI 失败/中止降级本地宽松匹配并在结果页提示）
  - 给出单词对错的数量对比`<correct count>/<total words>`
  - 要是单词全对可以做一个撒花或是其他的效果来庆祝，所有svg图形需求优先查lucide icon库中有没有能满足要求的
- 显示出结果后，提供关闭按钮，点击后回到准备默写状态，不自动重置默认内容，由用户自行选择默同样的还是清空重填
  - 结果界面按 Escape 必须与点击关闭按钮完全等价：停止正在试听的结果发音并回到词库准备状态，保留当前词库
- 内容模式除单词/释义/中文词/组句外，另有`短句`模式（滑块顺序：单词 · 释义 · 中文词 · 短句 · 组句）：
  - 准备阶段为每个目标词生成一句英文**短句或词组**，默写对象是整句；句子用词与句法难度由设置里的生成级别约束
  - **短句要短**：目标 3–6 词、**硬上限 8 词**，超过即判不合格并做一次「收紧到 ≤5 词」的重试，仍不合格的词**降级为单词轮**（不中止本场）；**允许不是完整句子**（短语/片段只要通顺即可）
  - 每轮播报：**只念整句 3 遍**，不再先念目标词（用户听到第一个音就开始写，念单词没有用）
  - 计时按**整句基础公式**：3 遍 ×（4 秒思考 + 0.45 秒 × 整句字符数，字符含空格与标点），再乘三档速率与倍率调整（双重缩放）；调时长要改这个基础公式，不要靠调系数
  - 判定是**整句归一化后全等**：小写 → 去掉所有标点 → 去掉首尾空白 → 中间连续空白压成单个空格，然后全等比较；因此大小写、标点、空格多少都不影响，词序/词形/漏词才算错。**不做 AI 批改**（归一化比较就够）
  - 结果页只做三件事：这一句默的是哪个词、标准整句（目标词高亮）、用户输入的**原文**；对错由行首 ✓/✗ 与底色表达，不额外解释
  - 书写与赛博两种作答都支持（区别于只有赛博的组句模式）
- 主界面模式滑块右侧是**模式操作区**（`ModeActions.tsx`，按选中模式显示不同操作，目前只短句模式有操作）：
  - 短句模式的`更新短句`按**当前今日队列**的词清掉短句缓存（`sentences.json` 对应条目；`model`/`contentLevel` 与其它词保留，大小写不敏感），下次准备重新生句并各自写回缓存
  - 队列为空/录入模式时按钮置灰并给出原因提示；结果提示分「已清掉 N 个」「本来就没缓存」「失败」三态，离开短句模式即清掉旧提示
  - 只清文本缓存，不清理旧句子音频（无引用清理，见 FUTURE.md）
- 注意：释义只能英文释义，不支持中文释义
- 界面提供设置功能，有以下设置，使用 electron 的 localStorage（持久化到 userData）进行存储：
  - 设置面板不提供确认按钮；文本输入及其他控件每次变化时立即同步界面状态，并通过 `es-toolkit` 在停止变更 1.5 秒后防抖写入 localStorage。关闭面板或页面退出时立即提交尚未写入的设置，不使用失焦保存。点击面板左右的遮罩空白处可关闭，点击面板内部不得误关闭
  - AI相关配置，就是标准openai的请求地址及key的输入框，界面上提供范例，这个不设置不支持释义功能
  - 默写速度`倍率调整`
  - 每轮默写倒计时是否显示数字（精确到0.1秒），关掉的话只有倒计时条
- 根据上面提供的要求和各个元素，设计界面排版，界面风格以浅色为主，高雅精致，设计一个好看的primary和辅色搭配整个界面
- 为生成的windows应用程序提供一个图标，这个图标可以基于lucide中已经有的图标拼出来，比如可以有个漂亮的小黄星星这样

### 词库 / 复习 / 学习档案（2026-10-18 更新）

- **词库模式**：词库本体仍是 `mds-data/banks/*.json`；每日队列由 FSRS-6 排期计算，不落盘；队列来源（新词/复习/重学）由服务端判定。
- **复习状态（唯一事实来源）**：`mds-data/review/review.sqlite`。表：`cards`（每词 FSRS 快照）、`review_log`（逐题判定）、`session` + `session_word`（每场使用记录与词）。写入一场 = 一个事务；`session.id` 为幂等键，重放不重复。
- **场次采集**：书写与赛博都写场次（书写 `correct` 为 `null`）；书写不进 SRS 调度，但计入使用频率。客户端在开始默写时生成 `session.id`/起始时间，结算时提交 `words/correct/activeMs/wallMs`。`session.correct` 以逐题日志重算（**按题/空计数**）；「最近练习」的分母用 `judged`（该场日志条数，`review_log.session_id` 索引子查询），所以组句一轮多空时会出现 `2 / 3`（2 词 3 空），不会再被夹成 `2 / 2`。书写场次 `judged = 0`，显示 `— / 词数`。
- **今日进度**：不再有 `daily.json`；`readDayStats(bankId, day)` 由 `review_log` 聚合 `correct/total/elapsedMs`；`done` 仍由 `doneWordsToday` 从卡片 `last_review` 计算（自愈）。
- **迁移/兼容**：工厂 `createReviewStore(reviewDir)` 负责打开/建库/迁移；旧文件先导临时库、计数校验、`quick_check`、原子 rename，再归档。失败保留旧文件并返回 JSON 兼容 store（`mode="legacy"`，`stats=null`）；下次启动重试。`node:sqlite` 通过 `process.getBuiltinModule` 运行时获取，不得改成静态 import。
- **学习档案**：词表模式当前词表左侧 `library` → 32×32 按钮打开档案（点词表名仍打开选择弹层）。档案 = 4 KPI + 学习进度 / 180 天热力 / 最近 3 场 + 14 天到期预测 / 薄弱·常练词；Esc 返回并恢复焦点。「已掌握」= 下次间隔 ≥ 21 天；正确率样本 < 10 显示「—」；旧数据无场次时场次类指标显示 `—` 并注明从本版开始。热力网格区**固定高度**（7 行 18px 格 ≈ 158px，容器 176px + `overflow-y` 显式取 `hidden`）且卡片不可被 flex 压缩：窗口变矮时整页滚动或网格横向滚动，**不允许内部出纵向滚动条**。
- **写回判定字段**：结算写回（`buildCommitItems`）的对错 = **该行所有 `graded` 字段都对**：短句轮是 `sentence`（整句归一化比较），其余模式与短句降级轮是 `word`。只认 `word` 会让短句场次整场不写回（卡片不排期/日志不落盘/最近练习显示 `0 / N`）；只取 `word` 字段又会让「拼写对、释义错」进 FSRS 记成 Good（与结算页判错矛盾）——两处都是同一行错误（2026-10-18 修复）。耗时按 `roundIndex`（轮）取，组句一轮多空均分到各空。
- **卡片按词聚合**：`review_log` 逐题（正确率/耗时按题看），但**每词一场只推进一次 FSRS**（`aggregateItemsByWord`：有一空错就记 Again）。原因：同一时刻对同一张卡连续评分两次会让它提前毕业（实测新卡同毫秒两次 Good 直接从 Learning 跳到 2 天后）。
- **书写不推进队列**：书写场次不写卡，所以 `doneWordsToday`/「已默 x / N」不因书写而增长，队列词也不会打勾（既定口径，见 FUTURE）。
- **改这里必须同时跑** `src/lib/review-service.test.ts` 的 store 级回归（短句写回、场次得分、同词多空）。
- **专练**：薄弱词最多 5 个，一键「单词 + 赛博」；`runContentMode` 只覆盖本场，结果页/历史显示「单词」，关闭后恢复用户模式。
- **代码边界**：`review-service.ts` 的 `buildCommitItems` 被浏览器端复用，该模块及其依赖**不得 import `node:*`**（曾因 `node:crypto` 导致 Vite dev 下整页 externalized 报错、水合失败）。
- **测试**：统计口径/迁移/store 的单测直接覆盖生产实现；改这些模块必须同步 `pnpm test:run` 与 `pnpm check`。
- **文档**：方案 `plans/wordbank-stats.md`；实施报告 `.implementation-report/2026-10-18-wordbank-stats.md`；短句写回/热力滚动条/更新短句见 `.implementation-report/2026-10-18-sentence-writeback-and-archive-fixes.md`。

### 难点攻关

这里我预期的难点包括:

- 发音生成: 这个需要查一下有没有typescript实现的edge-tts库可以调，集成一个python程序太麻烦了，生成的音色配置要看下怎么弄，看要不要做进配置里
  - **现状（2026-10-17）**：已改为**项目内自研**：`src/lib/edge-tts-token.ts`（v2 `Sec-MS-GEC` 令牌）+ `src/lib/edge-tts-client.ts`（双端点、连接/回合超时、AbortSignal），不再依赖`edge-tts-universal`（它仍是 v1 令牌，且在握手失败时会让请求永不返回——正是「一直卡在生成音频中」的成因）。排障先跑`pnpm get:tts <word>`，详见`.implementation-report/2026-10-17-edge-tts-v2-and-hydration-crash.md`
- AI释义生成: 其实这个难度倒不大，提供一个提示词，要求AI返回指定格式的json，一次性提交所有的单词，一次交互在json里返回所有单词对应的释义就行
