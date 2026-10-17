# 内置 PET 词库（剑桥官方词表 → 随包资源词表）（2026-10-13）

## 一、需求

崔总：**「我要的效果就是 PET 词表作为内置的资源词库，能否从官方取一下扒过来转换成我们的格式」**。

（前置调研见 FUTURE 16：官方 PDF、Qwerty Learner 的 PET json、CEFR-J A1–B1 三条路线对比；
本轮按崔总口径选**官方 PDF**。）

补充需求（同日）：**「词套部分要的，你自己划个范围添加进去，主题表也要的，这些一并入库」** ——
即附录 1（Word sets：数字/序数/星期/月份/季节/国家国籍/大洲）与附录 2（Topic Lists 主题表）
都要进词库；词套里原文只写 `etc.` 的部分由我划定范围补全。

## 二、关键决策

### 1. 数据源＝剑桥官方词表 PDF（而不是扒 Qwerty Learner）

Cambridge《B1 Preliminary / B1 Preliminary for Schools Vocabulary List》**2025-08 版**，53 页 PDF，免费下载：

https://www.cambridgeenglish.org/Images/506887-b1-preliminary-vocabulary-list.pdf

- 字母表正文在第 **4–40** 页（附录 1「词套」在 41 页、附录 2「主题表」42 页起）；本轮只取字母表。
- 不选 Qwerty Learner 的 `pet-vacabulary-list-2024.json`：仓库 GPL-3.0、内容源自剑桥版权表，不适合随包分发。
- 不选 CEFR-J：只能近似（A1–B1 覆盖官方主表 87.1%），而官方 PDF 取的是**权威集合本身**。

### 2. 三个附录的来源划分（谁进词库、谁去补全）

| 部分 | 来源 | 处理 |
| --- | --- | --- |
| 字母表（4–40 页） | PDF 逐条 | 解析入库（2,900+ 词条） |
| 附录 1 里**印出来的**条目（季节、大洲、举例的国家/国籍） | PDF 原文 | `parsePetWordSetsText` 解析入库 |
| 附录 1 里写 `etc.` 的部分（基数词、序数词、星期、月份） | 人工划定范围 | `scripts/data/pet-word-sets.txt`（每行一词，带说明注释） |
| 附录 2 主题表（42–53 页） | PDF 逐条 | 解析入库（1,580 词条，含主题分组里的词组） |

补全范围（写在 `pet-word-sets.txt` 顶部）：基数词 zero–million、序数词 first–thousandth、
星期 7 个、月份 12 个、B1 常见的国家/国籍/语言约 80 条 —— 官方原文给的是「for example … etc.」，
这里是按 B1 常见范围整理的**人工补全**，不代表官方逐字词表。

### 3. 版权口径（必须留痕）

- 词表版权归 **Cambridge University Press & Assessment**；本轮的用法定位是**个人学习**。
- 已落到两处：词库 `note`（含来源 URL + 许可）与 manifest 的 `license` 字段
  （「检查清单更新」弹层里会显示这一行）；`public/banks/pet.json` 随包发布。
- ⚠️ 若将来要对外正式分发/商业化，需要重新评估剑桥的授权（当前随包 = 个人学习用途）。

### 4. 解析口径（`src/lib/pet-wordlist.ts` + `src/lib/pet-pdfxml.ts`，纯函数 + 单测）

**版面**：这份 PDF 是 2–4 栏排版，**栏内还嵌窄栏**（例如第 11 页右半边是两条 50pt 宽的窄栏），
`pdftotext` 直出会串行（`dinner (n) dinosaur`、`milk piece of cake`）。先后试过按坐标切栏、
按括号组重新分条等方案都不稳，最后落到**用 `pdftohtml -xml`**：它把**词头**与**加粗的词性括号**
输出成两个独立带坐标的元素，于是「取非加粗元素 = 词条」就够了，不再需要任何跨元素拼接
（跨栏串词的根源正是拼接）。例句（`•`）按位置过滤：`•` 所在视觉行、右侧 120pt 内的元素全部丢掉，
`•` 单独占一行时再放宽一行。

| 输入形态 | 处理 |
| --- | --- |
| `autumn (n) (Br Eng) (Am Eng: fall)` | 剥掉行尾全部括号组 → `autumn` |
| `all (adj, adv, det & pron)` / `ages (n pl)` / `be (av & v)` | 词性组合随意，一律剥掉 |
| `• be able to`（例句）/ `A`（字母标题）/ `Page 4 of 53` / `© CUPA 2025` | 跳过（不带行尾括号，天然过滤） |
| `blond(e)` / `yog(h)urt` / `gram(me)` / `forward(s)` / `wool(len)` | 可选片段（1–4 个小写字母，非词性）= 两种写法都收 |
| `disco(theque)` / `folder (computer)` | 片段超过 4 个字母＝注记，丢掉（只收 `disco` / `folder`） |
| `a/an` / `centre/center` / `lots / a lot` | 斜杠两段都收 |
| `made of/from/out of` / `step over/in/on/out of` / `step forward/back(wards)/out` | 三段及以上是整句替换，只取第一段 |
| `deal with (sth/sb)` / `focus (sth) on/upon sth/sb` | 去 sb/sth 占位（`focus on/upon` 两段都收，会多带一个真实单词 `upon`） |
| `congratulations!` / `a.m.` | 去首尾标点，但缩写内部的点保留 |
| 去重 / 过滤 | 大小写不敏感去重；必须含字母、≤ 40 字符、≤ 4 个词 |

