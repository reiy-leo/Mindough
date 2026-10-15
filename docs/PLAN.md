# Mindough 计划（v1，2026-10-15）

## 一句话
多端任务管理：任务不靠层层分类，而靠“完成后接什么”（FS 依赖）串起来；琐事用流水式列表记。

## 技术方案
- 平台（MVP 全部要可用）：macOS、Windows、iOS、Android、Web。
- 外壳：Tauri 2，一套 React 前端同时打 macOS / Windows（Linux 顺带）、iOS、Android 安装包；Web 端是同一份前端的浏览器构建，部署在 `mindough.rei8t.dev`。
- 前端：TypeScript + React + Vite；UI 为 headless 组件 + 每端原生风格皮肤（见“设计风格”）；浅/深色跟随系统。
- 存储：本地优先、离线可用。原生端 SQLite；Web 端 SQLite WASM（OPFS 持久化）；同步引擎见“同步引擎选型”。两端同一套 schema，前端只写一层数据访问接口，底下按平台换驱动。
- 同步：Cloudflare Worker + D1（结构化数据）+ R2（海报、图标等图片）作服务端（同域 `mindough.rei8t.dev/api`）。登录用 Google OAuth（Rei 的 Worker 默认）；原生端走系统浏览器 + deep link 回调。
- Markdown 编辑：Milkdown 或 TipTap（所见即所得，支持任务清单、代码块），原文以 .md 文本入库。
- 依赖图：React Flow（xyflow）画图 + elkjs 自动分层布局。

### 为什么用 Tauri 2（含移动端）
- Tauri 2 正式支持 iOS / Android，五端一套 React 前端 + Rust 后端；移动端界面跑在系统 WebView（iOS WKWebView、Android System WebView）。
- 适合本项目：列表、依赖图、热力图都是 Web 界面强项；Rust 后端能直接用 Turso。
- 短板与对策：移动端插件生态比桌面小，原生能力（通知、分享、相机选图）用官方插件，没有的写 Swift / Kotlin 小插件；桌面小组件 / iOS 主屏小组件 / 灵动岛计时需要原生扩展，放到以后；后台同步受系统限制，改为回到前台时同步 + 推送唤醒（以后）。
- 退路：`packages/core`（数据模型、DAG、打卡、同步）保持纯 TS，界面层若移动端体验不达标，可换 Expo / React Native（Turso 有 `@tursodatabase/sync-react-native`）只重写外壳。
- 已看过 MyGo（mygo.egoist.dev）：Go 写桌面 app，体积小，但只支持 macOS / Windows / Linux，没有 iOS / Android，不采用。

### 设计风格：每个系统用对应的原生风格（Rei 2026-10-15 提）
可行，做法是“一套结构 + 每端一层皮肤”，而不是五套界面。
- 共用：数据、状态、交互逻辑、页面结构全部一份；组件用无样式的 headless 组件（React Aria Components），自己不带外观。
- 每端一套皮肤（启动时按平台选，设置里可手动切）：
  - Apple（macOS + iOS 共用）：SF 字体、HIG 圆角与间距；macOS 侧边栏 + 工具栏 + 窗口毛玻璃（Tauri window-vibrancy），iOS 大标题、底部标签栏、左滑操作、底部弹层。Liquid Glass 只能用 backdrop-filter 近似。
  - Windows：Windows 11 / Microsoft Store 那种 WinUI 3 风格（Windows 版 Fluent 2）：Segoe UI Variable、Mica / Acrylic 窗口材质、NavigationView 侧栏、圆角卡片、系统强调色。不用 Fluent UI React v9（它是 Office / Teams 网页那套外观）；按微软 Windows UI Kit（Figma）和 WinUI 3 的设计令牌自己写皮肤。
  - Android：Material 3（Roboto、动态取色、底部导航栏、FAB、底部弹层、返回手势）。
  - Web：默认跟随访问者的系统，也可固定一种。
- 移动端可用 Konsta UI（同一组件出 iOS 和 Material 两种外观）加速。
- 原生部分直接用系统：菜单栏、右键菜单、托盘、通知、文件选择走 Tauri 原生 API，不用网页模拟。
- 代价：界面工作量约 1.5 倍，每次改界面要在三种皮肤（Web 跟随访问者系统，复用其一）× 桌面 / 手机下截图检查；导航结构（侧边栏 vs 底部标签栏）按“桌面 / 手机”两种布局写，不按五个平台写。
- 因此本项目不用 Kumo（Kumo 是 Cloudflare 自己的统一风格，与“各端原生”冲突）。

