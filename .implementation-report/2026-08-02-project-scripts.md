# Project scripts configuration

## 目标

统一通过 pnpm 提供项目相关的开发、测试、Web 生产运行、Electron 调试与正式打包入口，并把前置条件、输出和使用约束写入 `AGENTS.md`。

## 脚本分组

- 通用兼容入口：`dev`、`build`、`start`、`preview`、`test`。
- Web：`web:dev`、`web:build`、`web:start`、`web:prod`、`web:preview`、`web:smoke`。
- 测试与交付检查：`test:run`、`test:watch`、`check`。
- Electron Client：`client:start`、`client:dev`、`client:package:dir`、`client:package`、`client:verify`。
- 旧命令兼容：`electron:start`、`electron:build`。

正式 portable 入口 `client:package` 的执行顺序为：

1. Vitest 单测；
2. Web/Nitro 生产构建；
3. Web 生产 HTTP 冒烟；
4. electron-builder Windows portable；
5. Electron 包内容校验。

## 辅助脚本

### `scripts/run-vitest.mjs`

- 统一启动 Vitest 单次或 watch 模式。
- 将 `TEMP`、`TMP`、`TMPDIR`固定到已忽略的`.tmp/vitest`。
- 解决 WSL 继承 Windows 临时目录时 Vite/Vitest SSR 临时目录创建失败的问题。

### `scripts/start-web.mjs`

- 校验`.output/server/index.mjs`存在。
- 支持`--host`、`--port`、`--cache-dir`，并设置 Web runtime mode。
- 默认监听`127.0.0.1:3000`。
- 启动后主动轮询首页，确认服务真实就绪；失败时以非零状态退出。
- 当前 Nitro 3 beta 的 node-server listener 不会单独保持 Node 事件循环，因此显式保持生产进程活动。

### `scripts/smoke-web.mjs`

- 自动选择本机随机端口。
- 启动真实 Web 生产入口并轮询 HTTP 200。
- 请求缓存音频路由并确认返回预期 404，同时验证自定义缓存目录被创建。
- 优雅停止子进程，超时后升级为`SIGKILL`，最终清理临时缓存。

### `scripts/verify-electron-package.mjs`

- 校验正式 EXE 存在、体积合理并具有 Windows MZ 文件头。
- 校验包内 Nitro server、静态图标、Electron main/runtime paths 齐全。
- 阻止`node_modules`或运行时`word-cache`混入包内。

## 验证结果

- `pnpm test`：15 个测试文件、163 项测试全部通过。
- `pnpm web:build`：成功生成`.output`。
- `pnpm web:smoke`：HTTP 200、缓存路由与目录检查通过，并正常退出。
- `pnpm check`：测试、构建、生产冒烟完整链路以退出码 0 完成。
- `pnpm client:package:dir`：成功生成`dist/electron/win-unpacked`。
- `pnpm client:verify`：现有 91,344,162 bytes portable EXE 及包内容校验通过。
- 所有新增 Node 脚本通过`node --check`；`git diff --check`通过。

## 文档

`AGENTS.md`已新增完整项目脚本章节，记录：

- 每条命令的用途和前置条件；
- Web 生产参数及环境变量；
- 测试临时目录规则；
- Client 调试包与正式 portable 的区别；
- 正式发布必须使用`client:package`或兼容别名`electron:build`。
