# 音素独立发音（phoneme audio）调研

> 状态：**调研完成，待选源**。需求由崔总 2026-10-23 追加：
> 「在答题过程凡是点上去的音标是能点击发音的（比如右边有喇叭，点左边还是能摘下来）」。
> 主方案见 `plans/phonetic-mode.md` §3.10；本文件只记录音源、许可、原型与播放交互的调研结论。

---

## 1. 结论

1. **可行**。已找到一套可随包发布的自由音源：Wikimedia Commons 的
   **12 个单元音 + 24 个辅音**录音（多数 CC BY-SA 3.0；`dʒ` 公有领域）；
   **8 个双元音**用两个单元音录音拼接（`e+ɪ`、`a+ɪ`、`ɔ+ɪ`、`ə+ʊ`、`a+ʊ`、
   `ɪ+ə`、`e+ə`、`ʊ+ə`），生成 0.5–0.7 秒的滑音。
2. **不能用** Oxford/教材音源（`xiaozhah/phoneme_audio` 的 README 明说来自
   Oxford Dictionary）、Freesound 的 CC BY-NC 包、IPA 官方图表音频
   （J. Esling，CC BY-NC-ND 4.0）以及没有许可证的 `moh3n9595/phonemes-dataset`。
3. **许可代价**：采用的音源是 **CC BY-SA 3.0/4.0**。音频目录需单独以
   CC BY-SA 4.0 发布，逐文件列作者/来源/许可/修改；App 代码仍是 MIT；
   安装包里要带 `THIRD_PARTY_NOTICES`/音频 LICENSE。若崔总不能接受
   share-alike，备选是 eSpeak-ng 机器音（免费、无版权负担、机器味）
   或自录/委托英式发音（质量最好、要时间）。
4. **技术**：单例 `Audio` 播放器；点已放置 chip 右侧喇叭 → 暂停/中止本轮单词音频 →
   播音素 → 从当前这一遍恢复单词音频；倒计时**不停**；重音符号 `ˈ`/`ˌ` 本身不发音。
5. **体积**：MP3 mono 64 kbps；原型 5 个文件 4.6–18.4 KB；估算 45 个音素 < 1 MB。
6. **质量限制**（必须如实告诉用户）：Commons 的辅音录音多为「辅音 + 元音」示范
   （例如 `ʃ` 源文件 2.4 秒，含两段音节），不是严格隔离的单音；双元音是拼接的；
   单元音是不同说话人录的，口音不全是英式。UI 标「音素示范」而不是「英式真人单音」。

---

## 2. 候选音源与判定

| 候选 | 内容 | 许可 | 判定 |
| --- | --- | --- | --- |
| Oxford Dictionary 音频（`github.com/xiaozhah/phoneme_audio`） | 44 个英式音素 isolation + 例词，正好是需求形态 | README 明说来源 Oxford Dictionary，未授权 | **不可随包分发** |
| Freesound「English Phonemes」by margo_heston | 约 12 个自然拼读音 | CC BY-NC | **不可用**（NC，且不全） |
| IPA 官方图表音频（J. Esling） | 完整 IPA | CC BY-NC-ND 4.0 | **不可用**（NC/ND，不能转码裁剪） |
| `github.com/moh3n9595/phonemes-dataset` | 44 English phoneme sounds | 仓库无 LICENSE | **不可用**（来源不明） |
| `charlottebuff.com/assets/audio/mpeg/phoneme/` | 以 IPA 描述命名的 mp3 | 站点 CC BY 4.0；音频目录当前 404，来源不明 | 不用 |
| MPC Interactive Cue Card | SSB English 音素 | 页面未给明确许可，疑似教材资源 | 不用 |
| **Wikimedia Commons**（Peter Isotalo / Denelson83 / Erutuon / Nardog / Octane） | 12 单元音 + 24 辅音 | **CC BY-SA 3.0/4.0；`dʒ` 公有领域** | **采用** |
| eSpeak-ng | 任意 IPA，机器音 | GPL 工具；生成音频可分发 | 备选（机器味） |
| Piper（en_GB 模型） | 神经 TTS，构建期生成 | 模型许可各异（多为 CC BY 4.0/公有领域） | 备选（质量/工作量更高） |
| 自录/委托英式发音 | 45 个单音，质量最好 | 自有 | 最佳，但要时间/成本 |

