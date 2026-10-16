# Mindough 计划（v1，2026-10-15）

## 一句话
多端任务管理：任务不靠层层分类，而靠“完成后接什么”（FS 依赖）串起来；琐事用流水式列表记。

## 技术方案
- 平台（MVP 全部要可用）：macOS、Windows、iOS、Android、Web。
- 外壳：Tauri 2，一套 React 前端同时打 macOS / Windows（Linux 顺带）、iOS、Android 安装包；Web 端是同一份前端的浏览器构建，部署在 `mindough.rei8t.dev`。
- 前端：TypeScript + React + Vite；UI 为 headless 组件 + 每端原生风格皮肤（见“设计风格”）；浅/深色跟随系统。
- 存储：本地优先、离线可用。原生端 SQLite；Web 端 SQLite WASM（OPFS 持久化）。两端同一套 schema，前端只写一层数据访问接口，底下按平台换驱动。
- 同步（M2 ✅）：云端数据存在 Turso Cloud（数据库 `mindough`，org rei8，东京 aws-ap-northeast-1）；客户端只和 Worker（同域 `mindough.rei8t.dev/api/sync`）说话，Worker 经 Hrana HTTP 读写 Turso；图片放 R2（`mindough-assets`）。登录用 Google OAuth；原生端走系统浏览器 + deep link 回调。见“多端同步怎么做”。
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
- 相关任务（Rei 2026-10-15：“任务只是有关系，但没有FS关系”）：表 `task_link(a_task_id, b_task_id, note, created_at)`，无方向、不阻塞——不解锁、不进环检测、不影响可开始 / 被阻塞。去重：规范顺序 a < b，id 由这一对算出（`related.ts` 的 `taskLinkId`，UUID 形状），两台设备各自连同一对得到同一行；去掉再连上 = 同一行墓碑翻回来。不能连自己；两件已有前后关系时不让再连相关（前后关系已经说明有关系），先相关后加了前后关系时只按前后关系显示（相关行不删，去掉前后关系后又出现）。删任务时它的相关行一起打墓碑。note 先留着，界面暂不编辑。
- 有组的起止时间时，可沿依赖链推算最早开始，超出组结束时间就标红（后期做，关键路径同理）。

## 多端同步怎么做（M2 ✅ 2026-10-15）
Rei 的要求：“确实是 SQLite，但有数据写入时能自动同步给其他设备”。现在的样子：每台设备都是完整的本地 SQLite（Web 是 OPFS 里的 Turso wasm，退回 localStorage 时也一样能同步；原生端是 rusqlite），写入先落本地；登录后后台自动推拉，云端是 Turso Cloud 里的一个库。

- 每条记录 UUIDv7 id、`updated_at`（HLC：`13 位毫秒-4 位计数-设备 id`，字典序即全序）、`deleted` 墓碑，不物理删除。
- 推：本机写入进 outbox；写入后防抖 1.5 秒推送（同一行多次改动只推当前值），成功才 ack。
- 拉：云端每采纳一行就给它一个新的 seq（每个用户各自递增），客户端记住拉到的最大 seq（游标），只拉更大的，每页 500 行。拉下来的行经 `Store.applyRemote` 合并，落盘但不进 outbox（不会回推）。
- 冲突：**行级 LWW**，比 `updated_at`；HLC 末尾是设备 id，同毫秒同计数时按设备 id 定先后，各端结果一致。云端用同样的规则（`ON CONFLICT … WHERE excluded.updated_at > updated_at`），所以晚推上来的旧改动不会覆盖新的。墓碑也只是一次写入，按同样规则比：删除晚于编辑就删，编辑晚于删除就留（行级，不是“删除永远赢”）。任务正文 body_md 整段 LWW，MVP 不做逐字合并。
- 打卡 check_in 只追加（每次一行新 id），两台设备离线各打一次卡，合并后进度是两次之和。
- 前后关系：`Store.edges()` 把依赖行按 updated_at 依次加入、同一对只算一条；加入后会成环的那条（后到的）进 `Store.conflictEdges()`，不生效（不阻塞、不进排布）。详情的「关系」顶上提示「先后关系绕成了圈」+「去掉这条」。两台设备连了同一对 → 两行算一条，去掉时一起去掉。
- 第一次在一台设备上登录（bootstrap）：先把云端全部拉下来；云端已有数据、而这台设备只有没动过的演示数据时，演示数据打墓碑不带上去（判断：`demo_stamp` 之后没有写入；M2 前播的演示数据用“全部在 10 秒内写入”判断）；再按 LWW 合并云端，把本机比云端新的行全部推上去——本机数据不丢。之后只做增量。
- 什么时候同步：登录后立刻、本机写入后（防抖）、窗口获得焦点 / 回到前台、联网、前台每 60 秒。全部在后台，界面永不等待；离线时照常用，联网后自动补上。
- 退出登录：只停同步，本机数据原样保留。登录同步时不能「重置演示数据」（会影响其他设备）；退出后重置会清掉同步游标，下次登录重新合并，云端数据会回来。
- 状态（设置 → 账户）：已同步 · 刚刚 / 正在同步… / 离线，联网后自动同步 / 同步出错（带 HTTP 状态码中文说明）+ 重试；凭据被拒（401 未登录 / 403 无权限）时按钮变「重新登录」。另有「立即同步」。
- 服务端按 user_id（登录邮箱，小写）隔离数据；Web 端与原生端共用一个账号。

### 同步引擎选型（Rei 2026-10-15 定 A：Turso Sync；实现时的取舍）
Rei 选了 A（Turso）。落地时用的是 **Turso Cloud 当云端存储 + 自己的 outbox / 游标协议（经 Worker）**，没有直接用 Turso Sync 的客户端 SDK（`@tursodatabase/sync-wasm` / Rust `turso` crate 的 sync）。2026-10-15 实测与原因：
- SDK 本身能用：`@tursodatabase/sync@0.8.3` 在 node 里对 Turso Cloud push / pull 成功。但它是**“最后推送者赢”**：实测设备 B 用更旧的 `updated_at` 改同一行后推送，A 拉下来是 B 的旧值——和我们要的“按 updated_at 行级 LWW”相反（可以用 `transform` 钩子改写成带条件的 upsert，但下面几条更难绕）。
- 它同步的是**整个数据库文件**（物理页 + 本地改动回放）：本机专用的 `meta`（device_id、游标）、`outbox` 会被云端版本盖掉；建表 / `ALTER TABLE` 也会同步，离线设备回放同一条 `ADD COLUMN` 会失败、把拉取卡死，以后加迁移很危险。
- Safari / iOS / macOS 的 WKWebView 没有 `COEP: credentialless`，跑不了 wasm 引擎（Web 端在 Safari 上本来就退回 localStorage），Apple 端只能换 Rust `turso` crate 重写原生存储层并实测移动端交叉编译。我们的协议是纯 TS，localStorage、rusqlite、OPFS 三种存储都能同步，Rust 侧不用动。
- 鉴权：Turso Sync 要把数据库 token 交给客户端；Turso 的 token 只能经 Platform API（org 级权限）或长期 token 签发，没法在 Worker 里不带 Platform API token 就签短期 token。现在数据库 token 只放在 Worker 的密钥里，客户端拿的是 Worker 签的 1 小时同步凭据，只能读写自己的行。
- 留的路：core 的 `SyncTransport` 接口与 `SyncEngine` 和存储无关，以后 Turso Sync 成熟（逻辑行级冲突、DDL 不随同步走）可以换；云端数据本来就在 Turso。
- 备选（未用）：B 自建 Worker + D1（同一套协议换个云端存储即可，~10 行）；cr-sqlite；PowerSync（需要 Postgres）。

