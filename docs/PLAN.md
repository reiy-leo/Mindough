# Mindough 计划（v1，2026-10-15）

## 一句话
做一个多端任务管理 app：任务不靠层层分类，靠“做完后接什么”（FS 依赖）串起来；琐事记在流水式的列表里。

## 技术方案
- 平台（MVP 都要能用）：macOS、Windows、iOS、Android、Web。
- 外壳：Tauri 2。一套 React 前端，同时打 macOS / Windows（顺带 Linux）、iOS、Android 的安装包；Web 端是同一份前端的浏览器版，部署在 `app.mindough.rei8t.dev`（2026-10-26 起；`mindough.rei8t.dev` 是介绍页，见「网页版搬到 app 域名」）。
- 前端：TypeScript + React + Vite；UI 用 headless 组件，每端配一套原生风格的皮肤（见“设计风格”）；浅色、深色跟着系统走。
- 存储：数据先存本机，离线能用。原生端用 SQLite，Web 端用 SQLite WASM（存在 OPFS 里）。两端用同一套 schema；前端只写一层数据访问接口，底下按平台换驱动。
- 同步（M2 ✅）：云端数据存在 Turso Cloud（数据库 `mindough`，org rei8，东京 aws-ap-northeast-1）；也可以换成 Cloudflare D1 库 `mindough`，用 Worker 环境变量 `STORAGE_BACKEND` 切（Rei 2026-10-17，见“云端存储：Turso / D1”）；客户端只跟 Worker（同域 `app.mindough.rei8t.dev/api/sync`；老客户端还连 `mindough.rei8t.dev/api/sync`，两个域名是同一个 Worker）打交道，Worker 用 Hrana HTTP 读写 Turso；图片放 R2（`mindough-assets`）。登录用 Google OAuth；原生端先开系统浏览器登录，再用 deep link 跳回 app。见“多端同步怎么做”。
- Markdown 编辑：Tiptap 3（所见即所得，支持任务清单、代码块；2026-10-16 起先用 Milkdown 7，2026-10-25 换成 Tiptap），原文存成 .md 文本。
- 依赖图：React Flow（xyflow）画图 + elkjs 自动分层布局。

### 为什么用 Tauri 2（含移动端）
- Tauri 2 正式支持 iOS / Android，五端共用一套 React 前端和 Rust 后端；移动端的界面跑在系统 WebView 里（iOS 是 WKWebView，Android 是 System WebView）。
- 为什么适合：列表、依赖图、热力图都是 Web 界面擅长的；Rust 后端能直接用 Turso。
- 短板和对策：
  - 移动端插件比桌面少。原生能力（通知、分享、拍照选图）用官方插件，没有的就写 Swift / Kotlin 小插件。
  - 桌面小组件、iOS 主屏小组件、灵动岛计时要原生扩展，放到以后。
  - 后台同步受系统限制，改成回到前台时同步，以后再加推送唤醒。
- 退路：`packages/core`（数据模型、DAG、打卡、同步）保持纯 TS。如果移动端体验不够好，可以换成 Expo / React Native（Turso 有 `@tursodatabase/sync-react-native`），只重写外壳。
- 已看过 MyGo（mygo.egoist.dev）：用 Go 写桌面 app，体积小，但只支持 macOS / Windows / Linux，没有 iOS / Android，不用。

### 设计风格：每个系统用对应的原生风格（Rei 2026-10-15 提）
能做。办法是“一套结构，每端一层皮肤”，不做五套界面。
- 共用的：数据、状态、交互逻辑、页面结构都只有一份；组件用不带样式的 headless 组件（React Aria Components）。
- 每端一套皮肤（启动时按平台选，设置里能手动切）：
  - Apple（macOS + iOS 共用）：SF 字体、HIG 圆角与间距；macOS 侧边栏 + 工具栏 + 窗口毛玻璃（Tauri window-vibrancy），iOS 大标题、底部标签栏、左滑操作、底部弹层。Liquid Glass 只能用 backdrop-filter 做个近似。
  - Windows：Windows 11 / Microsoft Store 那种 WinUI 3 风格（Windows 版 Fluent 2）：Segoe UI Variable、Mica / Acrylic 窗口材质、NavigationView 侧栏、圆角卡片、系统强调色。不用 Fluent UI React v9（那是 Office / Teams 网页的外观）；照着微软的 Windows UI Kit（Figma）和 WinUI 3 的设计令牌自己写皮肤。
  - Android：Material 3（Roboto、动态取色、底部导航栏、FAB、底部弹层、返回手势）。
  - Web：默认跟着访问者的系统走，也能固定一种。
- 移动端可以用 Konsta UI 提速（同一个组件能出 iOS 和 Material 两种外观）。
- 能用系统的就用系统：菜单栏、右键菜单、托盘、通知、选文件都走 Tauri 原生 API，不用网页模拟。
- 代价：界面工作量大约是 1.5 倍。每次改界面，都要在三种皮肤（Web 跟着访问者的系统，用其中一种）× 桌面 / 手机下截图检查。导航结构（侧边栏还是底部标签栏）只按桌面、手机两种布局写，不按五个平台写。
- 所以不用 Kumo：它是 Cloudflare 自己的统一风格，和“各端原生”冲突。

## 前导图（PDM）怎么实现
- 依赖是一张有向无环图（DAG）：表 `dependency(pred_id, succ_id, type, lag)`。
- MVP 只做 FS（完成→开始）。一件任务能有多个前置、多个后续；type / lag 字段先留着，以后加 SS/FF/SF 和延迟。
- 加边时做环检测（DFS），会绕成环就不让加，并提示。
- 任务状态是算出来的：前置都结束了（完成或关闭），就是“可开始”；不然就是“被阻塞”，并显示还差哪几件。
- 任务没有“取消”（Rei 2026-10-15：“任务没有取消之说，只有完成和关闭两种，关闭也完成状态”）。结束态两种：
  - 完成：做成了，算成就（热力图、连续天数、组进度、我的一天“x/y 已完成”）。
  - 关闭：不做了、不需要了。它也算结束：会解锁后续并弹出“解锁了 N 个后续”，不进待办 / 可做 / 搜索的前排，在我的一天里沉到底。但它不算成就：不计入组进度和“已完成”的数，重复任务从关闭那天起不用再打卡，以前的格子留着。界面上不划线，整体变淡，带“关闭”标记，勾选框显示 ×。
  - 两种都能“重新打开”（回到待办，清空 done_at）。M0 存过的“取消”，打开时自动改成“关闭”（改写一次，进 outbox）。
- 完成一件任务时，弹出它的后续任务，提示“已解锁 N 个”；完成时也能一键新建后续（“然后呢？”）。
- 相关任务（Rei 2026-10-15：“任务只是有关系，但没有FS关系”）：表 `task_link(a_task_id, b_task_id, note, created_at)`。没有方向，也不阻塞：不解锁，不进环检测，不影响可开始 / 被阻塞。
  - 去重：两个 id 按 a < b 排好，行 id 由这一对算出（`related.ts` 的 `taskLinkId`，UUID 形状），所以两台设备各自连同一对，得到的是同一行；去掉再连上，就是把同一行的墓碑翻回来。
  - 不能连自己。两件已经有前后关系的，不让再连相关（前后关系已经说明它们有关系）；先连了相关、后来又加了前后关系的，只按前后关系显示（相关那行不删，去掉前后关系后又会出现）。
  - 删任务时，它的相关行一起打墓碑。note 先留着，界面上暂时不能编辑。
- 组有起止时间时，可以顺着依赖链推算最早什么时候开始，超过组的结束时间就标红（后期做，关键路径也一样）。

## 多端同步怎么做（M2 ✅ 2026-10-15）
Rei 的要求：“确实是 SQLite，但有数据写入时能自动同步给其他设备”。现在是这样：每台设备上都有一份完整的本地 SQLite（Web 是 OPFS 里的 Turso wasm，退回 localStorage 时也一样能同步；原生端是 rusqlite），写入先存本地；登录后在后台自动推拉，云端是 Turso Cloud 里的一个库。

- 每条记录 UUIDv7 id、`updated_at`（HLC：`13 位毫秒-4 位计数-设备 id`，按字典序比就能排出先后）、`deleted` 墓碑，不真删。
- 推：本机写入先进 outbox；写完防抖 1.5 秒再推（同一行改了几次，只推最新的值），推成功了才 ack。
- 拉：云端每收下一行，就给它一个新的 seq（每个用户各自递增）。客户端记住拉到的最大 seq（游标），下次只拉比它大的，每页 500 行。拉下来的行用 `Store.applyRemote` 合并，存进本地，但不进 outbox（不会再推回去）。
- 冲突：**行级 LWW**，比 `updated_at`；HLC 末尾是设备 id，毫秒和计数都一样时，按设备 id 定先后，各端算出来的结果一致。云端也用这条规则（`ON CONFLICT … WHERE excluded.updated_at > updated_at`），所以晚推上来的旧改动，盖不掉新的。墓碑也只是一次写入，按同样的规则比：删除比编辑晚就删，编辑比删除晚就留（按行比，不是“删除永远赢”）。任务正文 body_md 整段比，MVP 不做逐字合并。
- 打卡 check_in 只追加（每次一行，新 id）。两台设备离线各打一次卡，合并后进度是两次加起来。
- 前后关系：`Store.edges()` 按 updated_at 顺序一条条加入依赖行，同一对只算一条；加进去会成环的那条（后到的）放进 `Store.conflictEdges()`，不生效（不阻塞，也不参与排布）。详情的「关系」顶上提示「先后关系绕成了圈」和「去掉这条」。两台设备连了同一对，两行算一条，去掉时一起去掉。
- 在一台设备上第一次登录（bootstrap）：
  1. 先把云端的数据全拉下来。
  2. 如果云端已经有数据，而这台设备上只有没动过的演示数据，就给演示数据打墓碑，不推上去。怎么判断没动过：`demo_stamp` 之后没写过东西；M2 之前生成的演示数据，看是不是“全在 10 秒内写入”。
  3. 按 LWW 合并云端，把本机比云端新的行都推上去，本机数据不会丢。
  4. 之后只同步增量。
- 什么时候同步：刚登录时；本机写入后（防抖）；窗口获得焦点或回到前台时；联网时；在前台时每 60 秒一次。都在后台跑，界面从不等它；离线照常用，联网后自动补上。
- 退出登录：只停同步，本机数据原样留着。登录同步时不能「重置演示数据」，因为会影响其他设备；退出后再重置，会清掉同步游标，下次登录重新合并，云端的数据会回来。
- 状态（设置 → 账户）：已同步 · 刚刚 / 正在同步… / 离线，联网后自动同步 / 同步出错（带 HTTP 状态码中文说明）+ 重试；凭据被拒（401 未登录 / 403 无权限）时按钮变「重新登录」。另有「立即同步」。
- 服务端按 user_id（登录邮箱，小写）把各人的数据分开；Web 端和原生端用同一个账号。

### 同步引擎选型（Rei 2026-10-15 定 A：Turso Sync；实现时的取舍）
Rei 选了 A（Turso）。真正做的时候，用的是 **Turso Cloud 当云端存储，加上自己的 outbox / 游标协议（走 Worker）**，没直接用 Turso Sync 的客户端 SDK（`@tursodatabase/sync-wasm` / Rust `turso` crate 的 sync）。2026-10-15 的实测和原因：
- SDK 本身能用：`@tursodatabase/sync@0.8.3` 在 node 里对 Turso Cloud push / pull 成功。但它是**“最后推送者赢”**：实测设备 B 用更旧的 `updated_at` 改同一行后推送，A 拉下来是 B 的旧值——和我们要的“按 updated_at 行级 LWW”相反（可以用 `transform` 钩子改写成带条件的 upsert，但下面几条更难绕）。
- 它同步的是**整个数据库文件**（物理页 + 本地改动回放）：只属于本机的 `meta`（device_id、游标）和 `outbox` 会让云端版本盖掉；建表、`ALTER TABLE` 也会跟着同步，离线设备回放同一条 `ADD COLUMN` 会失败，把拉取卡死，以后加迁移很危险。
- Safari / iOS / macOS 的 WKWebView 没有 `COEP: credentialless`，跑不了 wasm 引擎（Web 端在 Safari 上本来就退回 localStorage），Apple 端只能换 Rust `turso` crate 重写原生存储层并实测移动端交叉编译。我们的协议是纯 TS，localStorage、rusqlite、OPFS 三种存储都能同步，Rust 侧不用动。
- 鉴权：Turso Sync 要把数据库 token 交给客户端；Turso 的 token 只能经 Platform API（org 级权限）或长期 token 签发，没法在 Worker 里不带 Platform API token 就签短期 token。现在数据库 token 只放在 Worker 的密钥里，客户端拿到的是 Worker 签发的 1 小时同步凭据，只能读写自己的行。
- 留的路：core 的 `SyncTransport` 接口和 `SyncEngine` 跟存储无关。以后 Turso Sync 成熟了（按逻辑行处理冲突，DDL 不跟着同步），可以换过去；云端数据本来就在 Turso。
- 备选：B 自建 Worker + D1——2026-10-17 已做成可切换的第二个后端（见下“云端存储：Turso / D1”），默认仍是 Turso；cr-sqlite；PowerSync（需要 Postgres）。

### 云端（Turso `mindough`）
- `sync_row(user_id, tbl, id, updated_at, deleted, data, seq)`，主键 (user_id, tbl, id)，索引 (user_id, seq)；`data` 是整行 JSON，云端不管业务列，所以客户端加列、加表都不用改云端。
- `auth_code(code, payload, challenge, expires_at, used)`：原生端一次性登录码（5 分钟）。
- `server_schema`：云端迁移版本；Worker 第一次用到时自动执行迁移（`apps/server/src/sync.ts` 的 `SERVER_MIGRATIONS`，只追加）。
- Worker 密钥：`TURSO_DB_URL`、`TURSO_DB_TOKEN`（全权限数据库 token，只在 Worker 里，不进仓库、不给客户端）。
- 接口：`POST /api/sync/token`（会话 → `{ url, token, expires_at }`，401 未登录 / 403 无权限 / 503 服务不可用）、`POST /api/sync/push`（`{ rows }` → `{ applied }`，单次最多 500 行、单行 ≤ 2 MB）、`POST /api/sync/pull`（`{ cursor, limit }` → `{ rows, cursor, more }`）。

### 云端存储：Turso / D1（Rei 2026-10-17）
Rei：「settings中的这个google登录写清楚数据流向，先经过worker认证是你自己，再存到turso中，也可以选择存在D1中」，随后改成「这个切换数据库用环境变量切换」。也就是不在界面上选，服务端也不记“选了哪个”，由 Worker 的环境变量决定。默认还是 Turso（Rei 2026-10-16 定过云端先继续用 Turso），线上部署保持 `turso`。
- 存储层：`apps/server/src/sql.ts` 定义 `SqlDb { execute, transaction }`；`turso.ts` 的 `tursoDb`（Hrana HTTP）、`d1.ts` 的 `d1Db`（Worker 绑定 `DB`，事务用 D1 batch，整批原子）和 `d1RestDb`（Cloudflare REST API，迁移脚本用）；`storage.ts` 的 `openDb(env)` 按 `STORAGE_BACKEND` 选。同步协议、`SERVER_MIGRATIONS`、upsert / RETURNING SQL 两边完全同一份；auth_code（原生端登录码）也跟着后端走。
- `STORAGE_BACKEND`：没设或 `turso` → Turso；`d1` → D1；别的值 → 503 服务不可用（不悄悄换回默认，免得两边数据对不上）。写在 `wrangler.deploy.jsonc` 的 `vars` 里（git 里看得到；`keep_vars` 只保留配置里没写的控制台变量）。
- D1 库：`mindough`（id `eb0e708a-8764-42fe-a41c-13c9906f16fe`，APAC，账户 9151f72e…）2026-10-17 建好、云端 schema v1 已应用、`sync_row` 是空的；绑定名 `DB`。
- 只读显示：`GET /api/health` 和 `POST /api/sync/token` 的响应带 `storage: 'turso' | 'd1'`（写错了 health 报 `null`）；设置 → 账户卡最后一行「数据怎么走」显示当前库名和流向（文案见 COPY.md）。
- 切换步骤（手动，Turso → D1；反向把 turso / d1 对调）：
  1. 复制并核对：`cd apps/server && TURSO_DB_TOKEN_FILE=<数据库 token 文件> CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… pnpm storage:copy -- --from turso --to d1`（先加 `--dry-run` 看源库有多少行；Hark 沙箱里 Node 要走代理，前面加 `NODE_USE_ENV_PROXY=1`）。脚本 `scripts/copy-storage.ts`（核心 `src/copy.ts`）：在目标库应用迁移 → 目标库已有同步数据就 409 冲突停下（确认要覆盖目标库加 `--replace`，只清目标库）→ 按主键翻页全量复制 `sync_row`（原样保留 seq，各设备的拉取游标切换后照样能用）→ 核对总行数、每个用户的行数与最大 seq、每张表的行数、逐行摘要（user/tbl/id/updated_at/deleted/seq/data 的 SHA-256）。任何一项对不上就以退出码 1 结束，提示“不要切换”。源库只读，从不删改。
  2. 把 `wrangler.deploy.jsonc` 的 `STORAGE_BACKEND` 改成 `d1`，提交并 `pnpm deploy`。
  3. 打开 `/api/health` 看 `storage` 是不是 `d1`，设置页库名跟着变。
  - 复制和切换之间不要有设备往旧库写：那几行不在新库里，而且新库会从旧的最大 seq 往上重新编号，已经拉到更大游标的设备会漏掉这些编号的新行。所以在没人用的时候做，复制完马上切；担心的话切换前再跑一次 `--replace` 复制。
- 测试：`apps/server/test/storage.test.ts`：STORAGE_BACKEND 解析与写错 503、D1 存储层（Miniflare 的本地 D1：编号参数、batch 原子回滚、迁移可重复）、同步 API 整套跑在 D1 上（push / pull / LWW / 游标 / 原生登录码，不发任何网络请求）、Turso ⇄ D1 双向复制（seq / 墓碑 / 中文原样、源库不变、409 与 --replace、--dry-run 不写、丢行和改值都能核对出来）。

### 原生端登录（Tauri）
- 「用 Google 登录」→ app 生成 verifier，用系统浏览器打开 `/auth/login?native=1&challenge=base64url(SHA-256(verifier))` → Google → Worker 发一次性登录码，结果页（“已登录，回到 Mindough 继续”）跳回 `mindough://auth?code=…` → app `POST /auth/exchange { code, verifier }` 换成会话（30 天），存本机，之后请求带 `Authorization: Bearer`。别的 app 就算截到 deep link，没有 verifier 也换不走；码只能用一次。
- Tauri 插件：opener（系统浏览器）、deep-link（`mindough://`，桌面与移动端都注册）、桌面端 single-instance（带 deep-link 特性：Windows / Linux 再开一个进程时把链接交给已开着的窗口）。Worker 给 `tauri://localhost`、`http(s)://tauri.localhost` 开 CORS。
- 状态：代码写完了，`cargo check`（Linux）能过，Worker 端有单测；**还没在真机上试过**（要打包安装后点一次登录）。`rust-ini` 锁在 0.21.1（0.21.3 给 `ParseOption` 加了字段，deep-link 2.6.2 编译不过）。

