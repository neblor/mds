# 菜单禁用 · 组句点选跳格 · 出题校验放宽（2026-10-13）

## 一、需求（崔总反馈三条）

1. **彻底禁用应用菜单**：`autoHideMenuBar` 只做到「隐藏」，单按 Alt 仍会把菜单栏唤出来。
2. **组句轮的点选流**：鼠标点一个候选词填完一个空之后，当前空要**自动跳到下一个空**，
   不需要再拿鼠标去点下一个空格；同时不阻止来回点击（已填的空也要能点回去改选），
   点完继续跳到下一个输入区。
3. **组句出题不能拦得太死**：本地没有模型，判不了题目好坏；校验只应保证「格式可识别、能跑」。
   句数/空数多几句少几句不是问题；**重复词必须允许**（学 `I` / `the` 这类基础词时，
   一句里两三个 `the` 很正常），否则那些词库根本出不了题。原话：「提要求是当然要的……
   但返回的结果多几句不重要」「不要提那种完全不合理的需求，什么测试里有 I 这个词，
   结果你说不允许出 I，这不是难为人吗」。

## 二、关键决策

### 1. 菜单：`Menu.setApplicationMenu(null)`，而不是继续调 autoHide 参数

- Electron 文档明确：`autoHideMenuBar` 下「users can still bring up the menu bar by pressing the single Alt key」，
  这正是问题根因，参数怎么调都躲不掉。
- `setApplicationMenu(null)` 才是「没有菜单可唤出」；Windows/Linux 下同时移除窗口菜单栏。
- 副作用确认：文字输入框的 Ctrl+C/V/X/A/Z 由 Chromium 自己处理，不依赖菜单加速键；
  该限制只影响 macOS（那边需要 Edit 菜单角色），本项目只出 Windows 包。
- 落点：`electron/main.mjs`（注释写明原因）；`electron/window-options.mjs` 的 `autoHideMenuBar` 保留但加注释说明它不是禁用。

### 2. 组句点选：把鼠标路径并到同一个纯状态机里（新增 `pick` 事件）

- 原实现里「填入后前进到下一个空」只写在 `cloze-input.ts` 的 `chooseWith` 里，
  而鼠标点击走的是组件里的另一条路（`chooseFromChip` → 直接 `onChoose(activeBlank, word)`），
  所以**只有键盘会跳格、鼠标不会** —— 与反馈完全对得上。
- 决策：状态机加 `pick`（按候选下标选择），鼠标点击 = `pick`，与 `Enter` 共用同一套「填入 + 前进」逻辑；
  `digit`（1–9 快选）也改走 `pick`，三条输入路径只剩一份实现。
- 前进方向：优先往后找下一个未填空，找不到再绕回前面（复用已有 `nextEmptyBlank`）。
- 已填空槽从 `<span>` 改成 `<button>`：点它 = 把当前空切回去（可再点候选词覆写）；
  当前空是已填状态时补一圈 `ring-[3px] ring-brand/30` 光圈，让「改选目标」看得见。
- 空槽顺序改按**正文首次出现**排列（原来是按编号大小）：编号跳号/同号重复时，跳格方向与阅读方向一致。

### 3. 出题校验：只拦「跑不了」，不拦「不够好」

硬拦（保留）：

| 规则 | 为什么必须拦 |
| --- | --- |
| JSON 形状（items 数组 / sentences 非空字符串数组 / blanks 对象数组） | 解析不了就渲染不了 |
| `##n` 与 `blanks` 编号集合一一对应（正文里出现的编号都要有答案，答案编号都要在正文里出现） | 空槽没有答案、答案没有空槽，判定与作答都对不上 |
| 答案必须来自候选池（大小写不敏感，归一为候选词原始写法） | 学生只能从候选胶囊里选，池外答案永远填不出来 |
| 防护上限：12 题 / 8 句 / 8 空 / 单句 400 字符 | 防异常响应把界面和一场默写撑爆，属于「不超太多就行」的那条线 |

明确放行（原来的硬拒全部删除）：

- 题数、句数、空数「多了少了」（提示词仍写 `3–6 题 / 每题 2–3 句 / 2–4 空`，但只是要求；也不再要求「编号各一次」）
- 同一个词填多个空、一句里两三个同词
- **未挖空的候选词出现在句子里**（原 `assertNoLeakedCandidates` 直接删除）——
  这条就是「测试里有 I 就说句子不许出现 I」，对基础词库等于断子绝孙
- `usedWords` 缺失、重复、写错（该字段不再参与校验，只按答案现算去重，保留字段是为了兼容旧响应与诊断脚本）
- 全场答案词去重 ≤16 的原 `CLOZE_MAX_ANSWERS` 上限（删掉常量与校验，回归为提示词里的「尽量 6–16 个不同词」；
  候选池本身 ≤24 已能兜住规模）
- 顺带增强：同一个编号 `##n` 在正文里出现多次不再报错（多个空槽共用一个答案，填一次全亮）；
  编号不必从 1 连续

`CLOZE_SYSTEM_PROMPT` 同步重写：明确「同一个词可以用在多个空，甚至一句里出现两三次，
`the` / `I` 这种词重复是正常的，不要刻意回避」，并写明「多几句少几句完全可以」。

## 三、改动落点

