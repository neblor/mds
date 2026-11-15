# 2026-11-15T18:30+08:00 — 设计稿补完第八批（短句三屏 + 窄窗 + 设置生成级别）并把 .pen 全部转成 .ptr

1. **格式迁移**：`paintress convert .design/mds.pen .design/mds.ptr`（新 fileToken），
   同一画板两边渲染的 PNG **md5 完全一致**；核对后 `git rm .design/mds.pen`（历史可回溯）。仓库里只剩 `mds.ptr`。

2. **补完「欠的稿」**（对应 FUTURE 原 §五-14、§七-4、§九-3、§十一-5）：
   - **C 基础组件**：模式条 4 项 / 宽 366 → **7 项 / 宽 500**，顺序与 `CONTENT_MODES` 一致
     （单词 · 释义 · 中文词 · 短句 · 混合 · 音标 · 组句）。33/37 的内联 Controls 同步。
   - **4 设置屏**：AI 卡补「生成级别 + 下拉 + 说明」，位置与 `SettingsPanel.tsx` 同序；
     面板收紧（卡片 p 18→14、gap 10→8、面板 gap 14→10、输入 padding 10→8）→ 高度 **854 → 754**，820 窗口内完整可见。
   - **41 词库页（短句模式）**：短句选中 + `更新短句` + 「已清掉 9 个词的短句…」提示。
   - **42 默写中（短句轮）**：`第 1/5 句`、`整句 1/3`、`正在播报 · 整句 1`、`听整句写整句，写完按回车`、占位 `输入整句…`、无「① 单词」标。
   - **43 默写结果（短句）**：三行（apple ✓ / give up ✗ / happy ✓），标准句里目标词品牌淡色高亮 + 「我写：」原文 + ✓/✗ 与底色。
   - **44 窄窗 747**：控制行换行（速度+500px 模式条 / 更新短句+提示），卡片宽 691。
   - **30 学习档案**：热力卡加标注「固定高 296（网格区 176）· 窗口变矮时整页滚动，网格内部不出纵向滚动条」。
   - **37 混合页**：控制行下新增说明行「混合：每词在释义 / 中文词 / 短句中随机 2 种，共 2 × 词数 轮（20 词 = 40 轮），同词两轮至少隔 6 轮」。

3. **顺手修的真相问题**：paintress 0.8.0 渲染 `ref` 实例时**只应用父节点直接子节点的纯属性覆盖**——
   `children` 整体替换不生效、孙节点 id 一律「未命中，已忽略」。因此 33（音标）、37（混合）、24（组句）、
   2（空态）、19（无词表）长期在画布上显示成普通 C。已用「深拷贝 C + 按 id 打补丁 + id 前缀重编」**实体化**这 5 块，
   画板与标题一致；19 另补了「新建词表 / 选择词表」两个按钮（与 `TodayQueueCard` 空态一致）。

4. **Pencil 残留清理**：项目 `AGENTS.md`、`.design/mds.md`、`.design/phonetic-mode.md`、`plans/*.md`、`FUTURE.md` 里的
   Pencil / `.pen 加密` 说法全部改成 paintress + `.ptr`（`.implementation-report/` 是历史档案，保持原样；
   `.agents/framework/snapshots/` 是框架快照，含旧 AGENTS.md 副本，也未改）。

5. **文档同步**：`.design/mds.md` 更新头部同步行（八批）、画布结构（补 33–44 列表）、
   新增「第八批」整节（含实例机制真相、每屏注解、与实现对齐表、未出稿项）；FUTURE 四条勾完成并新增两条待办
   （混合说明文案落地、设置面板是否收紧到 754）。

## 验证

- `paintress validate .design/mds.ptr` → **errors 0 / warnings 0**（含插入 6 个画板、约 900 个新节点后）。
- 逐板渲染目视核对：4 / 41 / 42 / 43 / 44 / 37 / 33 / 24 / 2 / 19 / 30 / 1 均与实现一致；
  截图存 `.design/sentence-mode-wordbank.png`、`sentence-mode-dictating.png`、`sentence-mode-result.png`、`wordbank-narrow-747.png`。
- 转格式一致性：同一画板 `mds.pen` 与 `mds.ptr` 的 PNG md5 相同（`333459ad…`）。
- 字体：在 `.design/__preset.ptr` 注册了 web 字体 Noto Sans SC（Google Fonts CSS），渲染不再全靠系统兜底；
  WSL 仍报 `Inter Variable / Segoe UI` 缺失，属渲染器候选栈提示。

## 待处理（已登记 FUTURE）

- 37 上的混合说明行**实现还没有**（FUTURE §十一-7）。
- 设置面板间距是否按 754 收紧到实现（FUTURE §十一-8）。
- 短句轮的**书写**作答画面未单独出板（文案只差状态行，10 号板已覆盖书写形态）。
- 新增文件 `.design/__preset.ptr`、`.design/__components.ptr` 是 paintress 0.8.0 自动创建的项目级设计系统文件，
  当前 preset 只有字体注册、组件库为空，未纳入本次改动范围（未 git add）。