## 前导图（PDM）怎么实现
- 依赖是一张有向无环图（DAG）：表 `dependency(pred_id, succ_id, type, lag)`。
- MVP 只做 FS（完成→开始），一个任务可有多个前置、多个后续；type/lag 字段先留着，以后加 SS/FF/SF 和延迟。
- 加边时做环检测（DFS），出现环直接拒绝并提示。
- 任务状态派生：所有前置都已结束（完成或关闭）→ “可开始”；否则 → “被阻塞”（显示还差哪几个）。
- 任务没有“取消”（Rei 2026-10-15：“任务没有取消之说，只有完成和关闭两种，关闭也完成状态”）。结束态两种：
  - 完成：做成了，算成就（热力图、连续天数、组进度、我的一天“x/y 已完成”）。
  - 关闭：不做了 / 不需要了。同样算已结束：解锁后续并弹“解锁了 N 个后续”、不进待办 / 可做 / 搜索前排、在我的一天沉底；但不算成就（不计入组进度和“已完成”计数，重复任务关闭当天起不再应打卡、历史格子保留）。界面上不划线、整体变淡、带“关闭”标记，勾选框显示 ×。
  - 两种都能“重新打开”（回到待办，清空 done_at）。M0 存过的“取消”在打开时自动迁移为“关闭”（改写一次并进 outbox）。
- 完成一个任务时，弹出它的后续任务，提示“已解锁 N 个”；也可在完成时一键新建后续（“然后呢？”）。
- 有组的起止时间时，可沿依赖链推算最早开始，超出组结束时间就标红（后期做，关键路径同理）。

## 多端同步怎么做
- 每条记录用 UUIDv7 作 id，带 `updated_at`（混合逻辑时钟 HLC）、`device_id`、`deleted` 墓碑，不物理删除。
- 客户端所有写操作先落本地，并进 outbox；联网后批量 push，再按服务端游标 pull 增量。UI 从不等网络。
- 冲突：字段级“后写赢”（LWW，比 HLC）。任务正文 body_md 也按整段 LWW，MVP 不做逐字合并。
- 依赖边合并后两端都重跑环检测；若两台设备各加一条边恰好成环，后到的那条标“冲突”，在界面上提示用户删掉其一。
- 服务端按 user_id 隔离数据；Web 端与原生端共用一个账号。

### 同步引擎选型（待 Rei 定）
Rei 的要求：“确实是 SQLite，但有数据写入时能自动同步给其他设备”。同步已进 MVP，待定的是用哪种引擎。存储层无论选哪种都按下面三条设计，便于接入 Turso Sync 或以后换引擎：主键 UUIDv7、删除用 tombstone（`deleted`）、每行记 `updated_at`。
- A. Turso Sync（推荐）：Turso 是 Rust 重写的 SQLite，兼容 SQLite。本地文件读写、离线可用；基于逻辑 CDC，本地改动按行 `push()` 到 Turso Cloud，其他设备 `pull()` 拿到。Turso 官方建议新项目用 Turso Sync 而不是 libSQL Embedded Replicas。
  - 各端：Tauri 原生端（macOS / Windows / iOS / Android）用 Rust `turso` crate 的 sync 模块；Web 端用 `@tursodatabase/sync-wasm`（OPFS 持久化）。
  - 冲突：默认行级“后推送者赢”（Last-Push-Wins）；可用 transform 钩子改写变更。打卡 check_in 只追加不改，天然不冲突；需要字段级合并的表在钩子里处理。
  - 鉴权：每个用户一个 Turso 数据库；Worker 用 Google 登录后经 Turso Platform API 签发该库的限权 token（Turso 原生 JWKS 只支持 Clerk / Auth0 / WorkOS）。
  - 风险：SDK 还在 0.x，移动端交叉编译需实测；数据在 Turso Cloud（有免费档）；不支持点对点，一切经云端中转。2026 年 Turso 宣布加入 Supabase，留意产品走向。
  - 文档：https://turso.tech/blog/building-local-first-apps-the-complete-guide-to-offline-first-database-sync ，https://docs.turso.tech/features/embedded-replicas/introduction