参考的作者/许可清单（Wikimedia Commons 音源）：
`https://jhnwnstd.github.io/courses/ipa-audio-credits.html`

---

## 3. 采用的音源表

> 下载入口（无需 API）：`https://commons.wikimedia.org/wiki/Special:FilePath/<文件名>`
> 许可/作者页：`https://commons.wikimedia.org/wiki/File:<文件名>`
> 两个 URL 都是纯文本，便于复制核对。

### 3.1 单元音（Denelson83，CC BY-SA 3.0）

| token | Commons 文件 | 备注 |
| --- | --- | --- |
| `iː` | `Close front unrounded vowel.ogg` | 与 `i` 共用；长版保留全时长 |
| `ɪ` | `Near-close near-front unrounded vowel.ogg` | |
| `e` | `Close-mid front unrounded vowel.ogg` | 音标表写 `/e/`；实际英语 DRESS 更接近 `[ɛ]`，此文件是 `[e]`，按表符号取用 |
| `æ` | `Near-open front unrounded vowel.ogg` | |
| `ɑː` | `Open back unrounded vowel.ogg` | |
| `ɒ` | `Open back rounded vowel.ogg` | |
| `ɔː` | `Open-mid back rounded vowel.ogg` | |
| `ʊ` | `Near-close near-back rounded vowel.ogg` | |
| `uː` | `Close back rounded vowel.ogg` | |
| `ʌ` | `Open-mid back unrounded vowel.ogg` | |
| `ɜː` | `Open-mid central unrounded vowel.ogg` | |
| `ə` | `Mid-central vowel.ogg` | |
| `i`（happy） | `Close front unrounded vowel.ogg` | 与 `iː` 同源，trim 到短版 |
| `a`（仅用于拼双元音） | `Open front unrounded vowel.ogg` | 不作为独立 tile |

### 3.2 辅音（Peter Isotalo，CC BY-SA 3.0；`dʒ` 除外）

| token | Commons 文件 | 备注 |
| --- | --- | --- |
| `p` | `Voiceless bilabial plosive.ogg` | 多为「辅音+元音」示范 |
| `b` | `Voiced bilabial plosive.ogg` | |
| `t` | `Voiceless alveolar plosive.ogg` | |
| `d` | `Voiced alveolar plosive.ogg` | |
| `k` | `Voiceless velar plosive.ogg` | |
| `ɡ` | `Voiced velar plosive.ogg` | |
| `tʃ` | `Voiceless palato-alveolar affricate.ogg` | |
| `dʒ` | `Voiced palato-alveolar affricate.ogg` | **公有领域**（Octane） |
| `f` | `Voiceless labiodental fricative.ogg` | |
| `v` | `Voiced labiodental fricative.ogg` | |
| `θ` | `Voiceless dental fricative.ogg` | |
| `ð` | `Voiced dental fricative.ogg` | |
| `s` | `Voiceless alveolar sibilant.ogg` | |
| `z` | `Voiced alveolar sibilant.ogg` | |
| `ʃ` | `Voiceless palato-alveolar sibilant.ogg` | 源文件 2.4 s，含两段音节 |
| `ʒ` | `Voiced palato-alveolar sibilant.ogg` | |
| `h` | `Voiceless glottal fricative.ogg` | |
| `m` | `Bilabial nasal.ogg` | |
| `n` | `Alveolar nasal.ogg` | |
| `ŋ` | `Velar nasal.ogg` | |
| `l` | `Alveolar lateral approximant.ogg` | |
| `r` | `Postalveolar approximant.ogg` | 英语 `/r/` 更接近；文件页标注 CC0 / CC BY-SA 3.0，构建脚本按页面当前许可写入 manifest。保守备选：`Alveolar approximant.ogg`（Erutuon，CC BY-SA 3.0，音色略“怪”） |
| `w` | `Voiced labio-velar approximant.ogg` | |
| `j` | `Palatal approximant.ogg` | |

### 3.3 双元音（拼接；改编后 CC BY-SA 4.0）

