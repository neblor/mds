# Electron 内置服务端口动态挑选（修复"内置服务启动超时"）

> 日期：2026-08-29 · 触发：0.5.0 安装版启动 10 秒后弹「默点啥启动失败 / 内置服务启动超时」

## 根因（与 0.4→0.5 代码变更无关）

1. Windows 的 Hyper-V/WSL NAT 组件会**动态保留端口段**（`netsh interface ipv4 show excludedportrange protocol=tcp` 可见，netstat 不可见，**随重启重新洗牌**）。故障当日保留段 `4788-4887` 正好罩住固定端口 4827，bind 直接 `EACCES`
2. nitro/srvx 的启动代码 `this.serve().catch(() => {})` **静默吞掉 listen 失败**：server import 正常完成、无任何报错、端口永不监听
3. `main.mjs` 轮询 10 秒拿不到 200 → 弹"启动超时"

排查链：读 `mds-error.log`（Windows 侧 userData）确认 0.4 时代 0.3-0.7s 就绪 → interop `start` 启动安装版确认全程无监听端口 → `ELECTRON_RUN_AS_NODE` 跑 server bundle 复现"import 53ms 完成但永不监听" → `node:net` 对照绑定证实 4827 EACCES / 5827 成功 → netsh 排除表落锤。0.4 正常是时间巧合（当时 4827 不在保留段）。

另证：sec-fetch-dest dev 修复不在生产包内（全产物 grep 无痕），与本故障无关。

## 修复

- 新增 `electron/port-picker.mjs`：`acquireServerPort({ host, candidates, net })`
  - 首选 4827（保持稳定习惯值）；候选全部不可绑（EACCES/EADDRINUSE）时绑 `port 0` 由 OS 分配空闲端口（绝不会撞保留段）
  - 探测 server 保持占用直到 `release()`，释放后立即 import nitro 绑定，缩短端口被第三方抢占的窗口
  - `net` 可注入（纯逻辑可单测）
- `electron/main.mjs`：启动前 `acquireServerPort()` → 按实际端口设置 `PORT/NITRO_PORT` → `startServer()` 返回端口供轮询与 `loadURL` 使用；超时错误信息带端口号，日志记录选中端口

## 验证

- 单测 `src/lib/electron-port-picker.test.ts`（5 例）：首选可用直接用（release 前保持占位）、EACCES 回落 OS 分配、EADDRINUSE 跳候选、全败抛可读错误、真实 net 冒烟
- **故障机实测**（4827 仍处于保留段时，`ELECTRON_RUN_AS_NODE` + 安装版 server bundle）：动态选中 12887（回退路径）→ HTTP 200 首页正常
- `pnpm check` 全绿：38 文件 326 例 + 构建 + 冒烟

## 后续

- 已安装的 0.5.0 仍是旧 main.mjs，下次 `client:package`（用户触发 bump）即携带修复；也可先 `client:package test` 验证
- 用户侧建议：重启 Windows 可同时恢复 WSL localhost 转发；管理员执行 `netsh int ipv4 set dynamic tcp start=49152 num=16384` 可把动态分配段固定在高位，减少此类问题（应用侧已免疫，此为系统卫生）
- srvx 静默吞 listen 错误属上游缺陷，升级依赖后可关注是否改善