- B. 自建：Cloudflare Worker + D1，按上面 outbox + HLC 字段级 LWW 自己实现。完全可控、和 Rei 其他项目同栈，但同步逻辑要自己写和测。
- 备选 cr-sqlite：SQLite 的 CRDT 扩展，无中心自动合并；项目活跃度需核实。
- 其他：PowerSync（需要 Postgres 后端）。
- 图片无论选哪种都放 Cloudflare R2。

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
（界面叫法：勾选完成 / 计时 / 计数 / 倒数日，见 docs/COPY.md；内部值 once / timer / count / countdown 不变。）
- 点一下（界面叫「勾选完成」）：点勾即完成（默认）。
- 计时：先点“开始”，过一段时间再点“结束”；可设目标时长（如 16 小时），未到时长卡片显示进度环与已用时间，到点发提醒，结束时满足目标才算完成。中途可暂停 / 继续。
- 计量（界面叫「计数」）：设目标数量和单位（8 杯水、30 页、5 公里），每次点 +1 或输入数量，累计达标即完成。
- 倒数日：设目标日期，卡片大字显示“还有 N 天”，过期后可切成“已过 N 天”（正数日）；到那天自动标完成，或手动完成。
- 重复：每天 / 每周几 / 每月几号 / 每 N 天，每个周期一份独立进度；记录连续天数与历史打卡日历。
- 打卡类任务完成时同样解锁 FS 后续任务。
- 打卡分类（Rei 2026-10-15 定，27 个均已批准）：重复任务可选一个打卡分类。内置顺序固定为：记录、整理、游戏、玩乐、健康、运动、护肤、清洁、学习、读书、饮食、作息、冥想、服药、理财、工作、写作、语言、乐器、创作、社交、宠物、植物、采购、个人护理、维护、观影。
  - 举例：饮食（喝水、做饭）、作息（早睡早起）、服药（补剂）、理财（记账、还款）、工作（周报、复盘）、创作（画画、摄影）、社交（联系家人朋友）、植物（浇水）、采购（补日用品）、个人护理（剪发、剪指甲）、维护（备份、换滤芯、保养）、观影（追剧）。
  - 每个带 lucide 图标与颜色，固定 id（UUIDv7 格式、时间戳 0，第四段 8001，各设备一致）；可改名、隐藏、新增（设置 → 打卡分类），内置的不删只隐藏。
  - 选择器是可搜索的网格（分类多，不用下拉）；“新建打卡”与任务详情里可选。打卡页可按分类筛选（横向标签，只列有任务的分类）和“按分类”分组（空分类不显示）。
  - 种子列表在 `packages/core/src/seed/builtin-checkin-categories.ts`：追加一行即可扩展（id 由编号决定、永不复用；顺序由数组位置决定），老用户打开时自动补上新分类。
  - 与“分类”（挂在组上，名称 + 颜色）是两张表：`checkin_category` 只给重复任务用。
- 同步：每次开始、结束、+1 都记一条 check_in 事件，多端合并时按事件累加，不会因两台设备同时点而丢次数。

## 数据模型
- task：id、body_md（无标题，列表里显示首行作预览）、status（待办 / 进行中 / 完成 / 关闭；完成和关闭都是“已结束”，done_at 记结束时间）、group_id（可空）、scheduled_date（可空，用于列表视图）、done_at、sort、created_at
- dependency：pred_id、succ_id、type=FS、lag=0
- group：id、name、icon（emoji 或 lucide）、start_at、end_at、category_id
- category：id、name、color
- task_type：id、name、icon、color、layout（poster / icon_name / banner / text）、fields（JSON 字段定义）、body_template（markdown）、builtin、hidden
- task 增加 type_id（可空=普通）、type_data（JSON，按字段定义填写，图片存 asset_id）
- group 增加 default_type_id（可空）
- task 增加 completion_mode（once / timer / count / countdown）、target_value、unit、target_date、recurrence（RRULE，可空）
- my_day：task_id、date（本地日期）、sort、added_at（同步时按 task_id+date 合并）
- check_in：id、task_id、period_key（重复任务的周期）、kind（start / pause / resume / stop / add）、amount、at
- task_type 增加 default_completion_mode
- checkin_category：id、name、icon（lucide）、color、builtin、hidden、sort；task 增加 checkin_category_id（可空，重复任务用）
- person：id、name、avatar_asset_id、relation、birthday、note_md
- task_person：task_id、person_id
- asset：id、sha256、mime、width、height、r2_key（同步后）
- 依赖可以跨组。

