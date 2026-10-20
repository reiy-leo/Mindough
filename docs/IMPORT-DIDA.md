# 从滴答清单导入（dida365 / TickTick）

Rei 2026-10-21：「添加从dida365导入任务的功能，在菜单栏的File/Import/Dida365，点击后弹出一个导入窗口」；追加「不能直接连接dida365么」。

## 入口
- 桌面 app（Tauri）菜单栏：**文件 → 导入 → 滴答清单**（英文界面 File → Import → Dida365）。菜单在 `src-tauri/src/menu.rs` 建，文字由前端按界面语言传过去（`lib/app-menu.ts` → 命令 `set_app_menu`）；点了发事件 `mindough:menu`（payload `import-dida365`）给主窗口。
  - macOS：全局菜单，保留标准的 App（关于 / 服务 / 隐藏 / 退出）、编辑（撤销 / 重做 / 剪切 / 拷贝 / 粘贴 / 全选）、窗口（最小化 / 缩放 / 全屏 / 关闭）菜单，复制粘贴快捷键靠「编辑」菜单。
  - Windows / Linux：只给主窗口加一条「文件」菜单（导入、退出），不加编辑菜单（WebView 自己处理快捷键，免得被抢）；小窗没有菜单。
- 所有端：设置 → 数据「从滴答清单导入…」；⌘K 命令「从滴答清单导入…」（没输入时就在列表里，输入「滴答 / dida / tick / 导入 / import」也出来）。

## 两种方式（导入窗口上面的分段切换）
1. **连接滴答清单**（默认）：滴答清单官方 Open API + **个人 API 令牌**（网页版 头像 → 设置 → 账户 → API Token；文档 <https://developer.dida365.com/docs/openapi.md> “Quick option: create a personal API token”）。
   - 令牌只存在这台设备上（localStorage `mindough:dida-token`，不进同步表、不上传到云端库），连接成功后记住；「忘记令牌」删掉。
   - 浏览器不能跨域直接调 `api.dida365.com`，Web 和 Tauri 都走 Worker 代理 **`/api/dida/*`**（`apps/server/src/dida.ts`）：要登录 Mindough（会话 / 原生 Bearer / 同步凭据）；令牌放在 `x-dida-token` 头里每次带来（Authorization 已用来证明是 Mindough 的谁），Worker 只转发、不存不记；只放行导入用的只读路径：`GET open/v1/project`、`GET open/v1/project/group`、`GET open/v1/project/{id}/data`、`POST open/v1/task/completed`、`POST open/v1/task/filter`、`POST open/v1/preference`，别的 404。上游出错附中文：401 未授权（令牌不对或失效）、403、404、429；其他 → 502 错误网关（带 `upstream_status`）；连不上 502、25 秒没回 504 网关超时。
   - 没登录 Mindough 时窗口里提示先登录（「连接并读取」按钮不可点）。
   - 拉取（core `dida/api.ts` 的 `fetchDidaAccount`，网络函数由调用方注入）：
     1. `GET /open/v1/project`（清单，含 groupId）+ `GET /open/v1/project/group`（文件夹名；拿不到不挡导入，只少了分类）
     2. 收集箱（projectId `inbox`）和每个清单 `GET /open/v1/project/{id}/data` → 未完成的任务。某个清单失败只记一条提示，401 直接停。
     3. 已完成：`POST /open/v1/task/completed {startDate, endDate}`（不传 projectIds = 所有清单，含收集箱）。每次最多 200 条：一个时间窗口拿满 200 就对半切开再拉，直到不满（窗口小于 1 分钟还满就提示可能漏几件）。窗口里「已完成的导入最近多久」：**全部（默认，从 2013-01-01 起）**/ 最近一年 / 最近 30 天 / 不导入已完成的。
     4. 已放弃：`POST /open/v1/task/filter {status: [-1]}`（文档只举了 [0] [2]，-1 是试的；最多 200 件，满了提示更早的没拉到；接口不认就跳过并提示「已放弃的任务没拉下来」）。**没在真实账户上验证过**。
     5. 按任务 id 去重。收集箱任务的 projectId 是 `inbox` + 数字，不在清单列表里 → 清单名记作 `Inbox`（和 CSV 一样）。
   - 拉取时显示进度（读清单 / 第 i / n 个清单 / 已拿到 N 件已完成 / 已放弃），能取消；401 → 「令牌不对或已经失效（401 未授权）…」。
   - 没做 OAuth（要 Rei 在滴答开发者中心注册应用拿 client id / secret），以后可选。
