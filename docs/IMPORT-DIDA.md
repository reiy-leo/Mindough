# 从滴答清单导入（dida365 / TickTick）

Rei 2026-10-21：「添加从dida365导入任务的功能，在菜单栏的File/Import/Dida365，点击后弹出一个导入窗口」；追加「不能直接连接dida365么」。

## 入口
- 桌面 app（Tauri）菜单栏：**文件 → 导入 → 滴答清单**（英文界面 File → Import → Dida365）。菜单在 `src-tauri/src/menu.rs` 里建，文字由前端按界面语言传过去（`lib/app-menu.ts` → 命令 `set_app_menu`）；点了以后给主窗口发事件 `mindough:menu`（payload `import-dida365`）。
  - macOS：全局菜单，保留标准的 App（关于 / 服务 / 隐藏 / 退出）、编辑（撤销 / 重做 / 剪切 / 拷贝 / 粘贴 / 全选）、窗口（最小化 / 缩放 / 全屏 / 关闭）菜单，复制、粘贴的快捷键要靠「编辑」菜单才生效。
  - Windows / Linux：只给主窗口加一条「文件」菜单（导入、退出），不加编辑菜单（WebView 自己处理快捷键，加了反而会抢走）；小窗没有菜单。
- 所有端：设置 → 数据「从滴答清单导入…」；⌘K 命令「从滴答清单导入…」（什么都不输入时就在列表里，输入「滴答 / dida / tick / 导入 / import」也能搜到）。

## 两种方式（导入窗口上面的分段切换）
1. **连接滴答清单**（默认）：滴答清单官方 Open API + **个人 API 令牌**（网页版 头像 → 设置 → 账户 → API Token；文档 <https://developer.dida365.com/docs/openapi.md> “Quick option: create a personal API token”）。
   - 令牌只存在这台设备上（localStorage `mindough:dida-token`），不进同步表，也不传到云端库。连接成功后记住，点「忘记令牌」就删掉。
   - 浏览器不能跨域直接调 `api.dida365.com`，所以 Web 和 Tauri 都走 Worker 代理 **`/api/dida/*`**（`apps/server/src/dida.ts`）。
     - 要先登录 Mindough（会话 / 原生 Bearer / 同步凭据）。
     - 令牌每次放在 `x-dida-token` 头里带过来（Authorization 已经用来说明你是 Mindough 的哪个用户）。Worker 只转发，不存也不记。
     - 只放行导入要用的只读路径：`GET open/v1/project`、`GET open/v1/project/group`、`GET open/v1/project/{id}/data`、`POST open/v1/task/completed`、`POST open/v1/task/filter`、`POST open/v1/preference`，别的都回 404。
     - 上游出错时附中文说明：401 未授权（令牌不对或失效）、403 禁止访问、404 找不到、429 请求太多；其他都回 502 错误网关（带 `upstream_status`）；连不上回 502，25 秒没回应回 504 网关超时。
   - 没登录 Mindough 时，窗口里提示先登录，「连接并读取」按钮点不了。
   - 拉取用 core `dida/api.ts` 的 `fetchDidaAccount`，网络函数由调用方传进去：
     1. `GET /open/v1/project`（清单，含 groupId）+ `GET /open/v1/project/group`（文件夹名；拿不到也照样导入，只是少了分类）
     2. 收集箱（projectId `inbox`）和每个清单 `GET /open/v1/project/{id}/data` ，拿到未完成的任务。某个清单失败只记一条提示；遇到 401 就直接停。
     3. 已完成：`POST /open/v1/task/completed {startDate, endDate}`（不传 projectIds 就是所有清单，包括收集箱）。每次最多 200 条：某个时间段拿满 200 条，就把它对半切开再拉，直到拿不满为止（切到不到 1 分钟还是满的，就提示可能漏了几件）。时间段由「导入哪段时间的任务」决定（选「全部」就从 2013-01-01 起）；时间写法照文档例子 `2026-03-01T00:58:20.000+0000`。如果接口给回来的完成时间明显在时间段外（说明它没按时间筛），就不再对半切，只拿这一批，提示一句，交给第 6 步在本地筛。
     4. 已放弃：`POST /open/v1/task/filter {status: [-1]}`（文档只举了 [0] [2] 的例子，-1 是试出来的；最多 200 件，满了就提示更早的没拉到；接口不认就跳过，提示「已放弃的任务没拉下来」）。**没在真实账户上验证过**。filter 也有 startDate / endDate，但它筛的是任务的开始日期，不是放弃的时间，所以不传。
     5. 按任务 id 去重。
     6. 按「导入哪段时间的任务」在本地把所有任务再筛一遍（见下面「时间范围」）。收集箱任务的 projectId 是 `inbox` 加一串数字，不在清单列表里，所以清单名记成 `Inbox`（和 CSV 一样）。
   - 拉取时显示进度（读清单 / 第 i / n 个清单 / 已拿到 N 件已完成 / 已放弃），能取消；遇到 401 显示「令牌不对或已经失效（401 未授权）…」。
   - 没做 OAuth（要 Rei 在滴答开发者中心注册应用，拿到 client id / secret），以后可以加。
