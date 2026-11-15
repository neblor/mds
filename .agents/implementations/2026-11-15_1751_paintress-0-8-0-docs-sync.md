# 2026-11-15T17:51+08:00 — 按 paintress 0.8.0 更新全局 skill 与设计稿操作约定

全局 `paintress` 从 0.7.1 升到 0.8.0（npm 最新，2026-11-15 发布）。顺手把两份说明书同步到实际接口。

## 改了什么

1. **`~/.pi/agent/skills/paintress/SKILL.md`**（包内带的正本覆盖手抄副本，旧文件备份在 `/tmp/paintress-SKILL.md.bak-*`）。
   新增两条工作规则：viewer 只在**设计根**注册（不传带 `AGENTS.md`/`package.json`/`.git` 却无设计稿的仓库根，`ok:false` 时读 `next`，不许自作主张 `force`）；收工调 `paintress_clear_changes` 撤掉金色高亮。
   与包内文件 `diff` 结果为 identical。

2. **项目 `AGENTS.md` 的 `.design` 定义**：设计稿改为「新建用 `.ptr`、历史 `.pen` 可读写」，并补上同名 `.md` 在查看器里显示为「笔记」面板的事实。

3. **全局 `~/.pi/agent/AGENTS.md`「设计稿操作」段**（此前该段写在项目文件里，实际位置在全局；上一条回复里我表述成「项目」，特此更正）：
   - 标题下补**版本基线 0.8.0**：MCP 工具带 `paintress_` 前缀，CLI 是简写子命令，`doc_info`→`info`、`screenshot`→`shot`，`marks` 无 CLI 等价体。
   - 工具清单由 11 个补到 23 个（新增 `viewer`/`project`/`new`/`convert`/`clear_changes`/`preset`/`font`/`audit`/`establish`/`adjust`/`component`）。
   - 新增**设计系统**一条：`__preset.ptr`（token / preset 组）与 `__components.ptr`（组件库）由 `viewer`/`project` 自动建；有 token 写引用不贴裸值、组件先查库再画、文字节点要有注册字体、`establish`/`adjust` 默认 dry-run。
   - **删掉过期说法**：`paintress web --daemon`（0.8.0 无此参数，`web` 已幂等立即返回，`--foreground` 才占终端）；端口 `3316`（现为默认 6033，占用则跳 6133/6233，再退 `0.0.0.0` 同三端口，须以返回值为准）；截图「只出整张画布」（现支持 `--board id|name`）。
   - 补 `paintress doctor` / `install` 用于修 MCP 条目。

## 核实过的事实（不是照抄文档）

- `paintress --version` → 0.8.0；`npm ls -g` 同步。
- MCP `connect paintress` 列出 **23** 个工具（原缓存 22）。
- `paintress new <path>` 不带扩展名时产出 `demo.ptr`（flavor `ptr`，version 2.22）。
- `paintress doc_info` → 「未知子命令」；`paintress info <file>` 正常返回 flavor/node 统计。
- `paintress shot <f> out.png --board "C · Word Bank 词库页" --scale 0.2` → ok，输出单板 PNG。
- 「首次写入会重排键序」仍然成立：把 `.design/mds.pen` 拷到 `/tmp` 做一次 no-op `update`，顶层键从 `version,children,variables,fileToken` 变成 `version,fileToken,variables,children`（因此这条注意事项保留）。
- 临时验证目录已清理（`/tmp/pnew`、`/tmp/pt`）。

## 后续

无。MCP 配置是 `command: paintress` + `args: ["mcp"]`（走 PATH），不钉版本，升级后新进程自动用 0.8.0。
