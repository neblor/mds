# Web 核心业务复审问题修复

日期：2026-08-01

## 范围

仅处理普通 Web 端核心业务，包括前端默写/播音编排和 Web 服务端 TTS 缓存路由；不涉及 Electron、Deno Desktop、安装包或客户端封装。

## 修复内容

### 轮次异步回调隔离

- 倒计时 interval、`onPlay`、`onAudioState` 均校验当前 `roundSeq` 和 `dictating` phase。
- 快速跳过后，旧轮次播音间隔的延迟清理回调不能再修改新轮次的 `sounding`、播报索引或推进状态。
- Promise 最终 outcome 继续使用同一序号边界，已失效轮次不会触发 `speech-end`。

### 媒体错误缓存淘汰

- `playWithIntervals` 增加 `onPlaybackFailure`，媒体解码错误或非自动播放策略的 `play()` 拒绝发生时立即通知一次。
- `useDictation` 在 `onAudioState(false)` 可能触发快速 advance/finish 之前启动对应音频缓存失效。
- `NotAllowedError` 仍视为浏览器播放策略问题，不删除正常缓存。
- 快速进入结果页和损坏缓存淘汰现在互不冲突。

### TTS 并发缓存写入

- 临时文件名改用 `pid + randomUUID`，避免不同任务共享临时路径。
- 临时文件在所有成功、重复目标和异常路径中统一清理。
- 两个请求同时合成同一个词时，如果另一个请求已经先写入目标文件，当前重复结果直接丢弃；兼容 Windows 不覆盖已有目标的 rename 行为。
- 中止发生在临时写入后时不会继续发布目标缓存。

## 测试与构建

- `api.test.ts`：验证媒体错误即时通知、自动播放策略不误报、失败通知只触发一次。
- `use-dictation.test.ts`：验证旧轮次延迟回调不污染新轮次，以及赛博快速结束叠加媒体错误时先淘汰缓存再进入结果页。
- 新增 `routes/api/tts.test.ts`：验证同词并发合成均成功、只留下一个目标文件且没有临时文件残留。
- `TMPDIR=/tmp pnpm test`：12 个测试文件、152 个用例全部通过。
- `pnpm run build`：Web 生产构建通过。