2. **从备份文件导入**：在滴答清单网页版「设置 → 账户与安全 → 生成备份」，下载 `.csv`，选文件或拖进窗口。

## 时间范围（`dida/range.ts`）
Rei 2026-10-26：「之前导入dad365的问题解决了么，选择30天实际是全部的问题」；又说「现在是可以选30天、半年、全部的，但选择了30天，还是会导入全部」。

- 窗口上方、两种方式共用一个选择器「导入哪段时间的任务」：**全部（默认）**/ 最近半年（180 天）/ 最近 30 天。下面一行说明：「按任务最后修改或完成的时间算。」
- 范围对所有任务生效，连账户和备份文件一样：
  - 未完成：看修改时间，没有就看创建时间。
  - 已完成：看完成时间，没有就看修改时间、创建时间。
  - 已放弃：看修改时间，没有就看完成时间、创建时间。
  - 选「全部」不筛。
- 一个时间都没有的，没法判断，照样导入，提示「N 件没有修改或完成时间，没法按范围筛，照样导入」。
- 备份 CSV 一般没有修改时间这列；有的话（`Modified Time` / `修改时间` / `更新时间` 等）也认。
- 预览里写「另有 N 件不在所选时间范围里，没读进来」；全都筛掉了就说「所选时间范围里没有任务（N 件更早的没读进来）」。
- 以前的问题：范围只传给已完成的接口，未完成和已放弃的全部拉进来；备份文件导入根本没有这个选择器。所以选 30 天看起来还是全部。
- 已完成接口本身有没有按时间筛，没在真实账户上验证过（要令牌）。请求的时间写法和文档例子一致；就算接口不筛，第 6 步也会在本地筛掉。

两种方式都先解析成同一个中间结构 `DidaRow`（core `dida/parse.ts`），之后的预览、映射、去重、结果、撤销都走同一套流程（`dida/plan.ts`）。

## 备份 CSV 的格式（`dida/csv.ts` + `dida/parse.ts`）
- 开头几行是说明（`Date: …`、`Version: …`、多行的 `Status: 0 Normal / 1 Completed / 2 Archived`），后面才是表头。在前 40 条记录里，第一条能认出「标题」和至少 4 列（还要有清单、taskId、状态其中一个）的，就当表头。
- 表头按名字和别名认，不看列的顺序：英文 `Folder Name, List Name, Title, Kind, Tags, Content, Is Check list, Start Date, Due Date, Reminder, Repeat, Priority, Status, Created Time, Completed Time, Order, Timezone, Is All Day, Is Floating, Column Name, Column Order, View Mode, taskId, parentId`；中文导出按「文件夹名称 / 清单名称 / 标题 / 类型 / 标签 / 内容 / 是否为清单 / 开始日期 / 截止日期 / 提醒 / 重复 / 优先级 / 状态 / 创建时间 / 完成时间 / 排序 / 时区 / 是否全天 / 是否浮动 / 任务 ID / 父任务ID」等别名（没见过真实的中文导出，别名是猜的，见下面「待确认」）。
- CSV：去掉 BOM；处理引号里的逗号、换行和 `""` 转义；`\r\n` / `\n` / `\r` 都认。出错提示里的行号把引号里的换行也算上。
- 没标题也没内容的行跳过（算「读不出来」）；看不懂的状态当成未完成，并提示。