- `electron/main.mjs` — `Menu.setApplicationMenu(null)` + 原因注释
- `electron/window-options.mjs` — `autoHideMenuBar` 注释澄清
- `src/lib/cloze-input.ts` — 新增 `pick` 事件；`digit` 改走 `pick`；文档注释补鼠标流
- `src/components/ClozeView.tsx` — 点候选词走 `pick`（自动跳格）；已填空槽可点（`focusBlank`）；
  已填 + 当前空的光圈；`本组 N 个空` 按实际槽位统计；短文卡加 `overflow-y-auto`（句多可滚动）
- `src/lib/cloze-parse.ts` — 校验口径重写（见上表），删除 `textContainsWord` / `assertNoLeakedCandidates` / `CLOZE_MAX_ANSWERS`
- `src/lib/cloze-provider.ts` — 提示词重写（平铺直叙；删掉「不许泄露候选词」「usedWords 要求」，
  也删掉后续追加的「重复词也可以」「多写少写也行」「编号各一次」等假想纠偏与自检要求；只留真护栏）
- `src/lib/cloze-parse.test.ts` — 按新口径重写（放行用例 + 保留的硬拒用例）
- `src/lib/cloze-input.test.ts` — 新增 `pick` 两个用例（含越界与绕回）
- `src/lib/cloze-provider.test.ts` — 提示词断言更新；「不重试」用例换成真正跑不了的 payload（池外答案）
- `.design/mds.md` — 组句轮交互口径与出题口径改写（新增「鼠标流」条目、空槽四态、句数/空数不再固定）
- `src/lib/use-dictation.ts` / `src/lib/results.ts` — 注释口径同步（去掉「2–3 句 + 2–4 空」的硬性描述）
- `FUTURE.md` — 第 7 条改为「含 I/the 的真实 Key 复核」，新增第 8、9 条（质量温和提示 / 干扰项比例回归提示词）

## 四、验证

1. **单测**：`pnpm test:run` → 57 文件 / 571 用例全绿。
2. **交付检查**：`pnpm check`（Vitest → Web 生产构建 → 生产冒烟 HTTP 200）通过。
3. **Electron 启动与菜单（xvfb 探针）**：
   - 真机启动 `electron .`（xvfb + no-sandbox）日志出现 `server 就绪 (4827)`，菜单改动不影响启动；
   - 探针（`/tmp/mds-menu-probe.cjs`，一次性）：默认应用菜单 + 不自动隐藏 → `isMenuBarVisible = true`；
     `Menu.setApplicationMenu(null)` 后 → `false`，且再显式 `setMenuBarVisibility(true)` 仍为 `false`
     （即没有菜单栏可显示，Alt 也无从唤出）。
   - 说明：Linux/WSL 下无法用 xdotool 真按 Alt；这条留给崔总在 Windows 包上按一下确认。
4. **组句交互端到端（Playwright + 打桩，`.tmp/cloze-ui-check.mjs`，一次性脚本）**：
   打桩 `/api/cloze` 返回「4 句 / 7 空 / 同一个词填 3 个空」的题面、`/api/tts` 返回 500（验证语音失败不阻塞），
   9/9 通过：
   - 7 个空槽全部渲染、卡头`本组 7 个空`、4 句短文齐全（放宽后的题面能跑）
   - 点候选词 → 该空立刻显示所选词、**当前空自动移到下一个空**（`["the","选词","＿＿",…]`）
   - 点已填空槽 → 该空变成当前空（class 里出现 `ring-[3px] ring-brand/30`）
   - 再点另一个候选词 → 覆写该空并继续前进（`["apple","选词","＿＿",…]`）
   - 页面无 JS 报错（除打桩的 500 资源）
   - 截图人工确认：空槽/光圈/候选胶囊/滚动区布局正常，未顶动空槽
5. **真实 AI 回归（基础词池，模型用 `glm-5.2`，崔总指定）**：`MDS_AI_MODEL=glm-5.2 pnpm get:cloze -- …`，两轮均**零校验失败**：
   - 15 词（`I the a is am you he she it we apple book happy run`）→ 5 题 / 10 空 / 7 个不同答案词，3.5s；
     本轮还含 `##1 is a book.` 这种句子——`a` / `is` 都是候选词且没被挖空，**旧校验必拒、新校验放行**。
   - 21 词（再加 `are/they/my/good/big/on`）→ 4 题 / 8 空 / 8 个不同答案词，3.1s；
     全程 `events: []`（无降级、无截断、无失败）。
   - 观察到的问题（记录，不修）：题目里出现 `She is a big apple.`、`The is on the book.` 这类不合语义/
     不合语法的句子，且「每个空恰好一个明确正确答案」并未被遵守（`##1 is a good apple.` 其实 he/she/it 都通）。
     这是「候选池几乎全是功能词 + 要求覆盖 6–16 个词」的自然后果，不是校验或提示词的格式问题；
     要不要把「句子必须自然正确」写得更硬，见 FUTURE 第 13 条。

## 五、后续

- 真实 Key 复核（含 `I` / `the` 的基础词池）→ [FUTURE.md](../FUTURE.md) 第 7 条；
  这次把它升级为「口径变更后更值得跑」。
- 「未挖空候选词出现在句中 / 同词重复过多」若实测题面变差，改走**只记诊断不结束本场** → FUTURE 第 8 条。
- 「干扰项池 > 答案池」现在只剩提示词约束 → FUTURE 第 9 条。