| token | 拼接 | 备注 |
| --- | --- | --- |
| `eɪ` | `e` + `ɪ` | 原型已生成 0.65 s / 5.5 KB |
| `aɪ` | `a` + `ɪ` | |
| `ɔɪ` | `ɔ`（取 `ɔː` 文件）+ `ɪ` | |
| `əʊ` | `ə` + `ʊ` | 英式 GOAT |
| `aʊ` | `a` + `ʊ` | |
| `ɪə` | `ɪ` + `ə` | |
| `eə` | `e` + `ə` | |
| `ʊə` | `ʊ` + `ə` | |

- 每个单元取 0.25–0.35 s，6–8 ms 交叉淡化，总长约 0.5–0.65 s。
- 这是「两个目标音的滑音」，不是某位英式发音人的真实双元音；UI 标「音素示范」。
- 如果以后找到 CC0/已授权的英式双元音真人录音，直接替换这 8 个文件即可，接口不变。

### 3.4 不发音的 token

- `ˈ`、`ˌ`：本身不是音素，**不提供喇叭**；chip 只保留左侧移除区域，
  title 写「重音符号本身不发音」。池子/结果页同理。

---

## 4. 原型结果（本机 ffmpeg）

已下载并转换 7 个源文件（`/tmp/phoneme-audio/`，临时）：

| 源文件 | 源 OGG 大小 | 源时长 | 转 MP3 64k mono | MP3 大小 |
| --- | ---: | ---: | --- | ---: |
| `Close front unrounded vowel.ogg` | 12,846 B | 0.60 s | `i-long.mp3` | 5,268 B |
| `Near-close near-front unrounded vowel.ogg` | 13,435 B | 0.57 s | `i-short.mp3` | 5,059 B |
| `Close-mid front unrounded vowel.ogg` | 18,193 B | 0.76 s | `e.mp3` | 6,313 B |
| `Mid-central vowel.ogg` | 10,959 B | 0.55 s | `schwa.mp3` | 4,641 B |
| `Alveolar approximant.ogg` | 23,547 B | 1.95 s | `r-alveolar.mp3` | 15,717 B |
| `Postalveolar approximant.ogg` | 27,209 B | 2.16 s | `r.mp3` | 16,135 B |
| `Voiceless palato-alveolar sibilant.ogg` | 123,837 B | 2.43 s | `sh.mp3` | 18,434 B |

- 转换参数：`-ac 1 -ar 22050 -b:a 64k`，`silenceremove` 去首尾静音，
  `loudnorm=I=-16:TP=-1.5:LRA=11` 统一响度。
- `eɪ` 拼接：`e` 取 0.30 s + `ɪ` 取 0.30 s，6 ms 交叉淡化 → **0.65 s / 5,477 B**。
- 估算 45 个文件：辅音带示范上下文约 10–18 KB × 24 ≈ 350 KB；
  单元音约 5 KB × 21 ≈ 105 KB；双元音约 5.5 KB × 8 ≈ 44 KB；
  合计 **约 0.5 MB**（不含清单/许可文本），可随包。
- 辅音源文件的 `silencedetect` 显示多为「静音 → 音节 → 静音 → 音节」的结构
  （例如 `ʃ`：0.18–0.89 s、1.47–2.26 s 两段）。计划**保留第一段**（约 0.9 s）
  作为示范，而不是硬切单辅音——切错比带元音上下文更糟。
- 单元音源都是 0.55–0.76 s 的稳定元音；长/短元音用**时长**区分：
  长元音保留 0.55–0.7 s，短元音 trim 到 0.25–0.35 s。

---

## 5. 播放与 UI 交互

### 5.1 放置后的 chip（崔总明确要求）

```text
我的音标：  / [ˈ]  [æ 🔊]  [p 🔊]  [ə 🔊]  [l 🔊] /
                     ↑ 左：token，点击移除
                            ↑ 右：喇叭，点击单独发音
```

- chip 是**两个相邻按钮**，不是嵌套按钮：
  - 左按钮 `aria-label="移除音素 æ"`；点击 `removePick(index)`；hover 变 err 色；
  - 右按钮 `aria-label="试听音素 æ"`；点击 `playPhoneme(token, pickKey)`；
  - 中间 1px 分隔；喇叭播放时 `animate-pulse`/高亮；`aria-pressed`。