### 云端（Turso `mindough`）
- `sync_row(user_id, tbl, id, updated_at, deleted, data, seq)`，主键 (user_id, tbl, id)，索引 (user_id, seq)；`data` 是整行 JSON，云端不关心业务列——客户端加列 / 加表不用改云端。
- `auth_code(code, payload, challenge, expires_at, used)`：原生端一次性登录码（5 分钟）。
- `server_schema`：云端迁移版本；Worker 第一次用到时自动应用（`apps/server/src/sync.ts` 的 `SERVER_MIGRATIONS`，只追加）。
- Worker 密钥：`TURSO_DB_URL`、`TURSO_DB_TOKEN`（全权限数据库 token，只在 Worker 里，不进仓库、不给客户端）。
- 接口：`POST /api/sync/token`（会话 → `{ url, token, expires_at }`，401 未登录 / 403 无权限 / 503 服务不可用）、`POST /api/sync/push`（`{ rows }` → `{ applied }`，单次最多 500 行、单行 ≤ 2 MB）、`POST /api/sync/pull`（`{ cursor, limit }` → `{ rows, cursor, more }`）。

### 原生端登录（Tauri）
- 「用 Google 登录」→ app 生成 verifier，用系统浏览器打开 `/auth/login?native=1&challenge=base64url(SHA-256(verifier))` → Google → Worker 发一次性登录码，结果页（“已登录，回到 Mindough 继续”）跳回 `mindough://auth?code=…` → app `POST /auth/exchange { code, verifier }` 换成会话（30 天），存本机，之后请求带 `Authorization: Bearer`。别的 app 截到 deep link 没有 verifier 换不走；码只能用一次。
- Tauri 插件：opener（系统浏览器）、deep-link（`mindough://`，桌面与移动端都注册）、桌面端 single-instance（带 deep-link 特性：Windows / Linux 再开一个进程时把链接交给已开着的窗口）。Worker 给 `tauri://localhost`、`http(s)://tauri.localhost` 开 CORS。
- 状态：代码写完、`cargo check`（Linux）通过、Worker 端单测覆盖；**还没在真机上走过**（需要打包安装后点一次登录）。`rust-ini` 锁在 0.21.1（0.21.3 给 `ParseOption` 加了字段，deep-link 2.6.2 编译不过）。

