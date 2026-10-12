# `pnpm get:explain` 完全不可用（TDZ）修复

日期：2026-10-12 ｜ 触发：为词库/SRS/组句方案做调研时需要一条可用的 AI 诊断链路

## 症状

任意真正的诊断命令都直接失败，只有 `--help` 与不带参数能出用法：

```bash
$ pnpm get:explain apple
{
  "error": "ReferenceError",
  "message": "Cannot access 'baseUrl' before initialization",
  "events": []
}
```

## 根因

`scripts/get-explain.mjs` 的结构是「先 dispatch，后声明配置」：

| 行 | 内容 |
| --- | --- |
| 22–57 | 顶层 dispatch：按参数分支直接调用 `runPairs()` / `runGrade()` |
| 59–61 | `const baseUrl / apiKey / model = …` ← **在 dispatch 之后** |

于是任何进入 provider 调用的分支都会读到一个尚未初始化的 `const` → **TDZ ReferenceError**。
`--help`、空参数这些分支在到达 provider 前就 `process.exit` 了，所以静态读代码一切正常——
**只有真正跑一次才会暴露**，这正是它一直没被发现的原因。

## 修法（`scripts/get-explain.mjs`）

1. **配置解析上移到文件顶部**（紧接 `.env` 加载），并加注释写明这个历史坑，防止再被改回去。
2. **dispatch 收进 `async function main()`，文件末尾 `await main()`**：结构固定为「读配置 →（按分支）校验 → 调用 provider」，顺序错误在结构上就不可能发生。
3. 顺手做两处小改进（不改语义）：
   - 用法/缺配置分支改用 `process.exitCode` + `return`，不再 `process.exit()`（管道下 stdout 是异步的，`exit()` 有截断输出的风险）。
   - 抽出 `collectWords()` / `collectGradeItems()` 两个纯函数，参数解析从 dispatch 里分离。
4. 缺配置的提示现在只在**真正要调 AI 的分支**出现（以前是先 fire `runPairs()` 再校验，会把「缺配置」和「provider 报错」两条信息混在一起）。

## 回归测试（`src/lib/explain-cli.test.ts`，3 条）

不 mock 内部函数，而是 **spawn 真实子进程 + 本地 HTTP stub 扮演 OpenAI 兼容端点**：

| 用例 | 断言 |
| --- | --- |
| 正常出释义 | 退出码 0；stdout 的 `definitions` 正好覆盖请求词；`missing` 为空；stderr 不含 `before initialization` |
| 上游 500 | 退出码 1；错误码是 provider 的 `http`，且 `error !== "ReferenceError"` |
| 缺配置 / `--help` | 缺配置提示 `MDS_AI_BASE_URL` 且退出 1；`--help` 退出 0 |

两个关键实现细节：

- 子进程的 `MDS_AI_*` 由测试显式注入。`process.loadEnvFile()` **不覆盖**已存在的环境变量（已实测），所以测试不会读到项目 `.env` 的真实 Key，**也不会发出真实网络请求**。
- 必须用**异步 `spawn`**：`spawnSync` 会阻塞宿主事件循环，而 stub 服务就在同进程里，需要事件循环才能应答 → 第一版用 `spawnSync` 直接死锁（两条用例同时超时）。

## 验证

| 项 | 结果 |
| --- | --- |
| `pnpm test:run` | **40 文件 / 339 用例全过**（含新增 3 条） |
| `pnpm exec tsc --noEmit` | 通过（无输出） |
| 真实 `.env` 跑释义 | `apple`、`give up` 2/2 命中，2569ms，`fallbackUsed: false`，`events: []` |
| 真实 `.env` 跑 `--chinese` | `apple`→苹果、`umbrella`→雨伞，2/2 |
| 真实 `.env` 跑 `--grade-def` | 判定 `correct: true` 并附理由 |
| `--help` | 退出码 0，用法完整 |

## 随本次一并处理的配置变更（崔总要求）

`.env`：`MDS_AI_MODEL=sensenova-6.7-flash-lite` → **`sensenova-6.8-flash-lite`**。
旧值在该服务上不存在（`404 model is not found`），导致释义/中文词模式在手工排查时必然失败。
新值已通过上述三条真实链路验证；走生产 provider（`src/lib/definition-provider.ts`），未另写调用逻辑。

## 后续可考虑（本轮未做）

- `--grade` / `--grade-def` 目前把 `expected` 传空串（沿用原设计，批改只凭作答本身）。若将来要诊断「有标准答案」的批改，需要扩展参数形式（如 `word=标准答案=学生作答`）。
- 脚本自身没有独立于 deploy 的 CI 入口，靠 `src/**/*.test.ts` 里的子进程用例兜底；若以后再加 CLI 脚本，建议沿用这套「spawn + 本地 stub」范式。
