# FUTURE A/B 组清理（工具链收尾）

> 日期：2026-11-15
> 背景：1.0.0 已公开发布（https://github.com/neblor/mds/releases/tag/v1.0.0），崔总要求「A 组（零风险收尾）实做、B 组（验收类）按已过验收直接关闭」。

## 1. A 组：已实做

| FUTURE 条目 | 改动 | 证据 |
| --- | --- | --- |
| §五.6 `tsc --noEmit` 纳入 `pnpm check` | `package.json` 新增 `typecheck` 脚本并接进 `check`；`typescript` 提为显式 devDependency（`^6.0.3`）；`tsconfig.json` 加 `exclude`（`dist`/`.output`/`release-out`/`.tmp`/`.mds-data`） | `pnpm check` 全链 exit 0，`tsc --noEmit` 约 10s |
| §五.15 `module.register()` → `registerHooks()` | `scripts/ts-resolve-hook.mjs` 改为同步 `resolve` + 导出 `registerTsResolve()`；**11 个** `scripts/*.mjs` 切换调用 | `pnpm db:status`、`get:tts --help`、`get:phonetics` 实测正常；`DEP0205` 警告消失 |
| §六.3 日志文件名与内容对齐 | `mds-data/logs/ai-definitions.log` → `runtime.log`；旧文件（含 `.1`）首次写入时自动迁移；滚动与脱敏行为不变 | 新增迁移单测；AGENTS/README（中英）/`plans/phonetic-mode.md` 同步 |
| §十三.8 归档写入原子化 | `buildAndArchive` 改为写 `release-out/.staging-<tag>-<pid>/` → 全量校验 → `rename` 成正式目录；失败/强杀清暂存；构建前清理同标签残留；`refreshNotes` 改为临时文件 + `rename` | 隔离发布夹具 8 组场景全绿（含 `--skip-build` 归档路径） |
| §十三.7 首次真发端到端核对 | 核对 tag/Release/资产摘要/链接；装机侧由崔总确认 | 见 §3 |
| package-client 收尾文案 | 显式同版本正式打包不再打印「测试打包完成」，改为「打包完成，版本保持 x.y.z」 | 本轮 `pnpm release 1.0.0 --no-publish` 构建时发现 |

### 关键取舍

- **`typescript` 必须显式声明**：此前 `pnpm exec tsc` 能用是因为解析到了 `/home/andares/.bun/bin/tsc`（全局），干净机器/CI 上并不存在。改为 `node_modules/.bin/tsc` 后行为可复现。
- **`exclude` 只影响类型检查**：不加的话 tsc 会去解析 `.output`/`dist` 里的产物，既慢又可能被生成代码污染；Vite/Nitro 构建不受影响。
- **`registerHooks` 是同步 API**：钩子必须同步返回解析结果，`nextResolve` 不再 `await`；调用点必须在 `await import(...)` 之前，语义与原先一致。
- **日志改名保留历史**：不删旧文件，而是首次写入时 `rename` 过去（含 `.1`），崔总继续按旧路径找也能找到。

## 2. B 组：按验收关闭（不再跟踪）

崔总确认：日常使用（含儿子在 Windows 上安装 1.0 后实际使用）已覆盖这些验收项。FUTURE 中逐条标注关闭理由，未删除内容：

- §六.6 TTS 新端点 Windows 可达性
- §五.11 Windows 上 Alt 不唤出菜单
- §十.6 Electron 全屏音标窗平台验证
- §十.2 音素音频音质 / 备选音源
- §十.3 AI 音标 20 词抽检
- §七.1 短句长度分布观测
- §七.8 短句计时基础公式标定
- §九.7 书写场次是否计入进度（维持现状）
- §九.8 中途退出是否记账（维持现状）
- §九.10 「今日总量」概念（不引入）
- §九.11 复习积压挤掉新词（维持 SRS 到期优先）

> 口径：关闭 ≠ 认为这些事「不该做」，而是「当前不需要专门验证/改动」；日后遇到具体现象可按条目描述重开。

## 3. 验证

- `pnpm test:run`：86 文件 / **934 用例**全绿（新增日志迁移用例）。
- `pnpm check`：Vitest → `tsc --noEmit` → 生产构建 → HTTP 冒烟，**exit 0**。
- 隔离发布夹具（`.tmp/release-review/integration.mjs`）：8 组场景全绿，覆盖原子归档改动。
- `pnpm db:status` / `get:tts --help` / `get:phonetics`：钩子迁移后正常运行，无 `DEP0205`。

## 4. 仍开放的（未在本轮处理）

- D 组技术债：设计稿 4 项（`.pen`）、图标别名根因、水合冒烟进 check、兼容模式移除、软链体检、wine 前缀 prune、`.tmp/wine32` 外移、发布编排集成测试固化。
- C 组小功能：短句逐词 diff（建议下一个做）、组句「下一场」、混合结果按词分组等。
- E 组大工程：语法专练、自动更新、代码签名、CI。
