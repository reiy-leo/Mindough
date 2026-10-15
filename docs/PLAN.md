# Mindough 计划（v1，2026-10-15）

## 一句话
跨平台桌面任务管理：任务不靠层层分类，而靠“完成后接什么”（FS 依赖）串起来；琐事用流水式列表记。

## 技术方案
- 平台（MVP 全部要可用）：macOS、Windows、iOS、Android、Web。
- 外壳：Tauri 2，一套 React 前端同时打 macOS / Windows（Linux 顺带）、iOS、Android 安装包；Web 端是同一份前端的浏览器构建，部署在 `mindough.rei8t.dev`。
- 前端：TypeScript + React + Vite，UI 用 Kumo（与 vector-wallpapers 等一致），lucide 图标，浅/深色。
- 存储：本地优先、离线可用。原生端 SQLite（tauri-plugin-sql）；Web 端 SQLite WASM（OPFS 持久化）。两端同一套 schema，前端只写一层数据访问接口，底下按平台换驱动。
- 同步：Cloudflare Worker + D1 作服务端（同域 `mindough.rei8t.dev/api`）。登录用 Google OAuth（Rei 的 Worker 默认）；原生端走系统浏览器 + deep link 回调。
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

## 数据模型
- task：id、body_md（无标题，列表里显示首行作预览）、status（待办/进行中/完成/取消）、group_id（可空）、scheduled_date（可空，用于列表视图）、done_at、sort、created_at
- dependency：pred_id、succ_id、type=FS、lag=0
- group：id、name、icon（emoji 或 lucide）、start_at、end_at、category_id
- category：id、name、color
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
- 谁能登录：只 Rei 自己（ADMIN_EMAILS 白名单），还是开放注册？
- iOS 分发：自用 TestFlight / 开发证书，还是上 App Store？