### 图片（R2）
- `POST /api/assets`（会话或同步凭据，image/*，≤ 10 MB）存进 R2 桶 `mindough-assets`，key = 用户邮箱哈希前 16 位 / 内容 SHA-256（同一张图只存一份）；`GET /api/assets/<key>` 公开读、长缓存（key 猜不到）。
- 客户端上传图片时：登录且在线 → 传 R2，asset 行只存地址（`url`、`r2_key`、`sha256`）；离线或没登录 → 仍存 data: 地址（照样同步，只是行大一些）。以前存的 data: 图片暂不自动搬到 R2（以后做）。

### 风险与缺口
- 每用户 seq 用 `MAX(seq) + 1` 在事务里算，依赖 Turso 单写者串行；若以后开 `BEGIN CONCURRENT` 要改成计数表。
- 行级 LWW：两台设备离线改同一件任务的不同字段，只留晚的那次（整行）。字段级合并以后再说。
- 旧版本客户端不认识的新列：拉下来能存（JSON 里有），但旧版本改这一行再推，会丢掉新列的值。
- 同步凭据 1 小时、会话 30 天；会话是 HMAC 签名、无服务端状态，泄露只能靠换 `SESSION_SECRET` 失效。
- Turso 免费档（starter）；2026 年 Turso 宣布加入 Supabase，留意产品走向。

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

- 资料库（2026-10-15 加，见下“资料库”）：每个类型的字段分 资料字段（属于这部片 / 这本书）和 任务字段（属于这一次）；资料存在资料库里，任务引用它。
- 人物列表：独立的一张人物表（姓名、头像、关系、生日、备注 md）。“人物”类型的任务显示对方头像 + 姓名；任何任务也可以关联多个人物，在卡片上显示小头像。人物详情页列出与 TA 相关的所有任务。
- 自定义类型：选一种版式（海报 / 图标+名称 / 横幅 / 纯文字），定义字段（文本、数字、进度、日期、链接、图片、单选、人物），写一段正文模板，配名称、图标、颜色。内置类型走同一套机制，不写死特例。
- 新建任务时先选类型（快捷键直接新建普通任务）；组可设“默认类型”，组里新建自动套用。
- 改类型（Rei 2026-10-16 改）：清空原来的资料与字段，新类型从「未选」开始；只留新类型也有的同 key 任务字段。不再把资料抄回、也不在新类型库里找同名或新建。
- 图片：本地上传或粘贴链接；原生端存本地文件，同步时上传到 Cloudflare R2，D1 只存引用。
- 按名称自动找图和资料（影视 TMDB、游戏 Steam/IGDB、书籍 Open Library）放在 M4，展示时附来源。

## 资料库（Rei 2026-10-15：“可以添加影视库、书库、项目库、游戏库、课程库等等，这样不用每次都添加这些资料而是可以选，如果没有再新建”）
- 每个非“普通”的类型有一个库，自定义类型自动有库。库名（界面）：影视库、书库、游戏库、项目库、课程库、目的地、好物清单、餐厅库、菜谱、人物；写在 `library.ts` 的 `LIBRARY_COPY`。
- 表 `library_item`：id（UUIDv7）、type_id、name（= 主字段：片名、书名…）、image（图片字段：asset id / 外链 / data URL）、fields（JSON，其余资料字段）、note_md、created_at、updated_at（HLC）、deleted 墓碑。task 加 `library_item_id`（可空）。一条资料可被多件任务引用（重看、再去一次）。
- 字段定义 `FieldDef.scope`：`item`（默认，资料字段）/ `task`（任务字段）；主字段和图片字段总是资料字段。任务的 `type_data` 只存任务字段；显示时 `Store.taskData()` = 资料展开 + 任务字段（同名以任务为准）。
- 内置类型拆分（资料 → 任务）：影视 片名·海报·年份·电影/剧集·平台 → 看到哪；书 书名·封面·作者·页数 → 读到第几页；游戏 游戏名·图标·平台 → 进度 %；项目 项目名·图标·链接 → （无）；课程 课程名·图标·平台·链接 → 学到第几课；旅行 目的地·照片 → 出发 / 返回日期；购物 名称·图片·价格·链接 → 买几件；餐厅 店名·照片·地址·链接 → （无）；饮食 菜名·照片·食材清单 → 餐次；人物 人物（person 表）→ 事由。
- 人物库 = person 表（不迁移，风险大）：`Store.libraryEntries(typeId)` 把资料和人物统一成 `LibraryEntry`（kind item / person），选择框、资料库页、⌘K 用同一套；人物详情仍在 `#/people/:id`。
- 内置类型改定义：`BUILTIN_TYPES_REVISION` 版本戳（`0000000000000-0001-builtin`）。打开时，存着的内置类型若仍是更早的内置戳（用户没改过）就换成新定义；用户改过的（真实 HLC）不覆盖，只在内存补上各字段的 scope，并补上新定义新增、它还没有的字段（按 key，插在新定义里前一个字段之后；不改写、不进 outbox）——这样 r2 的 IMDb / 豆瓣 / 更多链接对改过类型的人也有。比当前内置戳更新的内置戳（别的设备已升级）不降级。
- 迁移（`Store.migrateToLibrary()`，每次打开都跑，无事可做时是空操作）：资料直接写在 type_data 里、没挂资料的旧任务 → 按 类型 + 规范化名字（NFKC、小写、去空白和标点）去重，先找库里已有的，没有就新建；同名的后来者只补空缺；任务改为引用资料、type_data 只留任务字段。迁移出来的资料用确定性 id（类型 + 规范化名字的哈希，UUID 形状），两台设备各自迁移得到同一条，同步时自然合并。没填主字段的、人物类型的、普通任务不动。SQLite：迁移 v2（建 library_item、task 加列与索引）；localStorage：旧 JSON 没有新表 / 新字段时在内存补空。
- 新建 / 改类型：`createTask` 时若 type_data 里写着名字（旧调用方式、⌘K 等），自动找同名或建资料挂上；`changeTaskType` 清空资料引用和资料字段（2026-10-16 起，不再抄回 / 重新挂）。删除资料：用到它的任务不删，把资料抄回各自 type_data 再解开引用。
- 搜索：`searchLibrary` 空查询按最近用到（任务 created_at 或资料创建时间）排，有查询按 完全一致 > 开头 > 包含 > 按顺序出现（如「王泪」→「王国之泪」），简介也能搜到；⌘K 结果里有资料，可「用它新建任务」。
- 界面：新建面板选类型后，主输入变成选择框（↑↓ 回车，缩略图，最后一行「新建“xxx”」→ 就地填资料：图片可上传 / 粘贴图片或链接，名字预填）；已经写了一行字再选类型，那行字直接当搜索词。详情顶部是资料卡（图 + 名字 + 简介，「换一个」「编辑资料」「在影视库里看 · N 件任务」），任务字段在内容下方。资料库页在导航里（桌面侧边栏，手机在「更多」里，人物页并入这里）：按库切换的标签条（Apple 胶囊、WinUI SelectorBar 下划短条、Material filter chip），网格按版式：影视 / 书竖版海报 2:3、游戏 / 项目 / 课程 / 好物方形圆角、目的地 / 餐厅 / 菜谱横幅 16:9、人物圆形头像。没有图时按名字生成渐变 + 缩写的占位（不用任何有版权的海报）。
- 字段种类（2026-10-15 补，内置版本 r2）：除了文字 / 数字 / 单选 / 链接 / 图片 / 清单，还有 `multiselect` 多选（存 string[]）、`money` 金额 + 币种（`{ amount, currency }`，ISO 4217，Intl zh-CN 按币种小数位显示，不换算；默认 = 资料库里最近改过的那条的币种，一开始人民币）、`site_id` 站点编号（只存编号，按 `site` 拼链接：IMDb tt…、豆瓣数字；粘贴整条网址自动只留编号）、`links` 更多链接（`{ url, label? }[]`，label 只在用户改过时存，否则按域名表认出 EXT / 烂番茄 / TMDB / Steam…，不认识的用域名）、`episode` 看到第几季第几集（`{ season?, episode? }`，认 S02E03 / 2x03 / 第二季第三集 / EP03 / S02，认不出按原文存）。都在 core（`links.ts`、`money.ts`、`episode.ts`），各类型可复用。
- r2 的内置调整（Rei 2026-10-15）：影视去掉「平台」，加 IMDb / 豆瓣 / 更多链接，「看到哪」改 episode；游戏「平台」改多选（PC（Steam）/ PC（Epic）/ PC（其他）/ PS5 / PS4 / Xbox Series X|S / Xbox One / Switch / Switch 2 / iOS / Android / macOS / Linux / Steam Deck / 网页 / 其他），加更多链接；购物「价格」改金额 + 币种。迁移（打开时，只动旧形状的值，可重复、多端结果一致）：影视资料里旧的平台值留在数据里不显示（不丢，以后加回同名字段还能看到）；游戏平台文字按选项名 + 别名对上（Switch → Nintendo Switch、PS5 → PlayStation 5、Steam → PC（Steam）…），对不上的加选「其他」并把原文记进备注「平台：原文」；价格数字算人民币，文字认符号 / 代码 / 中文（$ → 美元、£、S$、HK$、元…），认不出的记进备注「价格：原文」。用户改过的内置类型（真实 HLC）不整体替换（只补新字段，见上），旧值也就不迁移。
- 新建面板：影视的搜索框里写「绝命毒师 S02E03」，拿「绝命毒师」去搜 / 新建，「看到哪」自动填第 2 季第 3 集，下面一颗小胶囊「已识别 第 2 季第 3 集」（× 不用 / 撤销）；内容第一行有季集标记且「看到哪」空着时同样（新建时提示、详情里写完内容后用可撤销的提示）。
- 资料 / 人物的备注支持 Markdown（和任务内容同一个渲染器：GFM 表格、清单、代码、引用；DOMPurify 消毒；链接新标签页打开）；编辑资料里备注写完显示排好版的样子，点一下接着改。
- 以后：按名字自动补资料和图（影视 TMDB、书 Open Library、游戏 Steam / IGDB），展示时附来源；资料合并（两条其实是同一部片）；资料库排序方式（最近 / 名字）。

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
  - 每个带 lucide 图标与颜色，固定 id（UUIDv7 格式、时间戳 0，第四段 8001，各设备一致）；可改名、隐藏、排序、新增（打卡页「编辑」或分类选择器「管理分类…」），内置的不删只隐藏。
  - 选择器是可搜索的网格（分类多，不用下拉）；“新建打卡”与任务详情里可选。打卡页可按分类筛选（横向标签，只列有任务的分类）和“按分类”分组（空分类不显示）。
  - 种子列表在 `packages/core/src/seed/builtin-checkin-categories.ts`：追加一行即可扩展（id 由编号决定、永不复用；顺序由数组位置决定），老用户打开时自动补上新分类。
  - 与“分类”（挂在组上，名称 + 颜色）是两张表：`checkin_category` 只给重复任务用。
- 同步：每次开始、结束、+1 都记一条 check_in 事件，多端合并时按事件累加，不会因两台设备同时点而丢次数。

## 数据模型
- task：id、body_md（无标题，列表里显示首行作预览）、status（待办 / 进行中 / 完成 / 关闭；完成和关闭都是“已结束”，done_at 记结束时间）、group_id（可空）、scheduled_date（可空，用于列表视图）、done_at、sort、created_at
- dependency：pred_id、succ_id、type=FS、lag=0
- task_link（相关任务，无方向）：a_task_id < b_task_id、note、created_at；id 由这一对确定（SQLite 迁移 v3）
- group：id、name、icon（emoji 或 lucide）、start_at、end_at、category_id
- category：id、name、color
- task_type：id、name、icon、color、layout（poster / icon_name / banner / text）、fields（JSON 字段定义）、body_template（markdown）、builtin、hidden
- task 增加 type_id（可空=普通）、type_data（JSON，按字段定义填写，图片存 asset_id；有资料库后只存任务字段）
- library_item：id、type_id、name、image、fields（JSON）、note_md、created_at；task 增加 library_item_id（可空）；FieldDef 增加 scope（item / task）
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
0. 我的一天：今天打算做的任务清单，打开 app 的首页。旁边是「待安排」：还没定哪天做的事（M3 加）。
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
- ~~从侧边栏 / 快捷键新建（不在组内、未指定日期）的任务自动加入我的一天。~~ Rei 2026-10-16 改：只有从我的一天新建的才进今天，其余默认进「待安排」（见 M3-6）。

### M1（进行中，2026-10-15）：真存储 + 原生包 + 登录
- ✅ SQLite 存储：`packages/core/src/storage/sql.ts` 的 `SqlAdapter` 实现 `StorageAdapter`，底下换驱动。
  - schema（`storage/schema.ts`）与数据模型一一对应（每字段一列，JSON 列存文本、布尔 0/1），`COLUMNS` 的类型约束保证 types.ts 加字段时必须加列；`schema_version` 表 + 只追加的迁移列表；`outbox`（自增 seq）与 `meta` 表。
  - 写入：一批变更一个事务，`INSERT … ON CONFLICT DO UPDATE … WHERE excluded.updated_at > updated_at`（行级 LWW，相等保留已有），每行进 outbox；失败整批回滚。
  - Web（2026-10-16 起，Rei：所有浏览器统一用 sqlite-wasm）：官方 `@sqlite.org/sqlite-wasm` 3.53 + opfs-sahpool VFS，跑在专用 worker（`store/sqlite.worker.ts`），库在 OPFS `.mindough-sahpool/`。单线程，不要 SharedArrayBuffer / 跨源隔离，Chrome 102+、Firefox 111+、Safari 16.4+；wasm 0.87 MB（gzip 0.4 MB）。同一时刻一个标签页（`store/tab-lock.ts`，Web Locks）：后开的只显示「已在另一个标签页打开」+「在这里用」（steal，原来那页先 flush 再停库、换成提示）。第一次启动把以前 Turso wasm 的 OPFS `mindough.db` 整份搬过来（`migrateFromTurso`，旧文件留作备份）；读旧文件还要 Turso 引擎和跨源隔离，所以 COOP / COEP 响应头暂时保留，等大家都迁完再去掉。无 OPFS（部分无痕模式）退回 localStorage。
  - 首次用上 SQLite 时把 localStorage 的数据原样迁过去（行、device_id、demo_seeded），只迁一次，旧数据留作备份。
  - Tauri 原生：`src-tauri/src/db.rs` 命令层（rusqlite bundled，单连接，`db_exec / db_run / db_all`），schema 与迁移仍在前端 core，与 Web 同一份。没用 tauri-plugin-sql：它是连接池，跨 invoke 的 BEGIN / COMMIT 不可靠。本机 `cargo check` 通过（Linux）。
  - 测试：同一套契约跑 内存 / localStorage / node:sqlite / Turso 引擎（`@tursodatabase/database`，与 wasm 同引擎）。
- ✅ GitHub Actions：`ci.yml`（类型检查、单测、构建）；`build.yml`（手动或推 `v*` 标签）用 tauri-action 打未签名的 macOS universal、Windows（msi / nsis）、Linux（AppImage / deb），另有 Android debug APK（arm64，CI 里 `tauri android init`）；产物传 artifacts，推标签时建 Release 草稿。iOS 待签名方案。
- ✅ Google 登录（Worker 写好未部署）：`/auth/login`、`/auth/callback`、`/auth/logout`、`/api/me`；HMAC 签名会话 cookie（SESSION_SECRET，30 天）；`ALLOWED_EMAILS` 白名单，为空 = 谁都不能登录。失败回跳带 `?login_error=代码`，前端启动时立即用 history.replaceState 去掉并显示可关闭提示，登录成功后不再显示。`POST /api/sync/token` 当时先返回 501 未实现，M2 已签发同步凭据。客户端设置页有“账户”区；不登录也能完整离线使用。
- ✅ 原生端登录（系统浏览器 + deep link 回调）：M2 里做完，见“原生端登录（Tauri）”；Worker 已部署，Google OAuth 客户端 Rei 配好（2026-10-15）。
- ✅ Markdown 编辑换成 Milkdown（所见即所得），见 M3-2。

### M1b ✅（2026-10-15）：新建与详情重做 + 文案（Rei：“功能都有，但让人厌恶……完成方式在新建时就要让用户选，而且用词很粗糙”）
- 新建和详情拆开。新建面板（TaskComposer）：一个大的无边框内容框（「要做什么？」，自动聚焦，无标签无编辑/预览页签，Markdown 写法只在 ? 悬停提示里）；下面一排属性胶囊（类型 / 日期 / 组 / 和谁有关，点开是弹层，设了显示值）；「怎么算完成」四张卡片（名称 + 一句话例子，默认勾选完成），选中后只出现它自己的一句话设置（每次 [10] [分钟] / 目标 [8] [杯] / 目标日期 [..]，到时显示 还有 N 天）；「多久一次」只做一次 / 定期打卡 → 每天 / 每周[一…日] / 每月 [15] 号 / 每 [3] 天，定期时出打卡分类网格。选了非普通类型才出现该类型的字段，类型可带默认完成方式（用户手动挑过就不改）。没有状态、没有删除；主按钮「添加」（⌘/Ctrl+Enter），取消或 Esc。从侧边栏新建且无组无日期的仍自动进我的一天；建好后提示里可「查看」。“然后呢？”/「新建下一步」打开同一个面板，带“做完「X」之后”，建好自动连上。
- 详情（TaskDetail）：内容在前（排好版的 markdown，点一下就地编辑，Esc 收起）；状态用操作按钮——主操作随完成方式变（完成 / 开始计时·暂停·结束 / +1 杯 / 打卡），「关闭」（重复任务叫「不再打卡」）是安静样式放左边，结束后只剩「重新打开」，顶部徽章显示 已完成 / 已关闭 / 还在等 N 件事 / 进行中；计时、计数、倒数日、定期打卡有一块进度（环 + 数值 + 连续次数）。右侧（手机在内容下方）属性列表：类型、完成方式、重复、打卡分类、日期、组、和谁有关，点值弹出编辑。「前后关系」分「先做完这些」「做完后解锁」，各有「添加」（可搜索）和「新建下一步」。删除放进 ··· 菜单并确认；加入 / 移出我的一天是顶部的太阳图标（菜单里也有）。
- 平台形状：Apple 桌面是无分隔带的 sheet、手机是带拖拽条的底部弹层（新建面板顶栏左取消、右添加）；WinUI 是 ContentDialog（20px 标题、底部按钮带）；Material 桌面是 28dp 圆角对话框，手机是全屏对话框（左上关闭、右上添加）。
- 文案：docs/COPY.md（术语表 + 语气原则），AGENTS 规定界面文案按它写；core 的 COMPLETION_MODE_LABEL / HINT 与 describe.ts（时长、倒数日、口语日期、完成方式摘要、快捷日期）统一说法。
- 依赖：@internationalized/date（React Aria 月历）。

### M1c ✅（2026-10-15）：资料库
- core：`library.ts`（叫法、字段拆分、规范化与模糊搜索、迁移计划、确定性 id、占位图配色）、`library_item` 表（SQLite 迁移 v2）、Store 的资料增删改 / 换资料 / 改类型保留字段 / 打开时迁移、⌘K 搜资料；内置类型拆 资料 / 任务 字段并按版本戳升级；演示数据每个库几条（星际穿越重看两次）。测试覆盖迁移（localStorage、node:sqlite、Turso 三种存储 v1 → v2）、去重、模糊搜索、删除 / 改类型。
- client：新建面板的资料选择框与就地新建、详情资料卡、资料库页与资料详情、人物并入资料库、⌘K「用它新建任务」、渐变占位图；三种皮肤的切换条与卡片形状。

### 相关任务 ✅（2026-10-15）
- core：`related.ts`（规范顺序、确定 id、前后关系优先的过滤）、`task_link` 表与 SQLite 迁移 v3、Store `linkTasks / unlinkTasks / relatedTasks / taskLinks`（按版本缓存）、删任务级联、演示数据三对；测试覆盖去重、不阻塞、与前后关系重叠、localStorage / node:sqlite / Turso v2 → v3。
- 界面：详情的分区改叫「关系」，下分 先做完这些 / 做完后解锁 / 相关任务（「添加」可搜索、「新建相关任务」、行可点开、悬停 × 去掉、显示对方状态）；新建面板多一颗「相关任务」胶囊（多选）；列表行在元信息里显示小链环 + 个数；关系图把相关画成没有箭头的点线（前后关系里还没完成的是虚线带箭头，所以相关用圆点线区分），参与排布让两件挨着，图例「相关（不分先后）」，「有关系的」范围包含相关任务；选中点线按 Delete 去掉。

### M2 ✅（2026-10-15）：多端同步
- ✅ 引擎：Rei 定 A（Turso）；实现为 Turso Cloud + 自己的 outbox / 游标协议经 Worker（原因见“同步引擎选型”）。core `sync/`：`SyncEngine`（防抖推送、游标拉取、第一次登录的合并、演示数据不带上去、状态）、`SyncTransport` 接口、`MemoryRemote` 假云端；Store `applyRemote` / `onLocalWrite` / `raw` / `conflictEdges`；适配器 `applyRemoteChanges`（不进 outbox）。
- ✅ 合并规则：行级 LWW（HLC + 设备 id 定先后）、墓碑同样比较、check_in 只追加、合并后成环的后到边标冲突。core 测试用两台模拟设备 + 假云端覆盖：互相看到、第一次合并两边数据都留、LWW 与推送先后无关、同毫秒按设备 id、删除 vs 编辑、打卡相加、成环冲突一致、同一对去重、新设备只有演示数据、改过的演示数据照常合并、离线后补推、401、防抖不回推、退出后不推、SQLite 落盘不进 outbox、重置后重新合并。
- ✅ Worker：`/api/sync/token`、`/api/sync/push`、`/api/sync/pull`、云端 schema 自动迁移、`/api/me` 移出白名单 403、Bearer 会话、Tauri CORS；单测用 node:sqlite 实现的假 Turso（真跑 SQL）；`apps/server/e2e/real-turso.test.ts` 对真实 Turso 跑两台设备（默认跳过，2026-10-15 跑通后清掉了测试行）。
- ✅ 客户端：`lib/sync.ts`（凭据缓存与 401 重取、HTTP 传输层、跟着账户开停、焦点 / 联网 / 60 秒触发）、`lib/account.ts` 改成全局账户状态（Web cookie / 原生 Bearer）、设置 → 账户的同步状态行与「立即同步」、详情里的成环提示、登录同步时不能重置。
- ✅ 原生端登录（deep link + 一次性码 + verifier）：代码与 `cargo check` 通过，未在真机验证。
- ✅ 图片上传 R2（登录在线时），asset 只存地址；旧的 data: 图片暂不迁移。
- 线上：Worker 已部署（`/api/health` stage M2）；Turso 库 `mindough`（东京）已建、云端 schema v1 已应用；Worker 密钥 `TURSO_DB_URL`、`TURSO_DB_TOKEN` 已设；R2 桶 `mindough-assets` 已建并绑定 `FILES`。
- 要 Rei 验证：两个浏览器（或电脑 + 手机）都登录同一个 Google 账户，一边新建 / 改 / 打卡，另一边回到前台或点「立即同步」看到。

### M3 天天好用（Rei 2026-10-16 批准路线图：“做完之后就按顺序，开工M3，直到做完为止”；动工顺序 4 → 6 → 2 → 1 → 3 → 5）
1. ✅ 提醒通知（2026-10-16）：
   - core `reminders.ts`（纯函数 + 测试）：`upcomingReminders(tasks, checkIns, { now, horizonMs, graceMs, timeZone, fired, snoozed })` 算出接下来要响的——只做一次（有日期，那天 `remind_time`）、倒数日（目标日那天）、定期打卡（每个要打卡的日子；那个周期已经达标就不响）、计时到点（正在走且有目标时长，不用设时间；暂停再继续按新的一段重算）。完成 / 关闭 / 不再打卡 / 删除的不响；建任务之前的打卡日不响。时间是本机（或指定 IANA 时区）的墙上时间，夏令时跳过的时刻顺延（纽约 02:30 → 03:30）、重复的取第一次。id 稳定（任务 + 种类 + 那天 / 那段计时），用来去重、记「已响过」、稍后再提醒（10 分钟）；app 刚打开时错过 15 分钟以内的补响。
   - 模型不用改：v4 已有 `task.remind_time`（同步）；总开关、已响过、稍后再提醒存本机（每台设备自己响，通知权限本来就按设备）。
   - 客户端 `lib/reminders.ts` + `components/ReminderHost.tsx`：每分钟、数据一变、回到前台时重算，最近的一个 setTimeout 到点。前台：app 里弹一条提示（铃铛 + 标题 · 说明，「查看」「10 分钟后」）；后台：系统通知（Web 经 `public/sw.js` 的 service worker 发——Android Chrome 只认这种，点通知回到 app 打开那件任务；没有 service worker 就用 `new Notification`）。
   - Tauri：`tauri-plugin-notification`（Cargo + `notification:default` 权限 + `@tauri-apps/plugin-notification`）。桌面同 Web（app 开着时排程）；手机把接下来 48 小时的提醒交给系统排好（`Schedule.at`，allowWhileIdle），app 关着也会响，重算时取消变了的、补上新的；点通知打开那件任务（`onAction`）。
   - 界面：新建面板多一颗「提醒」胶囊（只在有日期 / 倒数日 / 定期打卡时出现）；详情属性列表「提醒」一行（同样条件，或已经设了）；弹层 = 常用时间 9:00 / 12:00 / 18:00 / 21:00 + 系统的时间输入「其他时间」+ 一句什么时候响 +「不提醒」；总开关关着时弹层里提示「提醒通知关着。去设置里打开」。设置 → 提醒：「提醒通知」开关（Apple / WinUI / Material 各自的开关样子，`ui/primitives` Switch）+ 权限状态说明 +「允许通知」；第一次打开开关时顺便问权限。
   - 没做：通知上的「稍后」按钮（系统通知的 action 各平台不一样；app 里的提示有）；Web 端 app 关着时不会响（要推送服务器，不做）；桌面端 app 关着不会响（以后可以加托盘常驻）。真机待验：macOS / Windows 通知权限、Android 13+ 的 POST_NOTIFICATIONS 与精确闹钟、iOS。
2. ✅ 正经的 Markdown 编辑器（2026-10-16）：所见即所得，取代「输入框 + 排好版的预览」，入库仍是 markdown 文本。
   - 选 **Milkdown 7**（不选 TipTap）：它本身就是 markdown 原生的——remark 解析 ↔ ProseMirror 文档 ↔ remark 序列化，存进去、读出来就是 markdown，往返保真（`milkdown.test.ts` 覆盖标题 / 清单 / 表格 / 删除线 / 链接 / 代码 / 引用 / 空清单项）；TipTap 的 markdown 要靠社区扩展转换，往返会丢东西。GFM 预设直接带表格、清单（`- [ ]`）、删除线、自动链接。headless、不带样式，排版沿用 `.md`，三种皮肤只改令牌（清单勾 Apple 圆形 / WinUI · Material 圆角方形）。
   - 用在：任务详情的内容（点进去就能改，Esc 收起）、资料 / 人物备注、**新建面板的内容框**（不带工具栏的轻量版 `toolbar="none"`：只靠写法变样子，`# `、`- [ ] `、`**粗体**` 打出来就排好；字号同以前 18px；Esc 关面板、⌘/Ctrl+Enter 添加照旧）。编辑器约 140 KB（gzip）按需加载，启动后空闲时预加载，新建面板一打开就能写。
   - 详情和备注编辑时下方出现格式工具栏（标题 / 粗体 / 斜体 / 删除线 · 清单 / 列表 / 编号列表 / 引用 / 代码 · 链接 / 表格），按钮不抢焦点，悬停提示带快捷键，⌘K 加链接；点清单的勾直接切换。
   - 去掉了备注标签旁的「支持 Markdown」小字（写的时候就是排好的样子，用不着说）；新建面板的 ? 提示改成「直接这样写，会自动排好版：」。
   - 修：详情第一行的标题样式漏到了整段（`.detail-md > :first-child` 套到了编辑器外壳上），小标题比正文大一点（h1 19 / h2 17）。
3. 🟡 小组件（2026-10-16，详见 docs/WIDGETS.md）：
   - ✅ 桌面小窗：我的一天标题旁「打开小窗」（只在桌面 app）→ Tauri 第二个窗口 `mini`（`?window=mini`，340 × 540，置顶，可调大小）：我的一天 + 今天要打卡，用 TaskRow 直接勾 / 计时 / +1，底部「加到今天…」，图钉切换置顶、「打开主窗口」。两个窗口共用 rusqlite，内存快照经 Tauri 事件 `mindough:changes` 互相 applyRemote；小窗不跑同步 / 提醒 / 登录回调。`cargo check` 通过，真机待验。
   - 🟡 Android：app 写快照 ✅（`lib/widget-snapshot.ts` → Rust `widget_snapshot` → app 数据目录 `widget-snapshot.json`，有测试）；AppWidget 的 Kotlin + 布局写在 `src-tauri/mobile/android-widget/`，**没接进构建**（gen/android 由 CI 生成、本机没 SDK 验证不了；接入步骤在 WIDGETS.md）。
   - 🟡 iOS：WidgetKit 脚手架（`src-tauri/mobile/ios-widget/MindoughWidget.swift`）+ 步骤（要 App Group，快照得写到共享容器）；待 Rei 在 Mac 上接。
4. ✅ 桌面 app 外链用系统浏览器打开（Tauri opener）：`lib/external.ts` 在 document 上捕获 click / auxclick，指向别的源的 http(s) 和 mailto / tel 链接一律交给 `openUrl`（Markdown 渲染的链接、资料卡小标签、编辑器里的链接都不用各自处理）；Web 端照常新标签页；权限沿用 `opener:default`（只放行 http / https / mailto / tel）。真机待验。
5. 🟡 各平台安装包：版本 0.1.0、macOS ad-hoc 签名、notification npm 与 crate 对齐；已推标签 v0.1.0-alpha.1 触发 build.yml（macOS / Windows / Linux / Android debug），结果由 Rei 在 Actions 查看；iOS 分发方式待 Rei 定。
6. ✅ 界面收尾：
   - ✅ 27 个打卡分类改「常用 6 个 + 更多」：常用 = 重复任务用得最多的（件数一样按最近），不够用 健康 / 运动 / 学习 / 读书 / 饮食 / 作息 补齐（core `pickFrequentCategories`、`Store.frequentCheckInCategories`）；当前选中的总在第一屏；「更多 · 21」展开搜索框和其余分类；分类改成随宽度换行的小胶囊。
   - ✅ 手机端细节：弹层底部轻提示（「改动会同步到用到它的 N 件任务」）放不下时自己占一行，不再把「保存」挤到下一行；更多链接每条一张小卡（上面名字 + 上移 / 下移 / 去掉，下面整行网址）；IMDb / 豆瓣预览链接太长时省略号。
   - ✅ 暗色模式检查（三种皮肤，我的一天 / 打卡 / 详情 / 编辑资料 / 资料库），Material 补截图（work/screens/m3-*）。
   - ✅ 关系图里相关任务并排放：相关的几件合成一个「并排组」交给 elk 排（`lib/graph-layout.ts`），同一层里挨着，侧边点线相连；两组之间有前后关系路径时不合（会绕圈），照旧只画线。几块互不相连的图手机上往下叠。
   - ✅ SGD / TRY 等币种显示本地符号：Intl 只给代码时换成表里的符号（S$189、₺1,299.50、₱500、RM49、₽99）。
   - ✅ 侧边栏分区（Rei 2026-10-16：「侧边栏分一下section，太乱了」）：「今天」我的一天 · 打卡 · 可做 /「计划」列表 · 组 · 关系图 /「资料」资料库 · 人物；设置和新建固定在底部。小节标题按平台：macOS 11pt 粗体灰字、悬停出折叠箭头；WinUI NavigationViewItemHeader 14px 粗体；Material 抽屉 Title small + 分隔线、桌面紧凑一档。点小节标题可折叠（记在本机，当前页所在的小节不折）。手机标签栏按同样顺序：我的一天、打卡、列表、关系图、更多；「更多」页同样分组（iOS 分组列表 / WinUI / Material 各自的小节标题）。
   - ✅ 打卡分类的管理从设置挪出来（Rei 2026-10-16）：打卡页筛选条末尾「编辑」、新建面板分类选择器底部「管理分类…」打开同一个弹层（`components/CategoryManager.tsx`）：改名、隐藏 / 显示、上移 / 下移（`Store.moveCheckInCategory`，只改 sort）、添加；id 不变；设置里不再有这一节。
   - ✅ 详情「关系」变紧凑（Rei 2026-10-16：「关联占用那么大空间……如果这类关系中没有内容，则不显示……也不要显示添加、新建下一步…无用的按钮」）：顶栏（太阳旁）一个「添加关系」按钮，菜单三项 先做完这些… / 做完后解锁… / 相关任务…；选了打开同一个挑任务的弹层（搜索已有任务，最后一行「新建“xxx”」直接新建并连好，回车也行——合并了以前的「添加」和「新建下一步」）；分组只在有内容时出现，三组都空时整个「关系」不显示；行照旧：点开、× 去掉、行尾状态。··· 菜单里的「新建下一步」去掉（完成提示里的「然后呢？」保留）。新建面板的「相关任务」本来就是一颗胶囊，不改。
   - ✅ 待安排（Rei 2026-10-16：「加一个待安排」）：没结束（待办 / 进行中）、只做一次、没有日期（倒数日的目标日也算日期）、不在今天我的一天里的任务；组里的也算（行上带组名）。行上：加入我的一天（太阳）、安排日期（日期面板，选了就进列表）、拖动排序（`Store.reorderBacklog`：这几件在原来那些 sort 值里换位置）；手动顺序在前、再按创建时间。导航「今天」小节里在我的一天下面（带件数）；手机标签栏 我的一天 · 待安排 · 打卡 · 列表 · 更多（关系图、可做进「更多」）。core `backlog.ts`（`isBacklogTask`、`backlogTasks`、`shouldJoinMyDay`）+ 测试。
     - **改了 M0 决定 8**（Rei 2026-10-16）：新建的任务不再因为「没日期、没组」就自动进我的一天；只有从我的一天页新建的（侧边栏 / N 键在我的一天页上、或我的一天的输入条）才放进今天，别处新建的默认进待安排。我的一天里没做完的：照旧有「昨天没做完 → 带回今天」，不带回的自然落回待安排。
   - ✅ 中英文（Rei 2026-10-16：「添加中英文支持」）：gettext 式——中文原文就是 key（`tr('还在等 {n} 件事', { n })`），英文值可以是函数（复数、语序）；`trx` 整句带元素（「还有 **12** 天」→ “**12** days to go”），`trc` 带语境（导航「打卡」= Check-ins、按钮 = Check In）。core `i18n.ts`（`tr` / `trc` / `dataLabel` / `setLocale` / `intlLocale`）+ `i18n-en.ts`（core 说法、演示数据）+ `i18n-data-en.ts`（内置类型 / 字段 / 选项 / 单位 / 模板 / 27 个打卡分类 / 网站名，显示时翻译，存的仍是中文，用户改过的照原样）；界面 `apps/client/src/i18n/en.ts`。日期星期月份走 Intl（`formatDate`、`weekdayLabel`、`monthShort`），币种名 `currencyName`（Intl.DisplayNames），金额 Intl 跟语言。设置 → 外观 → 语言（跟随系统 / 中文 / English）存进同步的 pref `locale`，本机另存一份启动即用；换语言整棵界面重新挂载（`lib/locale.tsx`，React Aria 的 I18nProvider 跟着换）；`?lang=en` 截图用。守门测试 `i18n/i18n.test.ts`（TypeScript AST 扫描）：组件与 core 没有漏翻的中文（数据 / 解析文件、console、`// i18n-ignore` 行除外）、每个 key 有英文、每个内置名字有英文。英文写法见 COPY.md「English」。截图 work/screens/m3-*-en.png。
     - 演示数据按生成时的语言写（英文界面第一次打开就是英文演示数据）；已有的中文演示数据不会变成英文（是用户数据）。

### M4 更聪明
- 自定义类型编辑器（字段、版式、图标、颜色、排序与隐藏）。
- 按名字自动补全资料（影视 TMDB / 豆瓣、游戏 Steam、书 Open Library；有 IMDb / 豆瓣编号时按编号取），展示时附来源。
- ✅ 资料合并（两条其实是同一部片）（2026-10-16，分支 m4-merge）
  - core `merge.ts`（纯逻辑：`planItemMerge` / `planPersonMerge` 算合并后的值与冲突、`mergeNotes`、`duplicateGroups`、`resolveMerged`、`mergeCycleSurvivors`）+ `Store.mergeLibraryItems(targetId, sourceIds, choices?)` / `mergePeople` / `undoMerge` / `settleMerges` / `duplicateGroups` / `dismissDuplicateGroup`；测试 `packages/core/test/merge.test.ts`。
  - 规则：同类型才能合并（不同类、只选一条、来源不在了抛 `MergeError`，不写入）。默认目标的非空值优先、空的按来源顺序补；`choices`（字段 key → 用哪条的 id）定冲突字段；主字段（名字）、图片也可选；「更多链接」不算冲突，按网址去重合并；类型里已经没有的旧字段同样目标优先补空、不丢。备注拼接：已包含的那段不重复。
  - 数据：`library_item.merged_into`、`person.merged_into`（SQLite 迁移 v5；localStorage / 旧行读入时补 null，写入也总带上）。来源打墓碑 + `merged_into = 目标`，用到来源的任务一次写入里改指目标。读取一律顺着 `merged_into` 解析（`store.itemOf`、`resolveItemId`、`resolvePersonId`、`tasksOfItem`、`libraryEntries` 的用到次数、`peopleOf`、详情的资料行），所以别的设备离线新建、还指着旧 id 的任务同步后立刻显示成目标；`settleMerges()` 在打开时和每次 `applyRemote` 后把这些任务（和人物关联）改写到目标 id（没事做不写）。链式合并（A→B→C）解析到最后一条。
  - 多设备：同时合并同一对 → 两边写的内容一样，LWW 收敛成一条；反方向同时合并（A 并进 B、B 并进 A）可能两条都成墓碑互相指着 → `settleMerges` 把每个环里 id 最小的那条翻回来（各端算出来一样），任务都解析到它。迁移出来的确定 id（`migratedItemId`）如果已经被并掉，旧任务迁移时直接挂到合并后的那条，不复活墓碑。
  - 撤销：返回 `MergeUndo`（合并前的目标 / 来源 / 改指过的任务或人物关联）；`undoMerge` 让目标回到合并前、来源翻回来、改指过且现在还指着目标的任务指回去（是一次新写入，照常同步）。
  - 人物：`task_person` 改指留下的人，同一件任务已经关联了留下的人就把重复那条打墓碑；旧人物类型任务 `type_data` 里写着的人也改过来。
  - 可能重复：同类型里规范化名字相同（`normalizeName`），或任一站点编号（IMDb / 豆瓣，`siteIdOf`）相同，传递成组；每组按用到的任务多 → 建得早排，第一条建议留下。「不是同一个」把组签名（排序后的 id 用 | 连）记进同步的 pref `library.not_duplicates`；组里多了新的一条签名就变了，会重新提示。人物库按名字。
  - 界面：`components/library/MergeSheet.tsx`（`MergeSheet` 并排对比：上面一排卡片选「留下」，下面只列有冲突的字段，每格是那条的值，点一格用它；`MergeIntoSheet`「合并到…」先挑同库另一条；`DuplicatesSheet` 一组一组：不是同一个 / 跳过 / 合并）。资料详情、人物详情的 ··· 里「合并到…」；资料库页工具栏「选择」进入多选（⌘ / Ctrl 点、手机长按也能进），「已选 N 条」+「合并」「完成」；「可能重复 N 组」小链接。合并后提示「已合并到「X」」+「撤销」。`LibraryPicker` 加 `allowCreate`。样式 `styles/library.css` 末尾「资料合并」、皮肤差异 `skin/skins.css`。截图 `work/screens/m4-merge-*.png`。
  - 待 Rei 确认：
    - 「更多链接」合并时两边合起来（不让选）；其余冲突字段让选。
    - 反方向同时合并成环时留 id 小的那条（合并时目标上合出来的字段可能丢一部分，任务不丢）；两边各自留下时（各自的目标都赢了）两条都在、任务对调，下次「可能重复」会再提示。
    - 改写离线任务（`settleMerges`）是整行 LWW：极少数情况下，另一台设备同时在改那件任务的正文，可能被这次改写盖掉（读取本来就会解析，不改写也显示正确）。要更稳可以只在打开时改写。
    - 「不是同一个」记在同步的 pref 里（跟着账户走）。
    - 合并入口只放在资料 / 人物详情的 ···，没放进「编辑资料」弹层（那里没有 ···）。
    - 「可能重复」只认同名和站点编号，不做模糊名字（「沙丘 2」≠「Dune: Part Two」，除非编号相同）。
- 导入导出 Markdown 文件夹。

### M5 项目视角
- SS / FF / SF 与间隔（lag）。
- 关键路径与日期推算（沿前后关系推最早开始，超出组结束时间标红）。
- 甘特图。
- 正文逐字合并（CRDT，取代整段 LWW）。

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
- 类型的海报 / 图标 MVP 只手动上传或贴链接，自动找图以后做，可以吗？
- 谁能登录：只 Rei 自己（`ALLOWED_EMAILS` 白名单，现默认 reiy.leoz@gmail.com），还是开放注册？代码已按白名单可配写好。
- iOS 分发：自用 TestFlight / 开发证书，还是上 App Store？