## 字段映射（两种来源一样）
| 滴答清单 | Mindough | 说明 |
|---|---|---|
| taskId / API `id` | 任务 id = `stableId('dida-task\0' + taskId)` | **不会重复**：同一份再导一次，库里已有（没删）的跳过；撤销或删掉后再导，会重新建。CSV 和 API 的 id 是同一个，两种方式混着导也不重复。没有 taskId 时，用清单 + 标题 + 创建时间算 |
| Title | 正文第一行 | Mindough 任务没有标题字段 |
| Content（TEXT / NOTE）/ desc（CHECKLIST） | 正文，空一行接在标题后 | markdown 原样 |
| 清单子项（CSV 内容里 `▫` 没勾 / `▪` 勾了；API `items[].status` 0 / 1） | `- [ ] ` / `- [x] ` 待办列表 | API 的 items 按 sortOrder 排 |
| Kind NOTE | 普通任务 | Mindough 没有笔记类型 |
| Status 0 | 待办 | |
| Status 1 / 2（CSV 2 = 归档，API 2 = 完成） | 完成，done_at = Completed Time（没有就用创建时间） | |
| Status -1（放弃） | **关闭**（Mindough 没有「取消」） | done_at 同上 |
| List Name / project | 项目：同名（`normalizeName`）复用，没有就新建（id = `stableId('dida-group\0' + 名字)`，图标 📁） | 收集箱（`Inbox` / 收集箱 / 没写清单）默认**不放进项目**（进「待安排」）。窗口里每个清单可选：新建项目 / 不放进项目 / 并入任一已有项目（有同名项目时不给「新建」） |
| Folder Name / 项目文件夹 | 新建的项目的**分类**（同名分类复用，没有就新建，按名字挑颜色） | 不建多层文件夹（MVP 不做）；已有的项目不改分类 |
| Start Date / Due Date | 日期（scheduled_date）= 开始那天，没有开始用截止；开始和截止不是同一天时正文末尾加一行「截止：YYYY-MM-DD」 | 按那一行的 **Timezone** 换算（导出里是 UTC `+0000`；全天任务存的是当地零点，换回来正好是那天）；时区没写或写错用本机时区；不带偏移的当作当地时间 |
| Reminder / reminders（`TRIGGER:-PT15M`、`P0DT9H0M0S`） | 提醒 remind_time「HH:MM」 | 只认落在同一天的第一个：全天任务从 0 点算，有时刻的从那个时刻算；前一天的提醒放不进来（Mindough 只能「那天几点」） |
| Repeat / repeatFlag（RRULE） | 只对**未完成**的：每天、每 N 天（DTSTART = 开始日）、每周几（没写 BYDAY 用开始日是周几）、每月几号 → `recurrence`（变成定期打卡，日期清空） | 每 N 周 / 每 N 月 / 每年 / UNTIL / COUNT / BYSETPOS / TT_SKIP（跳过节假日）/ ERULE（自选日期）等 Mindough 没有的，以及已完成 / 已放弃任务上的规则：正文末尾一行「重复（滴答清单的规则，这里没法照样重复）：FREQ=…」 |
| Priority 0 / 1 / 3 / 5 | 正文末尾的标签行 `#低优先级` / `#中优先级` / `#高优先级`（英文界面导入时写 `#low-priority` 等） | Mindough 没有优先级字段 |
| Tags | 正文末尾 `#标签`（空格换成 `_`） | Mindough 没有标签；和优先级同一行 |
| parentId（子任务） | **前后关系**：子任务 → 父任务（父任务详情「先做完这些」里列出子任务） | 为什么不用「相关任务」：子任务做完，父任务才算做完，这正是 FS。依赖 id 由这一对任务算出，重导不重复；要过环检测。父任务没导入（选项里没勾）时，提示「父任务没导入，没连上」 |
| Created Time / createdTime | created_at | API 文档里没写 createdTime（返回了就用），没有就用导入的时间 |
| Order / sortOrder | 排序：按清单出现顺序，清单里按 Order 从小到大 | |
| Is Floating、Column Name / Order、View Mode、focusSummaries | 不导 | |

