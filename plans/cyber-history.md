# 赛博默写历史记录（最近 5 次）方案

> 状态：已确认（2026-08-21）。三个决策点经用户确认：入口放词库头部设置旁、历史详情支持发音试听、不提供清空历史按钮。

## 需求

- 主界面提供「测试历史」入口
- 点击弹出浮窗，背景毛玻璃模糊（与设置/批量导入弹层一致）
- 列出最近 5 次**赛博默写**结果（书写模式不判定、不记录）
- 点击记录可回看完整结算画面（复用 `ResultsView`）
- localStorage 持久化

## 方案

### 入口

词库页头部、设置齿轮左侧 `History` 图标按钮（与设置按钮同款样式）。始终可见，无记录时弹窗内显示空状态。仅词库阶段（idle/preparing/ready）可打开。

### 历史弹窗 `HistoryDialog`

- 遮罩复用弹层范式：`bg-ink/30 backdrop-blur-sm` + `isSettingsBackdropClick` 防误关
- 两级视图：列表态（时间、内容模式标签、得分 `x/n`，点击进详情）/ 详情态（渲染 `ResultsView`，rows 喂历史数据，判定已烘入）
- `ResultsView` 增加可选 title/footer props 以同时服务现场结算与历史回看
- 键盘流：Escape 分层（详情→列表→关闭）；Tab + Enter 操作条目；弹窗容器 autofocus

### 存储 `src/lib/history-storage.ts`

```ts
interface HistoryEntry {
  id: string;           // finishedAt 时间戳
  finishedAt: number;
  contentMode: ContentMode;
  correctCount: number; // 冗余汇总
  wordCount: number;
  gradeNote: string | null;
  rows: ResultRow[];    // 已含 correct 判定
}
```

- Key `mds.history.v1`，上限 5 条 prepend 截断；`normalizeHistory()` 校验形状丢弃损坏条目；SSR/异常静默降级

### 录制时机（use-dictation 收口）

三处进 `results` 的路径统一 `enterResults()`：赛博单词直进、AI 批改完成（含失败降级）、中止批改降级。`mode === "cyber"` 时 `buildResultRows(...)` 烘入判定后 `appendHistory()`。书写模式不记录。

### 发音试听

`playResultAudio` 抽成通用工厂 `createResultAudioPlayer()`（`src/lib/result-audio.ts`），结算页与历史弹窗各自实例化；失败优雅降级并淘汰缓存。

## 测试

- `history-storage.test.ts`：normalize 校验/截断、append、buildHistoryEntry 汇总
- `use-dictation.test.ts`：三路径录制、判定烘入、书写不记录、只留 5 条
- `HistoryDialog` 组件测试：空状态、列表渲染、进详情返回、Escape 分层

## 实施顺序

plans 存档 → `.design` 设计三画面（入口/列表/详情）→ history-storage → result-audio 抽取 → use-dictation 接入 → UI 接线 → `pnpm test:run` + `pnpm build` → 实施报告