## 视图（MVP）
0. 我的一天：今天打算做的任务清单，打开 app 的首页。
   - 任何地方都能加入：搜索结果、列表、组、依赖图节点、人物详情、打卡页，右键 / 长按 / 悬停按钮“加入我的一天”，快捷键可一键加。
   - 全局搜索（⌘K / Ctrl+K）：搜正文、类型字段（片名、店名…）、人物、组；结果项直接带“加入我的一天”按钮。
   - 每天零点清空（按本机时区），没做完的不自动顺延，放进“昨天没做完”区一键带回今天。
   - 建议区：今天到期的、今天要打卡的、刚被解锁可开始的任务，点一下加入。
   - 可拖动排序；完成的沉到底部。
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
   - 格子严格正方形（宽高相等，不随容器拉伸），直角或极小圆角。
   - 每月 1 号那一格做标记：格子够大（桌面）时在格内显示月份数字（如“3”），格子小（手机）时显示一个小圆点；设置里可固定选“数字 / 圆点 / 不标”。
- 全局：快速新建（快捷键）、⌘K 搜索（可直接加入我的一天）、按分类筛选。

## 里程碑

### M0 ✅（2026-10-15）：核心逻辑 + Web 客户端 + 外壳骨架
- pnpm workspace：`packages/core`、`apps/client`、`apps/server`（占位）；TypeScript strict。
- `packages/core`（纯 TS、无 DOM，Vitest 90 个用例；客户端另有 4 个平台检测用例）：
  - 全部表的类型（task、dependency、group、category、task_type、person、task_person、my_day、check_in、asset），每行 UUIDv7 id + HLC updated_at + deleted 墓碑。
  - DAG：加边前环检测（拒绝时给出成环路径）、自环 / 重复边拒绝、合并后找冲突边、拓扑排序；派生状态 可开始 / 被阻塞（列出缺哪些前置）；完成后算出解锁的后续。
  - 打卡：进度只由 check_in 事件折叠（计时含暂停 / 继续、计量累加、点一下、倒数日剩余 / 已过）；重复规则（每天、每周几、每月几号、每 N 天）与周期键、连续天数 / 最长。
  - 热力图：一年 53 列 × 7 行（周一开始），4 档（0、<50%、<100%、达标），每月 1 号标记；每日总比例与单任务比例索引。
  - 我的一天：按本地日期的清单、完成沉底、昨天没做完、建议（今天到期 / 倒数日到了 / 今天要打卡 / 刚解锁）。
  - 内置 11 种类型（普通 + 10 种，固定 id）与演示数据；⌘K 搜索（正文、类型字段、人物、组）。
  - 存储：异步 `StorageAdapter` 接口（以后 SQLite / Turso 适配器实现它）+ 内存适配器 + localStorage 适配器；写入同时进 outbox（同步引擎以后从这里 push）。`Store` 持有内存快照，UI 同步读、永不等待存储。
- `apps/client`：Vite + React + React Aria Components；皮肤层 = CSS 变量令牌（Apple / WinUI 3 / Material 3 × 明暗）+ 平台形状；自动按 UA 检测平台（Tauri 端用 os 插件），设置里可手动切；桌面侧边栏 / 手机底部标签栏按宽度切换。
  - 页面：我的一天（首页，拖动排序、昨天没做完、建议）、列表（Agenda，今天居中）、组（卡片 + 组详情：列表 / 按类型版式的卡片 / 组内依赖图）、人物（头像列表 + 详情）、依赖图（xyflow + elkjs 分层布局，拖线连依赖，成环弹提示，颜色区分状态）、可做、打卡（总热力图 + 每任务迷你热力图 + 连续天数 + 今日操作 + 倒数日）、设置。
  - 全局：⌘K / Ctrl+K 搜索并直接“加入我的一天”；N 快速新建（先选类型，预填字段与正文模板）；完成时提示解锁了哪些后续，可一键“然后呢？”新建后续。
  - Markdown：M0 用 textarea + 预览（marked + DOMPurify）。