2. **从备份文件导入**：网页版 设置 → 账户与安全 → 生成备份，下载的 `.csv`。选文件或拖进窗口。

两种都解析成同一个中间结构 `DidaRow`（core `dida/parse.ts`），后面的预览 / 映射 / 幂等 / 结果 / 撤销一套流程（`dida/plan.ts`）。

## 备份 CSV 的格式（`dida/csv.ts` + `dida/parse.ts`）
- 开头几行是说明（`Date: …`、`Version: …`、多行的 `Status: 0 Normal / 1 Completed / 2 Archived`），之后才是表头。前 40 条记录里找第一条能认出「标题」+ 至少 4 列（且有清单 / taskId / 状态之一）的当表头。
- 表头按名字和别名认，不靠列序：英文 `Folder Name, List Name, Title, Kind, Tags, Content, Is Check list, Start Date, Due Date, Reminder, Repeat, Priority, Status, Created Time, Completed Time, Order, Timezone, Is All Day, Is Floating, Column Name, Column Order, View Mode, taskId, parentId`；中文导出按「文件夹名称 / 清单名称 / 标题 / 类型 / 标签 / 内容 / 是否为清单 / 开始日期 / 截止日期 / 提醒 / 重复 / 优先级 / 状态 / 创建时间 / 完成时间 / 排序 / 时区 / 是否全天 / 是否浮动 / 任务ID / 父任务ID」等别名（真实中文导出的表头没见过样本，别名是猜的，见下「待确认」）。
- CSV：去 BOM，引号里的逗号、换行、`""` 转义；`\r\n` / `\n` / `\r`。出错提示里的行号算上引号里的换行。
- 没标题也没内容的行跳过（算「读不出来」）；看不懂的状态当未完成并提示。

