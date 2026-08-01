# 默写结束立即进入结果页修复

日期：2026-08-01

## 问题

默写最后一轮通过快速提交结束时，结果页不能稳定立即显示：最后一个输入框的 Enter 先触发提交并进入 `results`，同一次键盘事件随后冒泡到 `window`，全局“结果页回车关闭”逻辑又立即把 phase 改为 `idle`。与此同时，抽离后的播音 Promise 可能仍在等待遍次间隔，使迟到回调进一步干扰页面状态。

## 实现

- 在 `use-dictation.ts` 增加唯一的 `finishDictation` 出口：先递增 `roundSeq` 使当前轮所有迟到回调失效，再清理倒计时和音频，立即切换到 `results`。
- `runStep` 只在 `dictating` 阶段处理事件；已进入结果页后，旧播音、倒计时或 abort 回调不能再驱动状态机。
- 最后一轮无论由正常双轨完成、赛博快速提交还是书写空格跳过结束，都使用同一完成出口。
- 赛博输入框处理 Enter 时调用 `preventDefault` 和 `stopPropagation`，避免提交事件继续到达全局结果页快捷键。
- 全局键盘处理增加防御：来源于 input、textarea 或 contenteditable 的 Enter 即使在 phase 切换后到达 window，也不会关闭刚出现的结果页；结果页中新的独立 Enter 仍可正常关闭。

## 测试

- `dictation-engine.test.ts` 增加“最后一轮在播报间隔区提交立即 finish”用例。
- `use-dictation.test.ts` 增加：
  - 最后一轮输入框 Enter 提交后立即停留在结果页；
  - 同一次 Enter 冒泡不能关闭结果页；
  - 旧播音 Promise 延迟完成不能改变结果页；
  - 书写模式最后一轮空格跳过立即进入结果页；
  - 释义第二步 Enter 同样不能关闭结果页。
- `TMPDIR=/tmp pnpm test`：11 个测试文件、150 个用例全部通过。
- `pnpm run build`：通过。