### 图片（R2）
- `POST /api/assets`（会话或同步凭据，image/*，≤ 10 MB）存进 R2 桶 `mindough-assets`，key = 用户邮箱哈希前 16 位 / 内容 SHA-256（同一张图只存一份）；`GET /api/assets/<key>` 公开读、长缓存（key 猜不到）。
- 客户端上传图片时：登录且在线 → 传 R2，asset 行只存地址（`url`、`r2_key`、`sha256`）；离线或没登录 → 还是存 data: 地址（照样同步，只是行大一些）。以前存的 data: 图片暂时不自动搬到 R2（以后做）。
- 附件（2026-10-17）另走 `POST /api/files`（任何格式，≤ 50 MB）/ `GET /api/files/<key>`（要登录、只能读自己的），同一个桶，key = 用户哈希 / `f` / SHA-256，见下面「附件」。

### 风险与缺口
- 每用户 seq 用 `MAX(seq) + 1` 在事务里算，依赖单写者串行（Turso 与 D1 都是）；以后要是开 `BEGIN CONCURRENT`，就得改成计数表。
- 行级 LWW：两台设备离线改同一件任务的不同字段，只留晚的那次（整行）。字段级合并以后再说。
- 旧版本客户端不认识的新列：拉下来能存（JSON 里有），但旧版本改这一行再推，会丢掉新列的值。
- 同步凭据 1 小时、会话 30 天；会话用 HMAC 签名，服务端不存状态；泄露了只能换 `SESSION_SECRET` 让它失效。
- Turso 免费档（starter）；2026 年 Turso 宣布加入 Supabase，留意产品走向。

## 任务类型（显示变体 + 创建模板）
任务可选一个“类型”。类型决定两件事：在列表、组、依赖图节点里怎么显示（显示变体），以及新建时给出什么模板（要填的字段 + 预填的 markdown 正文）。正文仍是 markdown、仍无标题。
- 默认类型“普通”：就是一段没有标题的 markdown 文本，无字段、无模板，显示正文首行，新建即写。
- 内置类型（先做这些，均可修改、复制、归档；类型不能删，Rei 2026-10-17）：

| 类型 | 显示 | 字段 | 正文模板 |
|---|---|---|---|
| 影视 | 竖版海报 + 片名 | 片名、海报、年份、电影/剧集、季集进度、平台 | 想看理由 / 观后感 |
| 游戏 | 方形图标 + 游戏名 | 游戏名、图标、平台、进度（%） | 目标 / 心得 |
| 书籍 | 书封 + 书名 | 书名、封面（只能手动上传 / 粘贴）、作者、出版社、出版年份、ISBN、页数、页数进度 | 摘录 / 笔记 |
| 项目 | 项目图标 + 项目名 | 项目名、图标、仓库或链接 | 目标 / 下一步清单 |
| 课程 | 图标 + 课程名 | 课程名、平台、链接、课时进度 | 笔记 |
| 旅行 | 横幅照片 + 目的地 | 目的地、照片、出发/返回日期 | 行程 / 待办清单 |
| 购物 | 商品图 + 名称 | 名称、图片、价格、链接 | 备注 |
| 餐厅 | 照片 + 店名 | 店名、照片、地址、链接 | 想吃什么 / 评价 |
| 饮食 | 菜品照片 + 菜名 | 菜名、照片、餐次、食材清单 | 做法 / 感受 |
| 人物 | 头像 + 姓名 | 人物（从人物列表选）、事由 | 要聊什么 / 备注 |

- 资料库（2026-10-15 加，见下“资料库”）：每个类型的字段分 资料字段（属于这部片 / 这本书）和 任务字段（属于这一次）；资料存在资料库里，任务引用它。
- 人物列表：独立的一张人物表（姓名、头像、关系、生日、备注 md）。“人物”类型的任务显示对方头像 + 姓名；任何任务也可以关联多个人物，在卡片上显示小头像。人物详情页列出与 TA 相关的所有任务。
- 自定义类型：选一种版式（海报 / 图标 + 名称 / 横幅 / 纯文字），定义字段（文本、数字、进度、日期、链接、图片、单选、人物），写一段正文模板，配名称、图标、颜色。内置类型走同一套机制，不写死特例。
- 新建任务时挑资料（2026-10-28 前是先选一个类型）；项目可设默认资料库，项目里新建时资料面板先打开它。
- 资料和类型（2026-10-28 起，docs/MULTI-TYPE.md）：任务不再「改类型 / 换资料库」，直接挂资料，能跨库挂好几条；类型能挂好几个，和资料互不相干，换类型不动资料。
- 图片：本地上传或粘贴链接；原生端存本地文件，同步时上传到 Cloudflare R2，D1 只存引用。
- 按名称自动找图和资料（影视 TMDB、游戏 Steam/IGDB、书籍 Open Library）放在 M4，展示时附来源。

## 资料库（Rei 2026-10-15：“可以添加影视库、书库、项目库、游戏库、课程库等等，这样不用每次都添加这些资料而是可以选，如果没有再新建”）
- 每个非“普通”的资料库（代码里叫类型）有一个库，自定义的自动有库。一件任务能挂好几个库里的资料（2026-10-28 起，见下面「多类型与多资料」）。库名（界面）：影视库、书库、游戏库、项目库、课程库、目的地、好物清单、餐厅库、菜谱、人物；写在 `library.ts` 的 `LIBRARY_COPY`。
- 表 `library_item`：id（UUIDv7）、type_id、name（= 主字段：片名、书名…）、image（图片字段：asset id / 外链 / data URL）、fields（JSON，其余资料字段）、note_md、created_at、updated_at（HLC）、deleted 墓碑。task 加 `library_item_id`（可空；2026-10-28 起是第一条资料，全部资料在 `task_item` 表）。一条资料可以给多件任务用（重看一遍、再去一次）。
- 字段定义 `FieldDef.scope`：`item`（默认，资料字段）/ `task`（任务字段）；主字段和图片字段总是资料字段。任务的 `type_data` 只存任务字段；显示时 `Store.taskData()` = 资料展开 + 任务字段（同名以任务为准）。
- 内置类型拆分（资料 → 任务）：影视 片名·海报·年份·电影/剧集·平台 → 看到哪；书 书名·封面·作者·页数 → 读到第几页；游戏 游戏名·图标·平台 → 进度 %；项目 项目名·图标·链接 → （无）；课程 课程名·图标·平台·链接 → 学到第几课；旅行 目的地·照片 → 出发 / 返回日期；购物 名称·图片·价格·链接 → 买几件；餐厅 店名·照片·地址·链接 → （无）；饮食 菜名·照片·食材清单 → 餐次；人物 人物（person 表）→ 事由。
- 人物库 = person 表（不迁移，风险大）：`Store.libraryEntries(typeId)` 把资料和人物统一成 `LibraryEntry`（kind item / person），选择框、资料库页、⌘K 用同一套；人物详情仍在 `#/people/:id`。
- 内置类型改定义：`BUILTIN_TYPES_REVISION` 版本戳（`0000000000000-0001-builtin`）。打开时，存着的内置类型若仍是更早的内置戳（用户没改过）就换成新定义；用户改过的（真实 HLC）不覆盖，只在内存补上各字段的 scope，并补上新定义新增、它还没有的字段（按 key，插在新定义里前一个字段之后；不改写、不进 outbox）——这样 r2 的 IMDb / 豆瓣 / 更多链接对改过类型的人也有。比当前内置戳更新的内置戳（别的设备已升级）不降级。
- 迁移（`Store.migrateToLibrary()`，每次打开都跑，无事可做时是空操作）：资料直接写在 type_data 里、没挂资料的旧任务 → 按 类型 + 规范化名字（NFKC、小写、去空白和标点）去重，先找库里已有的，没有就新建；同名的后来者只补空缺；任务改为引用资料、type_data 只留任务字段。迁移出来的资料用确定性 id（类型 + 规范化名字的哈希，UUID 形状），两台设备各自迁移得到同一条，同步时自然合并。没填主字段的、人物类型的、普通任务不动。SQLite：迁移 v2（建 library_item、task 加列与索引）；localStorage：旧 JSON 没有新表 / 新字段时在内存补空。
- 新建 / 改类型：`createTask` 时若 type_data 里写着名字（旧调用方式、⌘K 等），自动找同名或建资料挂上；挂 / 去资料走 `toggleTaskRef` / `setTaskItems`（2026-10-28 起；原来的 `changeTaskType`、`setTaskItem` 删了）。删除资料：用到它的任务不删，把资料抄回各自 type_data 再解开引用。
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
- journal_entry（日记，SQLite 迁移 v6，Rei 2026-10-17）：id（由日期算：`journalEntryId`）、date、body_md、mood（心情英文 id，可空）、base_at（这一版是在哪一版别的设备写的内容上改的，同步保护用）、created_at
- 依赖可以跨组。

## 视图（MVP）
0. 我的一天：今天打算做的任务清单，打开 app 的首页。旁边是「待安排」：还没定哪天做的事（M3 加）。
   - 任何地方都能加入：搜索结果、列表、组、组里的依赖图节点、人物详情、打卡页，右键 / 长按 / 悬停按钮“加入我的一天”，快捷键可一键加。
   - 全局搜索（⌘K / Ctrl+K）：搜正文、类型字段（片名、店名…）、人物、组；结果项直接带“加入我的一天”按钮。
   - 每天零点清空（按本机时区），没做完的不自动顺延，放进“昨天没做完”区一键带回今天。
   - 建议区：今天到期的、今天要打卡的、刚解锁可以开始的任务，点一下就加进来。
   - 可拖动排序；完成的沉到底部。
1. 列表（Agenda 式）：按日期往下流的时间线，今天居中，过去在上、将来在下；琐事随手记，不用建组。
2. 组：组卡片（名称、图标、起止、分类、进度），点开看组内任务列表 + 组内依赖图（组页的「关系图」视图）。
3. 人物：人物列表（头像 + 姓名），点开看相关任务
4. 依赖图：按组看 DAG（组页的「关系图」视图），拖线连依赖，颜色区分 完成 / 可开始 / 被阻塞。全局关系图页 2026-10-23 删掉（Rei：「侧边栏的Graph选项卡并不是我想要的」），换成详情里的「任务链」（原叫「整条线」，见下）。
5. 可做清单：所有“可开始”的任务，按组和日期排。
6. 打卡：今天要打卡的任务、正在计时的任务、倒数日，一屏看完。样式照 GitHub contribution graph（活动热力图）：
   - 顶部一张总热力图：过去一年，每天一格，颜色深浅 = 当天完成的打卡数占应打卡数的比例；悬停/长按看当天明细。
   - 每个重复打卡任务一行：连续天数 + 今日操作按钮（勾 / 开始·结束 / +1）。迷你热力图（活动图）2026-10-25 起默认收起，点卡片左上角圆点才在下面整行展开，见「打卡卡片的活动图收进圆点」。
   - 计量与计时按达成比例分 4 档深浅（0、<50%、<100%、达标）；颜色跟随任务类型颜色，明暗主题各一套。
   - 窄屏（手机）默认显示最近 16 周，可横向滑动看全年。
   - 格子严格正方形（宽高相等，不随容器拉伸），直角或极小圆角。
   - 每月 1 号那一格做标记：格子够大（桌面）时在格内显示月份数字（如“3”），格子小（手机）时显示一个小圆点；设置里可固定选“数字 / 圆点 / 不标”。
- 全局：快速新建（快捷键）、⌘K 搜索（可直接加入我的一天）、按分类筛选。
- 任务详情不是弹窗（2026-10-23 起）：桌面三列「侧边栏 | 当前视图的列表 | 任务详情」，手机整页推入，见下「三列布局」。

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
- ✅ Markdown 编辑换成 Milkdown（所见即所得），见 M3-2；2026-10-25 又换成 Tiptap，见「编辑器换成 Tiptap」。

### M1b ✅（2026-10-15）：新建与详情重做 + 文案（Rei：“功能都有，但让人厌恶……完成方式在新建时就要让用户选，而且用词很粗糙”）
- 新建和详情拆开。新建面板（TaskComposer）：一个大的无边框内容框（「要做什么？」，自动聚焦，无标签无编辑/预览页签，Markdown 写法只在 ? 悬停提示里）；下面一排属性胶囊（类型 / 日期 / 组 / 和谁有关，点开是弹层，设了显示值）；「怎么算完成」四张卡片（名称 + 一句话例子，默认勾选完成），选中后只出现它自己的一句话设置（每次 [10] [分钟] / 目标 [8] [杯] / 目标日期 [..]，到时显示 还有 N 天）；「多久一次」只做一次 / 定期打卡 → 每天 / 每周[一…日] / 每月 [15] 号 / 每 [3] 天，定期时出打卡分类网格。选了非普通类型才出现该类型的字段，类型可带默认完成方式（用户手动挑过就不改）。没有状态、没有删除；主按钮「添加」（⌘/Ctrl+Enter），取消或 Esc。从侧边栏新建且无组无日期的仍自动进我的一天；建好后提示里可「查看」。“然后呢？”/「新建下一步」打开同一个面板，带“做完「X」之后”，建好自动连上。
- 详情（TaskDetail）：内容在前（排好版的 markdown，点一下就地编辑，Esc 收起）；状态用操作按钮——主操作随完成方式变（完成 / 开始计时·暂停·结束 / +1 杯 / 打卡），「关闭」（重复任务叫「不再打卡」）2026-10-17 起挪进顶栏 ··· 菜单（见下面「「关闭」挪进 ··· 菜单」那条），底部只放主操作，结束后底部只剩「重新打开」，顶部徽章显示 已完成 / 已关闭 / 还在等 N 件事 / 进行中；计时、计数、倒数日、定期打卡有一块进度（环 + 数值 + 连续次数）。右侧（手机在内容下方）属性列表：类型、完成方式、重复、打卡分类、日期、组、和谁有关，点值弹出编辑。「前后关系」分「先做完这些」「做完后解锁」，各有「添加」（可搜索）和「新建下一步」。删除放进 ··· 菜单并确认；加入 / 移出我的一天是顶部的太阳图标（菜单里也有）。
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
- ✅ 引擎：Rei 定 A（Turso）；做成了 Turso Cloud + 自己的 outbox / 游标协议经 Worker（原因见“同步引擎选型”）。core `sync/`：`SyncEngine`（防抖推送、游标拉取、第一次登录的合并、演示数据不带上去、状态）、`SyncTransport` 接口、`MemoryRemote` 假云端；Store `applyRemote` / `onLocalWrite` / `raw` / `conflictEdges`；适配器 `applyRemoteChanges`（不进 outbox）。
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
   - （2026-10-25 已换成 Tiptap，读写仍用 remark，见下面「编辑器换成 Tiptap」。下面是当时的选型。）选 **Milkdown 7**（不选 TipTap）：它本身就是 markdown 原生的——remark 解析 ↔ ProseMirror 文档 ↔ remark 序列化，存进去、读出来就是 markdown，往返保真（`milkdown.test.ts` 覆盖标题 / 清单 / 表格 / 删除线 / 链接 / 代码 / 引用 / 空清单项）；TipTap 的 markdown 要靠社区扩展转换，往返会丢东西。GFM 预设直接带表格、清单（`- [ ]`）、删除线、自动链接。headless、不带样式，排版沿用 `.md`，三种皮肤只改令牌（清单勾 Apple 圆形 / WinUI · Material 圆角方形）。
   - 用在：任务详情的内容（点进去就能改，Esc 收起）、资料 / 人物备注、**新建面板的内容框**（不带工具栏的轻量版 `toolbar="none"`：只靠写法变样子，`# `、`- [ ] `、`**粗体**` 打出来就排好；字号同以前 18px；Esc 关面板、⌘/Ctrl+Enter 添加照旧）。编辑器约 140 KB（gzip）按需加载，启动后空闲时预加载，新建面板一打开就能写。
   - 详情和备注编辑时下方出现格式工具栏（标题 / 粗体 / 斜体 / 删除线 · 清单 / 列表 / 编号列表 / 引用 / 代码 · 链接 / 表格），按钮不抢焦点，悬停提示带快捷键，⌘K 加链接；点清单的勾直接切换。（2026-10-25 工具栏去掉了，见「编辑器去掉工具栏」。）
   - ✅ 链接能改了（Rei 2026-10-17：「放上去就展示吧，点一下是访问链接」）：编辑器里点链接 = 打开（Web 新标签页 noopener，App 经 `lib/external.ts` 的 `openExternal` 交给系统浏览器；mousedown 不放光标、不进编辑；全局外链拦截跳过编辑器里的链接，免得开两次）。鼠标移到链接上出小浮层（`.md-link-pop`）：原地址（省略号，可点）+「编辑」（浮层里改，预填原地址，回车保存）+「去掉链接」，鼠标能移进浮层，移开 250 毫秒收起。触屏没有悬停：点按仍是打开，长按选中链接里的字（光标 / 选区落在链接里，编辑器有焦点时）出同一个浮层——选这个而不是「第一次点放光标、第二次打开」，因为 Rei 要的是「点一下是访问」。⌘K / 工具栏链接按钮在已有链接里：输入框预填原地址，按钮变「保存」，旁边多「去掉链接」。更新逻辑：按 link mark 的连续范围 removeMark + addMark（`setLinkTr`，保留 title），不再用 toggleLinkCommand（它对已有链接会去掉）；选中普通文字加链接也改成 addMark。
   - ✅ 链接的文字和网址一起改（Rei 2026-10-17：「编辑器中链接要支持编辑名称和链接」）：浮层「编辑」、工具栏链接按钮、⌘K 开同一个链接框，两栏「文字」「链接」。**形式按 Rei 定的**：桌面 = 那个悬停浮层原地展开（锚在链接旁；新加时锚在光标 / 选区处），不是居中弹窗；触屏（最后一次是触摸 / 笔，或 `(hover: none) and (pointer: coarse)`）= 底部弹出面板 `.md-link-sheet`（遮罩点一下取消；`visualViewport` 算键盘高度把面板抬上去，没键盘时留 `safe-area-inset-bottom`；输入框 44px 高、16px 字防 iOS 放大）。预填：在链接里 = 原文字 + 原地址，焦点在「文字」；选了字 = 文字预填（选的字本身像网址就顺手填进「链接」），焦点在「链接」；空光标 = 都空。保存（`applyLinkTr`）：文字没改只换地址（保留链接里的粗斜体），改了就整段换成新文字（带第一个字的格式）；文字空着用网址当名字；跨段落的选区文字不能改、只加链接；保存后光标在链接后面，接着打的字不进链接（storedMarks 去掉 link）。网址规范（`normalizeHref`）：去两头空白、中间空格编成 %20、没协议补 https://、`//` 开头补 https:、mailto: / tel: / 站内 `#/…` 照原样，javascript: / data: / vbscript: 不收，http(s) 主机名要带点（或 localhost / IP），不像就在框里红字「这不像网址，检查一下」（空着「填一个网址」）、框不关。回车保存（输入法选字的回车不算：isComposing / keyCode 229），Esc 取消（不冒泡关详情弹窗），Tab / Shift+Tab 只在两栏和按钮间转；点框外面 = 取消。开框前先 `domObserver.flush()` 读进刚改的选区（按 Shift + 方向键后马上按 ⌘K 会读到旧选区）。工具栏里原来的单栏链接输入框去掉了。WinUI 浮层 / 面板用实色 `--popup-bg`（`--surface` 半透明，下面的工具栏会透上来）。测试 `components/editor/link-edit.test.ts`（规范网址、改文字和网址、保留粗体、留空用网址、网址不对不改、新加、含括号 / 空格网址 + 含方括号 / 星号的中文文字往返稳定、跨段落）；截图 work/shots-linkedit/（脚本 work/shots-tool/le-link2.mjs）。
   - ✅ 手打即时渲染逐项查过（Rei 2026-10-17，真实 Chromium 里一个字一个字打）：标题 # ~ ######、**粗**、*斜* / _斜_、~~删~~、`行内代码`、``` 代码块（回车或空格）、> 引用、- / * / + 列表、1. 编号、- [ ] / - [x] 清单、--- / *** 分隔线、|3x2| 空格 本来就行；补了四个：`[文字](网址)` 打完右括号变链接（网址缺协议补 https://，`[](网址)` 用网址当文字，也认全角括号，`![…](…)` 图片语法不碰，代码里不转）、`<网址>`、裸网址后打空格（末尾标点不算，www. 补 https://）、一行 `|a|b|` 回车变表格（这行当表头，下面一行空的，光标进第一格；`|---|` 分隔行、列表 / 引用里不转）。检查脚本 `work/shots-tool/le-syntax.mjs`。
   - ✅ 修：列表里 Tab 让焦点跑出编辑器（Rei 2026-10-17「ul ol 还是用 tab 缩进会 unfocus 整个编辑器」）：缩进其实做了（Milkdown 列表 keymap 的 Tab → sinkListItem），但详情是弹层，React Aria FocusScope（contain）在 document 上自己接 Tab 挪焦点，不看 defaultPrevented；happy-dom 单测里没有弹层所以测不出来。改为编辑器根节点上拦下 Tab 的冒泡（preventDefault + stopPropagation），测试里断言 document 收不到 Tab。
   - 去掉了备注标签旁的「支持 Markdown」小字（写的时候就是排好的样子，用不着说）；新建面板的 ? 提示改成「直接这样写，会自动排好版：」。
   - 修：详情第一行的标题样式漏到了整段（`.detail-md > :first-child` 套到了编辑器外壳上），小标题比正文大一点（h1 19 / h2 17）。
   - ✅ 网络图片不渲染（Rei 2026-10-17：「编辑器的网络插图」「编辑器不渲染网络图片」；先误解成去掉资料图片框的「粘贴图片链接」，Rei 澄清后改回，那个照留）：判断在 `lib/remote-image.ts`（http(s) 和 `//` 开头算网络图片；`data:` / `blob:` / 相对路径 / `https://app.mindough.rei8t.dev/api/assets/…`、旧的 `https://mindough.rei8t.dev/api/assets/…` 和同源的 `/api/assets/` 是自己的图，照常显示）。编辑器里覆盖 image 节点视图（`components/editor/remote-image.ts`，`$view`）渲染成 `span.md-remote-image`（alt，没有就网址；title 是网址），不建 `<img>`；只读预览（`lib/markdown.ts` 的 marked image 渲染器）同样处理（编辑器加载前的占位也是它）。markdown 原文不动，往返一致；粘贴 markdown / HTML 也不加载（ProseMirror 和 Milkdown 剪贴板都在惰性文档 / template 里解析）。不迁移旧数据；导出时正文里的网络图片仍照旧去取回打包（`remoteImageUrls`），没改。
   - ✅ GitHub 扩展语法（Rei 2026-10-17 截图：引用块里原样显示「[!NOTE]」和「$O(n)$」）。编辑器 `components/editor/gh-syntax.ts`，只读 `lib/markdown.ts`，共用 `lib/gh-alerts.ts`（标记、标题、图标）、`lib/math.ts`（KaTeX 加载、GitHub 公式规则）。markdown 原文不变：
     - 提示块 `> [!NOTE]` / `[!TIP]` / `[!IMPORTANT]` / `[!WARNING]` / `[!CAUTION]`（大小写不敏感、标记独占第一行，同 GitHub）：编辑器里是 `gh_alert` 节点（attrs kind + marker 原样大小写；标题图标不可编辑），remark 读入时把引用块改成 ghAlert，写出还原成引用块、标记用 html 节点原样输出（不被转义成 `\[`），和下一块之间不空行（toMarkdown join）。旧编辑器把 `[!NOTE]` 存成了 `\[!NOTE]`，两边都照样认，编辑器写回时改成 `[!NOTE]`。手打：`> ` 变引用后打 `[!note]`，打完 `]` 就是提示块。标题中英：注意 Note / 提示 Tip / 重要 Important / 警告 Warning / 小心 Caution；颜色是每个皮肤 × 明暗的 `--alert-*` 令牌，Apple / Material 整块浅色圆角、WinUI 细边框（skins.css），通用是左色带。
     - 数学公式 KaTeX 0.19（JS、CSS、字体都打包在应用里，不走 CDN；只读显示里用到才按需加载，没加载完先显示源码）：行内 `$…$` / `$$…$$`、块级 `$$` 独占行、```math。是不是公式按 GitHub 规则：开头 $ 后紧跟非空白、结尾 $ 前非空白、结尾 $ 后不是数字——「$5 和 $10」「$5和$10」「$ x $」都不算。编辑器读入用 micromark-extension-math，再按这条规则把不像公式的还原成文字；只读用自写的 marked 扩展，配对方式和 micromark 一样（不成立的那一对整段当文字，后面那个 $ 不再拿去开头），两边结果一致。写出：文字里的 $ 不转义（以前的「$5」不会变成「\$5」），只有读回来会被当成公式的那一对才加反斜杠；行内公式照原来的 $ 个数。编辑器里 `math_inline` / `math_block` 节点存源码，平时显示 KaTeX，光标进去（点它；←/→、退格挨着它）显示源码可改、块级下面实时预览；手打 `$x$` 收尾即变，紧接着打数字（`$5$1`）变回文字；一行 `$$` 回车（或 `$$ `）开公式块，块里最后一行打 `$$` 回车结束；光标离开时空的行内公式删掉。
     - 其他 GitHub 语法核对：脚注 `[^1]` 编辑器（Milkdown gfm 自带，补了样式）和只读（加 marked-footnote，跳转在卡片里滚动、不改地址栏的 # 路由）都显示；表格对齐编辑器本来就对，只读以前被 `.md th, td { text-align: left }` 盖掉了，修了；任务清单、删除线、自动链接本来就行（编辑器写回时 `www.x.com` 会变成 `[www.x.com](http://www.x.com)`、表格补空格对齐，是 Milkdown 原有行为，没动）；`<details><summary>` 只读里能折叠（DOMPurify 放行）——编辑器里后来也做了，见下面「折叠块」。
     - ~~顺带发现：Milkdown 给根节点加 class `editor` 撞上 app.css 的 `.editor`~~ → 已修，见下一条。
   - ✅ 编辑器块间距收紧（Rei 2026-10-17）：原因是 Milkdown 给 ProseMirror 根节点加 class `editor`，撞上 app.css 里的 `.editor`（flex 竖排 + 16px gap，2026-10 早期新建面板用过的类，`8648218` 起已经没有组件用它），块与块之间多 16px，而且 flex 里外边距不合并。删掉了那条死样式（全库查过没有别的 `.editor` 用法），编辑器又是普通块排版，间距只靠 `.md` 的外边距（段落 / 列表 4px、引用 / 折叠块 6px、提示块 / 公式块 / 表格 / 代码 8px、详情里小标题上 16px 下 4px），和只读显示一致。上一轮给提示块 / 公式块去外边距的特例删了。editor.css 里留了注释：别给裸 `.editor` 写样式。编辑器加载前的占位预览也加上 `md-editor-content`，加载完不跳。
   - ✅ 折叠块 `<details>`（Rei 2026-10-17）：`components/editor/details.ts`。
     - 读入：remark 插件（排在 gh-syntax 后面）在每一层里找以 `<details` 开头的 html 节点（Milkdown 的 remarkHtmlTransformer 已经把块级 html 包进了段落，两种都认），按 `<details>` / `</details>` 数层数找配对结尾：一个 html 节点写完的（一行，或中间没空行），把里面的正文用同一个 remark 再读一遍（再跑公式规则和提示块）；多行写法（开头 html、中间普通块、结尾 `</details>` 的 html）把中间的块收进来。都收成 mdast `details`（attrs 原文、summary 文字、是否一行写完）。没有结尾的照旧当 HTML，不吞后面的字。
     - 节点：`details`（content `details_summary block+`，attrs：`attrs` 原样属性如 ` open`、`inline`、`hasSummary`、`expanded`）+ `details_summary`（纯文字一行，不带格式）。节点视图：不可编辑的三角按钮（`.md-details-toggle`，`aria-expanded`，读屏「展开折叠块 / 收起折叠块」）+ contentDOM；收起时 CSS 藏掉标题以外的块。
     - 展开状态：决定**不写回 markdown**，放在节点 attr `expanded` 里（不进撤销历史、序列化不读它）。理由：点开看一眼不该算改了正文——正文是整段后写赢同步，白白算一次改动可能冲掉另一台设备上的真改动，也会让 markdown 来回多出 / 少掉 `open`。原文的 `open` 属性原样保留，只决定打开时默认展开（只读显示也是原生行为）；新建的折叠块默认展开好接着写。
     - 写出：标准写法 `<details>\n<summary>标题</summary>\n\n正文\n\n</details>`（正文前后空行，GitHub / marked 才会把正文当 markdown）；原文是一行写完、正文还是一段文字的照一行写回（`<details><summary>标题</summary>内容</details>`）。中间没空行的多行写法第一次保存会变成标准写法，之后不再变。标题空且原文没有 summary 时不写 `<summary>`。
     - 输入（2026-10-25 起没有工具栏，改成行首 `>> `，见「编辑器去掉工具栏」）：工具栏「折叠块」（ListCollapse 图标，放在「代码」后面）：空光标在一段文字里 → 这段变标题；选了几块 → 收进新折叠块的正文、光标在空标题（占位「折叠块标题」）；光标在折叠块标题里 → 拆开。手打一行 `<details>`（可带 ` open`、`<summary>标题</summary>`）回车也变。没做斜杠菜单（编辑器还没有斜杠菜单，为这一个块加一套不划算）。
     - 键：标题里回车 → 进正文第一行（不是空段落就插一个；收起的先展开）；正文空段落回车 → 出到折叠块后面（ProseMirror 自带 liftEmptyBlock）；标题开头退格 → 拆开；收起时标题里 ↓ 跳到下一块（没有就补一段），下一块开头 ↑ 回标题；光标不管怎么进了收起的正文都会展开（appendTransaction）。
     - 样式：只读 `.md summary`（去掉原生三角，`::before` 画 chevron mask，`[open]` 转 90°）和编辑器 `.md-details-toggle::before` 共用一套；正文缩进 20px；只用令牌颜色，三皮肤 × 明暗通用。测试 `details.test.ts`（读入结构、往返、两遍稳定、工具栏、手打、回车 / 退格、展开收起不算改动）；截图 `work/shots-details/`（脚本 `work/shots-tool/details.mjs`、`details-type.mjs`）。
3. 🟡 小组件（2026-10-16，详见 docs/WIDGETS.md）：
   - ✅ 桌面小窗：我的一天标题旁「打开小窗」（只在桌面 app）→ Tauri 第二个窗口 `mini`（`?window=mini`，340 × 540，置顶，可调大小）：我的一天 + 今天要打卡，用 TaskRow 直接勾 / 计时 / +1，底部「加到今天…」，图钉切换置顶、「打开主窗口」。两个窗口共用 rusqlite，内存快照经 Tauri 事件 `mindough:changes` 互相 applyRemote；小窗不跑同步 / 提醒 / 登录回调。`cargo check` 通过，真机待验。
   - 🟡 Android：app 写快照 ✅（`lib/widget-snapshot.ts` → Rust `widget_snapshot` → app 数据目录 `widget-snapshot.json`，有测试）；AppWidget 的 Kotlin + 布局写在 `src-tauri/mobile/android-widget/`，**没接进构建**（gen/android 由 CI 生成、本机没 SDK 验证不了；接入步骤在 WIDGETS.md）。
   - 🟡 iOS：WidgetKit 脚手架（`src-tauri/mobile/ios-widget/MindoughWidget.swift`）+ 步骤（要 App Group，快照得写到共享容器）；待 Rei 在 Mac 上接。
4. ✅ 桌面 app 外链用系统浏览器打开（Tauri opener）：`lib/external.ts` 在 document 上捕获 click / auxclick，指向别的源的 http(s) 和 mailto / tel 链接都交给 `openUrl`（Markdown 渲染的链接、资料卡小标签、编辑器里的链接都不用各自处理）；Web 端照常新标签页；权限沿用 `opener:default`（只放行 http / https / mailto / tel）。真机待验。
5. 🟡 各平台安装包：版本 0.1.0、macOS ad-hoc 签名、notification npm 与 crate 对齐；已推标签 v0.1.0-alpha.1 触发 build.yml（macOS / Windows / Linux / Android debug），结果由 Rei 在 Actions 查看；iOS 用免费 Apple ID + Xcode 直装（docs/IOS.md）。打包规则（Rei 2026-10-17）：alpha 标签也建 Release（预发布草稿），APK 一并挂上。
6. ✅ 界面收尾：
   - ✅ 27 个打卡分类改「常用 6 个 + 更多」：常用 = 重复任务用得最多的（件数一样按最近），不够用 健康 / 运动 / 学习 / 读书 / 饮食 / 作息 补齐（core `pickFrequentCategories`、`Store.frequentCheckInCategories`）；当前选中的总在第一屏；「更多 · 21」展开搜索框和其余分类；分类改成随宽度换行的小胶囊。
   - ✅ 手机端细节：弹层底部轻提示（「改动会同步到用到它的 N 件任务」）放不下时自己占一行，不再把「保存」挤到下一行；更多链接每条一张小卡（上面名字 + 上移 / 下移 / 去掉，下面整行网址）；IMDb / 豆瓣预览链接太长时省略号。
   - ✅ 暗色模式检查（三种皮肤，我的一天 / 打卡 / 详情 / 编辑资料 / 资料库），Material 补截图（work/screens/m3-*）。
   - ✅ 关系图里相关任务并排放：相关的几件合成一个「并排组」交给 elk 排（`lib/graph-layout.ts`），同一层里挨着，侧边点线相连；两组之间有前后关系路径时不合（会绕圈），照旧只画线。几块互不相连的图手机上往下叠。
   - ✅ SGD / TRY 等币种显示本地符号：Intl 只给代码时换成表里的符号（S$189、₺1,299.50、₱500、RM49、₽99）。
   - ✅ 侧边栏分区（Rei 2026-10-16：「侧边栏分一下section，太乱了」）：「今天」我的一天 · 打卡 · 可做 /「计划」列表 · 组 · ~~关系图~~（2026-10-23 删掉）/「资料」资料库 · 人物；设置固定在底部（新建按钮 Rei 2026-10-17 改成右下角浮动按钮）。小节标题按平台：macOS 11pt 粗体灰字、悬停出折叠箭头；WinUI NavigationViewItemHeader 14px 粗体；Material 抽屉 Title small + 分隔线、桌面紧凑一档。点小节标题可折叠（记在本机，当前页所在的小节不折）。手机标签栏按同样顺序：我的一天、打卡、列表、关系图、更多；「更多」页同样分组（iOS 分组列表 / WinUI / Material 各自的小节标题）。
   - ✅ 打卡分类的管理从设置挪出来（Rei 2026-10-16）：打卡页筛选条末尾「编辑」、新建面板分类选择器底部「管理分类…」打开同一个弹层（`components/CategoryManager.tsx`）：改名、隐藏 / 显示、上移 / 下移（`Store.moveCheckInCategory`，只改 sort）、添加；id 不变；设置里不再有这一节。
   - ✅ 详情「关系」变紧凑（Rei 2026-10-16：「关联占用那么大空间……如果这类关系中没有内容，则不显示……也不要显示添加、新建下一步…无用的按钮」）：顶栏（太阳旁）一个「添加关系」按钮，菜单三项 先做完这些… / 做完后解锁… / 相关任务…；选了打开同一个挑任务的弹层（搜索已有任务，最后一行「新建“xxx”」直接新建并连好，回车也行——合并了以前的「添加」和「新建下一步」）；分组只在有内容时出现，三组都空时整个「关系」不显示；行照旧：点开、× 去掉、行尾状态。··· 菜单里的「新建下一步」去掉（完成提示里的「然后呢？」保留）。新建面板的「相关任务」本来就是一颗胶囊，不改。
   - ✅ 「关闭」挪进 ··· 菜单（Rei 2026-10-17：「任务窗口底部的close按钮，移动到ellipsis下拉菜单中去」）：Rei 说的 close 是详情底部左边那个把任务状态改成「关闭」的安静按钮（不是右上角关窗口的 ×，× 不动）。菜单顺序和分组在 `lib/task-menu.ts` 的 `detailMenu`（纯逻辑，测试 `task-menu.test.ts`）：加入 / 移出我的一天 ｜ 直接标为完成（计时 / 计数 / 倒数日，只做一次的）· 关闭（重复任务「不再打卡」）｜ 删除…（红字）；任务结束了（完成或关闭），状态那组换成「重新打开」（重复任务「恢复打卡」）。`OverflowMenu` 的 `MenuAction` 加了 `separator`（这一项前画 React Aria `Separator`，样式 `.menu-sep`，三皮肤共用 `--border`）。底部：没结束的只剩右边主操作（完成 / 开始计时·暂停·结束 / +1 / 打卡），没有主操作时整条底栏不渲染；结束了的底部照旧「这件事已关闭…」+「重新打开」（主操作就是它，菜单里也有一份）。原来没有快捷键，没加。截图 work/shots-closemenu/（脚本 work/shots-tool/closemenu.mjs）。
   - ✅ 待安排（Rei 2026-10-16：「加一个待安排」）：没结束（待办 / 进行中）、只做一次、没有日期（倒数日的目标日也算日期）、不在今天我的一天里的任务；组里的也算（行上带组名）。行上：加入我的一天（太阳）、安排日期（日期面板，选了就进列表）、拖动排序（`Store.reorderBacklog`：这几件在原来那些 sort 值里换位置）；手动顺序在前、再按创建时间。导航「今天」小节里在我的一天下面（带件数）；手机标签栏 我的一天 · 待安排 · 打卡 · 列表 · 更多（关系图、可做进「更多」）。core `backlog.ts`（`isBacklogTask`、`backlogTasks`、`shouldJoinMyDay`）+ 测试。
     - **改了 M0 决定 8**（Rei 2026-10-16）：新建的任务不再因为「没日期、没组」就自动进我的一天；只有从我的一天页新建的（侧边栏 / N 键在我的一天页上、或我的一天的输入条）才放进今天，别处新建的默认进待安排。我的一天里没做完的：照旧有「昨天没做完 → 带回今天」，不带回的自然落回待安排。
   - ✅ 中英文（Rei 2026-10-16：「添加中英文支持」）：gettext 式——中文原文就是 key（`tr('还在等 {n} 件事', { n })`），英文值可以是函数（复数、语序）；`trx` 整句带元素（「还有 **12** 天」→ “**12** days to go”），`trc` 带语境（导航「打卡」= Check-ins、按钮 = Check In）。core `i18n.ts`（`tr` / `trc` / `dataLabel` / `setLocale` / `intlLocale`）+ `i18n-en.ts`（core 说法、演示数据）+ `i18n-data-en.ts`（内置类型 / 字段 / 选项 / 单位 / 模板 / 27 个打卡分类 / 网站名，显示时翻译，存的仍是中文，用户改过的照原样）；界面 `apps/client/src/i18n/en.ts`。日期星期月份走 Intl（`formatDate`、`weekdayLabel`、`monthShort`），币种名 `currencyName`（Intl.DisplayNames），金额 Intl 跟语言。设置 → 外观 → 语言（跟随系统 / 中文 / English）存进同步的 pref `locale`，本机另存一份启动即用；换语言整棵界面重新挂载（`lib/locale.tsx`，React Aria 的 I18nProvider 跟着换）；`?lang=en` 截图用。守门测试 `i18n/i18n.test.ts`（TypeScript AST 扫描）：组件与 core 没有漏翻的中文（数据 / 解析文件、console、`// i18n-ignore` 行除外）、每个 key 有英文、每个内置名字有英文。英文写法见 COPY.md「English」。截图 work/screens/m3-*-en.png。
     - 演示数据按生成时的语言写（英文界面第一次打开就是英文演示数据）；已有的中文演示数据不会变成英文（是用户数据）。

   - ✅ 外壳调整（Rei 2026-10-17，分支 macos-titlebar）：
     - macOS 无标题栏（「macOS的边栏框要贯通，titlebar不展示」）：`src-tauri/tauri.macos.conf.json` 只在 macOS 合并，主窗口 `titleBarStyle: Overlay` + `hiddenTitle` + `trafficLightPosition { x: 16, y: 17 }`；前端在 Tauri + macOS + 主窗口时给 html 加 `platform-macos-overlay`（`skin/platform.ts` 的 `usesMacOverlayTitlebar`），侧边栏和内容区顶部各一条 38px（`--titlebar-h`）的 `data-tauri-drag-region` 拖动条（双击放大走 Tauri 自带的 drag 脚本，权限加 `core:window:allow-start-dragging`），内容区改由 `.main-scroll` 滚动（平时 `display: contents`，等于没有）。y 按「(条高 − 按钮高) / 2 + 按钮在容器里的 origin.y」估：Sequoia 上 origin.y≈5、按钮高≈14 → 17；Tahoe 上 origin.y≈7，红绿灯会高约 2pt，要真机再调。小窗保持系统标题栏；Windows / Linux / 网页不变；全屏时红绿灯隐藏，拖动条仍留空。
     - 侧边栏不放软件名和图标（「侧边栏不要添加软件title」），三种皮肤都去掉。
     - 新建任务改成右下角浮动按钮（「新建任务移动到右下角浮动」）：桌面和手机三种皮肤都是 `.fab`——Material 3 FAB（56dp、16dp 圆角、primary container）、Apple 强调色正圆 52px、WinUI 强调色 8px 圆角 48px；手机在标签栏上方并让开安全区；侧边栏底部和手机顶栏的新建按钮去掉，N 键不变；关系图的缩放按钮挪到左下，免得被挡。
     - 去掉全局右键菜单（「去掉全局右键菜单」）：`lib/contextmenu.ts` 在 window 上拦 `contextmenu`，输入框 / 多行文本 / contenteditable（Milkdown）/ `[data-native-menu]` 例外；Tauri 和网页都生效。
     - 页面不能左右移动（「不允许页面左右移动」）：html、body `overflow-x: hidden` + `overscroll-behavior-x: none`，#root / .app 不超宽；表格、代码块、公式、标签条、打卡分类条在自己的容器里横向滚。没在根上加 `touch-action: pan-y`（祖先上的 touch-action 会连带禁掉这些容器里的横向滑动）。

### M4 更聪明
- ✅ 自定义类型编辑器（2026-10-16，分支 m4-types）：设置 →「类型」一节和资料库页标签条末尾「编辑」打开同一个弹层（`components/TypeManager.tsx`，样式 `styles/types.css`）。
  - 第一屏类型列表：拖动排序（也能用键盘拖）、归档、「新建类型」、点进去编辑；最底下一行不显眼的「已归档 N 个」，点开可「取消归档」；不列「普通」（没有字段和版式）和「人物」（已从可选类型删掉，人物库不动）。
  - 一个类型：名字（失焦保存；内置名字没改动不写回）、图标（lucide 网格 56 个 + 自己填一个 emoji；`lib/icons.ts` 的 `typeIcon` 认 emoji）、颜色（14 个色板 + 自己调）、资料库版式（竖版海报 2:3 / 方形 / 横幅 16:9 / 圆形——`TypeLayout` 加了 `round`，卡片、行缩略图、资料库都按它出圆图）、默认怎么算完成、新建时的正文、归档（不能删）。
  - 字段：增（名字 + 种类：文字 / 数字 / 进度 / 日期 / 单选 / 多选 / 链接 / 更多链接 / 站点编号 / 图片 / 清单 / 金额 / 看到第几集）、行内改名、拖动排序（设置弹层里也有上移 / 下移）、隐藏、删除；设置弹层里改种类、资料字段 / 任务字段、单选多选的选项（选项改名连同资料和任务里存着的旧选项一起改：`Store.renameFieldOption`）、单位、站点、提示文字。主字段和图片字段固定是资料字段，不能隐藏、删除、改种类。
  - 关键决定：字段 key 随机生成（`f` + 8 位）、永不随改名变；删字段只在定义里留墓碑 `removed: true`（值留在 JSON 里不显示），加回同名同种类的字段就翻回同一个 key、旧值又出现——墓碑也让 `withNewBuiltinFields` 不会把用户删掉的内置字段补回来；影视 r2 去掉的「平台」记在 `LEGACY_BUILTIN_FIELDS`，加回「平台」（文字）用回旧 key `platform`。隐藏字段 `hidden: true`：`itemFieldsOf` / `taskFieldsOf` / `shownFields` / `linkChips` 都不含它，改类型时要留的值用 `allTaskFieldsOf`（含隐藏、删掉的）。字段已经有值时不让改种类和归属（`Store.fieldHasData`），免得旧值对不上。
  - 类型顺序存在同步偏好 `type_order`（id 列表，`orderTypes`；没写进去的按 sort 接后面），不改类型行——否则排一下顺序内置类型就变成「改过」，以后内置升级不再覆盖它。界面上取类型都用 `store.pickableTypes()`（新建 / 改类型 / 组默认类型）/ `store.orderedTypes()`（资料库标签条）/ `store.editableTypes()`（编辑器）/ `store.archivedTypes()`（编辑器底部已归档），前三个都不含归档的。改名字、图标、字段、归档这些会写类型行：内置类型的 updated_at 变成真实 HLC，按 `ensureBuiltinTypes` 的老规矩不再整体替换（只补新字段）。
  - ✅ 类型只能改和归档、不能删（Rei 2026-10-17：「类型创建后只能修改和归档，不支持删除，归档的类型不再可见，但旧的引用它的任务不破坏。」）。取代原来的「隐藏」+「没人用的自定义类型能删」。
    - 存储沿用 `task_type.hidden` 列（不加列、不加迁移），语义改成归档；旧数据里 `hidden = true`（以前的「隐藏」）读出来就是归档。导出的 `_meta/types.json` 写 `archived`，导入兼容旧文件的 `hidden`。`isArchivedType`（library.ts）、`Store.archiveType` / `unarchiveType` / `archivedTypes` / `effectiveDefaultTypeId`；`deleteType` / `canDeleteType` 删掉了，`updateType` 不再改归档。内置、自定义一样；「普通」「人物」不能归档。
    - 归档的不出现在：新建 / 改类型 / 组默认类型的选择器、资料库标签条、类型编辑器主列表、深链 `new?type=`（退回普通）；资料详情页不再给「用它新建任务」。⌘K 照常搜得到归档类型的资料（见下方纠正）。
    - ✅ Rei 2026-10-17 纠正：「组的类型被归档后不退回，搜索里出它的资料。归档只是让它不能被后续任务使用呀」。所以归档只管选择器（不让后续任务选到它），已经用上它的地方不变：组的默认类型照样生效、⌘K 照常搜到它的资料。
    - 归档类型的库按 id 打开（`#/library/<id>`，如从它的资料页点「‹ 某某库」回来）照常显示这个库，不再落到第一个库；标签条里仍没有它，工具栏条数后面轻标「已归档」。选这个而不是「回来源页」：返回链接本来就是 href，不用记来源，深链 / 刷新也对。
    - 旧任务不受影响：任务和资料照常显示这个类型的图标、名字、字段、资料行、完成方式，能改字段值；详情「类型」一行照常显示当前值，只是选择器里没有它；从任务详情点资料行仍能进资料页。
    - 组的默认类型是归档的：照样生效（Rei 2026-10-17 纠正，取代上一版「不生效、退回普通」）——在组里新建任务仍用它，组页副标题照常显示；`effectiveDefaultTypeId` 只在类型行不在了（旧墓碑没被找回）时退回普通。新建任务面板的类型选择器里不列它，但类型小标签照常显示它是当前值。组目前只有新建时选默认类型（`GroupDialog`，选择器不列归档的），没有改已有组默认类型的界面，所以「已选的归档类型显示为当前值」暂时只体现在组页副标题和新建面板。
    - 以前版本删掉的类型（墓碑）：被任务 / 资料引用的，打开时 `reviveReferencedTypes` 照旧找回来，找回来就是归档状态（两台各做一遍内容相同，LWW 后一致）；没人引用的墓碑留着不动。还没升级的旧客户端同步过来的删除也走这条。
  - core：`typedef.ts`（纯函数 `addField` / `updateField` / `removeField` / `reorderFields` / `moveField` / `orderTypes` / `isEditableType`、`FIELD_KIND_LABEL`、`LIBRARY_LAYOUTS`），Store 的 `createType` / `updateType` / `setTypeFields` / `addTypeField` / `renameFieldOption` / `reorderTypes` / `moveType` / `typeUsage` / `archiveType` / `unarchiveType` / `archivedTypes`；测试 `packages/core/test/typedef.test.ts`（类型增改、字段排序隐藏、删字段数据保留与加回、内置改过不被覆盖、排序不改内置行、不能删、归档后不在 pickable / ordered / editable、引用归档类型的任务照常解析、⌘K 搜得到归档类型的资料、组默认类型归档后照样生效、旧 hidden 兼容与导出导入、选项改名、两端同步 LWW、复活的墓碑是归档状态）。没加表也没加列（字段定义本来就是 JSON），SQLite / Tauri 不用迁移。
  - 截图 `work/screens/m4-types-*.png`（三皮肤桌面 + 手机，含暗色、英文）；归档 `work/screens/m4-archive-*.png`。
  - 待 Rei 确认：
    - ~~有引用的自定义类型只能隐藏，不做「把任务改成普通再删」——要不要加？~~ 已定（Rei 2026-10-17）：类型不能删，只能改和归档，见上。
    - 编辑器列表底部「已归档 N 个」→ 取消归档（为了能恢复，代理加的）；归档不弹确认，提示里能撤销。
    - ~~⌘K 搜索不出归档类型的资料~~ 已改（Rei 2026-10-17）：照常能搜到。资料详情页对归档类型仍不给「用它新建任务」（归档就是不让后续任务用它）。
    - 字段有值后锁定种类和归属（要换就新加一个字段），而不是自动迁移旧值。
    - 新字段种类里不放「人物」（任务本身就能关联人物）。
    - 编辑器里不出现「普通」：它的名字 / 图标 / 默认完成方式暂时不能改。
    - 归档 / 改名等会让内置类型变成「改过」，以后内置定义大改时只补新字段、不整体替换。
- 按名字自动补全资料（影视 TMDB / 豆瓣、游戏 Steam、书 Open Library；有 IMDb / 豆瓣编号时按编号取），展示时附来源。
- ✅ 资料合并（两条其实是同一部片）（2026-10-16，分支 m4-merge）
  - core `merge.ts`（纯逻辑：`planItemMerge` / `planPersonMerge` 算合并后的值与冲突、`mergeNotes`、`duplicateGroups`、`resolveMerged`、`mergeCycleSurvivors`）+ `Store.mergeLibraryItems(targetId, sourceIds, choices?)` / `mergePeople` / `undoMerge` / `settleMerges` / `duplicateGroups` / `dismissDuplicateGroup`；测试 `packages/core/test/merge.test.ts`。
  - 规则：同类型才能合并（不同类、只选一条、来源不在了抛 `MergeError`，不写入）。默认目标的非空值优先、空的按来源顺序补；`choices`（字段 key → 用哪条的 id）定冲突字段；主字段（名字）、图片也可选；「更多链接」不算冲突，按网址去重合并；类型里已经没有的旧字段同样目标优先补空、不丢。备注拼接：已包含的那段不重复。
  - 数据：`library_item.merged_into`、`person.merged_into`（SQLite 迁移 v5；localStorage / 旧行读入时补 null，写入也总带上）。来源打墓碑 + `merged_into = 目标`，用到来源的任务一次写入里改指目标。读的时候都顺着 `merged_into` 找（`store.itemOf`、`resolveItemId`、`resolvePersonId`、`tasksOfItem`、`libraryEntries` 的用到次数、`peopleOf`、详情的资料行），所以别的设备离线新建、还指着旧 id 的任务同步后立刻显示成目标；`settleMerges()` 在打开时和每次 `applyRemote` 后把这些任务（和人物关联）改写到目标 id（没事做不写）。链式合并（A→B→C）解析到最后一条。
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
- ✅ 导入导出 Markdown 文件夹（2026-10-16，分支 m4-io；格式全文见 [docs/EXPORT.md](EXPORT.md)）
  - 格式：一件任务一个 .md（YAML front matter：id、状态、日期、组、类型 / 资料、任务字段、完成方式与重复、提醒、人物、`after` 先做完这些、`related` 相关任务都用 id 引用，行尾 `# 名字` 注释给人看；打卡次数摘要在 front matter，完整事件在 `_meta/checkins.json`），正文就是 body_md；组 = 一层文件夹 + `_group.md`；资料 `library/<库名>/<名字>.md`、人物 `people/<名字>.md`；类型、打卡分类、组分类、偏好、图片清单在 `_meta/*.json`；图片进 `assets/`，正文引用改成相对路径。文件名由正文首行生成（安全化、同文件夹不分大小写去重），id 才是身份。
  - 代码：core `archive/`（`text.ts` front matter / 文件名 / 路径 / base64、`export.ts`、`import.ts`、`zip.ts`），单独入口 `@mindough/core/archive`（yaml 2.9 + fflate 0.8，客户端按需加载，独立 chunk ≈ 46 KB gzip）。界面：设置 → 数据「导出」「导入」两行（`pages/Settings.tsx` 的 `ArchiveRows`）、导入面板 `components/ArchiveImport.tsx`（`styles/archive.css`）、浏览器那头 `lib/archive.ts`（取回网上图片、打 zip 下载、读 zip / 文件夹、登录时先把图片传 R2）。
  - 导出：zip 下载 `Mindough YYYY-MM-DD.zip`（解开是同名文件夹）。asset 里的 data: 图直接写文件；网上的图片（R2、海报外链）先试着取回（8 秒超时、并发 4，跨域取不到的照原链接写，提示里说几张没取到）。
  - 导入：选 zip 或文件夹 → 预览「新建 / 更新 / 跳过 / 出错」+「其中 N 件任务 · N 个组…」+ 出错列表（没导入的 / 没接上的）→ 确认后 `applyImport` 一批写入（一次进 outbox）→ 提示里「撤销」整批撤销（`undoImport`：新建的打墓碑、覆盖的写回原样）。自己的格式按 id：没有 → 建，内容一样 → 跳过，内容不同 → 默认跳过、可选「已有的用文件覆盖」（连前后关系 / 相关 / 人物一起按文件来；我的一天、打卡只补不删）。普通 markdown：每个 .md 一件任务，最上一层文件夹 → 组（同名已有组直接用），文件名补成标题，`- [ ]` 清单不拆，认 status / done / due 几个常见属性，`![[x.png]]` 换成图片。前后关系逐条过环检测，会成环的不连、记进「没接上」。
  - 测试 `packages/core/test/archive.test.ts`：front matter 往返与畸形输入、文件名安全化与去重、相对路径、base64；导出结构；**导出 → zip → 解 zip → 导入空库，全部表等价**；再导一次全跳过、改过的默认跳过 / 选覆盖才改；整批撤销回到导入前且进 outbox；普通 markdown 文件夹（组、标题、清单、Obsidian 图片、再导一次跳过）；畸形文件（坏 YAML、没收尾、列表当属性、坏 JSON、找不到的引用、乱写的完成方式）只进出错列表、不崩。截图 work/screens/m4-io-*.png（三皮肤 × 桌面 / 手机，Apple 桌面英文）。
  - **待 Rei 确认**（我先这样定的）：
    1. Tauri 端也是 zip 下载，没有「选目录直接写文件夹」：dialog / fs 插件还没装，沙箱里没有 Rust 工具链没法 cargo check，就没动 Cargo.toml / capabilities。要的话装 `tauri-plugin-dialog` + `tauri-plugin-fs`，导出时 `save()` 选目录逐个写文件、导入时 `open({ directory: true })` 读。另外桌面 WebView 里 `<a download>` 能不能存到「下载」文件夹要在真机上看一眼（不行的话就得上 dialog 插件）。
    2. 选进来的那一层文件夹本身不算组（zip 根文件夹、选文件夹时那个文件夹）；普通 markdown 里更深的子文件夹并进最上一层的组。
    3. 普通 markdown 的任务 id 由「根文件夹名 + 路径」算出：同一个文件夹再导一次是跳过 / 可覆盖，不会重复；但把文件改名或挪位置再导，会当成新的一件。
    4. Obsidian 的 `tags` 和其他不认识的属性不导入（Mindough 没有标签）；正文里的 `#标签` 原样留着。
    5. 导入的图片：登录时先传到 R2，没登录用 data: 地址（和离线插图一样，行会大一些）。
    6. 导入时类型、打卡分类也按 id 认：内置类型内容一样就跳过，不同（对方改过内置类型）默认跳过，选覆盖才会换成文件里的（之后这个内置类型就算「用户改过」，不再随内置版本升级）。
    7. 文件名、库文件夹名按导出时的界面语言（英文界面导出是 `library/Movies & TV/`）；不影响再导入。
   - ✅ 图片统一宽高（Rei 2026-10-16：「上传前要统一宽高」）：apps/client/src/lib/image.ts。按版式：海报 600×900、方形 / 圆形（含头像）600×600、横幅 1280×720，居中裁切，WebP 0.85（编不了 WebP 退 PNG / JPEG）；小图也放大到统一尺寸；普通图片字段只限长边 1600。在线封面经 `POST /api/lookup/image {url, raw:true}` 代拉原图 → 本机裁 → `/api/assets`，代拉失败退回 Worker 直接存原图。Markdown 文件夹导入的图保持原样（是自己导出的）；粘贴的图片链接仍只存链接；已存的旧图不回头重裁。
   - ✅ 按名字 / 编号在线找资料（分支 m4-lookup）：
     - **Worker**（`apps/server/src/lookup/`，都要登录：会话或同步凭据，同 /api/assets）：`GET /api/lookup/search?kind=movie|book|game&q=&lang=zh|en[&media=movie|tv][&alt=]`、`GET /api/lookup/item?source=tmdb|douban|openlibrary|steam|imdb&id=`、`POST /api/lookup/image {url}`（把选中的封面拉进 R2 `mindough-assets`，key 同 /api/assets，资料里存 asset 引用，不热链；只拉 image.tmdb.org、covers.openlibrary.org、*.steamstatic.com、img*.doubanio.com，豆瓣带 Referer）。Cache API：每个来源的搜索 1 天、详情 7 天，只缓存成功的；对外请求 8 秒超时（504 网关超时）、连不上 502 错误网关、限流 429 请求太多；错误都带中文说明。一个来源出错不影响别的，所有来源都失败才返回第一个的状态码。
     - **来源适配器**各一个文件，统一输出 `{source, sourceId, name, year?, image?, thumb?, subtitle?, fields, url}`，fields 的 key 是内置类型的字段 key：
       - `tmdb.ts`：search/multi（不知道电影还是剧集时）或 search/movie、search/tv（知道时，排序也准）；movie / tv 详情 + `append_to_response=external_ids` 拿 IMDb；`find/{imdb}`。密钥 Worker secret `TMDB_API_KEY`：v4 读访问令牌（eyJ… 开头）走 Bearer，其余当 v3 key 走 `api_key`；没配置或密钥不对 → 503 服务不可用（`unconfigured`），界面写「TMDB 还没配置」。中文界面 zh-CN、英文 en-US。
       - `douban.ts`（尽力而为）：建议接口 `movie.douban.com/j/subject_suggest`；详情先用手机版 JSON `m.douban.com/rexxar/api/v2/movie/<id>`（剧集 301 到 /tv/），不行再解析 subject 页面（会跳到验证页）。拿不到算 `blocked`，静静降级。2026-10-16 沙箱实测建议接口和手机版 JSON 都通。豆瓣的结果只在中文界面列出。
       - `openlibrary.ts`：search.json（少于 3 个字改按 `title:` 搜，否则 422）；详情 `q=key:/works/<id>`；作者只取 author_name 第一位（后面常是译者、插画师）。按名字得到的是作品（OL…W），只有作品级字段：作者、首版年份、页数。按 ISBN（`/api/lookup/item?source=isbn&id=`）：`/isbn/<isbn>.json`（302 到那一版 `/books/OL…M.json`），取书名、出版社 publishers[0]、出版年份（publish_date 里的年）、页数 number_of_pages、ISBN；作者先看这一版的 authors，没有（常见）就取作品的第一位，再查 `/authors/<id>.json` 的名字；ISBN 校验位不对 400。不给封面（见下）。
       - `steam.ts`：storesearch + appdetails（中文 l=schinese&cc=CN，英文 l=english&cc=US）；平台 windows → PC（Steam）、mac → macOS、linux → Linux / Steam Deck；官网进「更多链接」；图标用 header 图（卡片里方形裁）。
     - **按 Rei 20 部真实数据试跑改的**（work/m4/tmdb_try.json：按 IMDb find 18/18 对，按中文名 search/multi 11/20 对）：搜之前去掉季 / 集标记（第三季、Season 2、S03、S02E03，复用 episode.ts，见 core `lookupSearchText`），带季标记的按剧集搜，季数由新建面板照旧填进「看到哪」；有 IMDb / 豆瓣编号先按编号取；影视资料「电影/剧集」已填时只搜那一种（`media`）；TMDB 按中文名没搜到时，用 `alt` 给的名字、再用豆瓣同名条目的原名（带豆瓣年份收窄）补搜（「海绵宝宝大电影·寻找方裤」→ The SpongeBob Movie: Search for SquarePants → TMDB「海绵宝宝：深海大冒险」）；按名字永远给候选让人选，不自动采用第一条。
     - **core** `lookup.ts`：哪些类型能在线找（按内置 id：影视 / 书籍 / 游戏）、结果形状（与 Worker 的 `lookup/types.ts` 一致，两处一起改）、`lookupSearchText` / `lookupQueryOf`（按什么找）、`findLookupTwin`（库里已有的同一条：同来源编号、同 IMDb / 豆瓣编号、或同名且年份不冲突）、`planAutofill` / `applyAutofill`（逐项计划）、`itemOfLookup`。资料来源存在 `library_item.fields._source`（「tmdb:movie/693134」），**不加列、不动 schema**；下划线开头的键不是类型字段，不显示、不进搜索。
     - **界面**：新建面板 / 详情「换一个」的选择框里，本地结果和「新建“xxx”」下面是「从 TMDB、豆瓣找」/「从 Open Library 找」/「从 Steam 找」（`components/library/Lookup.tsx` 的 `OnlineOptions`，防抖 350 毫秒、新输入取消旧请求、离线或没登录整块不出现，键盘上下和本地结果连着；粘贴 IMDb / 豆瓣链接按编号取；库里已有的同一条不重复列）。选中马上建资料（界面不等网络），后台补详情（IMDb 编号等）和封面，只补空缺（`lib/lookup.ts` 的 `createItemFromLookup`）；新建面板里选了又取消 / 换掉的、没有任务用到的资料，关掉面板时删掉。编辑资料底部「自动补全」：先按已填的 IMDb、再豆瓣编号取，都没有按名字给候选列表挑一条；然后逐项列出要填的值（勾选框 + 字段名 + 新值 +「现在：旧值」），空缺默认勾上，已有的默认不勾（勾上 = 覆盖），更多链接是合并；「填进去 N 项」才拉图、填进草稿，最后还是「保存」才落库。资料卡（详情大卡）和资料页名字下面「资料来自 TMDB」小字 + 链接。设置最下面「关于」：Mindough 图标与名字在前，TMDB 认可的 logo（blue_short，10px 高，比我们的标识不显眼，链到 https://www.themoviedb.org）+ 原文声明“This product uses the TMDB API but is not endorsed or certified by TMDB.”，中文界面再附译文。样式在 `styles/lookup.css`。
     - 测试：core `test/lookup.test.ts`；server `test/lookup.test.ts`（全部用 mock fetch：TMDB 两种密钥、没配置 503、超时 504、限流 429、豆瓣跳验证页降级、media 过滤、按原名补搜、拉图进 R2、缓存 TTL）；`e2e/real-lookup.test.ts`（`E2E_LOOKUP=1` 真实请求 Open Library、Steam、豆瓣、拉图进 R2，有 `TMDB_API_KEY` 时也试 TMDB）；client `lib/lookup.test.ts`。截图 work/screens/m4-lookup-*.png（脚本 work/shots-tool/m4lookup.mjs，mock 接口）。
     - **待 Rei 确认**（我先这样定的）：
       1. 来源存在 `fields._source`，不加 `library_item.source` 列（免得和别的分支的迁移撞号）；以后想要单独一列再迁移。
       2. 没加 Google Books：沙箱里没法验证无 key 接口（网关拦下来回 403 禁止访问），Cloudflare 出口 IP 也常被它限流；书只用 Open Library，中文书覆盖一般。
       3. 豆瓣结果只在中文界面列出；英文界面只拿它给原名补搜 TMDB。
       4. 选择框里在线结果放在「新建“xxx”」下面（位置稳定，结果晚到不会把「新建」挤走）；库里同名（年份不冲突）的条目视为同一条，在线列表里不再列，选中时用库里那条、只补空缺。
       5. 按 IMDb / 豆瓣编号取到的直接进逐项确认（编号是精确的），按名字一定先给候选。
       6. 「自动补全」和在线结果只在登录且在线时出现；没登录不提示（克制）。
       7. 游戏图标用 Steam header 图（横图，方形裁中间），Steam 没有方形图标接口。
     - ✅ **书的封面不对接任何平台，纯手填（Rei 2026-10-17 定）**：只去掉书的封面，Open Library 仍补书名、作者、年份、页数等。Worker 的 openlibrary 适配器不取 cover_i、不输出 image / thumb；`/api/lookup/image` 白名单去掉 covers.openlibrary.org（现在只拉 image.tmdb.org、*.steamstatic.com、img*.doubanio.com）。core 的来源表加 `covers`（Open Library 为 false）和 `lookupCover(r)`：自动补全不列图片那行、选中在线结果建资料不拉图、候选列表里的书都用占位图——就算旧 Worker / 缓存还带着封面地址也不用。书的封面只走现有的手动图片字段（上传 / 粘贴，照旧按海报 600×900 统一裁切）。已经拉进 R2 的旧封面不动。
     - ✅ **书按 ISBN 精确取那一版（Rei 2026-10-17 同意）**：书籍类型加三个资料字段 出版社（publisher，文字）、出版年份（year，数字）、ISBN（isbn，站点编号 `site: 'isbn'`，链到 openlibrary.org/isbn/…），插在作者和页数之间；内置版本升到 r3（`BUILTIN_TYPES_REVISION` 0003），没改过的内置书籍直接换新定义，改过的照 `withNewBuiltinFields` 只补这三个新字段、已有的不动。core `links.ts` 的 `isbnOf`：ISBN-10 / 13，容许连字符、空格、「ISBN」前缀，也认 openlibrary.org/isbn/ 链接，校验位不对的不认（免得把一串数字当 ISBN）。选择框里输入 / 粘贴 ISBN（只在书里认）就按 ISBN 取一条候选；编辑资料「自动补全」先认已填的 ISBN（名字栏里粘的 ISBN 也认），取到的直接进逐项确认（同 IMDb 编号）；按书名找到的是作品，逐项确认上面说明「只补作者、首版年份、页数；要出版社和 ISBN，先填 ISBN 再自动补全」。按 ISBN 取到的来源记成这一版（`openlibrary:OL25840916M`，链接到 /books/）；同一 ISBN 算库里的同一本。仍然不带封面。2026-10-17 沙箱实测 978-7-5366-9293-0 → 三体 · 刘慈欣 · Chongqing Press · 2008 · 302 页。

### 日记 J1 ✅（2026-10-17，方案 docs/JOURNAL.md）
- **core** `journal.ts`：`journalEntryId`（日期 → 固定 id，第四段 8002）、`journalToday`（「一天从几点开始」，pref `journal.day_start`，默认 5）、`canWriteJournal`（将来不能写）、12 个心情 `MOOD_IDS` / `moodLabel`、字数 `journalWordCount`（中文按字、英文按词）、同步保护 `isJournalConflict` / `mergeJournalConflict`（输家里赢家没有的段落收进 `<details data-journal="conflict">` 折叠块，已经有的不重复，两边各合一次也收敛）、月历 `monthGrid`。Store：`journalToday()`、`journalOf(date)`、`setJournal(date, {body_md, mood})`（将来抛 `FutureJournalError`；空的不建；base_at = 上一版是别的设备写的就记它）、`deleteJournal`；`applyRemote` 收到一篇没看到本机那版的日记 → 合好写成一次新的本机写入推上去。搜索 `SearchHit.kind = 'journal'`；提醒 `journalReminders`（每天 pref `journal.remind_time`，默认 21:00，写没写都响；`journal.remind` 默认开）；导出 `journal/YYYY/MM/YYYY-MM-DD.md`、导入按日期认。测试 `test/journal.test.ts`（两台设备离线同写一天两种先后都不丢字）。
- **界面**：`pages/Journal.tsx`（桌面月历 + 这个月的列表 + 那天的日记；手机「月历」切换；停手 1.2 秒、离开编辑器、换一天、关页面时存；正在写时同步来了另一版也收进折叠块）、`components/journal/`（`MoodIcon` 12 个手写 SVG + `styles/journal.css` 的点选动画，颜色令牌 `--mood-*` 三皮肤 × 明暗在 `skin/tokens.css`；`MoodPicker`；`JournalCalendar`；我的一天底部 `JournalCard`）。侧边栏「今天」小节最后「日记」，手机在「更多」；设置 → 日记；⌘K「写今天的日记」+ 搜日记；深链接 `mindough://journal/{today|日期}`、`view/journal`（Android 注册 journal host）、Web `#/journal/…`；提醒点了打开日记（sw.js `open-journal`、Tauri extra.journal）。截图 work/shots-journal/（脚本 work/shots-tool/journal.mjs）。
- **按推荐、Rei 未答**：同步保护（折叠块）、导出按年 / 月两层、隐私开关留 J3。
- **J2 / J3 待排**：那年今日、插入时间、`@` 引用、Obsidian 每日笔记导入、`journal/today?append=`；隐私三个开关、写日记热力图、Day One 导入。

### 附件 ✅（2026-10-17）
Rei 2026-10-17：「添加附件功能，用户可以拖拽或选择文件作为附件，附件是图片则小图显示点击可放大(有关闭、下载按钮)，其他文件格式上传后显示图标，点击下载」。
- **挂在哪**：任务详情、日记（每天那篇）。资料项暂不做（待问）。正文下面一块「附件」。
- **数据**：新表 `attachment`（SQLite 迁移 **v7**）：`owner_type`（task / journal）、`owner_id`（任务 id，或日记 `journalEntryId(date)`）、`file_name`、`mime`、`size`、`r2_key`、`thumb_key`、`width` / `height`（原图）、`created_at`，加 `id` / `updated_at` / `deleted`。按现有同步协议加表（云端只存整行 JSON，不动云端 schema），行级 LWW。给日记加附件时先 `Store.ensureJournal(date)` 建一行空日记（导出靠这一行认日期；只有附件的日子在月历和列表里也算写了，列表里写「N 个附件」）。删任务 / 删那天日记一起把附件打墓碑。Store：`attachmentsOf` / `addAttachment` / `setAttachmentFile` / `renameAttachment`（没写扩展名补回原来的）/ `removeAttachment` / `restoreAttachment`。纯逻辑 core `attachments.ts`（文件类型 10 种、大小显示、文件名安全化与去重、`MAX_ATTACHMENT_BYTES`）。测试 core `test/attachments.test.ts`、client `lib/attachments.test.ts`、`components/attachments/FileIcon.test.tsx`、server `test/files.test.ts`。
- **存储**：原文件原样传 R2 `mindough-assets`（不压缩不改尺寸），图片在本机另生成一张缩略图（长边 480，WebP，编不了退 JPEG）也传上去，网格用它。Worker `apps/server/src/files.ts`：`POST /api/files`（会话或同步凭据；≤ 50 MB，超过 413 内容太大；同内容只存一份）、`GET /api/files/<用户哈希>/f/<sha256>[?name=&dl=1]`（要登录，key 前缀不是自己的都回 404 未找到；安全的图片格式 inline，其余的或 dl=1 都按 attachment 下载，带原文件名；nosniff + CSP sandbox，HTML / SVG 附件里的脚本不跑；`cache-control: private`）。
- **上传**（client `lib/attachments.ts` + `lib/attachments-queue.ts`）：选进来 / 拖进来 → 先建行（r2_key 空）+ 文件和缩略图存进本机 IndexedDB 队列 `mindough-files` → 登录且在线时传（XMLHttpRequest，有进度；同时 2 个；先传缩略图再传原图）→ 填上 key、删本机那份。界面显示「正在上传 45%」+ 进度条，能取消（停掉上传、删行，不留撤销）；失败显示「上传失败」+ 重试（悬停看原因，带状态码中文说明）；离线「等联网后上传」、没登录「登录后上传」，联网 / 登录后自动接着传；关掉 app 再开，队列里的接着传。别的设备加的、还没传上来的显示「还在另一台设备上」。上传器只在主窗口跑（同同步）。
- **显示**（`components/attachments/`）：图片（浏览器能直接显示的，HEIC 等有缩略图才算）方形小图网格；点开灯箱 `Lightbox`：全屏深色底、先放大缩略图顶着、原图到了换上；顶栏文件名、「2 / 5」、下载、关闭；多张时左右箭头、← → 键、手机左右滑；Esc、点图片外面关闭；四周 `env(safe-area-inset-*)`。其他文件：按类型的图标 + 文件名 + 「PDF · 380 KB」，点一下下载。每个附件 ··· 菜单：下载、重命名…（选中主干，不写扩展名就保留原来的）、删除（提示里「撤销」）。
- **文件类型图标** `FileIcon`：自绘一组 SVG（折角的纸 + 中间一个线条图形 + 扩展名），10 种：图片、PDF、文档、表格、演示、压缩包、音频、视频、代码 / 文本、通用；颜色令牌 `--file-*`（三皮肤 × 明暗，`skin/tokens.css`）。
- **拖放**：拖文件到任务详情 / 日记那一块上，显示虚线高亮层「松手添加附件 · 每个文件不超过 50 MB」，可多个；捕获阶段接住，编辑器不会把文件插进正文、浏览器也不会打开文件。只认文件（拖文字照旧）。将来的日子不收。手机上「添加附件」打开系统选择器（iOS / Android 里含相册）。
- **下载**：Web 端直接让浏览器下 `/api/files/<key>?dl=1&name=原文件名`（同源带 cookie）；还在本机队列里的用 blob: 地址，名字一样。Tauri：取回内容交给新命令 `save_download`（`src-tauri/src/files.rs`，原始字节经 IPC，不用新插件）存进系统「下载」文件夹（没有就「文稿」），重名加「 (2)」，提示「已存到「下载」：x」+「在文件夹中显示」（opener 的 revealItemInDir）。原生端显示图片：带 Bearer 取回成 blob: 地址（内存缓存）。
- **导出 / 导入**：见 [EXPORT.md](EXPORT.md)「附件」：文件进 `attachments/`，记录 `_meta/attachments.json`，正文后面附一段链接（导入时去掉）；导入后带文件的排进上传队列。
- 截图 `work/shots-attachments/`（脚本 `work/shots-tool/attach.mjs`，假 API）。
- **待 Rei 确认**（我先这样定的）：
  1. 单个附件上限 50 MB（Worker 和客户端同一个数 `MAX_ATTACHMENT_BYTES` / `MAX_FILE_BYTES`）。Worker 一次读进内存算 SHA-256；要更大得改成分片（R2 multipart）。
  2. 资料项（影视 / 书…）要不要也能挂附件。
  3. 附件不占正文：不在 markdown 里插链接（导出时才附一段清单）；要不要支持把附件拖进正文某处当插图。
  4. ~~删掉的附件只打墓碑，R2 里的文件不删~~（2026-10-25 改了）：删掉以后没别的行用着这份文件，Worker 就删 R2 里的文件；另外每天清理一次没人用的。见下面「附件：清理没人用的云端文件」。
  5. 只有附件、没写字的日记那天算「写了」（月历上有点）。
  6. （2026-10-25 改为桌面弹系统保存框，见下面「只预览图片 + 本机缓存」，仍待确认）Tauri 下载直接存进「下载」文件夹，不弹保存对话框（不装 dialog 插件）；iOS / Android 上「下载」目录的行为要真机看（iOS 没有下载文件夹时退到「文稿」，Android 可能要存储权限），沙箱里没有 Rust 工具链，`files.rs` 没有 cargo check 过，交给 CI build.yml。
  7. 两台设备同时改同一个附件（一边改名、一边刚传完填 key）是整行 LWW，极少数情况下改名会被盖掉。
  8. 已经传到 R2 的文件，本机默认不留缓存：离线时打不开、下不了（显示缩略图要联网）。2026-10-25 起可以手动「缓存」，见下面「只预览图片 + 本机缓存」。
  9. 还没升级的旧客户端会跳过 attachment 表的行（同 journal_entry 当时的情况），升级后要等那些行再被改一次才会拉到。

#### 附件：只预览图片 + 本机缓存 ✅（2026-10-25）
Rei 2026-10-25：「任务详情页中，attachments 如果是图片，添加后是缩略图，点击可放大查看。其他类似的附件都不可预览。附件可以下载、删除、缓存、删除缓存。缓存的附件 24 小时后清除本地缓存。」
- **预览**：图片照旧小图网格 + 灯箱（灯箱只翻图片）；其他文件（PDF、视频、音频、文档…）都不预览，图标 + 文件名 + 大小，点一下下载（原来就没有内嵌预览，这次只是写明）。core `attachmentPressAction`（lightbox / download）。
- **操作**：··· 菜单 下载 / 缓存（或「删除缓存」）/ 重命名… / 删除（删除前加分隔线，仍是提示里撤销）。桌面悬停出现 ···、右键也打开同一个菜单；触屏点 ··· 或长按 500 ms（iOS 不发 contextmenu，自己计时；长按后那次点击吞掉，不会顺手打开灯箱 / 下载）。哪些能点由 core `attachmentActionState` 算（缓存着 / 在本机上传队列 / 联网）。
- **缓存**：「缓存」把原文件存到这台设备。Web 用 **Cache Storage**（缓存名 `mindough-attachments-v1`，假地址 `/__attachment-cache/<id>`；选它不选 OPFS：iOS Safari 等的 OPFS 写入接口支持不齐，Cache Storage 各家都稳；sw.js 不碰这个缓存，外壳清理只删 `mindough-shell-*`，所以 SHELL 版本没动）；Tauri 用 app 缓存目录 `attachments/<id>`（`files.rs` 的 `att_cache_put / get / delete / list / copy`，先写 .part 再改名）。缓存记录（附件 id、r2_key、大小、缓存时间）存 localStorage `mindough:att_cache`，只在本机、不同步；附件换了文件（r2_key 变了）就不算缓存着。缓存着的附件有个小硬盘标记（悬停看还剩几小时）。「删除缓存」只删本机副本。缩略图不算缓存的附件，照旧。client `lib/attachment-cache.ts`（`AttachmentCache`、`useCacheRecord`、`installAttachmentCache`），纯逻辑 core `attachment-cache.ts`。
- **24 小时清理**：从缓存那一刻起算（打开、下载都不续期；对已缓存的再点一次缓存不会出现，因为菜单那时是「删除缓存」）。启动时、回到前台（visibilitychange / focus）、运行中每小时各查一次；读的时候发现到期也当没缓存并删掉。附件被删了（墓碑）、没有记录的孤儿文件也一并清。
- **本地优先**：缓存着的附件，灯箱原图、下载、导出都先用本机副本；离线又没缓存的：下载按钮灰掉（悬停说明），点文件行提示「离线中，没缓存的附件下载不了，联网后再试」；灯箱里下载灰掉。
- **Tauri 下载**：桌面改为弹系统保存框（新加 `tauri-plugin-dialog`，权限 `dialog:allow-save`，默认原文件名），缓存着的从缓存目录拷过去（`att_cache_copy`），否则取回后写过去（`save_to_path`）；取消保存框不提示。手机（iOS / Android）仍存进「下载」文件夹（`save_download`）。
- **日记附件**用同一个组件，同样生效（Rei 只提了任务详情）。
- 测试：core `test/attachment-cache.test.ts`（到期、假时钟清理、图片 / 非图片、操作状态），client `lib/attachment-cache.test.ts`（缓存记录、假时钟 24 小时清理、install 定时 / 前台、离线下载、菜单与英文 Title Case）。截图 `work/shots-attach/`。
- **待 Rei 确认**（我先这样定的）：
  1. Tauri 桌面下载弹系统保存框（之前是直接存进「下载」不弹框，PLAN 附件待问 6）；手机不弹。
  2. 非图片附件点一下仍是下载（不预览）；要不要改成点一下什么都不做、只能从菜单下载。
  3. 缓存着的附件不能「续期」：24 小时到了就清，要再缓存得等清掉后再点（或先删除缓存再缓存）。
  4. 删掉附件时不立刻删缓存（为了撤销），下一次清理（≤ 1 小时 / 回到前台）时删。
  5. 「已缓存」标记用 Lucide `hard-drive`，「缓存」菜单图标 `hard-drive-download`。
  6. 正在上传的附件（文件本来就在本机）不显示「缓存」。

#### 附件：清理没人用的云端文件 ✅（2026-10-25）
Rei 2026-10-25 问「附件删除时会同步删除云端的文件么」，当时答不会（上面待确认第 4 条）。Rei：「不能立即判断是否还有引用么，没引用直接删？」我说可以，代价是删除同步上去以后再撤销，文件拿不回来，只能从本机缓存补传，不然显示「文件已删除」。Rei：「同时加一个定期清理：没人引用且删满 30 天的文件从云端删掉」。

结论：附件删了、没别的地方用着这份文件，Worker 马上删 R2 里的原文件和缩略图；每天再扫一遍兜底。只管附件（`<用户哈希>/f/<sha256>`），资料图和正文图片（`/api/assets`，key 里没有 `/f/`）不动。

- **什么算引用**：这个用户 `sync_row` 里任何一行（不分表），整行 JSON 里出现了这个 key，就算引用。附件行的 `r2_key` / `thumb_key` 是主要的；任务正文、日记正文、备注里写着 `/api/files/<key>` 也算。正文图片（Tiptap 拖进正文、粘贴）走的是 `/api/assets`，不在这套里。只看自己的行，只删自己哈希前缀下的文件。
- **即时删**（`apps/server/src/purge.ts` 的 `purgeAfterPush`）：`/api/sync/push` 整批写进库以后，从这次真写进去的墓碑行里取出 key（同一批里新加的附件用着同一份内容，判断时已经在库里，不会删）。放进 `ctx.waitUntil`，不拖慢同步响应：先等 12 秒，没有没删的行引用、文件上传满 15 分钟，删之前再查一次引用，再删。出错只记日志，交给每天的清理。
- **每天清理**（`purgeOrphans`，wrangler `triggers.crons` = `0 19 * * *`，北京时间每天 03:00）：逐个用户分页列出 R2 `<哈希>/f/` 下的文件，再分页扫这个用户含 `/f/` 的行：
  - 有没删的行引用：留着；
  - 只有删掉的行引用：这些行全部删满 30 天（按墓碑 `updated_at` 里的时间，取最晚那行）才删；
  - 从没被任何行引用：上传满 30 天才删（防止刚传上去、行还没同步过来的文件被误删；附件换了文件后旧文件也走这条）。
  - 删前再查一次引用。一次最多删 500 个、每个用户最多列 20 页（每页 1000 个），没扫完下次接着。日志写扫了几个、删了几个、多少字节、有没有扫完（`partial`）。
- **上传**：`POST /api/files` 同内容还是同一个 key，但已经有了也重写一遍，刷新上传时间（不然「上传满 15 分钟」会把刚刚传的同一份内容当旧文件）。补传回来的文件 key 不变，行不用改。
- **HEAD /api/files/<key>**：新加，只回头不回内容，客户端用它查文件还在不在：200 还在，404 未找到 = 已经清掉了（别人的 key 也是 404）。
- **客户端**（`apps/client/src/lib/attachment-gone.ts`）：显示附件时查一次云端文件还在不在（HEAD，同一个文件 10 分钟内只问一次；离线、没登录、正在上传的不查）；缩略图加载失败、点「撤销」恢复附件、下载时发现没了，都马上重新查。
  - 云端没了、本机有（上传队列里的、本机缓存的）：重新传上去，同内容 key 不变。缩略图也没了就用原文件重新生成再传，key 变了才改行。补传时显示「正在补传…」。
  - 云端没了、本机也没有：附件显示「文件已删除」。图片的小图位置放文件图标，灯箱里不显示它；下载、缓存灰掉；点它提示「云端的文件已经删了，这台设备上也没有副本」。重命名、删除照常。
  - 原文件在、只是缩略图没了、本机又没有：不算删除，网格退回用原文件显示。
  - 九种语言都补了这三句。
- 测试：server `test/purge.test.ts`（即时删、别的行还用着不删、同一批新加的不删、正文里的链接算引用、跨用户隔离、刚上传不满 15 分钟不删、等待期间撤销不删、LWW 输了不触发、R2 出错不影响同步响应、cron 30 天边界、按最晚墓碑算、孤儿按上传时间算、资料图不动、没同步行的前缀不碰、文件和行都分页、单次上限、HEAD）；client `lib/attachment-gone.test.ts`（还在、已删除、从缓存 / 上传队列补传、缩略图重新生成、查不出来不下结论、补传失败、不查的情况、撤销后补传）。
- **替 Rei 定的细节**（待确认）：
  1. 即时删先等 12 秒：删除提示里的「撤销」有 6 秒，同步防抖 1.5 秒，等这一会儿，点了撤销的文件就不会被删。过了这 12 秒再撤销（比如从别的设备恢复），就只能靠本机副本补传。
  2. 文件上传不满 15 分钟不即时删：另一台设备可能刚传了同一份内容、行还没推上来。这种文件留给每天的清理（删满 30 天才删）。所以刚加上就删掉的附件，云端文件会多留 30 天。
  3. 「删满 30 天」按墓碑的 `updated_at`（HLC 里的毫秒，是删除那台设备的时钟），不是服务器收到的时间。
  4. 只清附件，资料图和正文图片（`/api/assets`）不清：资料图公开读、会被多条资料和导入的旧数据共用，正文里还可能是 data: 地址，引用关系复杂，先不动。
  5. 没有同步行的用户哈希前缀（比如从没同步过的账户）不碰。
  6. 清理只看 `sync_row`；本机还在上传队列、没同步上去的行看不到。所以从没被引用的文件要等上传满 30 天才删。
  7. 「文件已删除」只在这次打开 app 时记着，不存本机；下次打开再查一次。

#### 任务详情：附件收进「+」菜单、拖到整列 ✅（2026-10-25）
Rei 2026-10-25 原话：「拖拽文件到详情页面可以直接添加附件。附件也收到这个下拉列表，但附件可以添加多个，添加后下拉列表中还要显示。附件section不要label，显示在属性块下方，不显示add attachment按钮」（附图是属性胶囊后面「+」打开的「添加属性」菜单）。

- **「+」菜单**：最后加一项「附件」（Lucide `paperclip`，英文单数 Attachment，`trc('属性', '附件')`）。点了直接打开系统文件选择，可以多选（在这次点击里调 `input.click()`，不放进 setTimeout，不然 Safari 不认是用户点的）。别的属性设了就从菜单里消失，「附件」不会：加过附件它还在。所以能加附件时「+」一直显示，属性全设了也在。纯逻辑 `lib/prop-chips.ts` 的 `addMenuItems`，单测在 `prop-chips.test.ts`。
- **附件区**：任务详情里不要标题「附件」、个数、「也可以把文件拖到这里」和「添加附件」按钮（`Attachments bare`）。没附件时整块不渲染，不占位；也没有分隔线。
- **顺序**：标题和正文 →（有类型时的「X 信息」折叠块）→ 属性胶囊行 → 附件 → 资料卡片（资料行、进度条、看到哪…）→ 关系。附件紧贴胶囊，从「+」加的附件就出现在「+」下面；资料卡片原来就在胶囊下面，现在往下挪到附件后面。附件原来在正文下面、属性上面，挪走了。
- **拖放**：拖文件到详情整列（右列 `.pane-detail` / 手机整页，包括顶栏和底栏）都能加，可以一次拖多个。拖进来时整列盖一层虚线高亮，中间「松手添加附件 · 每个文件不超过 50 MB」。50 MB 上限、类型、报错沿用原来的 `addAttachments`。桌面置顶小窗（弹窗）没有外框，照旧是内容区。
- **只认从页面外面拖进来的文件**：拖文字、链接不触发（types 里没有 Files）。从页面里开始的拖动也不触发（window 上记 dragstart / dragend）：Chrome 拖页面里的 `<img>` 时 types 里也带 Files，不排除的话编辑器里拖图片挪位置会变成加附件。
- **编辑器的取舍**：当时编辑器不支持把图片文件拖进正文当插图，所以拖到哪里（包括正文）都是加附件。2026-10-25 换成 Tiptap 后分出来了：只有图片、拖到正文上，就上传插进正文；其余照旧是附件（见下面「编辑器换成 Tiptap」）。
- **日记**：日记共用 `Attachments` 组件，但它没有胶囊行，没地方放「+」，所以保持原样：小标题、「添加附件」按钮、「也可以把文件拖到这里」、拖到日记那一块都照旧。「不认页面里开始的拖动」这一条日记也跟着生效。所以「添加附件」「也可以把文件拖到这里」两个字符串日记还在用，没删；上一轮挪到单独一行的提示（中文以外）也还是日记在用。
- **新建面板**不改。
- 截图 `work/shots-attach2/`（脚本 `work/shots-tool/attach2.mjs`，假 API）：三皮肤 × 宽屏 1440 / 手机 390，没附件、「+」菜单、有附件、拖入高亮、带资料卡的类型；苹果宽屏、Material 手机加暗色；苹果宽屏英文。
- **替 Rei 定的**（可以再改）：
  1. 附件排在胶囊下面、资料卡片上面（不是整个属性块最后）。
  2. 拖到正文外面、或者拖的不全是图片，都是加附件。只有图片拖到正文上才插进正文（2026-10-25 换 Tiptap 后加的，见下面「编辑器换成 Tiptap」）。
  3. 日记不改，仍有自己的标题和「添加附件」按钮。
  4. 菜单里的「附件」不显示已有个数。
  5. 桌面置顶小窗里拖放范围仍是内容区，不含弹窗顶栏。

### 农历 ✅（2026-10-17，Rei：「选择日期支持选择中国农历，订阅农历可在设置中看到地址和同步频率」；澄清后确认：从外部订阅一份农历 / 节气日历（ICS），设置里显示源地址和多久同步一次）
- **换算本地查表，不联网**：core `lunar/`——`data.ts`（农历 1900–2100 月大小 / 闰月 201 个数 + 公历 1900–2100 节气表，约 6 KB）由 `packages/core/scripts/gen-lunar-data.mjs` 从 lunar-javascript 1.7.7（MIT，6tail，寿星天文历算法）生成；它不是依赖，只在生成时用，生成时 1900-01-31 … 2100-12-31 逐日核对过农历和节气（全对）。没用 `Intl` 的 chinese 历：Node / 浏览器的 ICU 在 2027、2030、2012、2018 等年份的初一和官方差一天（如 ICU 说 2027 春节是 2-07，官方 2-06）。`lunar.ts`：`solarToLunar` / `lunarToSolar`（不存在的日子 null）、`lunarYearMonths`、`leapMonthOf`、`solarTermOf`、`lunarFestivalOf`（春节、元宵、龙抬头、端午、七夕、中元、中秋、重阳、腊八、小年、除夕；闰月不算）、`lunarYearlyDate`（每年农历 X 月 X 日落在哪天）、`lunarCellLabel`（格子小字优先级：订阅的节日名 > 传统节日 > 节气 > 初一显示月名「九月」「闰六月」> 日子「初八」）。名字在 `names.ts`（中英文界面格子里都照中文显示，同 Apple 日历；选择器、重复规则的英文说法 Month 9 / Day 8 / Leap Month 6）。
- **日期选择**：`DatePanel`（新建 / 详情的日期、倒数日目标日、待安排里排日期）格子下显示农历小字 + 订阅的放假「休」/ 调休上班「班」角标；上面「公历 | 农历」切换（这台设备记住上次用的），农历模式按 农历年（「2026 丙午」）- 月（含闰月）- 日 选，下面写出公历，点「选这天」换算成公历存。日记月历同样显示农历。日期都存公历 `YYYY-MM-DD`，不加列、不加迁移。
- **每年农历重复**：重复规则加 `lunarYearly`，存 RFC 7529 写法 `FREQ=YEARLY;RSCALE=CHINESE;BYMONTH=8;BYMONTHDAY=15`（闰月 `BYMONTH=6L`）。闰月规则：那年有同一个闰月就在闰月，没有就按非闰的同一个月；三十碰上小月取廿九。打卡、连续天数、提醒都按它走（`isDueOn` / `periodStart`）。
- **订阅**：默认源 Apple「中国大陆节假日」`https://calendars.icloud.com/holidays/cn_zh.ics`（macOS / iOS 日历里订阅的同一份；节气、传统节日、法定假日的放假（休）和调休上班（班），简体中文；2026-10-17 实测 246 个事件、2023-12-30 … 2029-12-21，假日安排随国务院公布更新）。备选（没用）：Google 中国节假日 ICS（`calendar.google.com/calendar/ical/zh-cn.china%23holiday%40group.v.calendar.google.com/public/basic.ics`，没有节气）、lanceliao/china-holiday-calender（只有法定假日）、infinet/lunar-calendar（停在 2015、繁体）。Worker `GET /api/calendar/ics?url=…[&fresh=1]`（`apps/server/src/calendar.ts`）代拉避开 CORS：不用登录（没登录也能看节日），只收公网 http(s)、回来的必须是 `BEGIN:VCALENDAR` 开头、≤ 2 MB、10 秒超时，Cache API 6 小时（「立即同步」带 fresh=1 跳过读缓存）；错误附中文状态码（400 请求有误、415 不支持的格式、413 内容太大、502 网关错误 + `upstream_status`、504 网关超时）。客户端 `lib/lunar.ts`：core `parseIcs`（全天 / 多天、DTEND 不含当天、`RRULE:FREQ=YEARLY;COUNT=…`、EXDATE、Apple 的 `X-APPLE-SPECIAL-DAY`、标题里的（休）（班））解析后存这台设备 localStorage（离线可用）；到点自动同步（启动、回到前台、每小时看一眼，按频率；失败隔一小时再试）。订阅的事件只读：显示在日期格子、我的一天副标题、列表每天的标题旁，不成任务；和本地农历冲突时用订阅的名字。
- **设置 → 农历**：「显示农历」（同步偏好 `lunar.show`，没设过跟界面语言：中文开、英文关；**2026-10-25 起改为本机开关「中国农历」，见下一节**）；「农历订阅」源地址（可复制、可改、webcal:// 自动换成 https://、改了的显示「恢复默认」；同步偏好 `lunar.sub_url`，空 = 默认源）；「同步频率」每天 / 每周 / 每月 / 手动（`lunar.sub_freq`，默认每天）；「上次同步 · 3 分钟前」+ 状态（「同步成功，315 个日子」/「同步失败：订阅源返回 404 未找到」…）+「立即同步」。地址和频率跟账户同步；数据、上次同步时间、状态只在这台设备。
- **测试**：core `test/lunar.test.ts`（对照已知日期：2026 春节 2026-02-17、2025 闰六月初一 2025-07-25、2033 闰十一月、1900-01-31 等；1900–2100 逐日往返；每年 24 节气）、`test/lunar-sub.test.ts`（ICS 解析、格子挑选、订阅设置、什么时候同步、状态文案）、`test/recurrence.test.ts`（每年农历：中秋、闰六月十五）；server `test/calendar.test.ts`；client `lib/lunar.test.ts`。截图 work/shots-lunar/（脚本 work/shots-tool/lunar.mjs、lunar-repeat.mjs）。
- **待 Rei 确认**（我先这样定的）：
  1. 「公历 | 农历」切换只在开了「显示农历」时出现（英文界面默认关，要用先在设置里打开）。
  2. 默认源选 Apple「中国大陆节假日」：它覆盖到约 5 年后，没有逐日农历（逐日农历本地算）；想要别的源在设置里换地址。
  3. 订阅不用登录，Worker 代拉对谁都开（只收日历文件，不能当通用代理）。
  4. 闰月重复的说法：选「闰六月十五」，没有闰六月的年份按六月十五；选普通「六月十五」，有闰六月的年份也只在（第一个）六月。
  5. 英文界面格子里的农历、节气、节日照中文显示。

### 农历只在中文界面、且打开「中国农历」时显示 ✅（2026-10-25）
Rei 原话：「日期部分，只有在设置中打开中国农历switch才显示。农历只有在简体中文、繁体中文中显示这个设置选项和界面中显示。这个顶部的四个快捷按钮，用图标，hover tooltip显示文本。」
- **开关**：设置 → 农历 →「中国农历」（Chinese Lunar Calendar），本机设置 `settings.chineseLunar`（localStorage `mindough:settings`，和任务链开关一样不同步），默认关。取代原来的同步偏好「显示农历」`lunar.show`（不再读；旧值留在库里没删）。订阅地址 / 频率仍是同步偏好，只在开关开着时显示。
- **判断**：core `isChineseLocale(locale)`（`zh`、`zh-Hans`、`zh-Hant`、`zh-TW`、`zh_HK`… 凡 zh 开头都算；现在只有 zh / en，以后加繁体不用改调用方）+ `lunarUiVisible(enabled, locale)`；客户端一律 `lib/lunar.ts` 的 `useLunarUi()`（`useLunar().show` 也由它来）。不是中文界面时设置里整节不渲染，开关开过也不显示农历。
- **隐藏时**：日期面板没有「公历 | 农历」与农历选择、日历 / 日记月历格子没有农历小字和休 / 班、我的一天副标题和列表日期标题没有农历一行、订阅不自动同步、重复频率里没有「每年农历」。已有每年农历重复的任务：规则和打卡 / 提醒照常按农历算，频率格子写「每年」+「下次：2027年9月15日」，说法 `describeRecurrence(r, { lunar: false, today })` =「每年 · 下次 2027年9月15日」（core `nextLunarYearly`）。
- **快捷按钮**：`quickDates` 加 `kind`（today / tomorrow / weekend / monday），DatePanel 用 Lucide Sun / Sunrise / Sofa / CalendarArrowUp 的图标按钮，一行四个等宽；新 primitive `TipButton`（React Aria TooltipTrigger + aria-label；触屏按住 500 ms 显示提示、松手不触发、1.5 秒后收起），外观沿用 `.tooltip`（WinUI 皮肤有自己的样子）。
- **顺手修**：农历选择三个下拉挤一行在 292 宽会截成「Mo…」「Da…」：改成「年」一整行、「月 / 日」各半，值超长时省略号。
- **待 Rei 确认**：① 原来的同步偏好「显示农历」作废、改本机开关后，之前在中文界面默认看到农历的设备升级后会先看不到（要去设置里打开一次）；② 今天图标用 Sun（和「我的一天」同一个图标）；③ 本周末 / 下周末的提示文字沿用现有说法（Rei 原话写的「下个周末」，周一到周五是「本周末」）。

### 任务时区 ✅（2026-10-25）
Rei 原话：「日期可以选择时区，时区默认是当前时区，时区默认只显示常用的一些时区，点击显示更多显示完整时区列表」。具体做法是派活时替 Rei 定的（见下面待确认）。
- **数据**：`task.time_zone`（IANA 名，可空），SQLite 迁移 v8 `ALTER TABLE "task" ADD COLUMN "time_zone" TEXT`，`COLUMNS.task.time_zone = 'text?'`；同步照常（云端存整行 JSON，不动云端 schema；行级 LWW）。空 = 跟着设备当前时区（浮动），老任务、滴答清单导入的都是空；在日期面板里选过就存具体名字（哪怕等于设备时区）。旧版本客户端收到带 time_zone 的行会原样存着、不认（不丢）。导出 Markdown 写 `time_zone:`，导入只收认得的（`normalizeTimeZone`）。
- **core `timezone.ts`**：`deviceTimeZone` / `COMMON_TIME_ZONES` / `commonTimeZones(device, recent)` / `allTimeZones()`（`Intl.supportedValuesOf('timeZone')` + UTC）/ `offsetMinutesOn(tz, date)`（那天当地正午的偏移，处理夏令时）/ `formatUtcOffset`（UTC+8、UTC−4、UTC+5:30）/ `timeZoneLabel`（「上海 (UTC+8)」；中文城市名在 `timezone-names.ts`，英文用 IANA 最后一段）/ `matchTimeZone`（城市、IANA、偏移都能搜）/ `taskToday` / `todayIn` / `isTaskOverdue` / `timeZoneBadge` / `pushRecentTimeZone`。单测 `test/timezone.test.ts`。
- **影响**：提醒（`upcomingReminders`）按任务时区的那天、那个钟点换算成绝对时刻，在设备上按换算后的时刻响；我的一天建议「今天到期 / 倒数日到了」按任务时区的今天；列表、详情胶囊的过期红字按任务时区的今天；「今天 / 明天…」快捷按钮和日历上的今天按面板里选的时区算。列表 / 详情日期旁：任务时区和设备那天的偏移不同才标小字「UTC−4」（上海和新加坡偏移一样，不标）；按天分组的列表（列表页）照旧按任务的公历日期归到那一天，行里只标偏移。
- **界面**：`DatePanel` 底部「时区」一行（Lucide globe +「上海 (UTC+8)（跟着设备）」），点开在面板里原地展开：常用（这台设备、最近用过的 5 个（本机 `mindough:tz-recent`）、UTC、上海、新加坡、东京、首尔、洛杉矶、纽约、伦敦、巴黎、柏林、悉尼，去重）+「显示更多」→ 完整列表 + 搜索框；选了不关面板。新建、详情胶囊的日期、待安排里排日期都有；倒数日目标日面板没接。组件 `components/task/TimeZonePicker.tsx`、`components/TaskDateText.tsx`。
- **待 Rei 确认**（派活时替 Rei 定的）：① 时区挂在任务上、存具体名字，空 = 浮动；② 常用列表的这一批城市；③ 只在偏移不同时才标、标「UTC−4」而不是 EDT 缩写；④「今天 / 明天」按所选时区算（东八区早上选纽约「明天」会落在设备的今天）；⑤ 倒数日目标日面板没有时区一行，定期打卡的周期、连续天数仍按设备日期（只有提醒按任务时区的那天那个钟点）；⑥ 英文面板太窄，不写「跟着设备」。

### 从滴答清单导入 ✅（2026-10-21，详见 [docs/IMPORT-DIDA.md](IMPORT-DIDA.md)）
Rei：「添加从dida365导入任务的功能，在菜单栏的File/Import/Dida365，点击后弹出一个导入窗口」；追加「不能直接连接dida365么」——直接连账户为默认，备份 CSV 留作备选。
- **core** `dida/`（单独入口 `@mindough/core/dida`，导入窗口打开时才加载）：`csv.ts`（RFC 4180，带行号）、`parse.ts`（备份 CSV → `DidaRow`：跳过说明行、表头按名字 / 别名认）、`api.ts`（Open API JSON → `DidaRow`；`fetchDidaAccount(call, opts)` 拉清单 / 文件夹 / 未完成 / 已完成（200 条一页，满了时间窗口对半切）/ 已放弃（`task/filter status [-1]`，试的））、`map.ts`（时区换算、提醒、RRULE → Mindough 能存的子集、正文拼法）、`plan.ts`（`planDida` 预览、`previewDida`、`applyDida` 一批写入、`undoDida` 整批撤销）。
- **决定**：任务 id = `stableId('dida-task\0' + taskId)` → 幂等（CSV 和 API 同一个 id）；清单 → 组（同名复用，收集箱默认不放进组），文件夹 → 新建组的分类（不做多层）；放弃 → 关闭；子任务 → 前后关系（子任务 → 父任务，FS，最贴合「做完子任务才算做完父任务」）；未完成任务的简单重复（每天 / 每 N 天 / 每周几 / 每月几号）→ 定期打卡，其余规则写进正文末尾；优先级 / 标签 → 正文末尾 #标签（没有字段）；NOTE → 普通任务；提醒只取同一天的第一个。
- **Worker** `apps/server/src/dida.ts`：`/api/dida/*` 代理到 `https://api.dida365.com`（浏览器跨域不行；Tauri 也走它）。要登录 Mindough；令牌在 `x-dida-token` 头里每次带来，不存；只放行 6 条只读路径；状态码附中文（401 未授权 = 令牌不对或失效）。CORS 允许 `x-dida-token`。
- **客户端**：`components/DidaImport.tsx`（两种方式 → 预览 / 选项 → 结果 / 撤销）、`lib/dida.ts`（令牌只存 localStorage `mindough:dida-token`，不进同步表；经代理调用）、`lib/app-menu.ts`（菜单文字走 tr()、监听 `mindough:menu`）、`lib/ui.tsx` 的 `didaImportOpen`；入口：设置 → 数据、⌘K「从滴答清单导入…」。
- **Tauri** `src-tauri/src/menu.rs`：macOS 全局菜单（App / 文件（导入 ▸ 滴答清单、关闭窗口）/ 编辑 / 窗口，用 Tauri 预置项，复制粘贴快捷键照常）；Windows / Linux 只给主窗口加「文件」菜单（导入 ▸ 滴答清单、退出），不加编辑菜单；启动先用英文建，前端 `set_app_menu` 换成界面语言的文字；点了 `emit_to("main", "mindough:menu", "import-dida365")` 并把主窗口叫到前面。Linux `cargo check` 通过；macOS 分支（`#[cfg(target_os = "macos")]`）在 Linux 上没编到，**没在 Mac 上编译 / 运行过**。
- 没做：OAuth（要 Rei 在滴答开发者中心注册应用，以后可选）；滴答清单的评论、专注记录、习惯、倒数日不导。
- 测试：core `test/dida.test.ts`（CSV + API 两份 fixture）、server `test/dida.test.ts`。截图 `work/shots-dida/`。
- **待 Rei 确认**：见 IMPORT-DIDA.md 末尾 8 条（子任务用前后关系、收集箱不进组、笔记当任务、优先级 / 标签写进正文、只有未完成的重复转打卡、已完成默认全部、中文 CSV 表头别名是猜的、已放弃靠 filter 试拉）。

### 任务链 ✅（2026-10-23，原叫「整条线」）+ 删掉侧边栏关系图页
- Rei 2026-10-23：「侧边栏的Graph选项卡并不是我想要的，可以删掉」「可以一键展示整个FS的一条线上的所有任务。当前一个任务只能展示它的前后任务，但前任务的前任务是没展示出来的」。
- 删掉：`pages/Graph.tsx`、路由 `#/graph`（旧地址打开我的一天）、侧边栏 / 「更多」里的「关系图」、深链接 `view/graph`（打开我的一天，不提示写错）、关系图页专用的文案。组页的「关系图」视图（`DependencyGraph` / `LazyGraph`）保留。⌘K 本来就没有跳关系图的命令。
- core `dag.ts` `taskChain(id, deps, tasks?)`：沿前后关系（不含相关任务）传递地取所有上游 + 下游；只走未删除的边和未删除的任务；按层排（层号 = 从最上游数过来最长的那条路，汇合点排在最晚的那条之后），返回 `ids`（拓扑顺序）、`ancestors`、`descendants`、`layers`、`currentLayer`、线内的 `edges`；只取当前任务的祖先和后代（上游分叉出去的兄弟不算）；有环（不该发生）也不会卡住。测试：直线、只有一层、分叉、汇合、菱形、孤立、已删除的边 / 任务、重复边、环。
- 第一版（c75664f）是「整条线」按钮 → Sheet 弹窗、每层写「第 N 步」、同层多件桌面并排；同日 Rei：「整条线不要弹窗。每个步骤显示相对时间，而不是第几步。改名成‘任务链’」，改成下面的样子。
- 界面 `components/task/TaskChain.tsx`：详情「关系」标题右边「任务链」开关（RAC ToggleButton，Lucide route，有前置或后续时才显示，开着强调色浅底）。开着时 `TaskChainInline` 在「关系」原地替换「先做完这些 / 做完后解锁」两段（这时没有逐条「去掉关系」的 ×，要去掉先关掉任务链），「相关任务」、成环提醒照常；关掉恢复。开关存本机设置 `settings.taskChain`（localStorage `mindough:settings`，不同步），换一件任务沿用。内容：顶上「已完成 N / 共 M」+ 进度条（只算完成，关闭不算）；每层左边小圆点（当前所在层强调色实心）+ 竖线 + 箭头，右边这一步的时间（见下，多件时带「N 件」）和任务卡；同一层有几件时都纵向叠着、左边缩进一道线（详情栏窄，桌面也不并排）；卡上状态点 + 标题（最多两行）+ 状态，当前这件强调色底 +「这件」；接的不正好是上一层全部时写「接在「X」后面」。点别的卡打开那件的详情（任务链还开着）。去掉了第一版的说明句「从上往下做…」（内联后箭头已经说明顺序）。
- 每一步的时间（core `dag.ts`：`taskPlannedDate`、`chainStepWhen`、`chainWhenLabel`，单测中英文）：一步里的任务都结束了（完成 / 关闭）→ 最晚那件的 `done_at`（本机日期）相对今天：今天完成 / 昨天完成 / N 天前完成 / 超过 30 天写「9月1日完成」（不是今年带年份）；没记 `done_at` 写「已完成」。否则只看没结束的几件，取最早的计划日期：一件的计划日期 = 倒数日用 `target_date`（就是截止日）> `scheduled_date`（「日期」，任务表没有单独的截止字段，这个日期就当要做 / 截止的那天）> 最晚一次进「我的一天」的日期；相对今天写 今天 / 明天 / N 天后 / 已过 N 天（色调 overdue，红色 `--danger`），超过 30 天写日期；都没有写「未定时间」。英文 Done Today / Done 3 Days Ago / Today / Tomorrow / In 5 Days / 2 Days Overdue / No Date。
- 为什么用纵向列表不用关系图：手机 390 宽也能读全标题和状态，不用缩放拖动；层就是「先做哪步」，和「先做完这些 / 做完后解锁」的说法一致。
- 截图 `work/shots-chain/`（第一版）、`work/shots-chain2/`（任务链内联 + 相对时间：三皮肤 × 桌面 / 手机）。

### 三列布局 ✅（2026-10-23）：任务详情不再弹窗
- Rei 2026-10-23：「任务链不要再弹窗了，任务详情如果不弹窗最好了，最好做成三列布局」。
- 宽屏（≥ 1100 px）：侧边栏 | 当前视图的列表 | 任务详情（`components/task/DetailPane.tsx`）。有任务列表的页面（我的一天、待安排、列表、组、组详情、可做、打卡）右列常驻，没选中时是空状态「选一件任务查看详情」（Lucide mouse-pointer-click）；日记、资料库、人物、设置等没有任务列表的页面只在打开任务时才出现右列。点列表里一件 → 右列显示，那一行高亮（`is-selected`，`aria-current`）；不在列表里的任务（⌘K、资料库关联任务、通知、深链接）也在右列显示，列表不高亮。右列左边分隔条可拖（双击 / Home 恢复默认，键盘 ← → 调，Shift 大步），宽度 320–720、还要给列表留 360，存本机 `mindough:detail_w`（不同步）；默认 400。Esc（不在输入框、弹层里时）或右上角关闭 = 取消选中；↑ ↓ 在当前页面的任务里换一件（按 `.main [data-task-id]` 的显示顺序，没选中时 ↓ 第一件、↑ 最后一件，自动滚到可见）。
- 中等宽度（761–1099 px）：侧边栏收成图标栏（64 px，macOS 无标题栏时 80 px 给红绿灯；悬停看名字，小节标题变成细线，收起的小节照样列出），列表 + 详情两列；没选中时右列不占地方（列表铺满）。选「图标栏」而不是「侧边栏可收起」：不用多一个开关，导航一直在手边。
- 手机（≤ 760 px，沿用原来的手机断点 `MOBILE_MAX_WIDTH`，不是 720）：详情整页推入（盖住标签栏，从右滑入），左上返回（Apple「‹ 返回」、WinUI / Material 箭头）；从屏幕左边缘右滑跟手返回；进详情时 `history.pushState`，所以浏览器 / 安卓返回键回列表；返回按钮在有这条记录时用 `history.back()`，不攒重复记录。
- 选中的任务写在当前页面 hash 的 `?task=<id>` 上（`#/agenda?task=…`，`lib/router.ts` 的 `taskInHash` / `hashWithTask`；`parseHash` 忽略 ? 后面的参数），刷新后还在；换页面就不带（取消选中）。桌面上选中 / 换一件用 `replaceState`（不攒浏览记录）。`ui.editingId` 就是它（`lib/ui.tsx` 跟着 hashchange / popstate 走），所有入口照旧调 `ui.openEditor(id)`，不用各自改。深链接 `#/task/{id}`（Web）还是先换成 `#/myday` 再在右列打开；`mindough://task/{id}` 在当前页面的右列打开。
- 详情外框 `DetailFrame`（`TaskDetail.tsx`）：`mode="pane"`（右列）/ `"page"`（手机整页）/ `"modal"`（桌面置顶小窗里照旧弹窗，小窗太窄放不下第三列）。右列和整页都是一栏：属性跟在正文、附件后面（`.detail.is-stacked`，原来 `.is-mobile` 的样式改名过来）。顶栏：完成状态 / 进度胶囊 | 我的一天、添加关系、··· | 关闭（整页是返回）；macOS 无标题栏时顶栏空白处可拖窗口。完成 / 关闭这件后：右列留着显示「已完成」+「重新打开」（方便撤回）；手机整页、小窗照旧收起。删除后右列回空状态。
- 新建面板（FAB）不变，还是自己的面板；新建后提示里的「查看」在右列打开。FAB 挪进中间一列（`.main-col`）右下角，不压住右列底栏的主操作。组页关系图单击节点就在右列显示（以前桌面要双击）。
- 皮肤：Apple 像「提醒事项」检查器（白底、左边 0.5 px 细线、底栏不分色，选中行强调色浅底）；WinUI 像 Mail 阅读窗格（右边一块圆角 8 卡片、和列表留缝，选中行浅底 + 左边强调色竖条）；Material 3 list-detail 规范布局（详情是圆角 16 的 surface container，中间 4×48 的拖动把手，选中行 secondary container 色）。
- 没改数据模型；纯逻辑（宽度上下限、↑ ↓ 选下一件、hash 读写）在 `lib/detail-pane.ts` + `lib/router.ts`，单测 `lib/detail-pane.test.ts`。
- 截图 `work/shots-3col/`：三皮肤 × 宽屏（列表 / 选中 / 任务链 / 拖宽 / ⌘K 打开不在列表里的）、中等宽度（选中 / 未选中）、手机（列表 / 推入详情 / 任务链）。
- 🟡 待 Rei 确认：断点（1100 / 760）；中等宽度用图标栏；完成后右列不收起；删除后回空状态（没自动选下一件）；没有任务列表的页面不显示空右列。

### 详情属性胶囊行 ✅（2026-10-25，Rei 选方案 A）
- Rei 2026-10-25：属性区原来一张卡片 7 行（类型 普通 / 完成方式 打勾 / 重复 一次 / 日期 / 提醒 无 / 组 / 人物 无），大半是默认值，太占地方；看了草图（`work/props-sketch/props-sketch.png`：现状 / 方案 A 胶囊行 / 方案 B 两列网格）选 **方案 A · 胶囊行**。
- 单值属性收成一行胶囊（`components/task/PropChips.tsx`），`flex-wrap` 自动换行；**只显示设过的**，默认值算没设：类型 = 普通（`type_id` null 或 `PLAIN_TYPE_ID`）、完成方式 = 勾选完成（`once`）、日期 = 没有（重复任务不适用）、重复 = 只做一次、打卡分类 = 未分类（只有重复任务适用）、提醒 = 不提醒（要有日期 / 倒数日目标日 / 重复才适用，`canRemind`）、组 = 不放进组、和谁有关 = 没有人。纯逻辑在 `lib/prop-chips.ts`（`applicableProps` / `isPropSet` / `setProps` / `unsetProps` / `clearPatch`），单测 `lib/prop-chips.test.ts`。
- 顺序固定：类型、完成方式、日期、重复、打卡分类、提醒、组、和谁有关（先「是什么、怎么算完成」，再「什么时候」，最后「放哪、和谁」）。
- 胶囊 = Lucide 图标 + 值的短文字（`friendlyDate` / `describeRecurrence` / `describeCompletion` / `formatRemindTime`、组用自己的 emoji、人物头像叠 + 名字、类型 / 分类图标带各自颜色）；逾期日期用 `--danger`。点胶囊打开原来的选择器（TypeGrid、CompletionChoice + CompletionSentence、DatePanel、RepeatEditor、CategoryPicker、RemindPanel、GroupList、PeopleList，逻辑不变），弹层锚在胶囊上。
- 清除：能悬停的设备上悬停出现右上角小 ×（`@media (hover: hover)`，不进 Tab 顺序），点了恢复默认、胶囊消失，提示「已清除「日期」」+「撤销」（类型走 `changeTaskType`，撤销把 type_id / 资料 / type_data / 正文一起还原；人物逐个解除关联）；触屏没有 ×，在选择器里选「无」那项（不设日期 / 只做一次 / 普通 / 不放进组 / 不提醒 / 未分类），「和谁有关」弹层底部加了「清除」。键盘：胶囊可 Tab 聚焦，Enter / 空格打开，Backspace / Delete 清除（焦点挪到下一个胶囊或「+」）；读屏名「属性名：值」。
- 行尾「+」：菜单列出适用但没设的属性（图标 + 名字），选一项直接打开那项的选择器（先锚在「+」上，设好后胶囊出现）；全都设了「+」隐藏；一个都没设时是「+ 添加属性」。
- 资料行（选影视 / 书 / 游戏…）和任务字段（进度条、看到哪…）不进胶囊，类型带资料时仍在胶囊下面一张属性卡片里，位置和样子不变。
- 三皮肤（`skin/skins.css`「属性胶囊行」，结构在 `styles/prop-chips.css`）：Apple 浅灰填充的圆角胶囊（高 26）；WinUI 细描边、圆角 4 的按钮（控件底色）；Material 3 assist / input chip（高 32、圆角 8、描边、图标强调色，打开时 secondary container 色）。「+」是虚线 / 细线的小方块。手机胶囊高 32。
- 新建面板不受影响：它本来就有自己的一排属性胶囊（`TaskComposer`，没设时显示属性名、设了显示值，完成方式和重复是下面两段），不是同一个组件，这次没改。
- 截图 `work/shots-chips/`：三皮肤 × 宽屏右列 / 最窄 320 右列 / 手机 × 中英文，各有 无属性 / 少量 / 很多属性（+ 带资料的类型）。
- 🟡 待 Rei 确认：顺序（打卡分类跟在重复后面）；清除都给「撤销」提示；没日期时「+」菜单里不列「提醒」（先设日期才出现）；人物胶囊最多叠 3 个头像、名字超长省略；完成方式胶囊的值用「计数 · 目标 5 公里」这类设定文字（进度 3/10 仍在顶栏进度胶囊里）。

### App 名字 ✅（2026-10-25）：英文 Mindough，中文「念头团」
Rei 2026-10-24 定：英文「Mindough」，中文「思想团」；2026-10-25 中文名改成「念头团」（英文不变），全仓「思想团」→「念头团」（i18n key 一起改，英文译文不变），manifest description 跟着改，sw.js SHELL v3 → v4。
- **界面**：core `appName()` = `tr('念头团')`（英文 Mindough）；tr 的中文原文里写「念头团」（「登录念头团」「关于念头团」），英文词典写 Mindough。设置「关于」、启动占位、手机顶栏兜底、置顶小窗标题、桌面菜单栏（关于 / 隐藏 / 退出）、通知相关说明、Worker 的原生登录结果页（只有中文）都随语言或改成念头团。没有文字字标（关于里是图标 + 文字名，文字随语言）。
- **网页标题**：`lib/i18n.ts` `applyAppTitle` 在启动和换语言时改 `document.title` 与 `apple-mobile-web-app-title`；index.html 里静态写 Mindough（JS 跑之前 / 爬虫）。
- **PWA manifest**：只有一种语言，`name` / `short_name` 保持 Mindough（装到桌面后的名字是 Mindough；iOS「添加到主屏幕」读的是 apple-mobile-web-app-title，随语言）；description 写「Mindough（念头团）：…」。改了 manifest，sw.js SHELL v2 → v3（10-25 改名再 v3 → v4）。
- **原生**：`src-tauri/locales/`——Apple `zh-Hans.lproj` / `en.lproj` 的 `InfoPlist.strings`（CFBundleDisplayName、CFBundleName），macOS 经 `bundle.macOS.files` 打进 Contents/Resources，`src-tauri/Info.plist` 合进 CFBundleLocalizations + LSHasLocalizedDisplayName；iOS 在 ios.yml 打 ipa 前 `scripts/native-locales.sh ios` 放进 .app；Android `values-zh` / `values-zh-rCN` 的 app_name（+ main_activity_title），build.yml 在 `tauri android init` 后 `scripts/native-locales.sh android` 拷进 gen/。
- **不改**：Tauri productName（Mindough，安装包名、.app 文件夹名、数据目录、更新都靠它）、bundle id `dev.rei8t.mindough`、Windows 安装包名、导出文件夹名「Mindough 日期」、User-Agent、`/api/health` 的 `name: 'mindough'`（标识，不是显示名）、仓库名、深链接 `mindough://`。Windows 安装后开始菜单里也还是 Mindough（productName 单语言）。

### 列表行去掉建议徽章和加入按钮 ✅（2026-10-25）
Rei 2026-10-25 先说「任务列表，如果很窄不显示右边的两个按钮」，又说「再宽一点显示图标按钮，很宽则显示图标 + 文本」，最后定了「任何情况下都不显示这两个按钮」，所以不按宽度分档。
- 我的一天「建议」行尾的原因徽章（今天到期 / 今天要打卡 / 刚解锁 / 倒数日到了）和「+ 加入」按钮，多宽都不显示；到期看元信息行里的日期（过期是红色）。core 的 `SUGGESTION_REASON_LABEL` 和排序原因还留着，只是界面不再用。
- 加入我的一天的入口：`TaskRow` 加了右键 / 长按（触屏 500 ms，移动超过 10 px 就取消，长按后松手不会打开任务）/ 键盘菜单键都能打开菜单，菜单项由 `lib/task-menu.ts` 的 `rowMenu` 给出：查看详情 ｜ 加入 / 移出我的一天。所有用 TaskRow 的列表（我的一天、待安排、列表、组、可做、资料 / 人物详情…）都有。任务详情「…」菜单里的「加入我的一天」照旧。

### 打卡卡片的活动图收进圆点 ✅（2026-10-25）
Rei 原话：「check-ins中的任务活动图，不要显示在列表中，而是左上角一个圆点，toggle全宽显示活动图」。原来活动图夹在标题和右边的计数 / +1 中间，把一行挤得很满。
- **圆点**：每张打卡卡片最左边、和标题第一行对齐，一个小圆点按钮（`TipButton`，悬停 / 聚焦有提示，触屏按住也有）。收起时是空心淡圈，展开时是实心，颜色跟活动图一样（打卡类型有颜色就用它，没有就用默认的热力图绿）。读屏名「显示活动图 / 隐藏活动图」，带 `aria-expanded` 和 `aria-controls`。圆点和打开详情的按钮是两个按钮，点圆点不会打开详情，键盘 Tab 能到、Enter / 空格切换。
- **展开**：卡片里多一整行，左右撑满。格子数按宽度算（`lib/habit-heatmap.ts` 的 `fitHeatmap`：格子最小 10 px，手机 9 px，间隔 2 px；放下整数周后把剩下的宽度平分给格子，正好填满；最多 53 周，格子最大 16 px，多出来的宽度留在左边），最近一天在最右。宽度变了（拖右列、转屏）就重算。这时不滚动、不显示月份和星期（和原来行内那张一样是小图）。`Heatmap` 加了 `fit`，别的地方不受影响：页面顶上「过去一年」那张大图照旧。
- **记住**：展开了哪几张存在本机设置 `settings.habitHeatmapOpen`（任务 id 列表，localStorage `mindough:settings`），和任务链开关一样不同步，默认都收起。
- **顺手修**：桌面上中间一列很窄时（右列打开、中等宽度 960），计时那种宽的打卡按钮会压住标题。现在 `.habit-list` 是容器，宽度不到 520 px 时打卡按钮挪到标题下面一行。手机布局不变。
- **替 Rei 定的**（可以再改）：① 圆点放在标题左边，不是卡片外角上；② 展开后是小图（没有月份、星期、图例）；③ 最多显示一年；④ 展开状态每台设备各记各的。

### 界面上「组」改叫「项目」✅（2026-10-25）
Rei 2026-10-25 原话：「groups更改成projects」；问中文要不要一起改，答「要都要改」。
- **改了什么**：凡是用户看得到的「组 / Group」都改成「项目 / Project」：侧边栏和页面标题（Projects）、详情属性胶囊、新建面板的胶囊、项目选择器（「不放进项目」）、空状态（「还没有项目」「项目里的任务都做完了」）、⌘K 占位和结果小字、从滴答清单导入（「清单放进哪个项目」「新建项目「X」」「不放进项目（进待安排）」）、导入导出说明（「文件夹是项目」）、导出时没名字的文件夹「未命名项目」。属性名和导航名分开：`trc('属性', '项目')` = Project，`trc('导航', '项目')` = Projects（不带语境的 `tr('项目')` 是资料库里「项目库」的短名）。
- **不改**：表 `group`、字段 `group_id`、代码里的 Group / groups 标识、路由 `#/groups/<id>`、深链接 `mindough://view/groups` 和 `mindough://group/<id>`、导出 front matter 的 `group:` 和 `_group.md`。新加两个别名：`#/projects`、`mindough://view/projects`，指向同一页；链接仍生成 `#/groups`，旧链接照样能用。导入不认文件夹名，所以「未命名组」→「未命名项目」不影响旧 zip 导入。
- **撞名**：资料库里本来就有个内置类型「项目」（项目库 / Projects，`B.project`）。现在侧边栏的「项目」和资料库的「项目」同名，界面上靠位置区分。要不要给其中一个改名，等 Rei 定。
- 只有表达「一批 / 一套」的「一组」「可能重复 N 组」「这组以后不再提示」这类不是这个概念，没改。

### 列表行选中、悬停、聚焦的底色盖满整行 ✅（2026-10-25）
Rei 原话：「这个左边的一部分focus时背景颜色还是白色的」。我的一天、待安排这种能拖动的列表，选中的浅蓝底只从勾选圈开始，最左边的拖动把手那段还是白的，卡片左上角也没染上。
- 原因：底色画在里面的任务行上，拖动把手在任务行外面。现在悬停、选中的底色画在整行上，键盘聚焦改成画在行里面的一圈（外圈会被卡片圆角裁掉）。WinUI 选中的竖条也挪到整行最左边。
- 第一行、最后一行的底色跟着卡片圆角走。打卡卡片原来选中第一张 / 最后一张时，方角底色会冒出圆角卡片，一起修了。
- 三套皮肤、亮暗色、宽屏 / 中等 / 手机都截图对过（`work/shots-rowfocus/`）。

### 多语言：西、葡、俄、日、德、法、印尼 ✅（2026-10-25）
Rei 2026-10-25 原话：「支持西、葡、俄、日、德、法、印尼」。

- **词典**：每种语言一个文件 `apps/client/src/i18n/locales/{es,pt-BR,ru,ja,de,fr,id}.ts`，每个 1428 条（core + 界面的说法，加内置数据的名字），用到时才下载。缺的字先退回英文，英文也没有才显示中文原文。复数用 ICU 写法。`locales.test.ts` 查 key 齐不齐、占位符、俄语复数、法语标点。
- **设置 → 语言**：原来的三段开关改成下拉，跟随系统加九种。跟随系统时按系统语言顺序找第一个支持的，都不支持用英文。
- **日期和数字**：都走 Intl，按语言出星期、月份、日期、金额、币种名。农历只在中文界面。
- **服务端**：原生登录的结果页按浏览器的 Accept-Language 显示九种语言，认不出用英文（`auth.ts` 的 `nativeLang`，单测 `test/auth.test.ts`）。
- **原生**：Android `values-es / pt-rBR / ru / ja / de / fr / in`、Apple `es / pt-BR / ru / ja / de / fr / id.lproj` 的显示名都是 Mindough，`Info.plist` 的 CFBundleLocalizations 加上这七种（系统才会按这些语言打开 app，WebView 的语言也跟着它），`tauri.conf.json` 的 macOS 文件和 `scripts/native-locales.sh` 一起改。没在真机上装过。
- **宽度**：七种语言在苹果皮肤宽屏截了我的一天、详情、设置、日期弹层；德、俄、法在三套皮肤的宽屏、中等、手机 390 上又看了一遍（`work/shots-i18n/`）。改了这几处：
  - 详情里附件的拖放提示挪到「附件」下面单独一行（中文以外都是，原来只剩「Oder Dateien …」）。
  - 段落标题不折行（俄语「Осталось со вчера」在手机上被挤成两行）；放不下时右边按钮换到下一行。
  - 西文、俄文界面在中间一列很窄时（右列打开、中等宽度），「带回今天」只留太阳图标，悬停有提示。中文、日文照旧显示文字。
  - 法语、西语、葡语的「待安排」改用短叫法（Réception、Entrada），手机底栏不再折成两行；法语输入框占位缩短。
  - 西文的引号、省略号、单位前空格这些原来只给英文的规则，推广到其他西文和俄文。
- **顺手修**：账户状态的说明（「同步服务尚未上线」）原来在词典加载前就算好了，德语界面里会冒出中文；现在等词典好了再查。

替 Rei 定的细节（不对可以改）：
- 葡萄牙语用巴西葡萄牙语（pt-BR），葡萄牙的系统语言也显示它。
- 英文的一周改成从周日开始，跟 Intl（en-US）走；原来英文也是周一。其他语言同样跟 Intl。
- 导航用各系统本地的叫法（参照 iOS / Android 同类功能），不照中文逐字译。
- 「打卡」在其他语言里译成「习惯」（Hábitos、Привычки、習慣、Gewohnheiten…）。
- 在线查资料：中文界面按中文查，其他语言都按英文查（来源只有中英两种结果）。
- 资料库内置类型「项目」和侧边栏「项目」同名，每种语言里都撞，**待 Rei 定**要不要改其中一个。

还要母语者看：七种译文都是照英文意思译的，没有母语者审过。俄语、日语、印尼语最没把握；日期弹层里俄语的单字母星期（п в с ч п с в）是 Intl 的标准写法，但有重复字母，要不要改成两个字母待定。

### 编辑器换成 Tiptap ✅（2026-10-25）
Rei 2026-10-25 原话：「用https://tiptap.dev/docs/editor/getting-started/install/react替代mildown，提供WYSIWYG」。

任务内容、资料 / 人物备注、新建面板、日记用的所见即所得编辑器，内核从 Milkdown 7 换成 Tiptap 3（`@tiptap/react` 的 `useEditor`）。存的还是 markdown，老数据打开、改、存都和以前一样。

- **只用开源扩展**：段落、标题、引用、分隔线、粗斜删、行内代码、代码块、列表、表格、图片、撤销、拖放光标这些官方扩展一个个单独引，不用 StarterKit（它会把用不上的下划线、官方链接和 linkifyjs 一起打进包里）。没用付费的 Pro 扩展。链接、公式、提示块、折叠块、脚注、HTML 片段是自己写的（`components/editor/extensions.ts`、`gh-syntax.ts`、`details.ts`）。
- **markdown 读写用 remark，不用官方的**：`@tiptap/markdown` 基于 marked，写出来的格式和以前存的不一样，表格对齐、脚注、HTML 块也弱；prosemirror-markdown（markdown-it）同样会改写老数据。所以沿用 Milkdown 一直在用的 remark：读是 remark-parse + remark-gfm（加公式、提示块、折叠块）→ Tiptap 文档，写是反过来再走 remark-stringify，规则照搬 Milkdown 7 的 commonmark / gfm 预设（`components/editor/markdown.ts`）。
- **和以前一字不差**：换之前用 Milkdown 7 跑了 190 段样例（各种写法、以前测试里的样例、内置模板、演示数据），记下原文、读写一遍、再读写一遍的结果（`markdown.fixtures.json`）。Tiptap 版逐条比，全部一样（`markdown.test.ts`）。
- **只看不改就不写回**：打开时先记下这篇写出去是什么样；挪光标、全选、点开折叠块、点进公式都不算改。所以原文里 `* 列表`、`__粗__` 这种写法，只看不会被改写。真改了字才存。
- **图片进正文**（新加的）：粘贴图片，或者把图片文件拖到正文上，就上传到 R2，在光标处插 `![](地址)`；传失败就什么都不插，提示「图片没传上去，稍后再试」。拖进来的不全是图片、或者落在正文外面，照旧是附件（`Attachments.tsx` 的 `dropGoesToEditor`）。
- **粘贴**：粘贴纯文字当 markdown 读（网络图片照旧只显示成文字，不加载）；一段字粘到段落中间，接在原来那段里；复制出去是 markdown。
- **只读**：编辑器加了只读模式，能看、能点链接，不能改。
- **快捷键、手打写法**和以前一样：删除线 ⌘⌥X、列表 ⌘⌥8 / ⌘⌥7、代码块 ⌘⌥C、引用 ⌘⇧B、标题 ⌘⌥1–6；⌘Enter、⌘K 不被编辑器吃掉。手打 27 种写法（标题、粗斜删、代码、引用、列表、清单、分隔线、链接、裸网址、表格、`|3x2|`、公式、提示块、折叠块）和 Tab 缩进不失焦，在真实 Chromium 里一个字一个字打过（`work/shots-tool/le-syntax2.mjs`）；新建面板的占位、自动聚焦、Esc、⌘Enter 添加、撤销重做也查过（`tiptap-composer.mjs`）。截图在 `work/shots-tiptap/`。
- **包大小**：编辑器那块（`MdEditor-*.js`，按需加载）从 Milkdown 时的 506 KB（gzip 154 KB）变成 620 KB（gzip 187 KB），多了 33 KB（gzip）。主包不变。

替 Rei 定的细节（不对可以改）：
1. 在链接末尾接着打字，新打的字不算链接（链接不往后延伸）。
2. 新插的表格每列不设对齐（分隔行写成 `| - |`，不是 `| :- |`）。
3. 手打 `![图](网址)` 不变成图片，留着原文（和以前一样）。
4. 离线或没登录时不往正文里插图，只提示「登录并联网后才能把图片放进正文」；附件那边离线排队的做法不变。
5. 只有图片文件、而且拖到能改的正文上，才插进正文；别的文件、图片和别的文件混着拖、拖到正文外面，都当附件。


### 编辑器去掉工具栏、悬停不变色 ✅（2026-10-25）
Rei 2026-10-25 原话：「换成tiptap后，不用显示toolbar。hover编辑器不用change bg。」接着又说：「checklist的markdown trigger `- [ ] `好复杂」（同意加 Notion 式快捷），问「collapsible要怎么触发」（同意加短触发）。

- **工具栏全去掉**：任务详情正文、资料 / 人物备注、新建面板、日记，宽屏和手机都不显示。`MdEditor` 的 `toolbar` 属性、按钮、`handle.run()` / `handle.active()`、工具栏专用的「折叠块」切换命令（`toggleDetails`）一起删了，原来按钮上的 11 个字符串（标题、粗体、斜体、删除线、清单、编号列表、引用、代码、折叠块、表格、格式）九种语言一起删。
- **留着的**：快捷键、手打写法、⌘K 链接框、链接悬停浮层、粘贴 / 拖进图片。⌘K 以前在新建面板里不开（那里没工具栏），现在三处都开。
- **只有工具栏能做的，现在这样打**：清单 `[] ` / `[ ] ` / `[x] `（或 `- [ ] `）；表格 `|3x2| ` 或一行 `| a | b |` 回车；折叠块 `>> ` 或 `<details>` 回车。标题、粗斜删、列表、编号、引用、代码块、链接本来就有快捷键和写法。提示块、公式、附件本来就不在工具栏里，不受影响。
- **悬停、聚焦都不变底色**：去掉 `.detail-body:hover` 的底色和过渡，三皮肤、亮暗一样；聚焦本来就不变底色，只有光标。资料 / 人物备注是输入框样子，聚焦时强调色边框保留（类名从 `is-active` 改成 `is-focused`）。
- **清单短写法**：行首打 `[] `、`[ ] ` 变成没勾的清单项，`[x] ` 变成勾上的，`- [ ] ` 照旧。我们没用官方 TaskItem（一种 listItem 靠 `checked` 区分，同一个列表里能混写清单和普通项），官方那条规则用不上，所以在 `MdListItem.extend` 的 `addInputRules` 里加：普通段落先包进无序列表，再把这一项标成清单；已经在列表项里的交给原来那条规则（顺便也认 `[]`）。代码块里、行中间的 `[ ]` 不变。存的还是 `- [ ]`。
- **折叠块短写法**：行首打 `>> `，这一行后面的字当标题；空行就是空标题，光标在标题里，显示占位「折叠块标题」。规则写在 `Details` 节点的 `addInputRules` 里，优先级 101，比引用（100）先试。
- **和引用的冲突**：先打 `> ` 变成空引用、再打 `> `，也变成折叠块，不再嵌套引用。引用里已经写了东西，在某行开头再打 `> ` 还是嵌套引用（不然没法写嵌套引用了）。
- 检查：`tiptap.test.ts`、`details.test.ts` 加了用例；真实 Chromium 一个字一个字打（`work/shots-tool/le-syntax2.mjs`，加了 `[] ` `[ ] ` `[x] ` `>> ` `> > ` 和普通引用，共 38 项）；截图 `work/shots-notoolbar/`（脚本 `work/shots-tool/notoolbar.mjs`，三皮肤宽屏 + 手机 390，悬停 / 编辑，亮 + 三张暗；量了悬停、聚焦前后底色都是透明）。

替 Rei 定的细节（不对可以改）：
1. 手机上不加气泡菜单之类的替代界面（Rei 没要求），全靠手打写法。
2. `>> ` 变成折叠块后，光标停在标题末尾，回车进正文。
3. 新建面板里 ⌘K 也开链接框（以前那里没有）。

### 我的一天去掉行尾 ×，拖完不高亮 ✅（2026-10-25）
Rei 2026-10-25 原话：「删除my day中的条目右侧的x按钮。拖拽调整顺序后不要highlight」。

- **去掉 ×**：我的一天列表每行右边的 ×（移出我的一天）删了，宽屏、手机、三皮肤都没有。移出我的一天还能这样做：行的右键 / 触屏长按 500 ms / 菜单键（Shift+F10）打开行菜单选「移出我的一天」；详情顶栏的太阳；详情「…」菜单第一项；⌘K 搜索结果行上的太阳。没有专门的快捷键，以前也没有。「移出我的一天」这个字符串别处还在用，不删。待安排行尾是「安排日期」，不是 ×，照旧。
- **高亮是怎么来的**：React Aria 放下后（`useDroppableCollection` 的 `updateFocusAfterDrop`）把焦点挪到被拖的行，还把交互方式强行设成「键盘」，行上就出现 `data-focus-visible`，画出键盘聚焦那圈强调色；拖行身（不拿把手）时，焦点留在行里的按钮上。截图里那种整行浅蓝底，是行被选中（`ui.editingId`）的样子，拖动本身不改选中；之前就选中的行拖完照样选中。
- **改法**（`lib/drag-guard.ts`）：记下拖动是鼠标 / 触屏还是键盘发起的。鼠标 / 触屏拖完，把交互方式改回 pointer，焦点离开列表（放下后 0、80、160 ms 各清一次，React Aria 最晚 50 ms 才挪焦点）；键盘拖动不动，键盘焦点照常留着。拖动中和放下后 350 ms 内的点按不算点开：不选中、不打开详情、不改 `?task=`。用在我的一天、待安排、类型列表、字段列表（类型列表的「点开」也挡住）。
- 检查：`drag-guard.test.tsx`（鼠标拖完清焦点、晚到的焦点也清、键盘拖保留焦点、列表外焦点不动、拖动中和刚放下的点按不算）；真实 Chromium 鼠标拖把手、拖行身、先选中再拖、键盘拖（`work/shots-tool/dbg-mydayx.mjs`）；截图 `work/shots-myday-x/`（脚本 `work/shots-tool/mydayx.mjs`）。

### 我的一天快速添加：去掉「从全部任务添加」，加完马上打开 ✅（2026-10-26）
Rei 2026-10-26 原话：「删除从全部任务添加的按钮，从这里添加任务后立即打开任务」。

- **去掉按钮**：我的一天顶部添加框右边的「从全部任务添加 ⌘K」删了，宽屏、中等宽度、手机、三皮肤都没有，输入框占满一行（右边留白和左边一样）。全局 ⌘K / Ctrl+K 照旧能搜、能把任务加进今天；空状态里「按 ⌘K / Ctrl+K 从全部任务里挑几件」那句还在。「从全部任务添加」这个字符串九种语言都删了。别的页面没有同样的按钮：待安排没有快速添加框，列表（Agenda）每天的添加框本来就只有输入框。
- **加完马上打开**：在框里打字按回车，任务建好、放进今天，马上选中它，和点列表里一行一样：三列时在右列，中等宽度是两栏，手机（≤ 760）整页推入；地址写上 `?task=id`。输入框清空，新的那行滚到看得见的地方。
- **焦点**：照详情打开的老规矩，打开详情不抢焦点，光标也不进正文。宽屏和中等宽度：光标留在添加框里，接着打字回车就是下一件，详情换成最新那件（连着加，以最后一件为准）。手机：详情整页盖住列表，添加框交出焦点，软键盘落下；要写正文就点正文。返回后回到列表，新任务在里面。
- 代码：`lib/quick-add.ts`（建任务、放进今天、打开；手机收键盘；等下一帧滚到新行，连着加时只滚最后一件）。
- 检查：`quick-add.test.ts`（建好后打开、空白不建、连着加停在最后一件、手机交出焦点、宽屏留住焦点、新行晚一帧出现也能滚到、连着加只滚最后一件）。截图 `work/shots-myday-add/`（脚本 `work/shots-tool/mydayadd.mjs`）：三皮肤宽屏亮色、Apple 暗色、中等宽度 980、手机 390（Apple、Material），每组加之前和加之后，手机多一张返回列表。

### 我的一天、待安排、可做：中间列去掉页头，顶上换成添加框 ✅（2026-10-26）
Rei 2026-10-26 原话：「我的一天、待安排、可做的中间列的header去掉，换成输入框」。

- **页头去掉**：这三页中间列不再有图标 + 大标题 + 副标题，最上面就是添加框（和我的一天一样：没有「从全部任务添加」，回车加完马上打开，焦点规矩见上一节）。组件 `components/QuickAddBar.tsx`，三页共用。
- **加到哪**：我的一天进今天；待安排进待安排；可做页也进待安排，和右下角新建按钮在可做页的默认一样。新任务没有前置，马上出现在可做页的「琐事」里，选中并滚到看得见。
- **占位**：我的一天「今天要做什么？按回车添加」（不变）；待安排「想到什么先记下，按回车添加到待安排」；可做「现在想做什么？按回车添加到待安排」。读屏名「添加任务到今天」/「添加任务到待安排」。新字符串九种语言都补了。
- **原来页头里的东西挪到哪**：
  - 副标题（我的一天的日期 · 完成数 · 农历，待安排的「N 件还没定哪天做 / 都安排好了」，可做的「N 件任务的前置都已完成…」）挪到添加框下面、列表上方的一行小字。
  - 我的一天的「打开小窗」按钮（只在桌面 app）挪到添加框行尾，小图标，悬停提示不变。
  - 待安排页头的「新建任务」按钮去掉了：右下角新建按钮和 N 一样打开完整的新建面板，功能没丢；空状态里的「记一件事」还在。
  - 页面标题留一个读屏用的隐藏 `h1`，读屏照样知道在哪一页。
- **macOS 无标题栏**：中间列顶上那条 38px 的拖动条（`titlebar-space`，带 `data-tauri-drag-region`）在 `App.tsx` 里，不在页面里，没动：红绿灯避让、拖窗口、双击放大照旧，添加框在拖动条下面。截图用加 `platform-macos-overlay` 类模拟过，没在真 Mac 上试。
- **手机（≤ 760）**：页面里也不放大标题，标题挪到顶栏（顶栏原来就有这个字，只是透明），左边写「我的一天 / 待安排 / 可做」，右边搜索不变。别的页面照旧。
- 检查：`quick-add.test.ts` 加了待安排 / 可做的用例（交给 create 建、不碰我的一天、空白不建）。截图 `work/shots-myday-add/hl-*.png`（脚本 `work/shots-tool/headerless.mjs`）：待安排、可做三皮肤宽屏亮色，待安排暗色，我的一天 macOS 无标题栏模拟，中等宽度 980 的待安排和可做，手机 390 三页（Apple、Material、WinUI），各有加之前和加之后。

### 日记改版：方案 B「心情为中心」✅（2026-10-25）
Rei 2026-10-25 看完三个原型（docs/JOURNAL-REDESIGN.md），回复：「按B实现」。按推荐做：B 的情绪月历和心情轮为主，正文借 C 的大字和留白。数据表没改，不用迁移。

- **桌面**：日记页铺满中间和右边两列。左边一列是「日记」标题、「今天」、搜索（打开 ⌘K），下面是情绪月历、「这个月的心情」分布条、这个月写过的日子。右边是那天的日记：页头按心情色铺一层很淡的渐变，大号日期「25」+「周日 · 2026年10月 · 今天」+ 前一天 / 后一天，右上角一张大脸（白底圆，下面写心情名和「点脸换心情」），正文 20px、行距 1.75，没有白框。中等宽度（侧边栏收成图标栏）和右边开着任务详情时，月历那列收窄到 280–340px。
- **情绪月历**：每格铺满那天心情色的淡色，中间画那张脸，左上角日期；写了没选心情是中性灰 + 小笔；没写的浅灰；今天还没写是强调色虚线 + 加号；将来的日子是虚线格，点不了。今天强调色描边，选中的那天深色描边。农历开着时，农历小字跟在日期后面。
- **心情轮**（`MoodWheel.tsx`）：12 张脸排成半圆，左边「开心一点」，中间「平平」，右边「不太好」；中间放大显示选中的那张，名字用心情色。点一下选中，再点一下取消。键盘：整个轮子一个 Tab 停靠点，← → ↑ ↓ 换脸（中间先预览）、Home / End 到两头、回车 / 空格选中、Esc 收起并回到大脸按钮。打开时脸从中间散开，选中时播那张脸自己的动画；系统「减少动效」时都不动。
- **还没写的一天**：页头换成大字「今天感觉怎么样？」（过去的日子「那天感觉怎么样？」）+ 心情轮，下面就是编辑器；桌面写一行「心情可以不选，也可以先写再选」，手机底部按钮「先不选，直接写」（点了光标进正文）。选了心情或开始打字，就换成正常页头；这次打开不再换回来，免得删光字时页面跳。
- **手机 390**：`#/journal` 是情绪月历首页（月历 + 分布条 + 列表），底部固定一个按钮：今天写过是「今天 · 满足 · 接着写」，没写是「写今天的日记」。点一天进那篇；写作页顶部是回月历按钮和「‹ 今天 ›」。我的一天的小卡、⌘K「写今天的日记」、21:00 提醒、深链接 `journal/today` 都直接打开今天那篇（路由带上今天的日期），不停在月历首页。
- **三皮肤**：只改令牌和 `styles/journal.css`、`skin/skins.css`。格子圆角 Apple 12、WinUI 4、Material 16；Material 写作区用 surface-2，心情轮面板 28 圆角，底部按钮是强调色（extended FAB 形状）；WinUI 按钮 6 圆角。亮暗都调过淡色比例（暗色格子 30%、页头 16%）。
- **其他**：旧的 2 × 6 心情按钮（`MoodPicker.tsx`）删了；`MoodIcon` 的 12 个图标和动画没动。core 加 `monthMoodStats`（写了几天、每种心情几天、没选心情几天、不认识的心情几天）。新字符串 19 个，九种语言都补了。
- 检查：core `journal.test.ts` 加了分布统计；client `MoodWheel.test.tsx`（半圆位置、方向键、单选和 Tab 停靠点、窄版不写名字）。截图 `work/shots-journal-b/`（脚本 `work/shots-tool/jb-*.mjs`），和原型 B 并排对比的是 `compare-*.png`。

按原型默认做了，待 Rei 确认：
1. **「这个月的心情」分布条和「写了 N 天」**：原型标的「可选」，按原型做了。长短按天数；写了没选心情的算一段灰色「没选心情」。这个月一篇都没有就不显示。
2. **写作页跟着心情变色**：只在页头铺一层很淡的渐变（亮色 22%、暗色 16%），正文区不变色；没选心情时是强调色很淡的一层。
3. **日记页藏掉新建任务的浮动按钮**：桌面和手机都藏，按 N 和 ⌘K 照样能新建任务。（JOURNAL.md 第 3 节原来定的是保留。）
4. **心情轮选完就收起**：选中或取消后轮子收起，大脸播一次动画；Esc 也收起。原型手机图里轮子一直摊开，这里改成点大脸才打开，免得占掉正文上面一大块。
5. **手机日记首页是月历**：JOURNAL.md 第 4 节原来写「进来是今天那篇」，按原型 B 改成月历首页；从我的一天、⌘K、提醒、深链接进来仍是今天那篇。
6. **列表不再显示字数**：原型 B 的列表只有日期、脸、第一行；字数还在写作页底部。

### 倒数日单独一页，侧边栏加「持续」小节 ✅（2026-10-26）
Rei 2026-10-26 原话：「把倒数日从“打卡”中拆出来单独一个侧边栏入口，把打卡、倒数日、日记放在另一个section：持续」。

- **侧边栏**：今天（我的一天、待安排、可做）· 计划（列表、项目）· 持续（打卡、倒数日、日记）· 资料（资料库、人物）；设置还在底部。中等宽度的图标栏、手机「更多」页跟着同样的分组走。手机标签栏还是 我的一天 · 待安排 · 列表 · 打卡 · 更多（按侧边栏顺序排，所以列表挪到了打卡前面），倒数日和日记在「更多」的「持续」里。
- **「持续」怎么译**：英文 Ongoing；西 Día a día、葡 Dia a dia、俄 Изо дня в день、日 継続、德 Fortlaufend、法 Au quotidien、印尼 Berkelanjutan。这几种照英文意思译，待母语者看。
- **倒数日页**（`pages/Countdowns.tsx`）：图标 Hourglass（打卡是 CalendarCheck2，日记是 NotebookPen）。卡片和原来打卡页里那一节一样，点开是任务详情，提醒、农历重复都在详情里。排序：今天和还没到的在前，越近越前；已经过了的排后面，刚过的在前（以前按任务顺序）。空状态「还没有倒数日」+「考试、纪念日、出发那天，记下来看看还有几天。」。页头按钮「新建倒数日」；这一页的右下角加号和 N 也默认建倒数日（新建面板打开时指定了完成方式，换类型时不跟着类型的默认完成方式变）。
- **打卡页**不再显示倒数日。
- **地址**：`#/countdown`（别名 `#/countdowns`）、深链接 `mindough://view/countdown`（别名 `view/countdowns`）。以前倒数日没有单独的锚点；为了保险，`#/checkin#countdown`、`#/checkin/countdown` 也打开倒数日页。
- 没有计数徽标（打卡、日记也没有）。⌘K 没有「跳到某页」的列表，桌面菜单栏也没有「前往」菜单，所以这两处不用改。数据结构没改。
### 设置分成五项，桌面端单独一个窗口 ✅（2026-10-26）
Rei 2026-10-26 原话：「设置在桌面端做成一个单独的窗口，设置窗口侧边栏：账户、外观」，补充「数据、提醒、任务」，又说「农历、类型、日记这三个可以放在一个」。

- **五项和里面放什么**（原来的七节拆进去）：
  - 账户：登录 / 退出、同步状态和「立即同步」、数据怎么走。
  - 外观：皮肤、语言、明暗、布局、热力图每月 1 号标记。
  - 数据：本机存储（含还没同步的改动数）、导出、导入、从滴答清单导入、重置演示数据，最下面是关于。
  - 提醒：提醒通知总开关（这台设备）、什么时候提醒。只放任务提醒原来就有的内容。
  - 任务：类型（编辑类型）、日记（一天从几点开始、每天提醒写日记，21:00 那个提醒也在这里，不拆到「提醒」）、农历（只在中文界面出现）。
- **桌面 app**：设置是单独的窗口（Tauri label `settings`，`?window=settings`），760 × 560，最小 640 × 440，可以拖大。左边侧栏是 Lucide 图标 + 名字，右边是内容，顶上写当前这项的名字。macOS 和主窗口一样隐藏标题栏，红绿灯浮在侧栏上方，侧栏和右边顶栏都留出 44px，不压内容，空白处能拖窗口。
  - 打开方式：主窗口侧边栏底部「设置」、⌘,（Windows / Linux 是 Ctrl+,）、应用菜单「设置…」（macOS 在 App 菜单「关于」下面，Windows / Linux 在「文件」里）、深链 `mindough://view/settings`（也可以 `view/settings/appearance` 直接到某一项）、手机布局下「更多」里的设置。已经开着就叫到前面，不开第二个；带了某一项就换过去。
  - 两个窗口实时同步：数据（语言、日记、类型、农历订阅）照旧走窗口间的 `mindough:changes`；本机设置（皮肤、明暗、布局、农历开关）、提醒通知开关、登录 / 退出走新的 `mindough:relay` 事件，另一个窗口收到就重新读；同一浏览器的别的标签页也听 `storage` 事件。
  - 设置窗口不跑同步、不传附件。同步状态由主窗口发过来，设置窗口里点「立即同步」交给主窗口去做；「从滴答清单导入…」在主窗口里打开导入窗口；在设置窗口重置演示数据，主窗口先重新载入，1.5 秒后设置窗口再载入，免得生成两份演示数据。
  - 记住上次看的那项（只记在本机）。
- **Web 和手机**：仍是页面，分类一样。宽屏左边一列五项、右边内容；窄屏（≤ 760，也就是手机布局）先列出五项，每项下面一行小字说里面有什么，点进去整页推入，左上角「‹ 设置」返回。hash 能深链到某一项：`#/settings/account|appearance|data|reminders|tasks`；旧的 `#/settings` 照旧能用（宽屏显示上次那项）。登录回跳到 `#/settings/account`。
- **键盘**：侧栏的五项是链接，Tab 能到；在侧栏里按 ↑ ↓（Home / End）换项，焦点跟着走。
- 新字符串 10 个，九种语言都补了。Rust 改了 `menu.rs`（「设置…」菜单项和 CmdOrCtrl+, 快捷键）；capabilities 给 `settings` 窗口同样的权限，另加 `core:window:allow-set-title`（换语言时改窗口标题）。
- 检查：`deeplink.test.ts` 加了 `#/settings/<项>` 和 `view/settings/<项>`；截图 `work/shots-settings-win/`（脚本 `work/shots-tool/settingswin.mjs`）。桌面窗口在沙箱里跑不了，截图是用 Web 的 `?window=settings` 按 760 × 560 模拟的；真机 Tauri 还没验。

### 整页不再能滚 ✅（2026-10-26）
Rei 2026-10-26 报 bug：「整个页面居然可以滚动」。截图是 macOS 桌面版、暗色：整个界面往上跑了一截，侧边栏顶上的项目压在红绿灯下面，窗口下面三成是空白，列表最后一行被切掉。

- **根因**：两件事叠在一起。
  1. 外层只写了 `overflow-x: hidden`（10-17「页面不能左右移动」时加的）。横向设成 hidden，浏览器会把纵向也算成 auto，于是 `#root`、`.app` 成了能滚的盒子。
  2. 会滚的列（`.main`、`.main-scroll`、侧边栏）没有 `position`。列表里 `position: absolute` 的东西，比如 React Aria 开关、复选框里藏着的 input，参照物就成了外面的 `.main-col`，不受这一列裁剪，排在长列表底下把 `.app` 撑高。设置页撑出 172–475 px，列表（日程）页撑出 1000 多 px。
- **结果**：这几种操作都会把整个 `.app` 往上推：在侧边栏上滚滚轮（macOS 无标题栏时侧边栏本身不滚，滚动交给外层）、列表页打开时 `scrollIntoView({ block: 'center' })` 定位「今天」（一打开就上移 19 px）、键盘和聚焦把行滚进视野。手机网页也一样：列表、可做、设置三页整页能滚，顶栏会被滚走。
- **改法**：
  1. `html` 设 `overflow: hidden`；`body`、`#root`、`.app` 设 `overflow: clip`（连脚本都滚不动；老 WebKit 不认就退回 hidden）。桌面布局再加 `overscroll-behavior: none`，整页不回弹；手机网页不加，保留浏览器的下拉刷新。
  2. 侧边栏、导航、`.main`、`.main-scroll`、详情框、`.pane-body`、小窗列表都加 `position: relative`，里面的绝对定位元素被各自那一列裁住。
  3. 小窗高度从 `100vh` 改成 `100%`，跟着 `#root` 走。
  4. 列表页定位「今天」、详情里方向键切换任务、Markdown 脚注跳转，改用 `lib/root-scroll` 的 `scrollIntoContainer`：只滚最近的那一列。
  5. 兜底：`installRootScrollGuard` 监听外层的滚动，桌面布局、鼠标操作时一被滚动就归零。手机、触屏、软键盘弹出（可见区域变矮）、手指放大时不拦，系统要滚整页让输入框露出来。
- **验证**：Playwright 在 Chromium 和 WebKit 里跑（`work/shots-tool/noscroll*.mjs`）：我的一天、待安排、列表、项目、资料库、人物、日记、打卡、设置逐页点开，各在中列和侧边栏上滚滚轮，再按方向键、End、Home、PageDown、空格，点最后一行开详情，编辑器里连打 40 个回车，开关 ⌘K 和新建面板，窗口变矮再变高，最后脚本强行滚外层。修前列表、设置两页 `.app` 被推上去；修后每一步 `window.scrollY` 和外层 `scrollTop` 都是 0。修前修后同一状态截图逐像素比：只有列表页不一样（修前整页上移了 19 px）；其他页在 Chromium 里逐像素相同，WebKit 里资料库、打卡有一百来个像素的差别，Chromium 里没有，判断是图片和动画的抖动。
- **桌面版要重新打包才有效**：Tauri 打包的是本地资源，网页版部署后马上生效，装在 Mac 上的 App 要等下一次打包。

### 项目页：列表 / 看板 / 时间轴 / 任务链，右上角视图和排序，顶上换成添加框 ✅（2026-10-26）
Rei 2026-10-26 原话：

- 「每个项目的视图支持列表、看板、时间轴，排序支持创建时间、修改时间、开始时间、到期时间，正序、倒序。视图和排序放在右上角图标按钮，点击dropdown。新建任务也统一换成输入框。标题和图标左上角，小一点，和右侧图标对齐」
- 「关系图完全去掉」
- 「添加另外一个视图：任务链」
- 「把项目中的任务关系按照任务链排列」

做了什么（项目页 = 单个项目的任务页，代码里是 group）：

- **页头**：左上角项目图标 + 名字，名字 18px（手机 17px），后面跟一行小字（起止时间 · 分类 · 默认类型，放不下就省略，手机不显示）；右上角两个图标按钮，和标题在同一行、同高（32px）、垂直居中。页头里原来只有「新建任务」一个按钮，没有「编辑项目」「更多」，所以没加第三个「…」。macOS 无标题栏的拖动条在 `App.tsx` 里，没动。
- **视图**（右上第一个按钮，图标跟着当前视图变）：列表（layout-list）、看板（kanban）、时间轴（gantt-chart）、任务链（workflow）。React Aria 菜单，单选打勾。原来的「卡片」视图不在 Rei 说的里面，一起去掉了。
- **排序**（右上第二个按钮，arrow-up-down；选了默认以外的字段时图标变强调色）：两组，「排序依据」默认顺序 / 创建时间 / 修改时间 / 开始时间 / 到期时间，「顺序」正序 / 倒序。没有这个日期的任务正序倒序都排最后。
  - **默认顺序**就是原来的顺序：任务的 `sort` 字段，一样时先建的在前（和 `store.tasks()` 一致）。项目页原来不能手动拖动排序，所以没有「手动」这一项；默认顺序下「顺序」一组灰掉。
  - **开始时间** = `scheduled_date`（界面上的「日期」）。**到期时间**：倒数日取 `target_date`（目标日），其他任务也取 `scheduled_date`（只有一个日期，它就是要做 / 截止的那天）。**创建时间** = `created_at`；**修改时间** = `updated_at`（HLC，按字符串比）。任务表没有单独的开始、到期两列，没改数据结构。
- **每个项目记住自己的视图和排序**：存在本机设置 `settings.projectViews`（项目 id → 视图、排序、正倒序、时间轴缩放），不同步、不改项目表。读到认不出的值，或以前存的「关系图」「卡片」，都回落成列表。
- **看板**：按状态分四列 待办 / 进行中 / 完成 / 关闭，列内按当前排序。卡片就是列表那一行（勾选、太阳、右键菜单都在）。拖到别的列就改成那一列的状态，结束态照常弹「已完成…接下来可以做…」和撤销。键盘：聚焦卡片左边的拖动把手按回车，方向键换列，回车放下（React Aria 拖放）。放不下四列时整个看板横向滚动（手机每列约 78% 屏宽）。
- **时间轴**：每件有日期的任务一行，横条从开始画到到期；只有一个日期就画一天。日 / 周 / 月三档缩放（本机记住，默认周），红色今天线，打开时滚到今天附近；任务名一栏贴在左边，横向滚动时不动。本项目里两件都在时间轴上的前后关系画箭头（前一件的尾 → 后一件的头）。没有日期的放下面「未定时间 N」。
- **任务链**：项目里由前后关系连起来的任务排成一条条任务链，排法和详情「任务链」完全一样（core `projectChains` 和 `taskChain` 共用一套分层 `layerNodes`）：先做完的在上，每一步写相对时间，分叉 / 汇合时一步里叠几件、写「接在「X」后面」。链上别的项目的前置 / 后续也列出来，标「在「项目名」里」（不在项目里的标「不在项目里」），点开就是那件任务，链不断开。只走本项目任务的上游、下游，不顺着别的项目的兄弟任务往外扩。排序菜单只决定链的先后（看链首：链里按依赖排第一的本项目任务在当前排序里的位置），链内顺序只看依赖。没有前后关系的任务放最后「单独的任务 N」，有链时默认收起。详情的步骤组件抽成 `ChainSteps`，两边共用。
- **新建任务**：项目页顶上换成添加框（复用 `components/QuickAddBar.tsx`，和我的一天、待安排、可做同一个），占位「这个项目里要做什么？按回车添加」，读屏名「添加任务到这个项目」。回车建到本项目（带项目的默认类型），马上打开详情；看板里新任务是待办，自然在待办列。项目页不再显示右下角新建按钮（N 和 ⌘K 照旧）。
- **关系图完全去掉**：删了 `DependencyGraph.tsx`、`LazyGraph.tsx`、`lib/graph-layout.ts` 和它的单测、`TaskCard.tsx`（只给卡片视图用）、`.graph*` / `.react-flow*` / `.legend*` / `.task-card*` 样式，依赖 `@xyflow/react`、`elkjs`（只有关系图用）；字符串「关系图」「正在加载关系图…」「正在排布…」「相关（不分先后）」「卡片」九种语言都删了。项目页没有地址参数选视图，旧链接 `view/graph`、`#/graph` 照旧打开我的一天。详情里的「任务链」「关系」区不是关系图，留着。
- 新字符串 31 个，九种语言都补了（法语标点前用不换行空格）。
- 检查：core `project-chains.test.ts`（链和详情任务链分层一致、跨项目不断链、不拉进兄弟任务、链的先后跟排序、删掉的不算）；client `project-view.test.ts`（设置回落、开始 / 到期字段、各字段正倒序和没日期排最后、看板分列、时间轴区间和位置）。截图 `work/shots-project-views/`（脚本 `work/shots-tool/project-views.mjs`）：四种视图 × 三皮肤宽屏亮色、Apple 宽屏暗色、Apple 中等宽度 960、手机 390（Apple 亮色、Material 暗色），两个菜单打开（宽屏、手机），看板添加后。

### 滴答清单导入：时间范围对所有任务生效 ✅（2026-10-26，详见 [docs/IMPORT-DIDA.md](IMPORT-DIDA.md)「时间范围」）
Rei 2026-10-26：「之前导入dad365的问题解决了么，选择30天实际是全部的问题」；16:08 又说「现在是可以选30天、半年、全部的，但选择了30天，还是会导入全部」。
- **原因**：范围只传给已完成的接口；未完成、已放弃的全部拉进来；备份文件导入没有这个选择器。
- **改了什么**：选择器挪到两种方式共用的位置，叫「导入哪段时间的任务」，选项改成 全部 / 最近半年 / 最近 30 天（去掉「最近一年」「不导入已完成的」；不想要某种状态，预览里还有三个开关）；下面写「按任务最后修改或完成的时间算。」。core `dida/range.ts` 统一筛：未完成看修改时间（没有看创建时间），已完成看完成时间，已放弃看修改时间；「全部」不筛；没有时间的照样导入并提示。连账户时最后在本地再筛一遍；已完成接口要是没按时间筛，不再对半切，靠本地筛兜底。预览里写「另有 N 件不在所选时间范围里，没读进来」。
- `fetchDidaAccount` 的选项 `completedDays` 改名 `days`，加 `completed?: false`；返回多了 `dropped`。
- 测试：core `test/dida.test.ts` 加未完成 / 已放弃按范围筛、接口不筛时本地兜底、请求体时间写法、备份文件 30 天 / 半年 / 全部。
- 没验证：真实账户上已完成接口是否按时间筛、API 任务里有没有 modifiedTime（Open API 文档的任务字段里没写）。

### 计数的步长和快捷按钮 ✅（2026-10-26）
Rei 2026-10-26：「这个计数，如果是喝2000mL水的话，每次只能加1，太不合理了吧，有什么合理的方式么？」看了方案回「完美」「按这个实现」。

- **每次加多少**：设置里第二行「每次加 [250] mL」。选或改单位时自动填：mL 250、页 10、分钟 5、次 1，别的常见单位按合理值（L 0.5、公里 1、步 1000、千卡 100…，表在 core `count.ts`），自定义单位 1。手改过步长就记一个 `step_set`，之后换单位不再覆盖。
- **快捷按钮**：任务上最多三个，比如「+250」「+500」；设置第三行能改、删、加。没改过时默认是步长和步长 × 2，单位是「次」只给 +1。列表行在电脑上全放，手机上只放第一个；详情底栏和进度弹层全放。
- **手输**：点当前数字变成输入框。选的是「直接改成总数」：喝水这类场景，人看着杯子知道「现在一共喝了多少」，比算「这次喝了多少」顺手。想加一个量也行，输「+330」就是加 330，「-100」是减。改成总数记成一条差值事件（可以是负数），进度照旧只由 check_in 累加，多端合并不受影响。
- **撤销**：每次加量都有提示「加了 250 mL」+「撤销」；详情底栏和进度弹层里有「撤销上一次」，撤这个周期最后一次加量。撤销就是给那条 check_in 打墓碑（`store.undoCheckIn`），会同步到别的设备。只做一次的任务因为这次加量才完成的，撤销后不再达标就改回待办；完成提示里的「撤销」也走这个。
- **数据**：任务加一列 `count_config`（JSON，SQLite 迁移 v9，默认 `{}`）：`{ step, step_set, quick }`。没有现成的计数配置 JSON，所以新开一列；云端存整行 JSON，不用动云端 schema，照行级 LWW 同步。老任务（还没有这列，或拉下来的旧行）在内存里补成 `{}`：步长 1、只有一个 +1，和以前一模一样；改过单位或步长才写进配置。导出导入多一个 `count` 字段（docs/EXPORT.md）。演示数据里「读书 30 页」「跑步 5 公里」带上了步长。
- **小数**：步长、快捷量、手输都能是小数，最多两位；累加后四舍五入到两位，免得出 0.30000000000000004。目标还是至少 1。
- 测试：core `test/count.test.ts`（默认步长、换单位不覆盖手改、快捷按钮默认 / 改 / 上限、手输解析、加量完成后撤销改回待办、撤销上一次、老数据补空对象）。截图在 `work/shots-count-step/`。

### 设置拆成七项：关于、日记单独一项；侧栏不左右滚；数据流向改对 ✅（2026-10-26）
Rei 2026-10-26 原话：

- 「这个页面的底部的关于念头团的说明，可以放在一个单独的选项卡：关于」（截图是设置 → 数据页底部那块）
- 17:12「设置的侧边栏禁止左右滚动」
- 17:13「这个数据流不对吧，其他设备不也要通过worker么？」（截图是设置 → 账户的流向图：这台设备 → Worker → Turso（东京）→ 其他设备，窄了以后箭头单独掉到第二行）
- 17:17「设置中日记单独一个tab」

改了什么：

- **七项**：账户、外观、数据、提醒、任务、日记、关于。桌面设置窗口、Web 宽屏侧栏、窄屏列表三处都一样。
  - 关于（Lucide `Info`）：app 图标、名字（中文界面念头团，其他语言 Mindough）、「版本 0.1.0 (60eeba0)」、「数据先存在这台设备上，离线也能用」、TMDB 署名（logo + 英文原文，中文界面再加一行中文）。数据页底部不再有这块。署名照原样搬过来：仓库里原本只有 TMDB 的署名，豆瓣、Open Library、Steam 没有现成署名，这次没加。
  - 版本号：`vite.config.ts` 用 define 注入 `__APP_VERSION__`（读 `src-tauri/tauri.conf.json` 的 version，和安装包一致）和 `__GIT_SHA__`（`GITHUB_SHA` 前 7 位，没有就跑 `git rev-parse --short HEAD`，再没有就不写）。`lib/version.ts` 拼成「0.1.0 (60eeba0)」。
  - 日记（Lucide `NotebookPen`，和侧边栏日记页同一个图标）：一天从几点开始、每天提醒写日记（21:00）。任务页只留类型和农历。
  - 深链：`#/settings/journal`、`#/settings/about`，`mindough://view/settings/journal|about`。旧的 `#/settings/tasks`、`#/settings/data` 照旧能打开（原来没有指向日记或关于的锚点，不用另做跳转）。
  - macOS 应用菜单「关于念头团」还是系统默认的关于面板，Rust 没动。
- **侧栏不左右滚**：设置窗口的 `.settings-side` 纵向照旧能滚（项多、窗口矮时），横向 `overflow-x: hidden` + `overscroll-behavior-x: none` + `touch-action: pan-y`；侧栏列表 `.settings-nav`（窗口和 Web 宽屏共用）`overflow-x: clip`，纵向保持 visible，不会多出一个能纵向滚的外层（29ea3bd 的教训）。名字太长截断加省略号。
- **数据流向**：同步的推送、拉取都走 Worker 的 `/api/sync/*`，其他设备也一样。改成 Worker 在中间：这台设备 ⇄ Worker ⇄ 云端库，其他设备 ⇄ Worker，箭头都是双向（Lucide `ArrowLeftRight`）。格子上的字：这台设备「先存在这里」、Worker「核对是你本人，转发改动」、云端库（Turso（东京）/ Cloudflare D1，按服务器的 STORAGE_BACKEND）「保存一份」、其他设备「也经 Worker 同步」。上面那段说明也改成「你的其他设备也经 Worker 同步」。
  - 排法按这块自己的宽度切（容器查询，不看窗口宽度）：≥ 560px 排成 T 字，上一排三格，其他设备在 Worker 正下方；窄了两列竖排，这台设备、其他设备在上，Worker、云端库各占一整行，箭头转 90°。格子和箭头都在网格里固定的位置，不会再有掉到下一行的箭头。设置窗口 760 × 560 里走竖排。
- 新字符串 9 个、改 5 个，九种语言都补了。
- 检查：typecheck、全部单测（`deeplink.test.ts` 加了 journal / about，`cloud.test.ts` 改成新说法）。Playwright `work/shots-tool/settings-about.mjs`：三种皮肤宽屏、390 手机、模拟设置窗口 760 × 560；七项和顺序、关于内容（含版本号）、数据页没有关于、任务页没有日记、日记页内容、流向图宽时 T 字窄时竖排、窗口里流向图不超出内容区；侧栏用滚轮横扫、脚本设 `scrollLeft`、德语和俄语加超长名字，`scrollLeft` 都是 0，长名字有省略号。截图在 `work/shots-settings-about/`。桌面 Tauri 窗口和 macOS 触控板没在真机上试。

### 设置 → 任务：日期显示（自动 / 相对时间 / 年月日 / 年月日+时区）✅（2026-10-26）
Rei 2026-10-26 原话：「设置-任务：支持自定义日期显示格式，相对时间、年月日、年月日+时区、自动等」。

- **四种方式**（设置 → 任务 →「日期显示」，单选，每项右边用今天（带现在的时刻）和三天后做实时预览）：
  - 自动（默认）：和以前一模一样。列表行前后两天内说今天 / 明天 / 昨天 / 后天 / 前天，再远写「10月29日 周四」；详情同上，不是今年的带年份；倒数日卡片「11月19日 周四」；任务链 30 天内「N 天后」，再远写日期。
  - 相对时间：一律相对，「3 天后」「6 天前」「2 个月后」「1 年后」；30 天内按天，一年内按月，再远按年。中文自己拼（数字和单位之间有空格），其他语言用 `Intl.RelativeTimeFormat`，单独成标签时首字母大写（In 3 days）。
  - 年月日：按界面语言的本地格式（`Intl` dateStyle medium：2026年10月26日 / Oct 26, 2026 / 26.10.2026 / 2026/10/26），当年也写年份；带时刻的跟着写时刻（中文 24 小时，其他语言按习惯）。
  - 年月日+时区：年月日（和时刻）后面带「GMT+8」这样的偏移，按任务时区（没设就按设备时区）在那天的偏移算，夏令时也对；这时日期旁边原来的「UTC−4」小标注不再重复显示。提醒时间在这种方式下也带时区（「21:00 GMT+8」），其他方式只写时刻。
- **统一走 core**：`packages/core/src/date-display.ts` 的 `formatTaskDate(date, { mode, today, time, timeZone, compact, locale })`、`formatTaskTime`（提醒时刻）、`formatTaskInstant`（创建 / 修改这类时间点）。`chainWhenLabel`、`describeCompletion` 多了一个可选的 mode 参数，不传就是自动。
- **用到的地方**：任务列表行（含项目看板卡片，用的是同一个行）、详情日期胶囊和提醒胶囊、新建任务面板的日期 / 提醒胶囊、详情里倒数日进度下面那行、倒数日完成方式摘要和目标日期按钮、任务字段里的日期（出发日期这类）、倒数日卡片的日期文字、任务链步骤标签、项目时间轴横条上的日期。
- **不跟着变**：我的一天 / 列表的日期分组标题、日期选择器、农历小字、日记和日记月历、时间轴刻度、打卡热力图、人物生日、项目（组）的起止日期、「每年 · 下次…」这类重复规则说明。倒数日「还有 N 天」大数字不变。界面上现在没有地方显示任务的创建 / 修改时间，`formatTaskInstant` 先备好、有单测，等以后有显示的地方再接。
- **存哪**：本机设置 `dateDisplay`（`mindough:settings`），不进同步数据；桌面多窗口经 `mindough:relay` 跟着变，同一浏览器别的标签页听 `storage`。调试可以在地址栏加 `?dates=relative|ymd|ymd-tz`。
- 新字符串 6 个、改 2 个，九种语言都补了。
- 检查：core `test/date-display.test.ts`（四种方式 × 中英 × 当年 / 跨年 × 有无时刻，另有德语、日语、印度时区、纽约夏令时、提醒时刻、时间点、倒数日摘要、任务链）；全部单测、typecheck。Playwright `work/shots-tool/date-display.mjs`：设置里四项和预览、点选后存进本机设置、回到倒数日页文字变成年月日、「还有 N 天」不变；四种方式下倒数日页、可做页、详情各截一张；英文、设置窗口 760 × 560 暗色、390 手机（窄时预览换到名字下面一行）。截图在 `work/shots-settings-about/date-display-*.png`。

### 界面上「类型」改叫「资料库」✅（2026-10-26）
Rei 2026-10-26 原话：「新建任务是“类型”对应“资料库”，可以统一名称么？」；方案（任务上直接叫「资料库」：选「影视」就是放进影视库，默认「不放进资料库」，和「不放进项目」一个样子；设置里的「类型」也改叫资料库）回「开工，都改成资料库」。

- **改了什么**：凡是用户看得到的「类型」都改成「资料库」。任务属性胶囊和选择器（标题「资料库」，选项是各库的名字，空选项「不放进资料库」，原来叫「普通」；没放进库时胶囊照旧不显示）、新建面板（弹层说明「放进资料库后，卡片换成它的样子，还会带上一组要填的信息。」）、设置 → 任务的「资料库」一节（行名「全部资料库」，按钮「编辑资料库」，说明「N 个，另有 M 个已归档…」，列表小字「资料库、日期显示、农历」）、资料库编辑器（标题「资料库」、「新建资料库」、新建默认名「新资料库」、名字框「资料库名字」、「归档这个资料库」、「已归档的资料库」）、资料库页的「编辑」按钮（读屏名「编辑资料库」）、项目的「默认资料库」、导入预览「N 个资料库」、导入出错「找不到它的资料库，没导入 / 没放进资料库」、出错提示「资料库不存在」。
- **新加一句**（2026-10-28 起作废）：当时详情里资料库选择器底下轻提「换资料库会清空原来的资料」。多类型与多资料上线后任务上没有资料库选择器了，这句和「不放进资料库」一起去掉。
- **英文**：Collection（导航里的「资料」本来就是 Collections，资料库页 Library 不变）。属性名用 `trc('属性', '资料库')` = Collection，编辑器标题 `trc('资料库编辑器', '资料库')` = Collections；不带语境的 `tr('资料库')` 还是页面名 Library。其他七种语言跟着换成各自「收藏 / 集合」的说法（Colección、Coleção、Коллекция、コレクション、Sammlung、Collection、Koleksi），和各自导航里的「资料」一致。
- **不改**：表 `task_type`、字段 `type_id` / `type_data`、`default_type_id`、偏好 `type_order`、代码里的 Type / TypeManager / typedef、导出文件（`_meta/types.json`、front matter `type:`、`default_type:`）、深链接 `new?type=`。内置「普通」的数据名还是「普通」（DATA 词典里留着），界面上只在选择器里换成「不放进资料库」。新加别名：`mindough://new?library=movie`（和 `type=` 一样）、`mindough://view/settings/library`（或 `types`）打开设置的「任务」那项。
- **撞名先不动**：资料库里有个内置的「项目」库，和侧边栏的「项目」同名；这次改名不处理，等 Rei 定。
- 检查：i18n 单测（九种语言 key 一样全）、deeplink 单测（`library=` / `type=` 都认、`view/settings/library`）、全部单测、typecheck；截图在 `work/shots-rename-library/`。

### 日期段 ✅（2026-10-26）
Rei 2026-10-26 17:26 原话：「现在的日期只是单个日期，要支持日期段」。之前问过项目页时间轴要不要单独的到期日，日期段就是答案。

- **数据**：任务加一列 `end_date`（结束日，可空，SQLite 迁移 v10）。开始日还是 `scheduled_date`。结束日只会晚于开始日：等于开始日、早于开始日、没有开始日时都存空（core `date-range.ts` 的 `normalizeRange`，`store.createTask` / `updateTask` 写之前都过一遍）。空 = 单日，老任务都是单日，打开时内存里补 null。云端存整行 JSON，不用动云端 schema，照行级 LWW 同步。导出导入多一个 `end_date`（docs/EXPORT.md）。Rust 端没有自己的 schema，不用改。
- **选日期**：日期面板（详情胶囊、新建面板）多一个「单日 / 日期段」切换。日期段下面是两格「开始 10月26日」「结束 10月30日」，点哪格就只改哪一头；默认点起点再点终点，中间一条浅色带。等结束时点在开始之前，就把开始挪过去，继续等结束；点开始当天等于回到单日。选好结束日弹层就关。快捷图标（今天 / 明天 / 本周末 / 下周一）在日期段里把开始挪到那天、天数不变。「去掉结束日」回到单日，「不设日期」两头一起清。农历小字照常，农历选择在日期段里也是改当前那一头。待安排页、倒数日的目标日还是单日。
- **深链**：`new` 多一个 `end=`，写法同 `date`（today / tomorrow / 2026-10-30）；没有 date、或不晚于 date 就当没写。
- **显示**：单日照旧。日期段写「10月26日 – 30日」「10月30日 – 11月2日」「2026年12月30日 – 2027年1月2日」：同月省掉月份，跨年两头都写年份；不跨年但不在今年时开头带年份。其他语言用 `Intl.DateTimeFormat#formatRange`，省略规则按各语言（英文「Oct 26 – 30」「Dec 30, 2026 – Jan 2, 2027」）。日期段不写「今天 / 明天」，也不写星期。
- **视图**：
  - 列表（Agenda）：放在开始那天，行里小字写整段日期；段跨过今天时今天也放一份，小字「第 3/5 天」。开始日在「更早的 N 条」之外、还没结束的，今天照样有，不算进 N。
  - 我的一天：今天落在段里、还没到结束日的进「建议」，理由「这几天要做」；到了结束日或过了才是「今天到期」。只建议，不自动加入。
  - 过期看结束日：段里不算过期。任务链每一步的「已过 / 明天」也按结束日算。
  - 项目页：时间轴从开始画到结束；排序「开始时间」用 `scheduled_date`，「到期时间」用结束日，没有就用 `scheduled_date`；倒数日仍用目标日。
  - 可做：没改，照旧只看前后关系（现在的逻辑里没有按开始日筛，见「待确认」）。
  - 提醒：照旧是开始那天的提醒时间，段里其他日子不提醒。
- **取舍**：
  - 结束日存在任务上，不另开表，也不复用倒数日的 `target_date`（倒数日是另一种完成方式，两个可以同时有）。
  - 重复任务不带日期段：新建面板里有重复时不存结束日。
  - 滴答清单导入还是只取开始日，截止日照旧写进正文：全天任务的截止是不是「不含当天」没核对过，先不变成日期段。
- **四种日期显示都支持日期段**（接在上面「日期显示」的 `formatTaskDate` 上，core `formatTaskDateRange`）：自动「10月26日 – 30日」；相对时间「今天 – 4 天后」；年月日一律带年份「2026年10月26日 – 30日」（其他语言 Intl formatRange + dateStyle medium，如「Oct 26 – 30, 2026」）；年月日+时区再带开始那天的「GMT+8」。详情胶囊、新建面板胶囊、列表行、Agenda 的整段小字都走它。
- 测试：core `test/date-range.test.ts`（迁移 v9 → v10、读写、老行补空、结束日规则、导出导入、中英文格式、选择器点法、快捷项、格子角色、Agenda 分组、过期、我的一天建议、任务链、提醒不变）；client `project-view.test.ts`（到期取结束日、两种排序、时间轴宽度）、`deeplink.test.ts`（end 参数）。截图在 `work/shots-date-range/`。

### 打卡分类、项目分类合成一套「类型」；侧栏「资料」改叫「管理」，加「类型」入口 ✅（2026-10-26）
Rei 2026-10-26 原话：「还有“打卡分类”，“倒数日分类”，项目分类，这些是否可统一呢？」。方案是合成一套（名称、颜色、图标），任务和项目共用，打卡、倒数日、项目页各自只列用到的，现有的 27 个打卡分类和项目分类自动合并，同名并成一个。Rei 回：「名称统一成“类型”合成一套，这套分了可以在设置-任务中修改，和资料库一样，可以添加、不显示、修改、不能删除。」
18:02 又补了一句：「主窗口侧边栏的“资料”section，更改成“管理”，任务入口删掉，添加一个“类型”入口」。

做了什么：
- 数据：统一用 `category` 表（名称、颜色、图标、builtin、hidden、sort、merged_into），任务加 `category_id`，任何任务都能挂；项目还是 `group.category_id`。逻辑在 `packages/core/src/categories.ts`。
- 迁移 v11（v10 是日期段的 end_date）：加列；打卡分类按原 id 拷进 `category`；任务的 `checkin_category_id` 抄到 `category_id`。这一步不改时间戳、不进 outbox，每台设备各迁一遍结果一样。
- 同名合并在 Store 打开时做：名字去首尾空格、不分大小写一样的并成一个。内置的留下，其次 sort 小的、id 小的；缺的图标 / 颜色从被并的补；几个都不显示才不显示。被并的打墓碑、记 `merged_into`，任务和项目上指着它的改指留下的。演示数据里项目分类「工作」就并进了内置的「工作」。
- 同步兼容旧客户端：拉到旧的 `checkin_category` 行按同 id 映射进 `category`；拉到缺新列的 `category` 行，图标、不显示、顺序用本机的；拉到没有 `category_id` 的任务用它的 `checkin_category_id`。本机写任务时把 `category_id` 抄进 `checkin_category_id`，旧客户端也认得。已经并掉的，旧客户端再改也不复活。云端只存整行 JSON，服务端不用改；rusqlite 端跑的是同一份迁移 SQL，也不用改。
- 规则：能加、改名 / 颜色 / 图标、不显示，不能删（`store.remove('category')` 直接报错）；改名撞名不改，新建同名就用已有的那个（不显示的会重新显示）。
- 界面：任务属性胶囊「类型」对所有任务开放（排在资料库后面），选择器还是「常用 6 个 + 更多」+ 搜索，底部「管理类型…」去设置 → 任务；新建面板底下一个收起的「类型」选择；项目新建和项目页名字下面用同一个选择器；打卡页、倒数日页、项目页按类型筛选 / 分组，只列用到的；设置 → 任务加「类型」一节（「编辑类型」打开编辑弹层）。
- 侧栏：「资料」改叫「管理」，下面是 资料库、人物、类型（18:54 起人物入口删掉，见下一节）；中等宽度图标栏和手机「更多」页跟着变。小节里本来就没有「任务」入口（只有资料库、人物），所以没删东西，汇报给 Rei 了。小节 id 还是 `library`，本机记的收起状态不丢。
- 类型页 `#/types`（深链 `view/types`，别名 `categories`）：左边是和设置里同一个编辑组件 `CategoryEditor`，点一行右边的箭头看挂了它的项目和任务（`#/types/<id>`）；手机先列表，点进去整页看。

替 Rei 定的、待确认：
- 英文叫 Category（资料库已经叫 Collection）。
- 新建面板里「类型」放最底下、默认收起，不打扰快速新建。
- 合并时颜色：留下那个是默认灰才用被并的颜色。
- 打卡页的「编辑」和选择器底部的「管理类型…」都跳到设置 → 任务（桌面 app 里开设置窗口），不再弹本页的弹层。（2026-10-28 改成跳到类型页，见下面「类型页改版：方案 C」。）

### 侧栏去掉「人物」；资料库能「在侧边栏显示」✅（2026-10-26）
Rei 2026-10-26 18:54 原话：「侧边栏的：管理-人物入口删掉」（18:02 那句「任务入口删掉」指的就是人物，打错了字）。
18:55 又加一句：「资料库中，任何一个资料库都可以“在侧边栏显示”，“取消在侧边栏显示”」。

做了什么：
- 「管理」一节只剩 资料库、类型；中等宽度图标栏、手机「更多」页一样。人物页本身没动：`#/people`、`#/people/<id>`、深链 `view/people`、`person/<id>`、⌘K 搜人物、任务详情点人物都照旧。
- 人物的入口改成资料库页标签条里的「人物」。人物合并、「可能重复 N 组」本来就在资料库页（人物库就是资料库里的一个库），不靠侧栏那一项，所以没有丢入口。
- 在人物页、人物详情时，侧栏亮「资料库」；人物库放进侧边栏后，亮它自己。
- 每个资料库（内置、自定义、人物库都行）能「在侧边栏显示 / 取消在侧边栏显示」。开关放在三处：资料库页标签条末尾 ··· 菜单（对当前这个库）、标签右键 / 长按、设置 → 任务 → 编辑资料库列表每行的侧栏按钮（亮着 = 在侧边栏）。侧栏里那一项自己也能右键「取消在侧边栏显示」。
- 显示的库挂在「资料库」下面，图标往里缩一点，名字用库名（影视库、书库…），点了直接进那个库；顺序跟资料库顺序走。默认都不显示。归档的库不出现，取消归档后回来。人物库不在编辑资料库列表里（它本来就不在），只能在资料库页开关。
- 存储：同步偏好 `library.sidebar`（类型 id 列表，core `LIBRARY_SIDEBAR_PREF`、`store.sidebarLibraries()` / `setLibraryInSidebar()`），不加列、不加迁移，也不改类型行。没按「资料库定义上的字段 + 迁移 v12」做，理由：
  1. 改类型行会让内置资料库算作「用户改过」，以后内置升级就不覆盖它了。资料库排序（`type_order`）也是因为这个才单独存成偏好。
  2. 旧客户端只认识已知的列。它改一下库名、推上来的整行就没有新列，LWW 后侧栏设置就丢了。偏好行旧客户端原样留着，不会碰。
  3. 还是跟着账户同步，各设备一致。代价是两台设备同时改，后改的整张列表赢；这个开关不常点，可以接受。
- 测试：core `test/library-sidebar.test.ts`（默认不显示、顺序跟资料库、取消、归档、普通类型不出现、两台设备同步）；client `lib/nav.test.ts`（「管理」一节没有人物、`#/people` 路由还在、库的入口地址、哪一项亮）。截图在 `work/shots-remove-people-nav/`。

替 Rei 定的、待确认：
- 侧栏里显示库名（影视库），不是标签条上的短名（影视）。
- 侧栏那一项不跟库的颜色走，图标和别的入口一样是灰的。
- 手机上在库里时，顶栏标题是库名。

### 网页版搬到 app 域名，旧域名留给介绍页 ✅（2026-10-26）
Rei 2026-10-26 19:12：「那就把app搬到 app.mindough.rei8t.dev，mindough.rei8t.dev留给介绍页」。

- 同一个 Worker `mindough` 挂两个 custom domain。`app.mindough.rei8t.dev` 出网页版和全部 API；`mindough.rei8t.dev` 根路径出介绍页（`apps/server/src/landing/`）。地址常量：Worker 在 `src/hosts.ts`，客户端在 `src/lib/origins.ts`，原生端（Tauri 桌面、Android、iOS）默认连 app 域名；Tauri CSP 两个地址都放行。
- 旧域名的 `/api/*`、`/auth/*` 不跳转、照常服务。原因：老的 alpha.5 桌面 / 安卓包写死了旧地址，POST 遇到 308 要重发、预检也可能被拦；Google 登录的回调地址要和控制台登记的一致，旧地址的登记还在；正文里存的图片地址是 `https://mindough.rei8t.dev/api/assets/…`，这个地址得一直能打开。新上传的图片用请求的域名，所以以后是 app 域名。
- 旧链接：介绍页的脚本看到 `#/…`、`?task=` 这类 app 地址，或者是从主屏幕打开的旧 PWA，就 `location.replace` 到 app 域名同一路径。
- 本机数据：网页端数据在浏览器 OPFS 里，按域名隔离，新域名一开始是空的。登录过、同步完的，到新域名登录就同步回来。没登录过的会留在旧域名。所以介绍页先看这个浏览器在旧域名有没有本机数据（OPFS 里 app 的库，或更早的 localStorage 数据）；有就先显示「网页版搬到了新地址」的提示，不自动跳。提示里两个按钮：「在旧地址导出备份」打开 `https://mindough.rei8t.dev/local/#/settings/data`（旧域名其他路径照旧出 app，顶上有一条不能关的提示），「已同步，去新地址」记下已确认、以后不再拦。
- 旧 PWA：scope 在旧域名，没法原地搬到新域名，要重新装。旧域名的 `/sw.js` 换成「清缓存、注销自己」的版本，免得缓存里的旧外壳顶替介绍页；从主屏幕打开旧版时，第一次显示提示（含「请重新添加到主屏幕」），之后直接跳 app 域名。
- 新域名不用改 manifest / sw.js / Cookie：manifest 的 id、start_url、scope 都是相对的 `/`；会话 Cookie 不带 Domain，只认当前域名；COOP / COEP 照旧由 Worker 加；Google 回调地址按请求的域名生成。
- 介绍页：九种语言（见下面「介绍页 i18n」），右上角能切；图标和名字、一句话介绍、五条功能、「打开网页版」、GitHub Releases 下载提示。以后换更完整的介绍页，只换 `landing/page.ts`（或按「app 的网站单独建 `<仓库名>-web` 仓库」的约定另起 Mindough-web，再让旧域名的 `/api`、`/auth` 走 service binding 回这个 Worker），搬家脚本那段要留着。

待 Rei 做：Google Cloud 控制台给 OAuth 客户端加重定向 URI `https://app.mindough.rei8t.dev/auth/callback`（旧的别删）；装过旧 PWA 的设备重新安装。

### 介绍页 i18n ✅（2026-10-26）
Rei 2026-10-26 19:41：「这个网站也要i18n」。

- 介绍页（`mindough.rei8t.dev`）和 app 一样用九种语言：zh（简体）、en、es、pt-BR、ru、ja、de、fr、id。文字在 `apps/server/src/landing/text.ts`，标题、一句话介绍、五条功能、按钮、下载提示、搬家提示和旧 PWA 重装提示都有九种。
- 说法跟 app 语言包一致：资料库 = Collection（de Sammlung、ja コレクション……），打卡 = 习惯（Habits），「设置 → 数据 → 导入」用各语言 app 里的菜单名。
- 选语言的顺序：`?lang=` → 手动选过的（localStorage `mindough:landing-lang`）→ `navigator.languages` → 英文。服务端先按 `?lang=` 和 Accept-Language（按 q 值）出对应语言，页面脚本再定一次。zh-TW 等都归简体中文，pt-PT 归 pt-BR。
- 右上角是下拉框，九种语言用各自本名显示；`<html lang>` 跟着换。
- 旧地址 `/local/` 顶上的横幅是 app 里的字符串，九种语言早就有了。

### 桌面窗口透出壁纸：macOS 侧边栏毛玻璃、Windows 11 Mica ✅（2026-10-26）
Rei 2026-10-26 20:58：「mindough app的背景，侧边栏背景不像是原生app的bg sensitive的」。以前窗口和侧边栏都是不透明的纯色，看不出桌面壁纸的颜色。

- macOS：主窗口、小窗、设置窗口都开透明，铺 NSVisualEffectView 的 Sidebar 材质，窗口失焦时跟系统一样变灰（`followsWindowActiveState`）。Apple 皮肤下侧边栏透明、透出材质；内容区和详情照旧不透明（`--bg` / 白底），像「提醒事项」「邮件」。侧边栏的搜索框改成半透明灰。窗口透明要用 Tauri 的 `macOSPrivateApi`，代价是不能上 Mac App Store（现在也不上）。
- Windows 11（build ≥ 22000）：整窗 Mica，WinUI 皮肤去掉以前假 Mica 的渐变底，卡片本来就是半透明白，直接叠在 Mica 上。Windows 10 没有 Mica：主窗口在 Rust 里按系统版本建（`tauri.windows.conf.json` 写 `create: false`），Win10 建成不透明窗口，界面照旧纯色。
- Linux、手机、网页版、PWA：不变（浏览器透不出壁纸）。Material 皮肤也不变，背景不透明，正好盖住材质。窗口拉窄成手机布局时也不透明。
- 深浅色：界面手动选了深色或浅色，窗口也跟着换（材质和 Mica 按窗口的深浅色画）；跟着系统时不动。
- 怎么接：原生端 `src-tauri/src/vibrancy.rs` 的 `window_material` 说这台机器用哪种材质（vibrancy / mica / none），顺便设窗口深浅色；前端 `lib/vibrancy.ts` 拿到 vibrancy / mica 才给 html 加 `is-vibrant` 和 `data-material`，样式都在 `styles/vibrancy.css`。前端开小窗、设置窗口时用 `materialWindowOptions()` 带上同样的 transparent / windowEffects。

待 Rei 定：
- 内容区要不要也半透明一点（现在 macOS 内容区不透明，和系统 app 一样）。
- Windows 10 要不要退回 Acrylic（Win10 有，但拖动窗口时会卡），现在是纯色。

### 多类型与多资料 ✅（2026-10-28）
Rei 2026-10-28 原话：「类型是类型，资料库是资料库，是平级的」「一个任务可以连多个资料库的资料，例如：可以同时几个人和一部电影」；类型选择器做成能搜索的多选下拉。方案和待确认的几条见 `docs/MULTI-TYPE.md`。

- 数据：迁移 v12，新表 `task_category`、`task_item`（行 id 由这一对算出，墓碑 + LWW）；人物还用 `task_person`。任务上的单值 `category_id` / `library_item_id` / `type_id` 继续写成第一个，另写 `refs_mirror` 认出旧客户端改的（只加不删）。代码 `packages/core/src/task-refs.ts`，测试 `packages/core/test/task-refs.test.ts`。
- 界面：类型多选下拉（`components/CategoryPicker.tsx`）；挑资料的面板和资料列表（`components/library/RefPicker.tsx`）；详情「资料」区按库分组、每库接任务字段（人物库不接）；新建面板同样；列表元信息 `观影 · 奥本海默 +3`；打卡 / 倒数日 / 类型页认多个类型。删了 `changeTaskType`、`setTaskItem`、`TypeGrid`、`PeopleList`，原来的「资料库」「和谁有关」胶囊并进「资料」。
- 上线前修的：挑资料面板的库按钮原来横向滚动、滚动条藏着，排在最后的「人物」点不到（点了还停在影视，再点第一条反而去掉了电影），改成折行；人物组下面多出「事由」任务字段，人物库不再显示任务字段；资料区第一行贴着卡片上沿，加了上下内边距。
- 检查：core / client typecheck、相关单测；截图 `work/shots-multi-type/`（脚本 `work/shots-tool/multi-type.mjs`，三皮肤 × 1366 / 390）。

### 类型页改版：方案 C（搜索优先、按大类分组、左右两栏、常用代替手动排序）✅（2026-10-28）
Rei 2026-10-28 原话：「类型的这个交互方式可以更现代一点么，更改计划让我审核」，看了 A、B 觉得都不好，补了 C 之后说「按方案C执行」。方案全文和三个问题在 `docs/CATEGORY-EDITOR.md`。

Rei 定的：
- 用「常用 + 最近用过」代替手动排序（07:08 明确确认）。上移、下移、拖动都去掉了。
- 设置里完全去掉类型（07:08「去掉设置中的入口」），不留「管理类型…」入口，类型只在侧栏「管理 → 类型」页管。`CategoryManager` 弹层删掉了；深链 `view/settings/types` 改去类型页（`view/settings/library` 还是设置 → 任务）。

按文档默认做的（Rei 没改）：
- 5 个大类：身体、生活、学习和工作、爱好、人；自己加的默认「其他」，详情里能换组。内置的默认组写在 `seed/builtin-checkin-categories.ts`（`BUILTIN_CATEGORY_GROUPS`）。

做了什么：
- 数据不改表结构。「常用」存同步偏好 `category.frequent`（id 列表，按设成常用的先后）；改过的大类存 `category.groups`（`"<id>=<组>"` 列表，偏好值不支持对象；改回默认组就去掉那一项）；「不显示」还是 `category.hidden`。理由同 `type_order`、`library.sidebar`：改类型行会让内置类型算作用户改过，旧客户端改名时也会冲掉不认识的列。逻辑在 `packages/core/src/category-prefs.ts`，Store 是 `pickerCategories()`、`frequentCategories(n)`、`categoryState` / `setCategoryState`（返回之前的档，撤销用）、`categoryGroup` / `setCategoryGroup`、`categoryLastUsed()`。
- 最近用过不另存：取挂了这个类型的任务的创建时间和它们打卡记录的时间，哪个晚算哪个（顺着合并算到留下的类型）。项目没有时间戳，不算进最近用过。
- 选择器顺序：常用的在前 → 用过的按最近 → 没用过的先放健康、运动、学习、读书、饮食、作息，再按大类和原来的 sort。第一屏放全部常用的，不足 6 个用后面的补齐。
- 搜索（类型页、选择器）：存着的名字、当前语言的名字、英文名都比；搜索词全是字母时再比中文名的拼音首字母和全拼（`tiny-pinyin`，用 pnpm 加在 core；它靠浏览器的中文排序数据，只给一个读音，乐、行、长这些常见多音字的另一个首字母补在 `pinyin-polyphone.ts`）。开头对上的排前面。
- 类型页（`pages/Categories.tsx` + `components/CategoryEditor.tsx` 的 `CategoryList`）：见 PRODUCT 第 30 条。图标网格加了搜索框（`IconPicker searchable`；中文关键词在 `lib/icon-keywords.ts`，只用来对搜索词）。颜色沿用资料库编辑器那 14 个色块 + 自己调，没缩成文档写的 12 个。
- 三套皮肤：Apple 是分组圆角列表、缩进分隔线；WinUI 选中行左边一道强调色竖条；Material 带分隔线、圆形图标块、选中是胶囊。
- 测试：core `test/category-prefs.test.ts`（默认组名单、偏好读写、三档、顺序、最近用过、拼音和多音字）；client `deeplink.test.ts`。截图在 `work/shots-categories/`（三套皮肤 × 1366 / 390，加 Apple 英文）。

和文档不一样的地方：
- 颜色是 14 个色块 + 自己调（复用资料库编辑器的 ColorPicker），不是 12 个。
- ⌘1/2/3 在网页版的 Chrome 里会被浏览器拿去切标签页，只在桌面 app（Tauri）和不占这个键的浏览器里有用；Ctrl+F 同理在部分浏览器里先打开浏览器自己的查找。
- 手机左滑出的两个按钮跟着当前状态变字：已经常用的显示「取消常用」，已经不显示的显示「显示」。

### 项目也能「在侧边栏显示」✅（2026-10-28）
Rei 2026-10-28 07:29 原话：「项目和资料库一样，项目也可以显示在侧边栏」。

做了什么：
- 每个项目能「在侧边栏显示 / 取消在侧边栏显示」。开关在两处：项目页右上角视图、排序后面的 ··· 菜单（读屏「项目操作」），项目列表里卡片的右键 / 长按。侧栏里那一项自己也能右键「取消在侧边栏显示」。
- 显示的项目挂在「计划 → 项目」下面，样子跟资料库下面的库一样（图标往里缩一点，图标栏不缩）；用项目自己的图标（emoji，或 `lucide:` 开头的图标名）和名字，点了打开那个项目（`#/groups/<id>`）。打开的是放进侧边栏的项目时亮它自己，项目列表和别的项目亮「项目」。中等宽度图标栏、手机「更多」页一样。顺序跟项目页一样（`store.list('group')`）。默认都不显示。删掉的项目不出现。
- 存储：同步偏好 `group.sidebar`（项目 id 列表，core `GROUP_SIDEBAR_PREF`、`store.sidebarGroups()` / `isGroupInSidebar()` / `setGroupInSidebar()`），理由同资料库：不加列、不改项目行，旧客户端改项目名不会冲掉它。
- 测试：core `test/group-sidebar.test.ts`（默认不显示、顺序跟项目页、取消、重复设不写、删掉的和坏 id 不出现、跟资料库各管各的、两台设备同步）；client `lib/nav.test.ts`（「计划」一节的顺序、入口地址、哪一项亮、图标名）。截图在 `work/shots-project-sidebar/`。

跟资料库不一样的地方：
- 项目没有归档，也没有「编辑资料库列表」那样的设置项，所以开关只有项目页 ··· 菜单和卡片右键 / 长按两处，设置里不加。
- 结束日期过了的项目照常显示（项目页也照常列着它）。

替 Rei 定的、待确认：
- 设置里不加「项目」的侧栏开关。
- 已经结束（结束日期过了、任务都做完）的项目不自动从侧栏拿掉。

### M5 项目视角
- SS / FF / SF 与间隔（lag）。
- 关键路径与日期推算（沿前后关系推最早开始，超出组结束时间标红）。
- 甘特图：项目页「时间轴」视图已有横条和前后关系箭头（2026-10-26），关键路径、拖动改日期还没做。
- 正文逐字合并（CRDT，取代整段 LWW）。

## 明确不做（MVP）
多人协作与共享、多层文件夹式分类。

## 工程默认
- 名字：英文 Mindough、中文「念头团」（Rei 2026-10-24 定、10-25 中文名由「思想团」改为「念头团」；做法见上面「App 名字」）；仓库 reiy-leo/mindough，分支 main，MIT
- Web 与同步 API：Cloudflare Worker `mindough`，域名 `app.mindough.rei8t.dev`；`mindough.rei8t.dev` 是介绍页（API 照常能用）
- AGENTS.md（+ CLAUDE.md 指向）、.agents/、docs/PRODUCT.md
- GitHub Actions 打 macOS / Windows / Android 包发布到 Releases；iOS 需 Apple 开发者账号签名（待定）
- 每轮完成后 commit + push

## 待确认
- Web 端风格：跟随访问者系统（默认），还是固定一种？
- 类型的海报 / 图标 MVP 只手动上传或贴链接，自动找图以后做，可以吗？
- ✅ 谁能登录（Rei 2026-10-16 定）：白名单，只 Rei 自己（`ALLOWED_EMAILS=reiy.leoz@gmail.com`），不开放注册。
- ✅ iOS 分发（Rei 2026-10-16 定）：免费 Apple ID + Xcode 个人团队装自己 iPhone（7 天重装，不走 TestFlight），步骤见 docs/IOS.md；小组件要 App Group，先不接。
- ✅ 日记功能（Rei 2026-10-17 审过：「一天一篇，英文Journal，入口按你推荐的做。只要心情（5个太少了…动画svg图标）。设一个「一天从几点开始」（默认 5点）。「这一天」汇总不放在日记中。日记提醒…晚上9点，不论是不是已经写了。将来这日子不能写。」）：J1 已做完上线，见下面「日记 J1」和 [docs/JOURNAL.md](JOURNAL.md) 第 0 节。
- 🟡 滴答清单导入待问：见 IMPORT-DIDA.md「待 Rei 确认」。
- 🟡 附件待问：见上面「附件」的待 Rei 确认（50 MB 上限、资料项要不要附件、Tauri 存到哪）。
- 🟡 日期段待问（2026-10-26）：「可做」现在只看前后关系，开始日还没到的任务也列着（单日任务一样）。要不要改成「开始日到了才算可做」？没改，等 Rei 定。
- 🟡 日记待问（J1 没做）：「一天从几点开始」要不要扩展到我的一天 / 打卡 / 提醒；日记页要不要只读的「这一天」；「插入时间」「那年今日」⌘K 按日期跳转。