## 字段映射（两种来源一样）
| 滴答清单 | Mindough | 说明 |
|---|---|---|
| taskId / API `id` | 任务 id = `stableId('dida-task\0' + taskId)` | **幂等**：再导一次同一份，库里已有（没删）的跳过；撤销或删掉后再导会重新建。CSV 和 API 的 id 是同一个，两种方式混着导也不重复。没 taskId 时按 清单 + 标题 + 创建时间 算 |
| Title | 正文第一行 | Mindough 任务没有标题字段 |
| Content（TEXT / NOTE）/ desc（CHECKLIST） | 正文，空一行接在标题后 | markdown 原样 |
| 清单子项（CSV 内容里 `▫` 没勾 / `▪` 勾了；API `items[].status` 0 / 1） | `- [ ] ` / `- [x] ` 待办列表 | API 的 items 按 sortOrder 排 |
| Kind NOTE | 普通任务 | Mindough 没有笔记类型 |
| Status 0 | 待办 | |
| Status 1 / 2（CSV 2 = 归档，API 2 = 完成） | 完成，done_at = Completed Time（没有就用创建时间） | |
| Status -1（放弃） | **关闭**（Mindough 没有「取消」） | done_at 同上 |
| List Name / project | 组：同名（`normalizeName`）复用，没有就新建（id = `stableId('dida-group\0' + 名字)`，图标 📁） | 收集箱（`Inbox` / 收集箱 / 没写清单）默认**不放进组**（进「待安排」）。窗口里每个清单可选：新建组 / 不放进组 / 并入任一已有组（有同名组时不给「新建」） |
| Folder Name / 项目文件夹 | 新建的组的**分类**（同名分类复用，没有就新建，按名字挑颜色） | 不建多层文件夹（MVP 不做）；已有的组不改分类 |
| Start Date / Due Date | 日期（scheduled_date）= 开始那天，没有开始用截止；开始和截止不是同一天时正文末尾加一行「截止：YYYY-MM-DD」 | 按那一行的 **Timezone** 换算（导出里是 UTC `+0000`；全天任务存的是当地零点，换回来正好是那天）；时区没写或写错用本机时区；不带偏移的当作当地时间 |
| Reminder / reminders（`TRIGGER:-PT15M`、`P0DT9H0M0S`） | 提醒 remind_time「HH:MM」 | 只认落在同一天的第一个：全天任务从 0 点算，有时刻的从那个时刻算；前一天的提醒放不进来（Mindough 只能「那天几点」） |
| Repeat / repeatFlag（RRULE） | 只对**未完成**的：每天、每 N 天（DTSTART = 开始日）、每周几（没写 BYDAY 用开始日是周几）、每月几号 → `recurrence`（变成定期打卡，日期清空） | 每 N 周 / 每 N 月 / 每年 / UNTIL / COUNT / BYSETPOS / TT_SKIP（跳过节假日）/ ERULE（自选日期）等 Mindough 没有的，以及已完成 / 已放弃任务上的规则：正文末尾一行「重复（滴答清单的规则，这里没法照样重复）：FREQ=…」 |
| Priority 0 / 1 / 3 / 5 | 正文末尾的标签行 `#低优先级` / `#中优先级` / `#高优先级`（英文界面导入时写 `#low-priority` 等） | Mindough 没有优先级字段 |
| Tags | 正文末尾 `#标签`（空格换成 `_`） | Mindough 没有标签；和优先级同一行 |
| parentId（子任务） | **前后关系**：子任务 → 父任务（父任务详情「先做完这些」里列出子任务） | 选它而不是「相关任务」：子任务做完父任务才算做完，正是 FS；依赖 id 由这一对算出，重导不重复；过环检测。父任务没导入（被选项过滤掉）时提示「父任务没导入，没连上」 |
| Created Time / createdTime | created_at | API 文档里没有 createdTime（有就用），没有就用导入时刻 |
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
1. 选方式：连接（令牌 + 已完成范围）/ 备份文件（选择或拖进 .csv）。
2. 预览：四格「任务 / 未完成 / 已完成 / 已放弃」、「其中 N 条笔记 · N 件子任务 · N 件以前导入过」；**导入哪些**：未完成 / 已完成 / 已放弃三个开关，**默认全开**（Rei 倾向全部导入、可取消）；**清单放进哪个组**：每个清单一行（文件夹、件数、以前导入过几件）+ 下拉；「会新建 N 个组：…」；「N 件以前导入过，这次跳过；N 件按上面的选择不导入」；读不出来 / 不完全一样的折叠列出（CSV 写第几行，连接写任务标题）。
3. 「导入 N 件」→ 一批写入（`applyDida`，一次进 outbox）。
4. 结果：「导入了 N 件任务」+ 三格「成功 / 跳过 / 新建的组」+「跳过的：N 件以前导入过 · N 件已完成的没选 · …」+ 没接上的折叠；底部「撤销这次导入」（`undoDida`：这次写过的每一行回到导入前，新建的任务、组、分类、前后关系打墓碑）/「完成」。

## 测试
- core `test/dida.test.ts`：CSV（引号 / 换行 / BOM）、表头（中英文、不靠列序）、fixture `test/fixtures/dida-backup.csv`（说明头行、中文、引号换行、清单、子任务、各状态、两种时区含夏令时）和 `dida-backup-zh.csv`、时间与提醒、重复、正文、预览、写入 / 再导跳过 / 撤销 / 撤销后再导、选项与组映射、父任务缺失；API fixture `test/fixtures/dida-api.json`：任务 JSON → 行、拉整个账户（收集箱、文件夹、三种状态）、和 CSV 同一套导入、已完成 200 条对半切、最近 N 天 / 不拉、401 直接停 / 别的只提示、取消。
- server `test/dida.test.ts`：白名单、转发（令牌进 Authorization、路径 / 体原样）、要登录、没令牌 / 不在白名单 / 方法不对、上游 401 / 500 / 连不上、CORS 带 `x-dida-token`。

## 待 Rei 确认
1. 子任务用「前后关系（子任务 → 父任务）」表达，父任务在子任务没做完时显示「还不能开始」。要改成「相关任务」吗？
2. 收集箱默认不放进组（进待安排）。
3. 笔记（NOTE）当普通任务导入。
4. 优先级和标签写成正文末尾的 `#标签` 行（Mindough 没有这两个字段）。
5. 只有未完成任务的重复规则转成定期打卡；完成的照抄进正文。
6. 已完成默认「全部」导入（可能很多，要拉一会儿；进度可见、可取消）。
7. 中文版备份 CSV 的表头是按猜的别名认的（手头没有真实中文导出样本）；有一份真实文件最好跑一下。
8. 已放弃（-1）靠 `task/filter status [-1]` 试拉，真实账户没验证；拿不到时只提示，不挡导入。
