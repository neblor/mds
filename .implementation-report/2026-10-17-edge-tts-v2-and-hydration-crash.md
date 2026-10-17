# Edge TTS 全挂 + 重启水合崩溃：根因与修复（2026-10-17）

崔总报告两件事：

1. 「最近一版改完以后 edgetts 音频出不来了，一直卡在生成音频中」
2. 全新安装的机器上，填了 AI 地址与模型（未填密钥）后关掉重启，应用就起不来（截图：`Error | Uncaught Client Exception`）

结论：**两件事互相独立，也都不是「上一版改坏了」**——第 1 件是微软服务端在 2026-10-10 改了鉴权方式，
第 2 件是上一版（词库/SRS 轮）引入的水合缺陷，只是恰好被这次使用路径踩到。

---

## 一、音频卡在「正在生成语音」的根因

### 1.1 微软侧：Sec-MS-GEC 令牌升级到 v2

自 2026-10-10 起，Edge 朗读端点只接受 **v2 令牌**（`<16 位 CS64>-<64 位 SHA-256>`，覆盖「57 字节版权前缀 +
时间片 + 客户端令牌」），并要求 `Sec-MS-GEC-Version` 以 `2-` 开头；Edge 自身已改用
`wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1`（密钥参数名
`Ocp-Apim-Subscription-Key`）。上游 Python 库同样中招（rany2/edge-tts#490）。

本机实测的握手矩阵（`ws` 直连，只看是否 101 升级成功）：

| 端点 | 令牌 | Version | 结果 |
| --- | --- | --- | --- |
| speech.platform.bing.com | v1 | 1-143.0.3650.75 | HTTP 403 |
| speech.platform.bing.com | v1 | 1-155.0.4283.45 | HTTP 403 |
| speech.platform.bing.com | **v2** | 2-143.0.3650.75 | 101 ✓ |
| api.msedgeservices.com + Ocp-Key | **v2** | 2-143.0.3650.75 | 101 ✓ |
| api.msedgeservices.com + Ocp-Key | v1 | 1-155.0.4283.45 | 101 ✓（旧格式暂时仍被新端点接受） |

即：旧端点已强制 v2；新端点两者都收，但必须用 `Ocp-Apim-Subscription-Key`（用 `TrustedClientToken` 会 403）。

### 1.2 库侧：`edge-tts-universal@1.4.0` 既发 v1 令牌，又会把请求挂死

- npm 上的最新版就是 1.4.0（上游没有 v2 修复），发行版把端点与版本串写死在 bundle 里，外部无法覆盖。
- 更致命的是它的 `Communicate._stream()`：`await new Promise(resolve => websocket.on("open", resolve))`，
  而 `error` 事件只把错误塞进消息队列、不 resolve → **握手失败时 Promise 永不 settle**。

两者叠加就成了用户看到的现象：`/api/tts` 既不返回也不报错，前端永远停在「正在生成语音 x/y」。
生产构建实测（修复前）：

| 请求 | 结果 |
| --- | --- |
| `POST /api/tts {"words":["apple"]}`（命中缓存） | 0.35s 返回 `cached:true` |
| `POST /api/tts {"words":["banana"]}`（需合成） | **35s 无响应**（curl exit 124） |

### 1.3 修复：项目内自研 provider（崔总选定方案 A）

新增两个模块，删除 `edge-tts-universal` 依赖：

- `src/lib/edge-tts-token.ts`：v2 令牌（CS64 + SHA256）纯函数实现，逐位移植上游修复 PR #492，
  并用该 PR 的 Python 参考实现在 4 个固定时间戳上逐字节对拍（期望值固化进单测）；附带时钟偏移换算。
- `src/lib/edge-tts-client.ts`：可注入 socket 的客户端。要点：
  - 端点顺序 `api.msedgeservices.com`（主）→ `speech.platform.bing.com`（备），各自带正确的密钥参数名；
  - **连接超时 8s / 回合超时 20s**，加上 AbortSignal，任何失败都必须收敛（不再有「永不 settle」）；
  - **回退策略只覆盖端点级失败**（连不上 / 连接超时 / 握手被拒）：回合内失败（无音频 / 回合超时 /
    提前关闭）换端点没意义，只会让用户多等一个回合，因此直接失败；
  - 403 且响应带 `Date` 时按服务端时间修正时钟偏移并重试同一端点一次（时钟偏差超 ~2.5 分钟会 403）。

`src/routes/api/tts.ts` 改为调用该 provider，契约不变（缓存文件名、mp3 头校验、并发 2、中止语义、
「响应里的每个音频名都必须可读」）。降级与失败按项目规则落诊断日志（Client 模式写外置
`mds-data/logs/ai-definitions.log`）：`tts.endpoint-fallback`（warning）、`tts.synth-failed`（error）。

新增诊断脚本 `pnpm get:tts <word...>`：复用生产 provider 逐词打印端点/是否回退/耗时/字节数/mp3 头/失败原因，
不写业务缓存。

---

## 二、重启后 `Error | Uncaught Client Exception` 的根因

### 2.1 复现与定位

- 触发条件：只要**曾经点过「词表」模式**（localStorage 里 `mds.vocab.v1` 存下 `mode:"bank"`），下次启动必崩。
  与 AI 配置无关——按「只填地址+模型、不填密钥」实测不崩。
- 机理：`src/lib/use-wordbanks.ts` 在 `createSignal` 初值里直接调 `loadVocabPrefs()`：

  - 服务端渲染时没有 localStorage → 渲染「录入」界面；
  - 客户端水合时读到 `mode:"bank"` → 首帧渲染「词表」界面；
  - 两边 DOM 结构不一致 → Solid 水合失败 → 整页 `Error | Uncaught Client Exception`。