- `apps/client/src-tauri`：手写 Tauri 2 配置（identifier `dev.rei8t.mindough`，productName Mindough，os 插件），图标已生成；本机无 Rust，未编译。
- `apps/server`：Worker `mindough` 占位（`/api/health`），wrangler.jsonc 已按 custom domain 配好，未部署。

M0 实现时定下的细节（Rei 2026-10-15 已确认）：
- 皮肤映射：macOS / iOS → Apple，Windows → WinUI，Android 与 Linux / 未知 → Material。
- 重复规则以 RRULE 子集字符串入库；每次“应打卡日”开一个周期，持续到下一次应打卡日前一天，周期键 = 该日。创建日之前的周期只在已达标时计入连续天数。
- 计时：有目标时长时，须点“结束”且时长达标才算完成；运行中进度环可到 100%。
- 非重复的打卡任务达标后自动标“完成”并解锁后续；重复任务只记周期进度，不改状态。
- 内置类型用固定 id（UUIDv7 格式、时间戳 0），各设备一致；`updated_at` 最小，用户修改总会胜出。
- 热力图一周从周一开始；无需打卡的日子显示为浅格。
- 列表（Agenda）只放有日期的非重复任务；重复任务在打卡页。
- 从侧边栏 / 快捷键新建（不在组内、未指定日期）的任务自动加入我的一天。

### M1（进行中，2026-10-15）：真存储 + 原生包 + 登录
- ✅ SQLite 存储：`packages/core/src/storage/sql.ts` 的 `SqlAdapter` 实现 `StorageAdapter`，底下换驱动。
  - schema（`storage/schema.ts`）与数据模型一一对应（每字段一列，JSON 列存文本、布尔 0/1），`COLUMNS` 的类型约束保证 types.ts 加字段时必须加列；`schema_version` 表 + 只追加的迁移列表；`outbox`（自增 seq）与 `meta` 表。
  - 写入：一批变更一个事务，`INSERT … ON CONFLICT DO UPDATE … WHERE excluded.updated_at > updated_at`（行级 LWW，相等保留已有），每行进 outbox；失败整批回滚。
  - Web：Turso `@tursodatabase/database-wasm`（OPFS 文件 `mindough.db`）——选它是因为同步走 Turso Sync，以后可换同引擎的 sync-wasm。需要跨源隔离：COOP `same-origin` + COEP `credentialless`（不用 require-corp，外站图片才能显示）；vite dev / preview 与 `public/_headers`（Worker 静态资源）都带上。wasm 约 11.6 MB（gzip 4 MB），按需加载。不支持时（无 OPFS / 未隔离，如 Safari 不支持 credentialless）退回 localStorage；已用过 SQLite 的设备打不开时报错（多半是另一个标签页占着），不悄悄退回以免分叉数据。
  - 首次用上 SQLite 时把 localStorage 的数据原样迁过去（行、device_id、demo_seeded），只迁一次，旧数据留作备份。
  - Tauri 原生：`src-tauri/src/db.rs` 命令层（rusqlite bundled，单连接，`db_exec / db_run / db_all`），schema 与迁移仍在前端 core，与 Web 同一份。没用 tauri-plugin-sql：它是连接池，跨 invoke 的 BEGIN / COMMIT 不可靠。本机 `cargo check` 通过（Linux）。
  - 测试：同一套契约跑 内存 / localStorage / node:sqlite / Turso 引擎（`@tursodatabase/database`，与 wasm 同引擎）。
- ✅ GitHub Actions：`ci.yml`（类型检查、单测、构建）；`build.yml`（手动或推 `v*` 标签）用 tauri-action 打未签名的 macOS universal、Windows（msi / nsis）、Linux（AppImage / deb），另有 Android debug APK（arm64，CI 里 `tauri android init`）；产物传 artifacts，推标签时建 Release 草稿。iOS 待签名方案。
- ✅ Google 登录（Worker 写好未部署）：`/auth/login`、`/auth/callback`、`/auth/logout`、`/api/me`；HMAC 签名会话 cookie（SESSION_SECRET，30 天）；`ALLOWED_EMAILS` 白名单，为空 = 谁都不能登录。失败回跳带 `?login_error=代码`，前端启动时立即用 history.replaceState 去掉并显示可关闭提示，登录成功后不再显示。`POST /api/sync/token` 先返回 501 未实现（M2 签发 Turso token）。客户端设置页有“账户”区；不登录也能完整离线使用。
- 待做：原生端登录（系统浏览器 + deep link 回调）；Worker 部署与 Google OAuth 客户端配置；Markdown 编辑换 Milkdown 或 TipTap（所见即所得）。