### 5. 词表中转文件入库，PDF 不入库

- `scripts/data/pet-b1-words.txt`：解析后的词表（带来源注释，**3,306** 行 = 字母表 3,179 + 词套印出 27 + 主题表 1,580，合并去重）**入库**，供构建脚本读取。
- `scripts/data/pet-word-sets.txt`：`etc.` 部分的人工补全（见上表），同样入库。
- `.tmp/banks-src/pet-b1-vocabulary-list-2025-08.pdf`：原始 PDF 落在 `.tmp`（已忽略）。
- `pnpm build:pet-words`（`scripts/fetch-pet-words.mjs`）可随时复现：下载 PDF → `pdftohtml -xml`（字母表/主题表）+ `pdftotext`（词套页）→
  解析 → 写词表文件；解析出的条数 < 1000 直接报错（版式变了要人看一眼）。

### 6. 构建链路：给内置词库加「词表型」数据源

`src/lib/bank-build.ts`：

- `BankSpec` 新增 `words?: ReadonlySet<string>`（匹配依据）、`wordsFiles?: string[]`（构建期来源，可多个）、
  `license?` / `sourceUrl?`（按库覆盖默认的 ECDICT 说明）。
- `specMatchesEntry` 优先按词表命中（`wordKey` 折叠，大小写/空白无关）。
- `parseWordListFile`：每行一个词，忽略空行与 `#` 注释 → 折叠集合。
- `buildBank(spec, entries, now, previous?)`：传上次的同一词库时，**内容没变就沿用旧 createdAt/updatedAt**。
- `WordBank` / `ManifestEntry` 增加 `license`；`parseBankFile` 透传（远程/导入的词库也能带自己的许可）。
- `BUILTIN_BANK_SPECS` 在「高考核心词」之后插入 `pet`（按难度排在大纲词库之间）。

`scripts/build-banks.mjs`：按 `wordsFile` 载入词表（缺文件直接报错，不静默跳过）；读旧词库做幂等时间戳；
统计行增加音标覆盖率。

### 7. 为什么坚持幂等时间戳

九个已有词库都是入库产物，重建时若时间戳全刷新，`git diff` 会变成 13 MB 的「整行重写」，
远端清单也会误判为「有更新」。加了这个判断后，本次重建**只动了 manifest + 新增 pet.json**（实测）。

## 三、结果

```text
pet         3108 词    962.0 KB  英文释义覆盖 91.0%  音标 91.1%
清单已写入 public/banks/manifest.json（10 个词库）
```

- 解析 3,138 条 → 与 ECDICT 交叉命中 3,108 条（差的 30 条是 ECDICT 里没有的词组等）。
- `bank id = pet`，名称「剑桥 PET 核心词」，`bundled: true`（随包，不联网即可用）。
- 词条字段：`word` + ECDICT 的 `definition` / `phonetic` / `frq` / `tags`（缺释义的保留，单词模式仍可用）。

## 四、验证

1. **单测**：`pnpm test:run` → 59 文件 / **600 用例全绿**。新增：
   - `pet-wordlist.test.ts` 12 例（词性/注记/例句/页眉页脚/变体展开/斜杠语义/占位符/去重/过滤）；
   - `bank-build.test.ts`：词表匹配、`parseWordListFile`、PET 许可不被标成 ECDICT、时间戳幂等、PET 词表文件存在且 >1000 词。
2. **交付检查**：`pnpm check`（600 测试 → Web 生产构建 → 生产冒烟）通过。
3. **真实接口核对（dev 服务）**：`/banks/manifest.json` 里 `pet` 条目为
   `{"name":"剑桥 PET 核心词","count":3380,"bundled":true,"license":"Cambridge University Press & Assessment（个人学习用）"}`，
   静态词库 `/banks/pet.json` 返回 200；词库里能查到 `dinner` / `shopping` / `Monday` / `Brazilian` / `swimming pool` / `piece of cake`。
4. **界面实测（Playwright + 真实 dev 服务，早前一轮）**：
   - 「选择词表」弹层里出现「剑桥 PET 核心词 3,108 词 · 下载」；
   - manifest 条目：`{"id":"pet","count":3108,"bundled":true,"license":"Cambridge University Press & Assessment（个人学习用）"}`；
   - 选中后 `/api/bank-detail?bankId=pet` 返回 3,108 词，首词按词频为 `the / be / and / of / a`（高频在前）。
   - 截图：`.tmp/pet-bank.png`。
4. **重建幂等**：`git status` 只显示 `public/banks/manifest.json` 修改 + `public/banks/pet.json` 新增 + `scripts/data/` 新增。

## 五、后续（已登记 FUTURE 16）

- 附录 1（词套）与附录 2（主题表）本已收录；`etc.` 部分的人工范围写在 `pet-word-sets.txt` 顶部，改动只需编辑该文件后重跑构建。
- 备选路线（Qwerty Learner、CEFR-J A1–B1）保留在 FUTURE 16 的说明里，供将来需要「可商用重发」的 B1 词库时参考。
- 词表更新：官方出新版（如 2026-08）时重跑 `pnpm build:pet-words && pnpm build:banks` 即可（页范围写在脚本顶部）。
- 已知取舍：个别被换行拆开的例句（`•` 与正文不在同一视觉行且中间夹着别的元素）可能漏进 1–2 个碎片；
  词表已做「>4 词、以冠词/代词开头的整句」等扫描，当前结果里没有这类残留。