- 复现证据：dev 与 production 构建双环境，浏览器里写 `mode:"bank"` 后重载，均出现同一错误页
  （`TypeError: t is not a function at getNextElement/template`），与用户截图一致。

### 2.2 修复

- 初值改为默认值 `{ ...DEFAULT_PREFS }`，**持久化偏好一律在 `onMount` 恢复**（与
  `use-dictation` 里内容模式的既有做法一致）。
- 恢复时若为词表模式，顺带 `refresh()` 补拉词表列表 + 清单 + 今日队列——修掉「重启后词表名空白、
  队列为空」的空壳状态（原来只有用户手动点选才会拉）。
- 新增 `src/lib/use-wordbanks.test.ts` 锁住水合契约：持久化偏好为 bank / 损坏 / 缺失时，首帧都必须是
  `{ mode: "entry", bankId: null }`。
  注：Vitest（node 环境）解析到 solid-js 的 SSR 构建、onMount 不执行，所以「挂载后恢复」这条链路由
  浏览器脚本验证（见 §三）。

### 2.3 顺带修掉的同类缺陷

- `src/lib/use-dictation.ts` 恢复内容模式的白名单漏了 `"cloze"` → 选了「组句」重启后会静默掉回「单词」。
  现在白名单与解析抽到 `src/lib/state.ts`（`CONTENT_MODES` / `isContentMode` / `resolveStoredContentMode`），
  `history-storage.ts` 的历史条目校验也改用同一份，避免再各自维护一份而漏项。

---

## 三、验证（全部实跑）

| 项目 | 结果 |
| --- | --- |
| v2 令牌对拍（Python 参考实现固定向量） | 4/4 逐字节一致（`src/lib/edge-tts-token.test.ts`） |
| TTS 客户端单测（成功/握手拒绝/时钟修正重试/端点回退/连接超时/回合超时/提前关闭/无音频/中止/超长文本/帧解析） | 19/19 通过，连跑 5 次无抖动 |
| 路由测试（并发写入、中止、降级日志、失败 502、坏字节不入缓存） | 5/5 通过 |
| 全量单测 | 63 文件 / 654 用例全绿 |
| `pnpm check`（vitest → 生产构建 → 生产冒烟） | 通过；`ws` 已内联进 `.output/server/_libs/ws.mjs`（打包版不含 node_modules 也能跑） |
| `pnpm exec tsc --noEmit` | 零报错 |
| 生产构建真实合成 | `zebra`+`umbrella` 未缓存 → 1.6s 返回、落盘 11232B；二次请求 31ms 命中缓存；`/api/audio` 读回 200/audio-mpeg、首字节 `fff3`（MPEG 帧同步）；无临时文件残留 |
| 有界失败（端点改指不可达端口） | 11ms 抛错并给出双端点原因摘要（旧库是无限悬挂） |
| `pnpm get:tts apple banana "ice cream"` | 3/3 成功，端点均为 `api.msedgeservices.com`，1.3–1.6s |
| 水合回归 `pnpm web:smoke:hydration` | 通过（导入最小内置词表 → 写 `mode:"bank"` → 重载 → 无异常页，且界面显示「中考核心词」= 恢复 + 补拉都生效）。**反向验证过**：把初值改回 `loadVocabPrefs()` 后该脚本立刻以「二次启动水合失败」退出 1，说明它真的能抓住这个 bug |
| 浏览器端到端（真实用户流程） | 录入 3 个全新词 → 「开始书写默写」→ 2.6s 到达「准备完成 / Let's Go!」，无 pageerror，不再卡在「正在生成语音」 |

## 四、关键决策与权衡

1. **自研 provider 而不是换库**：`@andresaya/edge-tts` 等库虽已换到新端点，但仍在用 v1 令牌（靠新端点的
   宽容策略），且超时/中止行为未知；自研后端点、令牌、超时全在项目内可见可控，也顺手消掉了
   「库在握手失败时挂死」这类不可诊断问题（仓库依赖反而少了一个）。
2. **保留旧端点做回退**：新端点连不上时（网络/地区/再次迁移）自动回退旧端点，两条路都认 v2 令牌。
3. **回合内失败不换端点**：避免失败场景把用户在准备页多拖一二十秒；改为直接给出带原因的错误。
4. **SSR 与水合纪律**：把「持久化状态必须挂载后恢复」写进 `use-wordbanks` 的注释与单测，
   这是本轮事故的通用形态（任何影响首帧结构、又在模块初始化期读 localStorage 的代码都会复现）。
5. **`metadataoptions.wordBoundaryEnabled` 从 true 改为 false**：项目按固定时长推进，不需要逐词边界，
   少收一类元数据帧（客户端对元数据帧一律忽略，不影响既有行为）。

## 五、后续可能要处理的部分

已全部登记到 `FUTURE.md`：§六「Edge TTS / 水合回归遗留（Agent 记录，2026-10-17）」——
端点与令牌再变更时的排查路径、长文本切分、音色列表动态获取、日志文件名与内容不再匹配、
水合回归脚本是否进 `check`、以及「持久化状态初始化」的静态约束。

## 六、排障手册（下次出问题先跑这两条）

```bash
pnpm get:tts apple           # 是否还能合成；403 → 令牌/时钟；超时 → 网络到 api.msedgeservices.com
pnpm web:smoke:hydration     # 二次启动是否还水合正常（需本机有 Chromium/Chrome）
```

若 `get:tts` 报 HTTP 403：先对齐系统时间（令牌按 5 分钟窗口、偏差 >2.5 分钟即失败），
仍失败则说明微软又改了令牌算法，对照 https://github.com/rany2/edge-tts/issues/490 与
`src/lib/edge-tts-token.ts` 的移植注释更新。
