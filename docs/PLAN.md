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

## 显示变体（variant）
任务可选一个“显示变体”，决定它在列表、组、依赖图节点里长什么样。正文仍是 markdown、仍无标题；变体只是附加的展示信息。
- 内置三种：
  - 影视：竖版海报（2:3）+ 片名，可选年份。
  - 项目：项目图标 + 项目名。
  - 游戏：游戏图标（方形）+ 游戏名，可选平台。
- 无变体的任务照旧显示正文首行。
- 自定义变体：用户自己建，选一种版式（海报 / 图标+名称 / 横幅 / 纯文字），再定义要填的字段（名称、文本、链接、日期、图片），可改名、配图标与颜色。内置三种也是用同一机制预置的，可修改或复制。
- 组可设“默认变体”，组里新建任务自动套用。
- 图片：本地上传或粘贴链接；原生端存本地文件，同步时上传到 Cloudflare R2，D1 只存引用。
- 以后再做：按名称自动找图（影视 TMDB、游戏 Steam/IGDB），展示时附来源。

## 数据模型
- task：id、body_md（无标题，列表里显示首行作预览）、status（待办/进行中/完成/取消）、group_id（可空）、scheduled_date（可空，用于列表视图）、done_at、sort、created_at
- dependency：pred_id、succ_id、type=FS、lag=0
- group：id、name、icon（emoji 或 lucide）、start_at、end_at、category_id
- category：id、name、color
- variant：id、name、icon、color、layout（poster / icon_name / banner / text）、fields（JSON 字段定义）、builtin
- task 增加 variant_id（可空）、variant_data（JSON，按字段定义填写，图片存 asset_id）
- group 增加 default_variant_id（可空）
- asset：id、sha256、mime、width、height、r2_key（同步后）
- 依赖可以跨组。

## 视图（MVP）
1. 列表（Agenda 式）：按日期往下流的时间线，今天居中，过去在上、将来在下；琐事随手记，无需建组。
2. 组：组卡片（名称、图标、起止、分类、进度），点开看组内任务列表 + 组内依赖图。
3. 依赖图：全局或按组看 DAG，拖线连依赖，颜色区分 完成 / 可开始 / 被阻塞。
4. 可做清单：所有“可开始”的任务，按组和日期排。
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
- 变体的海报 / 图标 MVP 只手动上传或贴链接，自动找图以后做，可以吗？
- 谁能登录：只 Rei 自己（ADMIN_EMAILS 白名单），还是开放注册？
- iOS 分发：自用 TestFlight / 开发证书，还是上 App Store？
