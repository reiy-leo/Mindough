# Mindough 计划（v1，2026-10-15）

## 一句话
跨平台桌面任务管理：任务不靠层层分类，而靠“完成后接什么”（FS 依赖）串起来；琐事用流水式列表记。

## 技术方案
- 平台（MVP 全部要可用）：macOS、Windows、iOS、Android、Web。
- 外壳：Tauri 2，一套 React 前端同时打 macOS / Windows（Linux 顺带）、iOS、Android 安装包；Web 端是同一份前端的浏览器构建，部署在 `mindough.rei8t.dev`。
- 前端：TypeScript + React + Vite，UI 用 Kumo（与 vector-wallpapers 等一致），lucide 图标，浅/深色。
- 存储：本地优先、离线可用。原生端 SQLite（tauri-plugin-sql）；Web 端 SQLite WASM（OPFS 持久化）。两端同一套 schema，前端只写一层数据访问接口，底下按平台换驱动。
- 同步：Cloudflare Worker + D1（结构化数据）+ R2（海报、图标等图片）作服务端（同域 `mindough.rei8t.dev/api`）。登录用 Google OAuth（Rei 的 Worker 默认）；原生端走系统浏览器 + deep link 回调。
- Markdown 编辑：Milkdown 或 TipTap（所见即所得，支持任务清单、代码块），原文以 .md 文本入库。
- 依赖图：React Flow（xyflow）画图 + elkjs 自动分层布局。

## 前导图（PDM）怎么实现
- 依赖是一张有向无环图（DAG）：表 `dependency(pred_id, succ_id, type, lag)`。
- MVP 只做 FS（完成→开始），一个任务可有多个前置、多个后续；type/lag 字段先留着，以后加 SS/FF/SF 和延迟。
- 加边时做环检测（DFS），出现环直接拒绝并提示。
- 任务状态派生：所有前置都完成 → “可开始”；否则 → “被阻塞”（显示还差哪几个）。
- 完成一个任务时，弹出它的后续任务，提示“已解锁 N 个”；也可在完成时一键新建后续（“然后呢？”）。
- 有组的起止时间时，可沿依赖链推算最早开始，超出组结束时间就标红（后期做，关键路径同理）。

## 多端同步怎么做
- 每条记录用 UUIDv7 作 id，带 `updated_at`（混合逻辑时钟 HLC）、`device_id`、`deleted` 墓碑，不物理删除。
- 客户端所有写操作先落本地，并进 outbox；联网后批量 push，再按服务端游标 pull 增量。UI 从不等网络。
- 冲突：字段级“后写赢”（LWW，比 HLC）。任务正文 body_md 也按整段 LWW，MVP 不做逐字合并。
- 依赖边合并后两端都重跑环检测；若两台设备各加一条边恰好成环，后到的那条标“冲突”，在界面上提示用户删掉其一。
- 服务端按 user_id 隔离数据；Web 端与原生端共用一个账号。

## 任务类型（显示变体 + 创建模板）
任务可选一个“类型”。类型决定两件事：在列表、组、依赖图节点里怎么显示（显示变体），以及新建时给出什么模板（要填的字段 + 预填的 markdown 正文）。正文仍是 markdown、仍无标题。
- 默认类型“普通”：就是一段没有标题的 markdown 文本，无字段、无模板，显示正文首行，新建即写。
- 内置类型（先做这些，均可修改、复制、隐藏）：

| 类型 | 显示 | 字段 | 正文模板 |
|---|---|---|---|
| 影视 | 竖版海报 + 片名 | 片名、海报、年份、电影/剧集、季集进度、平台 | 想看理由 / 观后感 |
| 游戏 | 方形图标 + 游戏名 | 游戏名、图标、平台、进度（%） | 目标 / 心得 |
| 书籍 | 书封 + 书名 | 书名、封面、作者、页数进度 | 摘录 / 笔记 |
| 项目 | 项目图标 + 项目名 | 项目名、图标、仓库或链接 | 目标 / 下一步清单 |
| 课程 | 图标 + 课程名 | 课程名、平台、链接、课时进度 | 笔记 |
| 旅行 | 横幅照片 + 目的地 | 目的地、照片、出发/返回日期 | 行程 / 待办清单 |
| 购物 | 商品图 + 名称 | 名称、图片、价格、链接 | 备注 |
| 餐厅 | 照片 + 店名 | 店名、照片、地址、链接 | 想吃什么 / 评价 |
| 饮食 | 菜品照片 + 菜名 | 菜名、照片、餐次、食材清单 | 做法 / 感受 |
| 人物 | 头像 + 姓名 | 人物（从人物列表选）、事由 | 要聊什么 / 备注 |