- 点左只移除、点右只发音，互不触发（`stopPropagation` 不需要，因为是两个独立按钮）。
- 移除正在播放的那个 chip 时，停止该音素。
- 重音 chip 没有右按钮；整块可点移除，title 说明不发音。

### 5.2 池子 tile（建议同构）

- 池子 tile 也做左/右分区：左 = 放入答案，右 = 试听。
- 这样用户在选之前就能听，不用「放入→试听→移除」来回。
- 若设计觉得 48px tile 放两个区域太挤，退化方案：
  - 池子 tile 只保留左放入；`Shift+Enter` 试听当前聚焦 tile（键盘）；
  - 鼠标用户可先放入再点喇叭（崔总要求的形态仍然满足）。
- 这是**建议**，需崔总确认（§7）。

### 5.3 结果页/历史

- 标准音标与「我的音标」都按 token 渲染，每个 token 右侧带小喇叭；点 token 可试听。
- 结果页的单词发音按钮与音素喇叭互斥：先停对方的播放。
- 历史回看复用同一结果行，音素音频是随包静态文件，离线可用。
- 这是顺手扩展，成本低；若不做，结果页仍可只看不点。

### 5.4 与单词音频的冲突（必须处理）

用户点音素喇叭时，本轮的单词 TTS 很可能正在播。三个选项：

| 方案 | 行为 | 评价 |
| --- | --- | --- |
| **A. 中止 + 重播当前遍（推荐）** | abort 本轮 `playWithIntervals` → 播音素 → 播完从 `repeatIndex` 重播当前这一遍 | 与全屏音标表的暂停机制复用；实现简单；用户会听到单词这一遍重新开始 |
| B. 压低单词音量 | 单词音频继续但音量降到 20%，音素正常播 | 两个声音重叠，辨识差 |
| C. 停止单词音频并标记语音轨完成 | 不再恢复 | 用户丢掉剩余遍数，但单词可见；最简单 |

- 推荐 A：`previewPhoneme` 在 `dictating` 且 `!speechDone()` 时
  abort 当前播放、记住 `repeatIndex`；音素播完（或失败）后从该遍重播；
  若期间已提交/推进/进入结果，则不恢复。
- 倒计时**不暂停**（只有全屏音标表暂停）；用户是在主动学习，不是离开。
- 连续点多个喇叭：停上一个音素，单词音频保持中止；最后一个音素播完后再恢复一次。
- 打开全屏音标表时：停止音素 + 单词音频；关闭后恢复单词音频（音素不恢复）。
- 结果页：音素喇叭与结果页单词发音按钮互斥；进入结果/历史切换时停止音素。

### 5.5 播放器与文件

- `src/lib/phoneme-audio.ts`：单例 `HTMLAudioElement`；
  `play(token, key)` / `stop()` / `preload(tokens)` / `playingKey` 信号；
  失败时标记该 token 本次会话不可用（喇叭置灰 + tooltip），不抛错。
- 静态文件 `public/ipa/audio/v1/<slug>.mp3`；`phoneme-audio.v1.json` 映射
  token → 文件 + 来源/作者/许可 + 修改说明。
- slug 用 ASCII，避免中文/特殊符号文件名：`i-long`、`i-short`、`e`、`ae`、`aa`、
  `o-short`、`oo-long`、`u-short`、`u-long`、`uh`、`er`、`schwa`、`happy-i`、
  `p`、`b`、`t`、`d`、`k`、`g`、`ch`、`j`、`f`、`v`、`th`、`dh`、`s`、`z`、`sh`、`zh`、
  `h`、`m`、`n`、`ng`、`l`、`r`、`w`、`y`、`ei`、`ai`、`oi`、`ou`、`au`、`ia`、`ea`、`ua`。
- 预加载：面板挂载时对**本轮池子**的 token 调用 `preload`（8–16 个文件），
  首次点击无等待；全部 45 个文件也可在进入音标模式后低优先级预热。
- 音频格式 MP3（Chromium/Windows 通用；Web 下 Safari 也支持）。
- 失败处理：文件缺失/解码失败 → 喇叭置灰、tooltip「该音素示范不可用」；
  单词音频按方案 A 恢复；不影响本轮提交/推进。

