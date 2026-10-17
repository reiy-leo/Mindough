# Markdown 文件夹：导出 / 导入格式

设置 → 数据 →「导出…」把整个库存成一个 Markdown 文件夹（打成 zip 下载），人能直接读，Obsidian 能直接当 vault 打开。「导入…」认这个格式，也认任何普通的 Markdown 文件夹。

代码：`packages/core/src/archive/`（纯 TS，不依赖 DOM；单独的入口 `@mindough/core/archive`，用到 `yaml` 与 `fflate`，客户端按需加载）；界面 `apps/client/src/lib/archive.ts`、`components/ArchiveImport.tsx`。测试 `packages/core/test/archive.test.ts`。

**id 才是身份。** 文件名、文件夹名只是给人看的：改名、挪位置都不影响再导入；同一个 id 再导一次就是「已有的」。

## 目录

```
Mindough 2026-10-16/              zip 里的根文件夹（导入时自动去掉这一层）
  _meta/
    mindough.json                 格式标记：{ "format": "mindough-markdown", "version": 1, exported_at, device, counts }
    types.json                    任务类型（内置 + 自定义，含归档的；整行，不含 updated_at / deleted；归档写 "archived": true，导入也认旧文件的 "hidden"）
    checkin-categories.json       打卡分类（含隐藏的）
    categories.json               组的分类（名字 + 颜色）
    checkins.json                 打卡记录（每条 start / pause / resume / stop / add 事件，带 id）
    assets.json                   用到的图片的 asset 行；有文件的写 "file": "assets/…"
    prefs.json                    同步的偏好（界面语言等）
  assets/                         图片：<asset id>.<扩展名>，或 img-<16 位哈希>.<扩展名>（正文里直接写的 data: 图、取回来的网上图片）
  library/<库名>/<名字>.md        资料库里的一条（影视库 / 书库 / 好物清单…，库名按导出时的界面语言）
  people/<名字>.md                人物
  journal/<YYYY>/<MM>/<YYYY-MM-DD>.md  日记（Rei 2026-10-17；一天一篇，没写东西的那天不导出）
  <组名>/_group.md                组的属性
  <组名>/<正文首行>.md            组里的任务
  <正文首行>.md                   不在组里的任务
```

- 组只有一层文件夹（不做多层）。组名和 `_meta`、`library`、`people`、`assets`、`journal` 撞了会加「 2」。
- 文件名：取正文第一行（去掉 `#`、`- [ ]` 等标记；正文空着时用资料名，再没有就「空白任务」），去掉 `\ / : * ? " < > | # ^ [ ]` 和控制字符、首尾的空格与点，最长 60 个字；Windows 保留名（CON、NUL…）后面加 `_`。同一个文件夹里重名（不分大小写）加「 2」「 3」。

## 任务文件

```markdown
---
id: 01a144ec-162a-73b6-8990-ac1e0cc0ba7e
status: 待办
created: 2026-09-06T01:00:00.000Z
scheduled: 2026-10-30
group: 01a144ec-1628-731f-9c9d-a37cf8a8660f # 搬家
type: 00000000-0000-7000-8000-000000000001 # 影视
item: 01a144ec-163b-7499-aee9-51f827461d32 # 星际穿越
fields:
  episode:
    season: 1
    episode: 3
completion: count
target: 3
unit: 次
repeat: FREQ=WEEKLY;BYDAY=MO,TH
checkin_category: 00000000-0000-7000-8001-000000000006 # 运动
remind: "08:00"
sort: 6
people:
  - 01a144ec-1629-7000-8000-000000000001 # 王小明
after:
  - 01a144ec-162a-73b4-8c3b-68a0020bcdfb # 打包书和衣服
related:
  - 01a144ec-162a-73b9-9000-000000000002 # 叫车
my_day:
  - 2026-10-16
checkins:
  count: 12
  last: 2026-10-15
---
退押金、交钥匙

![收据](../assets/img-3f2a9c0d11e4b7a8.png)

- [ ] 拍水电表
```

| 键 | 对应 | 说明 |
|---|---|---|
| `id` | task.id | 必有；UUID |
| `status` | status | 内部值：待办 / 进行中 / 完成 / 关闭 |
| `created` / `done` | created_at / done_at | ISO 时间；done 只在结束了才有 |
| `scheduled` | scheduled_date | YYYY-MM-DD |
| `group` | group_id | 组的 id；行尾注释是组名 |
| `type` / `item` | type_id / library_item_id | 类型、挂的资料（id） |
| `fields` | type_data | 只有任务字段（看到哪、读到第几页…）；资料字段在资料文件里。图片字段写 `assets/…` |
| `completion` `target` `unit` `target_date` | 完成方式与目标 | once / timer / count / countdown；计时的 target 是毫秒 |
| `repeat` | recurrence | RRULE 子集（见 recurrence.ts） |
| `checkin_category` | checkin_category_id | |
| `remind` | remind_time | 「HH:MM」，加了引号（有的 YAML 1.1 解析器会把 08:00 当数字） |
| `sort` | sort | |
| `people` | task_person | 人物 id 列表 |
| `after` | dependency（FS） | **先做完这些**：前置任务的 id；后续不用写，从对方文件的 after 推出来 |
| `related` | task_link | 相关任务的 id（两头的文件各写一次） |
| `my_day` | my_day | 放进过「我的一天」的日期 |
| `checkins` | — | 摘要（次数、最近一次），只给人看；完整记录在 `_meta/checkins.json` |

