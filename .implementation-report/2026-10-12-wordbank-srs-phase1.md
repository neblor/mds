# Phase 1 · 词库 + 每日复习（FSRS-6）实施报告

日期：2026-10-12 ｜ 范围：`plans/wordbank-srs-cloze.md` 的 Phase 1（词库功能 + SRS 每日复习）
状态：**完成**（`pnpm check` 全绿；词库/复习接口已在生产构建上端到端验证）

## 一、交付内容

| 模块 | 文件 | 说明 |
| --- | --- | --- |
| 数据模型 | `src/lib/bank-types.ts` | 词库/条目/摘要/清单类型；id 规则；只有 custom 可编辑 |
| 解析归一 | `src/lib/bank-parse.ts` | 归一、去重、限长、坏数据容错；CSV 解析（引号/内嵌换行/转义）；ECDICT 行映射 |
| 构建规则 | `src/lib/bank-build.ts` + `scripts/build-banks.mjs` | ECDICT CSV → 9 个内置词库 + 清单（`pnpm build:banks`） |
| 存储 | `src/lib/data-paths.ts`、`json-file.ts`、`bank-store.ts`、`review-store.ts` | 原子写、索引自愈、日志 append-only、坏数据隔离 |
| SRS | `src/lib/srs.ts` | ts-fsrs 封装：两档评分、学习步 1m/10m、保持率、注入时钟、序列化 |
| 队列 | `src/lib/daily-queue.ts` | 到期优先 + 新词补足；按天粒度；已默词规则；跨日 |
| 编排 | `src/lib/review-service.ts` | `buildQueueForBank` / `commitReviews` / `buildCommitItems`（生产实际调用，直接单测） |
| 路由 | `src/routes/api/{banks,bank-detail,bank-update,bank-import,bank-remove,review-queue,review-commit}.ts` | 只做参数校验与 HTTP 适配 |
| 客户端 API | `src/lib/bank-api.ts` | 词表 CRUD/下载/复制、队列与写回；**不做任意 URL 抓取**（id 白名单 + 固定前缀） |
| 前端状态 | `src/lib/use-wordbanks.ts` | 双模式 + 当前词表 + 今天默几个 + 队列 + 写回 |
| 界面 | `SourceModeSwitch`、`BankSourceCard`、`TodayQueueCard`、`BankPickerDialog`、`NewBankDialog`、`BankDetailScreen`、`HistoryImportDialog` + 重写 `WordBank.tsx` | 对应 pencil 18–23 屏 |
| 接线 | `routes/index.tsx`、`SettingsPanel.tsx`、`ResultsView.tsx`、`use-dictation.ts` | 队列开默写、结算写回、复习反馈、期望保持率、每轮实际耗时 |

内置词库产物（`public/banks/`，随包发布，ECDICT MIT）：core3000 3000 词、zk 1603、gk 3677、cet4 3849、cet6 5407、ky 4801、ielts 5040、toefl 6974、gre 7504，合计 **13 MB**（含中文释义，为 Phase 2 的「中文词」免 AI 调用预留）。构建脚本端到端 28 s（含下载 64 MB CSV），CSV 解析 3.5 s。

## 二、关键决策（含相对 plan 的细化）

1. **队列规则**（崔总定的「不选词」口径落地）：
   - 到期卡按 `due` 升序（逾期最重的在前），超额时只取前 N；
   - 新词按词频升序补足（无词频的保持词表顺序）；
   - **按天粒度**：当天 20:00 到期的卡，早上建队列就算到期（Anki 口径）；
   - **已默词不再排，除非它的卡已真正到点**（学习/重学步内的词当天会回来）——这条是实测出来的必需规则，否则答错的词当天永远不会重练。