### M1b ✅（2026-10-15）：新建与详情重做 + 文案（Rei：“功能都有，但让人厌恶……完成方式在新建时就要让用户选，而且用词很粗糙”）
- 新建和详情拆开。新建面板（TaskComposer）：一个大的无边框内容框（「要做什么？」，自动聚焦，无标签无编辑/预览页签，Markdown 写法只在 ? 悬停提示里）；下面一排属性胶囊（类型 / 日期 / 组 / 和谁有关，点开是弹层，设了显示值）；「怎么算完成」四张卡片（名称 + 一句话例子，默认勾选完成），选中后只出现它自己的一句话设置（每次 [10] [分钟] / 目标 [8] [杯] / 目标日期 [..]，到时显示 还有 N 天）；「多久一次」只做一次 / 定期打卡 → 每天 / 每周[一…日] / 每月 [15] 号 / 每 [3] 天，定期时出打卡分类网格。选了非普通类型才出现该类型的字段，类型可带默认完成方式（用户手动挑过就不改）。没有状态、没有删除；主按钮「添加」（⌘/Ctrl+Enter），取消或 Esc。从侧边栏新建且无组无日期的仍自动进我的一天；建好后提示里可「查看」。“然后呢？”/「新建下一步」打开同一个面板，带“做完「X」之后”，建好自动连上。
- 详情（TaskDetail）：内容在前（排好版的 markdown，点一下就地编辑，Esc 收起）；状态用操作按钮——主操作随完成方式变（完成 / 开始计时·暂停·结束 / +1 杯 / 打卡），「关闭」（重复任务叫「不再打卡」）是安静样式放左边，结束后只剩「重新打开」，顶部徽章显示 已完成 / 已关闭 / 还在等 N 件事 / 进行中；计时、计数、倒数日、定期打卡有一块进度（环 + 数值 + 连续次数）。右侧（手机在内容下方）属性列表：类型、完成方式、重复、打卡分类、日期、组、和谁有关，点值弹出编辑。「前后关系」分「先做完这些」「做完后解锁」，各有「添加」（可搜索）和「新建下一步」。删除放进 ··· 菜单并确认；加入 / 移出我的一天是顶部的太阳图标（菜单里也有）。
- 平台形状：Apple 桌面是无分隔带的 sheet、手机是带拖拽条的底部弹层（新建面板顶栏左取消、右添加）；WinUI 是 ContentDialog（20px 标题、底部按钮带）；Material 桌面是 28dp 圆角对话框，手机是全屏对话框（左上关闭、右上添加）。
- 文案：docs/COPY.md（术语表 + 语气原则），AGENTS 规定界面文案按它写；core 的 COMPLETION_MODE_LABEL / HINT 与 describe.ts（时长、倒数日、口语日期、完成方式摘要、快捷日期）统一说法。
- 依赖：@internationalized/date（React Aria 月历）。

### M2：多端同步
- 定同步引擎（A Turso Sync 推荐 / B 自建 Worker + D1）；从 outbox push、按游标 pull；字段级 / 行级 LWW；check_in 只追加；合并后重跑环检测并标冲突边。
- 图片上传 R2，asset 只存引用。

### 以后
- 自定义类型编辑器（版式、字段、模板、图标、颜色）；类型隐藏 / 排序。
- 提醒通知（计时到点、倒数日）、桌面 / 主屏小组件。
- 按名称自动找图（TMDB / Steam / Open Library）。
- 下面“以后再做”里的 SS/FF/SF、关键路径、甘特图等。

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
- Web 端风格：跟随访问者系统（默认），还是固定一种？
- 同步引擎：A Turso Sync（推荐）还是 B 自建 Worker + D1？
- 类型的海报 / 图标 MVP 只手动上传或贴链接，自动找图以后做，可以吗？
- 谁能登录：只 Rei 自己（`ALLOWED_EMAILS` 白名单，现默认 reiy.leoz@gmail.com），还是开放注册？代码已按白名单可配写好。
- iOS 分发：自用 TestFlight / 开发证书，还是上 App Store？