### 5.6 键盘

- 池子 roving tabindex：方向键移动；`Enter` 放入；`Shift+Enter` 试听当前 tile
  （若池子 tile 有右喇叭，也 Tab 可达）。
- 已放置 chip：`Backspace` 撤销最后一个；`Shift+Backspace` 试听最后一个；
  每个 chip 的左右按钮都是可聚焦按钮，Tab 可逐个访问。
- 结果页：token 喇叭可 Tab；`Enter`/`Space` 试听。
- 全屏音标表 `F1` 不变。

---

## 6. 构建、许可与测试

### 6.1 构建脚本

`scripts/fetch-phoneme-audio.mjs`（`pnpm build:phoneme-audio`）：

1. 读内置的源表（token → Commons 文件/作者/许可）；
2. 从 `Special:FilePath` 下载 OGG 到 `.tmp/phoneme-audio/src`；
3. ffmpeg 去静音、trim、响度归一、转 MP3 64k mono；
4. 拼接 8 个双元音（交叉淡化）；
5. 写 `public/ipa/audio/v1/*.mp3` + `phoneme-audio.v1.json` +
   `LICENSE.md`（逐文件作者/来源/许可/修改）；
6. 打印每个文件的源大小/输出大小/时长/许可；
7. 生成物提交仓库；`pnpm check` 不联网、不重跑。

### 6.2 许可

- 源音频：CC BY-SA 3.0 / 4.0；`dʒ` 公有领域；`Postalveolar approximant.ogg`
  文件页当前标注 CC0 / CC BY-SA 3.0（构建脚本记录实际值）。
- 转换/trim/拼接后的音频：**CC BY-SA 4.0**（share-alike）；
  音频目录单独许可，App 代码保持 MIT。
- 必须随包提供：
  - `public/ipa/audio/LICENSE.md`：逐文件作者、标题、来源 URL、许可、修改；
  - 根目录 `THIRD_PARTY_NOTICES.md`（或等价）汇总；
  - 安装包/应用内可访问的许可页（设置里加一行「音素音频来源/许可」链接即可）。
- 如果崔总不能接受 CC BY-SA：
  - eSpeak-ng 生成（免费、无 attribution，机器音）；
  - Piper en_GB 神经模型构建期生成（质量更好，模型许可需逐个确认）；
  - 自录/委托英式发音（质量最好，时间/成本）。

### 6.3 测试

- `phoneme-audio-data.test.ts`：45 个 token（除 `ˈ`/`ˌ`）都有 manifest 条目；
  文件存在、MP3 头合法、大小 < 100 KB；manifest 每个文件都有作者/来源/许可；
  slug 全 ASCII；双元音有两条源引用。
- `phoneme-audio.test.ts`：mock `Audio` 覆盖 play/stop/ended/error、
  单例互斥、`playingKey`、preload、失败置灰、stress 无 audio。
- `use-dictation.test.ts`：点音素喇叭 → 单词音频 abort → 音素播完 →
  从 `repeatIndex` 恢复；期间提交/推进/进结果不恢复；打开全屏表停止音素；
  连续点多个只恢复一次。
- `web:smoke`：抽查 `/ipa/audio/v1/ei.mp3` 与 manifest 200；
  `client:verify` 包含 `public/ipa/audio`。

---

## 7. 已确认（崔总 2026-10-23）

1. **音源**：**A. Wikimedia Commons 自由录音 + 拼接双元音**（CC BY-SA，需 attribution/share-alike；
   辅音带元音上下文、口音不全是英式）。
2. **池子 tile**：**也做左放入/右试听**。
3. **结果页/历史**：**IPA token 也加喇叭**。
4. **重音符号**：默认**不发音、无喇叭**（如需重音示范音，另录/合成，见 FUTURE）。
5. **许可**：接受音频目录 CC BY-SA 4.0 与随包许可清单；App 代码保持 MIT。

> 已否决的备选：eSpeak-ng（机器音）、Piper en_GB（构建期神经模型，留作后续备选）、
> 仅本机自用 Oxford 音源（不可随安装包分发）。