正文示例：

```
准备材料

说明一行

- [x] 已完成的一项
- [ ] 没做的一项

#工作 #中优先级

截止：2026-10-28
```

## 导入窗口流程（`apps/client/src/components/DidaImport.tsx`）
1. 选方式和时间范围：连接（令牌）/ 备份文件（选择或拖进 .csv），时间范围两种方式共用。
2. 预览：四格「任务 / 未完成 / 已完成 / 已放弃」、「其中 N 条笔记 · N 件子任务 · N 件以前导入过」；**导入哪些**：未完成 / 已完成 / 已放弃三个开关，**默认全开**（Rei 倾向全部导入，可以关掉）；**清单放进哪个组**：每个清单一行（文件夹、件数、以前导入过几件）+ 下拉；「会新建 N 个组：…」；「N 件以前导入过，这次跳过；N 件按上面的选择不导入」；读不出来、对不上的收起来列出（CSV 写第几行，连接方式写任务标题）。
3. 点「导入 N 件」，一批写进去（`applyDida`，一次进 outbox）。
4. 结果：「导入了 N 件任务」+ 三格「成功 / 跳过 / 新建的项目」+「跳过的：N 件以前导入过 · N 件已完成的没选 · …」+ 没接上的折叠；底部「撤销这次导入」（`undoDida`：这次写过的每一行回到导入前，新建的任务、项目、分类、前后关系打墓碑）/「完成」。

## 测试
- core `test/dida.test.ts`：CSV（引号 / 换行 / BOM）、表头（中英文、不靠列序）、fixture `test/fixtures/dida-backup.csv`（说明头行、中文、引号换行、清单、子任务、各状态、两种时区含夏令时）和 `dida-backup-zh.csv`、时间与提醒、重复、正文、预览、写入 / 再导跳过 / 撤销 / 撤销后再导、选项与项目映射、父任务缺失、备份文件按范围筛（30 天 / 半年 / 全部、没时间的照样导入、修改时间列）；API fixture `test/fixtures/dida-api.json`：任务 JSON → 行、拉整个账户（收集箱、文件夹、三种状态）、和 CSV 同一套导入、已完成 200 条对半切、最近 N 天（请求体的时间写法）/ 不拉、未完成和已放弃按范围筛、接口不按时间筛时本地兜底、401 直接停 / 别的只提示、取消。
- server `test/dida.test.ts`：白名单、转发（令牌进 Authorization、路径 / 体原样）、要登录、没令牌 / 不在白名单 / 方法不对、上游 401 / 500 / 连不上、CORS 带 `x-dida-token`。

## 待 Rei 确认
1. 子任务用「前后关系（子任务 → 父任务）」表示；子任务没做完时，父任务显示「还不能开始」。要改成「相关任务」吗？
2. 收集箱默认不放进项目（进待安排）。
3. 笔记（NOTE）当普通任务导入。
4. 优先级和标签写成正文末尾的 `#标签` 行（Mindough 没有这两个字段）。
5. 只有未完成任务的重复规则转成定期打卡；已完成的照抄进正文。
6. 时间范围默认「全部」导入（可能很多，要拉一会儿；能看到进度，也能取消）。
7. 中文版备份 CSV 的表头是按猜的别名认的（手头没有真实的中文导出）；最好拿一份真实文件跑一下。
8. 已放弃（-1）是用 `task/filter status [-1]` 试着拉的，没在真实账户上验证；拿不到只提示，不影响导入。
