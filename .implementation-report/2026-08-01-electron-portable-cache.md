# Electron portable packaging and runtime cache adaptation

## 目标

- Windows 端交付无需安装、可直接运行的单个 portable EXE。
- 构建期 `public` 只承载字体、图标等静态资源，不再承载运行时下载。
- 音频和释义缓存通过统一存储边界读写，根据 Web/Client 环境决定具体存储位置。

## 实现结果

### 1. 缓存存储层

- 新增 `src/lib/cache-storage.ts`，提供 `RuntimeCacheStorage`：
  - 音频命中、读取、原子写入、失效；
  - 释义读取、JSON 原子写入；
  - 文件名白名单在存储边界再次校验，避免路径穿越。
- TTS、音频响应、坏缓存失效、释义缓存路由均改为调用该接口，不再直接操作缓存文件。
- 前端音频地址改为 `/api/audio?name=...`，不再依赖 `/word-cache/...` 静态 URL；旧 catch-all 路由已移除。

### 2. 环境分流

| 环境 | 缓存位置 | 说明 |
| --- | --- | --- |
| Web 默认 | `<cwd>/.mds-data/word-cache` | 与 `public` 完全隔离，可用 `MDS_CACHE_DIR` 覆盖 |
| Electron portable | `<portable-exe-dir>/mds-data/word-cache` | 利用 electron-builder 提供的 `PORTABLE_EXECUTABLE_DIR` |
| Client 回退 | `<userData>/mds-data/word-cache` | EXE 所在目录不可写时自动回退 |

Electron 在导入 Nitro 服务前设置 `MDS_RUNTIME_MODE=client` 与绝对 `MDS_CACHE_DIR`。业务缓存模块在 Client 模式缺少路径注入时会直接报错，避免静默退回 Web 目录。

原 `public/word-cache` 中 36 个文件（约 308 KB）已无损迁移到 `.mds-data/word-cache`。生产构建后的 `.output/public` 已检查，不含 `word-cache`。

### 3. Electron 主进程

- portable 目录会先做真实写入探测，不可写才回退 `userData`。
- 内置 Nitro 仅绑定 `127.0.0.1`。
- 增加单实例锁，重复启动时聚焦已有窗口，避免同一应用争抢固定端口。
- 窗口图标直接读取 `.output/public/icons/app.ico`，不再为了图标重复打入源码 `public/icons`。

### 4. 打包内容精简

Nitro 已将运行依赖打进 `.output/server`。此前 electron-builder 仍自动收集根项目生产依赖，向包内加入约 213 MB `node_modules`，其中还包含 Linux 原生 binding。

新增 `scripts/electron-builder-hooks.mjs`，通过 electron-builder `beforeBuild` 约定声明 node_modules 已由项目处理。最终解包应用目录为约 3.8 MB，不含 `node_modules`，portable EXE 从约 108.6 MB 降至约 91.3 MB。

## 验证

- `TMPDIR=/tmp TMP=/tmp TEMP=/tmp pnpm test`
  - 15 个测试文件通过；
  - 163 项测试通过。
- `pnpm build`：成功，`.output/public` 中运行时缓存数量为 0。
- `pnpm electron:build`：明确以退出码 0 完成。
- 正式产物：`dist/electron/mds-0.1.0-x64.exe`
  - 大小：91,344,162 bytes；
  - SHA-256：`d347e876da9b40f8f54568a33a9c22914b3f5522dbafcdc1f911e5b44408bf6d`；
  - 文件识别：Windows GUI / NSIS self-extracting archive。
- Windows 实际启动冒烟：
  - 从独立临时目录直接启动 EXE，无安装步骤；
  - `http://127.0.0.1:4827/` 返回 HTTP 200；
  - EXE 同目录成功生成 `mds-data/word-cache`；
  - 测试进程与临时副本已清理。

## 方案结论

不应把整个 `public` 外置。字体、图标和前端构建资源属于只读静态应用资源，应继续嵌入单文件 portable 包；只有运行时生成/下载的音频和释义缓存需要外置。现在两类资源已在代码、磁盘和打包过滤规则三层完成隔离。

## 已知非阻塞事项

- 当前保持 `asar: false`。electron-builder 会给出建议开启 ASAR 的警告，但 portable 仍是单个可分发 EXE，且 Windows 实际启动已通过。以后若开启 ASAR，需要专门验证从 ASAR 内以文件 URL 动态导入 Nitro 服务的行为。
- 当前 EXE 的 Windows Authenticode 状态为 `NotSigned`。不影响运行，但下载分发时可能触发 SmartScreen“未知发布者”提示；正式公开分发若要消除此提示，需要代码签名证书和对应 CI 密钥配置。

## 参考

- electron-builder portable：<https://www.electron.build/docs/nsis/#portable>
- electron-builder Windows target：<https://www.electron.build/docs/win/>
- Electron `app.getPath`：<https://www.electronjs.org/docs/latest/api/app#appgetpathname>