2. **评分两档**：对 = Good、错 = Again。不上 Hard/Easy（用户无从判断，错档比少一档更糟）。
3. **`queueKind` 语义 = 进场时它是哪类卡**（new/review/relearn），由服务端判定，不信客户端；重学卡再考时才是 `relearn`。
4. **日志拆成 append-only 的 `.jsonl`**（plan 里写的是 `<bankId>.json`）：符合 FUTURE.md「只增不改」的原始意图，也避免整份日志被重写。
5. **资源词表下载不做任意 URL 抓取**：内置清单是随包静态资源，客户端按 **id 白名单 + 固定前缀** `/banks/<id>.json` 取；「远端清单」留待后续（需服务端路由 + 主机白名单）。
6. **「复制为自建词表」在服务端做**（`bank-import` 的 `copyOf`）：避免把 7,000 词搬到浏览器再搬回来。
7. **删词表连带清复习数据**（卡片 + 日志），避免孤儿文件；每日汇总保留（它跨词表）。
8. **`doneWordsToday` 从卡片的 `last_review` 推导**（而不是另存一份计数）：刷新/重进页面后进度自愈。
9. **每轮实际耗时**已接入（`use-dictation` 的 `roundElapsed`）→ 写进日志的 `elapsedMs`，供 FUTURE 的统计图使用。
10. 设置面板把「倍率 / 倒计时数字 / 期望保持率」**合并成一张参数卡**：三张独立卡时面板总高 919 > 820 窗口高度，合并后 779。

## 三、数据落盘布局

```text
mds-data/banks/<bankId>.json        词库（含词条）
mds-data/banks/index.json           索引（缺失/不一致时按磁盘重建）
mds-data/review/<bankId>.cards.json 卡片状态（ts-fsrs 快照，Date → ISO）
mds-data/review/<bankId>.log.jsonl  复习日志（append-only，坏行只丢一行）
mds-data/review/daily.json          每日汇总（target/done/correct/total/elapsedMs）
mds-data/word-cache/…               音频与释义缓存（原有）
```
目录优先级：`MDS_DATA_DIR` > `dirname(MDS_CACHE_DIR)` > `<cwd>/.mds-data`；Electron 下即 `userData/mds-data`（卸载保留）。

## 四、验证证据

| 项 | 结果 |
| --- | --- |
| `pnpm test:run` | **49 文件 / 455 用例全过**（新增 ~100 条：解析/CSV/存储/索引自愈/SRS 轨迹/队列边界/编排/写回映射） |
| `pnpm check` | 全绿（vitest → 生产构建 → 生产冒烟） |
| 生产构建端到端（独立数据目录，真实 HTTP） | 新建词表 ✓、详情 ✓、分页+搜索 ✓、加词去重 ✓、今日队列 ✓、写回（Good/Again）✓、队列重算（done=2、已默词不再排）✓、内置词库导入 ✓、复制为自建 ✓、删除连带清复习数据 ✓ |

端到端过程中抓到并修掉一个真 bug：`getParam()` 读的是**路由参数**（`event.params`），两个 GET 接口（`bank-detail`、`review-queue`）因此拿到空 `bankId` → 404。已新增语义明确的 `getQuery()`（读 `searchParams`）并替换，同时补了单测。

## 五、已知问题与遗留

1. **`src/lib/icons.tsx` 的 35 条 TS2307**（`lucide-solid/dist/source/icons/*.jsx` 深路径）：**HEAD 就有**（实测 HEAD 版本 20 条，我的新增图标再加 15 条）。原因是 lucide-solid 的 `exports` 只暴露 `./icons/*`，而项目用 `dist/source/icons/*.jsx` 深路径 + Vite alias（为 dev 体积优化）；`tsc` 无法解析该深路径（ambient wildcard 声明未生效）。**不影响 `pnpm check`**（构建走 alias 正常）。建议后续二选一：改用包的 `./icons/*` 导出子路径，或在 `icons.d.ts` 里逐个显式声明。
2. **`src/routes/api/definitions.test.ts` 的既有类型错**（联合类型未收窄）：HEAD 就有，与本次改动无关。
3. **远端清单（自定义 URL 抓取）未做**：需要服务端路由 + 主机白名单，属 Phase 2 之后。
4. **Phase 2 · 范例组句未做**（独立模式、一次批量出题、失败即结束）——按计划留到下一步。
5. 词库模式目前只支持「今天默几个」一个旋钮；按词表分场、每场 24 词上限要等 Phase 2（组句的候选池）一起定。

## 六、给未来的接口

- `FUTURE.md` 要求的字段**已全部落盘**（`elapsedMs / queueKind / stateBefore / intervalBeforeDays / intervalAfterDays / stabilityAfter / difficultyAfter` + `DailyStat`），统计图与积分进度可以直接在这些原始数据上做，不需要回填。
- 重跑内置词库：`pnpm build:banks`（幂等；`--csv` 可指定本地 ECDICT CSV）。