- 值为空的键不写。`# …` 是给人看的名字（组名、片名、对方任务的首行），导入时忽略。
- 正文就是 body_md，front matter 后面紧跟着，原样写（清单、表格、链接都不动）；正文里的图片（`data:` 图、取得到的网上图）存进 `assets/`，链接改成相对这个文件的路径。取不到的网上图片照原链接写。
- 没有「标签」这个概念，不写 `tags`。

## 其他文件

- `_group.md`：`id`、`name`、`icon`、`start`、`end`、`category`（id）、`default_type`（id）；正文是一行 `# 组名`（导入时忽略）。
- `library/…/x.md`：`id`、`type`（id）、`name`、`image`（`assets/…`，或没取到文件时的 asset id / 链接）、`fields`（资料字段：年份、作者、IMDb 编号、价格 `{ amount, currency }`、更多链接 `[{ url, label? }]`…）、`created`；正文是备注。
- `people/x.md`：`id`、`name`、`avatar`、`relation`、`birthday`；正文是备注。
- `journal/2026/10/2026-10-17.md`（日记，方案见 JOURNAL.md）：`id`（由日期算出的固定 id，只用来核对）、`date`（YYYY-MM-DD）、`mood`（心情的英文 id：happy、calm、tired…，没填不写）、`created`；正文是日记内容（图片同任务改成相对路径）。导入按日期认（同一天就是同一篇）：日期不对的「没导入」，id 和日期对不上的按日期导入并提示。规则同任务（新建 / 跳过 / 可选覆盖、整批撤销），预览里数「N 篇日记」。「这一天」汇总是算出来的，不导出。按日期命名的普通 Markdown（Obsidian 每日笔记）当日记导入留到 J2。

## 导入

1. 选一个 zip，或选一个文件夹（网页 `webkitdirectory`）。系统文件（`__MACOSX`、`.DS_Store`、`.obsidian/`、隐藏文件）不看。所有文件都在同一个顶层文件夹里时去掉这一层（zip 的根文件夹、选文件夹时那个文件夹本身不算组）。
2. **有 `_meta/mindough.json` → Mindough 格式。** 按 id 认：库里没有（或删掉了）→ 新建；有、内容一样 → 跳过；有、内容不同 → 默认跳过，打开「已有的用文件覆盖」就改成文件里的样子（连同它的先做完这些、相关任务、人物；我的一天、打卡记录只补不删）。文件里没有 id 的 .md（在 Obsidian 里新写的）当新任务，放进所在文件夹的组。
3. **没有 → 普通 Markdown 文件夹。** 每个 `.md` 一件任务：
   - 最上一层文件夹 → 组（同名的已有组直接用，没有就建；更深的子文件夹并进最上一层）；
   - 文件名就是标题：正文第一行不是它时，在最前面补一行 `# 文件名`；
   - 正文原样，`- [ ]` 清单不拆成多件任务；
   - front matter 认几样常见的：`status`（done / completed / doing / closed / 中文状态…）、`done: true`、`due` / `date` / `scheduled`（YYYY-MM-DD → 日期），其余忽略；
   - id 由「根文件夹名 + 文件路径」算出（确定的 UUID 形状）：同一个文件夹再导一次是「跳过」（改过的可以选覆盖）。
4. 图片：正文里指向文件夹内图片的链接，和 Obsidian 的 `![[x.png]]`（按路径或文件名找），换成图片地址。登录时先传到 R2 用 R2 地址，没登录 / 传不上用 data: 地址（和离线时插图一样）。
5. 预览：新建 N / 更新 N / 跳过 N / 出错 N，「其中 N 件任务 · N 个组 …」，出错列表（文件路径 + 原因）。出错分两种：**没导入**（front matter 写坏了、没有用 `---` 收尾、id 不对、找不到资料的类型、JSON 坏了）和**没接上**（关联的任务 / 人物找不到、重复规则看不懂、前后关系会绕成圈）。畸形的文件不会让整个导入失败。
6. 确认后一次写入（一批，同一次进 outbox，登录时同步到其他设备）。提示里「撤销」整批撤销：新建的打墓碑，覆盖的写回导入前的样子（同样一批进 outbox）。

## 往返

导出再导入到一个空库，数据等价（`archive.test.ts`、`journal.test.ts`）：任务、组、资料、人物、类型、打卡分类、打卡记录、日记、图片按 id 原样回来；前后关系、相关任务、人物关联、我的一天按内容一样（前后关系 / 人物关联 / 我的一天的行 id 是新生成的）。`data:` 图片按内容一样（回来是 base64 写法）。网上的图片导出时取回了内容的，导入后变成本地（或重新上传到 R2 的）地址。