- 人物列表：独立的一张人物表（姓名、头像、关系、生日、备注 md）。“人物”类型的任务显示对方头像 + 姓名；任何任务也可以关联多个人物，在卡片上显示小头像。人物详情页列出与 TA 相关的所有任务。
- 自定义类型：选一种版式（海报 / 图标+名称 / 横幅 / 纯文字），定义字段（文本、数字、进度、日期、链接、图片、单选、人物），写一段正文模板，配名称、图标、颜色。内置类型走同一套机制，不写死特例。
- 新建任务时先选类型（快捷键直接新建普通任务）；组可设“默认类型”，组里新建自动套用。
- 改类型时保留已填字段，新类型没有的字段先隐藏不删。
- 图片：本地上传或粘贴链接；原生端存本地文件，同步时上传到 Cloudflare R2，D1 只存引用。
- 以后再做：按名称自动找图和资料（影视 TMDB、游戏 Steam/IGDB、书籍 Open Library），展示时附来源。

## 完成方式（打卡）
完成方式与类型独立：任何任务都可选一种，类型可以给默认值。
- 点一下：点勾即完成（默认）。
- 计时：先点“开始”，过一段时间再点“结束”；可设目标时长（如 16 小时），未到时长卡片显示进度环与已用时间，到点发提醒，结束时满足目标才算完成。中途可暂停 / 继续。
- 计量：设目标数量和单位（8 杯水、30 页、5 公里），每次点 +1 或输入数量，累计达标即完成。
- 倒数日：设目标日期，卡片大字显示“还有 N 天”，过期后可切成“已过 N 天”（正数日）；到那天自动标完成，或手动完成。
- 重复：每天 / 每周几 / 每月几号 / 每 N 天，每个周期一份独立进度；记录连续天数与历史打卡日历。
- 打卡类任务完成时同样解锁 FS 后续任务。
- 同步：每次开始、结束、+1 都记一条 check_in 事件，多端合并时按事件累加，不会因两台设备同时点而丢次数。

## 数据模型
- task：id、body_md（无标题，列表里显示首行作预览）、status（待办/进行中/完成/取消）、group_id（可空）、scheduled_date（可空，用于列表视图）、done_at、sort、created_at
- dependency：pred_id、succ_id、type=FS、lag=0
- group：id、name、icon（emoji 或 lucide）、start_at、end_at、category_id
- category：id、name、color
- task_type：id、name、icon、color、layout（poster / icon_name / banner / text）、fields（JSON 字段定义）、body_template（markdown）、builtin、hidden
- task 增加 type_id（可空=普通）、type_data（JSON，按字段定义填写，图片存 asset_id）
- group 增加 default_type_id（可空）
- task 增加 completion_mode（once / timer / count / countdown）、target_value、unit、target_date、recurrence（RRULE，可空）
- check_in：id、task_id、period_key（重复任务的周期）、kind（start / pause / resume / stop / add）、amount、at
- task_type 增加 default_completion_mode
- person：id、name、avatar_asset_id、relation、birthday、note_md
- task_person：task_id、person_id
- asset：id、sha256、mime、width、height、r2_key（同步后）
- 依赖可以跨组。

## 视图（MVP）
1. 列表（Agenda 式）：按日期往下流的时间线，今天居中，过去在上、将来在下；琐事随手记，无需建组。
2. 组：组卡片（名称、图标、起止、分类、进度），点开看组内任务列表 + 组内依赖图。
3. 人物：人物列表（头像 + 姓名），点开看相关任务
4. 依赖图：全局或按组看 DAG，拖线连依赖，颜色区分 完成 / 可开始 / 被阻塞。
5. 可做清单：所有“可开始”的任务，按组和日期排。
6. 打卡：今天要打卡的任务、正在计时的任务、倒数日，一屏看完。采用 GitHub contribution graph（活动热力图）样式：
   - 顶部一张总热力图：过去一年，每天一格，颜色深浅 = 当天完成的打卡数占应打卡数的比例；悬停/长按看当天明细。
   - 每个重复打卡任务一行迷你热力图 + 连续天数 + 今日操作按钮（勾 / 开始·结束 / +1）。
   - 计量与计时按达成比例分 4 档深浅（0、<50%、<100%、达标）；颜色跟随任务类型颜色，明暗主题各一套。
   - 窄屏（手机）默认显示最近 16 周，可横向滑动看全年。
- 全局：快速新建（快捷键）、搜索、按分类筛选。

## 以后再做
SS/FF/SF 与 lag、关键路径与日期推算、甘特视图、提醒通知、body_md 逐字合并（CRDT）、导入导出 Markdown 文件夹。

## 明确不做（MVP）
多人协作与共享、多层文件夹式分类。

## 工程默认
- 名字 Mindough（读 /ˈmaɪn.doʊ/，来自“满都”）；仓库 reiy-leo/mindough，分支 main，MIT
- Web 与同步 API：Cloudflare Worker `mindough`，域名 `mindough.rei8t.dev`
- AGENTS.md（+ CLAUDE.md 指向）、.agents/、docs/PRODUCT.md
- GitHub Actions 打 macOS / Windows / Android 包发布到 Releases；iOS 需 Apple 开发者账号签名（待定）
- 每轮完成后 commit + push

## 待确认
- 类型的海报 / 图标 MVP 只手动上传或贴链接，自动找图以后做，可以吗？
- 谁能登录：只 Rei 自己（ADMIN_EMAILS 白名单），还是开放注册？
- iOS 分发：自用 TestFlight / 开发证书，还是上 App Store？
