# 2026-11-24T01:46+08:00 — 音色试听评审补强：覆盖生产状态编排并修正文档

第三方复审确认需求本身已覆盖，但原实现把约 90 行试听状态编排直接写在 `SettingsPanel.tsx`，现有单测只覆盖台词/文案，没有覆盖生产代码的停止、迟到回调、换音色与失败重试路径。

本轮将实际编排抽成 `src/lib/voice-preview-player.ts`，`SettingsPanel` 仍调用同一生产播放器；网络与媒体边界通过 `VoicePreviewDriver` 注入，默认 driver 继续复用 `requestTtsAll` → `/api/tts` 与 `playWithIntervals`，交互不变。音色切换改成显式 `voiceChanged()` 迁移，避免 Node 下 Solid 服务端构建不执行 effect 更新而无法测试；组件的 select onChange 直接调用它。

新增 `voice-preview-player.test.ts`，覆盖：当前音色合成、合成中重复点击、完整播放、播放中停止、合成中停止、迟到回调失效、换音色中止且不自动开播、合成失败重试、空音频名、媒体失败/播放拒绝淘汰缓存、卸载中止、跨任务不连续重复选句。

另外修正文档：试听缓存上限 5×12 应为 60 个文件而非 65；设计注解原先写复用 `createResultAudioPlayer`，改为实际复用的底层 `playWithIntervals`；README 明确“每个音色的一句台词首次合成需要联网”，避免误解成任意新句都可离线。

## 验证

- `pnpm test:run`：89 个测试文件、961 个测试全部通过。
- `pnpm typecheck`：通过。
- `pnpm check`：完整通过（测试 → tsc → Web 生产构建 → 生产 HTTP/缓存冒烟）。
- 实际浏览器复测：合成→播放→字幕、播放中停止、换音色停止且不自动重播、焦点保持均正常；控制台无新增错误。
