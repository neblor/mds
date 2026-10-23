# 音标资源

## 音标表

- 文件：phonetic-symbols.png（3600×2400，源自 ~/repos/andares/clocktower/cheat-sheets/phonetic-symbols.png）
- 用途：音标模式中按 F1/按钮全屏查看；构建期只复制，不修改。

## 音标词典

- 文件：en-gb.v1.json
- 源：Britfone 3.0.1（MIT）
  https://github.com/JoseLlarena/Britfone
- 许可：见 LICENSE-britfone.txt
- 生成：`pnpm build:phonetics`（默认下载到 .tmp/phonetics-src；可用 --csv 指定本地文件）
- 归一化：
  - ɹ→r、ɛ→e、ɛə→eə、ɐ→ʌ、g→ɡ、iə/uə→ɪə/ʊə、oʊ→əʊ；
  - 长元音/双元音/塞擦音各为一个 token，不拆 ː；
  - Britfone 的重音挂在元音前，构建期按「最大音节首」移到音节首前；
  - happy 尾音 i 单列（音标表 44 音之外的第 45 个 token）。
- 只保留单条英文词；词组/缩写/专名跳过，运行时降级为单词轮。

## AI 音标兜底

- 只补内置词典缺失的词；`POST /api/phonetics` → `phonetic-provider` → `phonetic-service`。
- 缓存：运行时缓存目录 `phonetics.json`（`model` + `promptVersion` 身份；缺失/失败不写负缓存；写后复读）。
- 诊断：`pnpm get:phonetics apple water`（直接调 provider，不读写业务缓存，不打印 Key）。
- 输出经 `parsePhoneticVariants` 白名单/重音归位/主重音数量校验；结果页标注「AI 生成，仅供参考」。
- 未配置 AI 时缺失词直接降级为单词轮，不阻塞音标模式。

## 全屏音标表

- 路由 `/phonetic-symbols`；Electron 主进程只允许同源精确路径，用无边框全屏子窗口；
  Web 为普通弹窗。任意键/点击关闭；默写中打开会暂停倒计时/音频，关闭后从当前这一遍恢复。

## 音素音频

- 文件：`audio/v1/`，45 个 MP3（44 音标表音 + happy `i`；重音 `ˈ`/`ˌ` 无音频），约 323 KB。
- 源：Wikimedia Commons 真人录音（37 个源文件；辅音多为「辅音 + 元音」示范，
  8 个双元音由同源单元音拼接）；逐文件来源/作者/许可/修改见 `audio/v1/LICENSE.md`。
- 整体许可：CC BY-SA 4.0；App 代码仍 MIT，随包 `THIRD_PARTY_NOTICES.md`。
- 生成：`pnpm build:phoneme-audio`；试听：`public/ipa/audio/v1/preview.html`（通过 `pnpm web:dev` 或内置服务打开）。
