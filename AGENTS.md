# AGENTS.md — Mindough（念头团）

写给 AI 编程代理和协作者看。产品细节见 [docs/PRODUCT.md](docs/PRODUCT.md)，完整的计划和决定见 [docs/PLAN.md](docs/PLAN.md)。

## 目标
做一个多端任务管理 app。任务不靠层层分类，靠 FS 依赖（完成→开始）串起来，也就是前导图（PDM）；琐事记在 Agenda 式的时间线上，随手就记。macOS、Windows、iOS、Android、Web 都能用；数据先存本机，再多端同步。

## 边界（MVP 不做）
- 多人协作与共享
- 多层文件夹式分类
- SS/FF/SF、lag、关键路径、甘特图（数据模型里先留好字段）
- 任务正文逐字合并（同步时整段比，后写的赢）

## 技术栈（M0 定下来的标 ✅）
- ✅ TypeScript 5.9（strict + noUncheckedIndexedAccess）、React 19、Vite 8、Vitest 4、pnpm workspace
- ✅ React Aria Components 1.x（headless）+ lucide-react；✅ @xyflow/react 12 + elkjs 0.11（依赖图，按需加载）；Markdown 预览 marked + DOMPurify（+ marked-footnote）；GitHub 提示块 / 公式（KaTeX，本地打包按需加载）见 `components/editor/gh-syntax.ts`、`lib/gh-alerts.ts`、`lib/math.ts`；✅ 编辑 Tiptap 3（`components/editor/`，所见即所得，存 markdown；读写自己用 remark 做，见下一条）
- Tauri 2（桌面 + iOS/Android；本机 cargo check 能过，GitHub Actions 的 build.yml 打包）
- UI：React Aria Components（headless），每端配一套原生皮肤：Apple（macOS/iOS）、WinUI 3 / Windows 11 风格（Windows）、Material 3（Android）；移动端可以用 Konsta UI；图标用 lucide 线条图标；明暗主题跟着系统走。不用 Kumo
- ✅ Markdown 编辑：Tiptap 3（Rei 2026-10-25 从 Milkdown 7 换过来），正文存成 .md 文本；没有工具栏（Rei 2026-10-25），格式靠快捷键和手打写法（清单 `[] `、折叠块 `>> `）
  - 只用开源扩展，逐个单独引，不用 StarterKit、不用官方 Link（链接是自己写的 mark）；公式、提示块、折叠块、脚注、HTML 片段也是自己写的节点（`extensions.ts`、`gh-syntax.ts`、`details.ts`）。
  - markdown 读写不用 `@tiptap/markdown`，用 remark（`markdown.ts`，规则照搬 Milkdown 7 的 commonmark + gfm 预设）。改读写时 `markdown.test.ts` 必须全过：190 段样例要和以前 Milkdown 的输出一字不差。
  - 只看不改不写回：没真改字就不调 onChange（`editor.ts` 的 controller）。
- 依赖图：React Flow（xyflow）+ elkjs
- ✅ 本地存储：原生 SQLite（rusqlite 命令层，src-tauri/src/db.rs）/ Web Turso database-wasm（OPFS），两边用同一份 schema 和迁移（packages/core/src/storage/schema.ts）
- ✅ 同步：云端默认是 Turso Cloud 库 `mindough`（东京），也可用 Worker 环境变量 `STORAGE_BACKEND=d1` 换成 Cloudflare D1 库 `mindough`（存储层 `apps/server/src/sql.ts` / `storage.ts`，切换前跑 `pnpm --filter server storage:copy`，见 PLAN“云端存储：Turso / D1”）；客户端走 Worker 的 `/api/sync/*`，用 core 的 outbox + 游标协议推拉（行级 LWW），没用 Turso Sync SDK（原因见 PLAN“同步引擎选型”）。Worker `mindough`（网页版和 API 在 `app.mindough.rei8t.dev`；`mindough.rei8t.dev` 根路径是介绍页，`/api`、`/auth` 照常留给老客户端，地址常量见 `apps/client/src/lib/origins.ts` 和 `apps/server/src/hosts.ts`）管 Google OAuth（Web + 原生 deep link）、同步 API、Web 静态资源；图片放 R2 `mindough-assets`
- 包管理用 pnpm，测试用 Vitest

## 目录（M1 实际）
```
packages/core/src/      纯逻辑，无 DOM（每个模块都有 test/*.test.ts）
  types.ts              全部表的行类型（UUIDv7 id + HLC updated_at + deleted）
  uuid.ts hlc.ts        UUIDv7 生成、混合逻辑时钟
  dag.ts                环检测、派生状态（可开始/被阻塞+缺哪些）、解锁后续、任务链 taskChain 与每一步的相对时间 chainStepWhen / chainWhenLabel
  related.ts            相关任务（task_link，无方向、不阻塞）：规范顺序、确定 id、前后关系优先
  recurrence.ts         RRULE 子集、周期键、连续天数
  checkin.ts            check_in 事件折叠出进度（计时/计量/点一下/倒数日）、热力图比例索引
  count.ts              计数的步长和快捷按钮（Rei 2026-10-26）：单位 → 默认步长、task.count_config 读写、手输「1200 / +330」解析
  heatmap.ts myday.ts   热力图网格与档位、我的一天（昨天没做完、建议）
  preview.ts search.ts  无标题任务的预览、⌘K 搜索
  library.ts            资料库：库名叫法、资料 / 任务字段拆分、去重与模糊搜索、旧数据迁移计划、占位图配色
  typedef.ts            类型编辑器（界面叫资料库编辑器）的纯逻辑：字段增改排序隐藏、删字段留墓碑（key 不变、值保留）、类型顺序（同步偏好 type_order）；类型不能删、只能归档（存 hidden 列，Store.archiveType）
  attachment-cache.ts   附件本机缓存的纯逻辑（Rei 2026-10-25）：缓存记录、24 小时到期与清理、点一下做什么（图片灯箱 / 其他下载）、每个附件哪些操作能用
  attachments.ts        附件（Rei 2026-10-17）：文件类型（10 种）、大小显示、文件名安全化 / 改名保留扩展名 / 导出去重、50 MB 上限；写入在 Store（attachmentsOf / addAttachment / setAttachmentFile / renameAttachment / removeAttachment / restoreAttachment / ensureJournal）
  lunar/                农历（Rei 2026-10-17）：data.ts（1900–2100 表，scripts/gen-lunar-data.mjs 生成，别手改）、lunar.ts（公历 ⇄ 农历、节气、节日、格子小字）、names.ts（月名日名节气节日，i18n 白名单）、ics.ts（订阅日历解析）、subscription.ts（默认源、偏好 lunar.*、什么时候同步、状态文案）
  date-range.ts         日期段（Rei 2026-10-26）：task.end_date（可空、只会晚于 scheduled_date）、normalizeRange、taskEndDate（到期看它）、formatDateRange（「10月26日 – 30日」）、选择器点法 pickRangeDay、Agenda 分组 agendaBuckets
  timezone.ts           任务时区（Rei 2026-10-25）：task.time_zone（IANA，空 = 跟着设备）、常用 / 全部时区、那天的偏移（夏令时）、taskToday / isTaskOverdue / timeZoneBadge；中文城市名在 timezone-names.ts
  journal.ts            日记（Rei 2026-10-17）：日期 → 固定 id、「一天从几点开始」、将来不能写、12 个心情 id、字数、同步保护（两边都改时输家收进折叠块，base_at 判断有没有看到对方）
  merge.ts              资料 / 人物合并：合并后的值与冲突、可能重复的分组、merged_into 解析与成环处理（写入在 Store.mergeLibraryItems / mergePeople）
  links.ts money.ts episode.ts  字段种类的逻辑：站点编号（IMDb / 豆瓣）与更多链接、金额 + 币种、看到第几季第几集
  lookup.ts             在线找资料的纯逻辑：结果形状、按什么找（去季标记、电影 / 剧集）、库里的同一条、自动补全逐项计划；来源存 fields._source
  store.ts              内存快照 + 领域操作（UI 同步读、写入异步落盘并进 outbox）；applyRemote 合并拉下来的行（不进 outbox）；edges() / conflictEdges()
  sync/                 同步：protocol.ts（WireRow、SyncTransport、SyncHttpError）、engine.ts（SyncEngine：推、拉、第一次合并、状态）、memory-remote.ts（假云端 / 协议参考实现）
  dida/                 从滴答清单导入（单独入口 @mindough/core/dida，docs/IMPORT-DIDA.md）：csv / parse（备份 CSV）、api（Open API，fetchDidaAccount 注入网络函数）、map（时区 / 提醒 / 重复 / 正文）、plan（预览、applyDida、undoDida）
  archive/              导入导出 Markdown 文件夹（单独入口 @mindough/core/archive，yaml + fflate，按需加载；格式见 docs/EXPORT.md）
  storage/              StorageAdapter 接口；memory、localStorage、SQLite（sql.ts + schema.ts 迁移）适配器；migrate.ts（localStorage → SQLite）
  categories.ts         类型（Rei 2026-10-26 打卡分类 + 项目分类合成一套，界面叫「类型」）：同名合并（survivorOrder）、merged_into 解析、旧行映射（categoryFromCheckin / fillCategory）；不能删（CategoryDeleteError）。读写走 store.categories() / category(id) / categoryOf(task) / createCategory / updateCategory；选择器顺序用 store.pickerCategories() / frequentCategories(n)，别自己按 sort 排
  category-prefs.ts     类型页方案 C（Rei 2026-10-28）：大类（默认组在 seed，改过的存偏好 category.groups）、常用 / 普通 / 不显示三档（常用存偏好 category.frequent）、选择器顺序（常用 + 最近用过）、拼音首字母搜索（tiny-pinyin + pinyin-polyphone.ts）
  seed/                 内置 11 种资料库、27 个内置类型（原打卡分类，固定 id）、演示数据
apps/client/src/
  skin/                 皮肤层：tokens.css（三套令牌 × 明暗）、skins.css（平台形状）、platform.ts（检测）
  styles/app.css        结构样式（只用令牌变量）
  ui/primitives.tsx     React Aria 包装（Button、Sheet、PopoverPanel、OverflowMenu、ConfirmDialog、InlineNumber、AutoTextarea、Tip…）
  components/task/      新建面板 TaskComposer、任务详情 TaskDetail（属性胶囊行 PropChips，外框 DetailFrame：右列 / 手机整页 / 小窗弹窗）、三列布局右列 DetailPane、共用选择件 pickers、日期面板 DatePanel、挑任务 TaskSearch
  components/library/   资料库共用件：占位图 ItemArt、选择框 LibraryPicker、资料编辑 ItemEditor / ItemSheet、资料卡 ItemCard
                        LinkFields（站点编号 / 更多链接 / 链接小标签）、MoneyField（金额 + 可搜索币种）、NoteField（Markdown 备注）
  components/attachments/  附件区 Attachments（bare = 任务详情里没标题没按钮；拖放 useFileDrop + DropOverlay、图片网格、文件列表、重命名）、灯箱 Lightbox、文件类型图标 FileIcon（手写 SVG，颜色令牌 --file-*）；样式 styles/attachments.css
  components/journal/   日记：心情图标 MoodIcon（手写 SVG + journal.css 动画，颜色令牌 --mood-*）、心情轮 MoodWheel（半圆、键盘可选）、情绪月历 JournalCalendar + 分布条 MoodSummary、我的一天小卡 JournalCard
  lib/lunar.ts          农历订阅：经 Worker /api/calendar/ics 代拉、存 localStorage、到点同步（useLunarSubScheduler 挂在 App）、useLunar(store).day(date)；日期格子小字用 DatePanel 的 LunarMark，日期标题用 components/LunarLine，设置在 components/LunarSettings；样式 styles/lunar.css
  pages/Journal.tsx     日记页（docs/JOURNAL.md）
  pages/Library.tsx     资料库页与资料详情（人物库沿用 pages/People.tsx 的人物详情）
  components/ pages/    业务组件与页面（不写死平台样式）
  styles/task.css       新建面板与详情的结构样式
  styles/library.css    资料库（占位图、选择框、资料卡、资料库页）的结构样式
  lib/ store/           设置、路由、提示、账户（account.ts：全局账户状态，Web cookie / 原生 Bearer）、同步（sync.ts：凭据、HTTP 传输、开停与触发）、原生登录（native-login.ts）、图片上传（upload.ts）、附件上传队列（attachments.ts：IndexedDB 队列 attachments-queue.ts、XHR 进度、取消重试、显示地址、下载）、附件本机缓存（attachment-cache.ts：Web Cache Storage / Tauri 缓存目录，24 小时清理）、云端文件没了时补传或标已删除（attachment-gone.ts）、Store 上下文与存储选择（sqlite-web.ts / sqlite-tauri.ts）
apps/client/src-tauri/  Tauri 2 外壳（src/db.rs：rusqlite 命令层；src/files.rs：save_download 把附件存进「下载」文件夹、save_to_path（保存框选的路径）、att_cache_*（附件本机缓存目录）；src/menu.rs：菜单栏 文件 → 导入 → 滴答清单（文字由 lib/app-menu.ts 按界面语言传入）；src/vibrancy.rs：窗口材质（macOS 侧边栏毛玻璃、Windows 11 Mica；前端 lib/vibrancy.ts 加 html.is-vibrant，样式 styles/vibrancy.css，只改 Apple / WinUI 皮肤）；opener + deep-link（mindough://）+ 桌面 single-instance）
apps/server/            Cloudflare Worker：auth.ts（Google 登录、会话）、native.ts（原生端一次性登录码）、sync.ts（同步 API + 云端 schema）、
                        存储层 sql.ts（SqlDb 接口）/ storage.ts（按 STORAGE_BACKEND 选）/ turso.ts（Hrana HTTP）/ d1.ts（D1 绑定 + REST）/ copy.ts（库间全量复制与核对，scripts/copy-storage.ts）、assets.ts（R2 图片）、files.ts（附件 /api/files：要登录、只能读自己的、≤ 50 MB；HEAD 查在不在）、purge.ts（清理没人用的附件文件：推送后即时删 + 每天 cron）、dida.ts（滴答清单 Open API 代理 /api/dida/*，令牌走 x-dida-token、不存、只放只读白名单）、lookup/（在线找资料：tmdb / douban / openlibrary / steam 适配器，Cache API，封面拉进 R2）、static-r2.ts
  test/                 单测（fake-turso.ts：node:sqlite 实现的假 Turso；storage.test.ts 用 Miniflare 本地 D1）；e2e/real-turso.test.ts 对真实 Turso（默认跳过）
.github/workflows/      ci.yml、build.yml
docs/                   PLAN.md、PRODUCT.md、COPY.md（界面文案）、EXPORT.md（导入导出格式，含附件）、IMPORT-DIDA.md（滴答清单导入字段映射）、DEEPLINKS.md、JOURNAL.md（日记方案与决定）
.agents/                skills / rules / prompts / memory
```

## 命令
| 用途 | 命令 |
|---|---|
| 安装 | `pnpm install` |
| Web 开发 | `pnpm dev`（:1420） |
| 单测 | `pnpm test`（= `pnpm -r test`） |
| 类型检查 | `pnpm typecheck`（= `pnpm -r typecheck`） |
| 构建 | `pnpm build`；只构建客户端 `pnpm --filter client build` |
| 预览构建 | `pnpm --filter client preview`（:4173） |
| 桌面 | `pnpm tauri dev` / `pnpm tauri build`（需 Rust） |
| 重新生成图标 | `scripts/make-icons.sh`（源图 apps/client/src-tauri/icons/source-character.png，透明底角色；生成桌面 / iOS / Android / PWA / favicon，改完把 sw.js SHELL 版本 +1） |
| Worker 本地 | `pnpm --filter server dev`（:8787，需 `apps/server/.dev.vars`，见 `.dev.vars.example`） |
| Worker 单测 | `pnpm --filter server test` |
| 同步端到端（真实 Turso） | `cd apps/server && E2E_TURSO_URL=https://mindough-rei8.aws-ap-northeast-1.turso.io E2E_TURSO_TOKEN_FILE=<放数据库 token 的文件> npx vitest run e2e/real-turso.test.ts`（测试账户 e2e@mindough.test，跑完自动删行） |
| 云端库复制（切换前） | `cd apps/server && pnpm storage:copy -- --from turso --to d1 [--dry-run] [--replace]`（环境变量见脚本头；切换改 `wrangler.deploy.jsonc` 的 `STORAGE_BACKEND`） |
| 部署 | `cd apps/server && CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… pnpm deploy`（`keep_vars` 保留控制台里的 Google 变量） |
| Rust 检查 | `cd apps/client/src-tauri && cargo check`（Linux 需 libwebkit2gtk-4.1-dev 等） |
| Android | `pnpm tauri android init` → `pnpm tauri android build --apk --debug` |
| 打包 CI | GitHub Actions `build.yml`（手动 / 推 `v*` 标签）；`ci.yml` 每次推送跑检查 |

截图检查：地址后加 `?skin=apple|winui|material&theme=light|dark` 能临时换皮肤。桌面 1366 宽、手机 390 宽各看一遍；动了外壳或详情，再看一遍 960 宽的中等宽度（图标栏 + 两栏）。

## 代码规范
- App 名字（Rei 2026-10-24 定，2026-10-25 中文名从「思想团」改成「念头团」）：英文「Mindough」，中文「念头团」。界面上要写 app 名，都用 core 的 `appName()`（或者在 tr 的中文原文里写「念头团」、英文写 Mindough），别写死 'Mindough'；网页标题由 `lib/i18n.ts` 的 `applyAppTitle` 跟着语言改。原生显示名的本地化在 `src-tauri/locales/`（Apple `*.lproj/InfoPlist.strings`、Android `values-*`，九种语言都有，中文叫念头团、其他都叫 Mindough；加语言时 `Info.plist` 的 CFBundleLocalizations 和 `tauri.conf.json` 的 `bundle.macOS.files` 一起改；`scripts/native-locales.sh` 在 CI 里拷进 gen/；macOS 经 `bundle.macOS.files`）。productName、bundle id、manifest name、导出文件夹名不改。
- 界面文案用中文，**都按 [docs/COPY.md](docs/COPY.md) 写**（术语表 + 语气原则：简洁、口语但不随便、不用技术术语）；有新词先补进术语表。出现 HTTP 状态码时附中文说明（如「408 请求超时」）。
- 界面有九种语言（Rei 2026-10-25「支持西、葡、俄、日、德、法、印尼」）：中文、英文，加西班牙语 `es`、巴西葡萄牙语 `pt-BR`、俄语 `ru`、日语 `ja`、德语 `de`、法语 `fr`、印尼语 `id`。**加新字符串时九种都要补**：中文写在 `tr()` 里，英文写进 `packages/core/src/i18n-en.ts` 或 `apps/client/src/i18n/en.ts`，另外七种写进 `apps/client/src/i18n/locales/<语言>.ts` 的 `MESSAGES`（内置数据的名字写进 `DATA`）。`locales.test.ts` 会查：缺 key、多 key、空值、占位符对不上、俄语复数没写 one / few / many、法语 `: ; ? ! »` 前面没用不换行空格（`:` 用 U+00A0，其余 U+202F）。不会写的语言先照英文意思译，提交说明里写上「待母语者看」。多语言的术语对照在 COPY.md「其他语言」。
- 排版跟语言走：中文、日文不在数字和单位之间空格，其他语言空（CSS 用 `html:not(:lang(zh)):not(:lang(ja))`）；会比中文长两三倍的文字（按钮、提示）要在手机 390、中等宽度、右列打开时都看一遍，装不下就换行或只留图标，别靠截断。
- 代码和文档里的概念名是固定的：任务 / 组 / 分类 / 前置 / 后续 / 可开始 / 被阻塞 / 琐事列表 / 任务类型（含显示变体与创建模板；界面上叫「资料库」）/ 完成方式（once 勾选完成、timer 计时、count 计数、countdown 倒数日）。界面上怎么叫，以 COPY.md 为准（比如“前置/后续”在界面上叫「先做完这些 / 做完后解锁」，“被阻塞”叫「还不能开始」；“组”在界面上叫「项目」/ Project，Rei 2026-10-25 改的，代码、表名、字段、`#/groups` 深链接都还叫 group，别跟着改；“任务类型”在界面上叫「资料库」/ Collection，Rei 2026-10-26 改的，`task_type`、`type_id`、`new?type=` 都不改，空的那个叫「不放进资料库」）。
- 新建和详情是两个组件：新建是 `components/task/TaskComposer.tsx`（快速、安静，完成方式在新建时选），详情是 `components/task/TaskDetail.tsx`（内容在前、状态用操作按钮、属性、关系（前后关系 + 相关任务））；两者共用 `components/task/pickers.tsx`。详情的单值属性是一行胶囊 `components/task/PropChips.tsx`（Rei 2026-10-25 方案 A：只显示设过的；默认值、适用与否、清除回默认都在 `lib/prop-chips.ts`，加新的单值属性就在那里加 PropId 和默认值）；资料行、任务字段还是属性卡片里的 `PropRow`。
- 三列布局（Rei 2026-10-23，PLAN「三列布局」）：任务详情不用弹窗。桌面上在右列（`components/task/DetailPane.tsx`，侧边栏 | 列表 | 详情；< 1100 侧边栏收成图标栏），手机整页推入，只有桌面置顶小窗里是弹窗（`TaskDetail mode`）。打开都用 `ui.openEditor(id)`（选中的任务写在 hash 的 `?task=` 里，别另存状态），手机上关掉用 `ui.closeDetail()`；能被 ↑ ↓ 选中、要高亮的列表项带 `data-task-id` 和 `is-selected`（参照 `TaskRow`）。别再给任务详情加新的弹窗；新弹层（挑任务、确认）可以照旧用 Sheet。
- 进度都由 check_in 事件累加出来，不直接改写进度字段（多端合并靠的就是这个）。计数的加量、手输、撤销都在 `components/CountControls.tsx`：手输总数记成差值事件，撤销用 `store.undoCheckIn`（打墓碑）；步长和快捷按钮读 core `countStep` / `quickAmounts`，空的 `count_config` 就是老任务（+1）。
- 资料库：类型字段分 资料字段（`scope` 省略 = item，存在 library_item 上）与 任务字段（`scope: 'task'`，存在 task.type_data）；显示任务时都用 `store.taskData(task)` / `lib/view.ts` 的 `viewOf` / `titleOf`，不要直接读 `task.type_data` 当完整数据。
- 类型编辑（M4）：取类型列表用 `store.pickableTypes()` / `orderedTypes()` / `editableTypes()`，不要自己按 sort 排；显示字段用 `shownFields` / `itemFieldsOf` / `taskFieldsOf`（不含隐藏、删掉的），别直接遍历 `type.fields` 去显示；删字段用 `removeField`（留墓碑），不要从数组里真删。
- 新字段种类（多选、金额、站点编号、更多链接、看到哪）逻辑写在 core，界面在 `FieldInput` 里按 kind 分派；改内置类型定义就把 `BUILTIN_TYPES_REVISION` 加一，旧值的迁移写进 `planFieldMigration`（只动旧形状的值）。
- 类型只管怎么显示、新建时带什么模板，不代替正文；内置类型和自定义类型走同一套 layout + fields + body_template，不要写死特例。
- 任务没有标题字段，列表里拿 body_md 的第一行当预览。
- 本地优先：界面从不等网络；写操作先写本地，再进 outbox。
- 每条记录都有 UUIDv7 id、HLC updated_at 和 deleted 墓碑，不真删。
- 同步：所有写入走 Store（进了 outbox 才会推上去）；拉下来的行只能走 `store.applyRemote`（不进 outbox，否则会回推）。合并是行级 LWW（比 `updated_at` 字符串），别在别处另写合并规则；云端（`apps/server/src/sync.ts`，Turso / D1 同一份 SQL，用 `openDb(env)` 拿库，别直接调 turso.ts）和 `MemoryRemote` 的规则一样，改一处就两处一起改。云端只存整行 JSON：客户端加列、加表都不用动云端 schema；云端自己的表加在 `SERVER_MIGRATIONS`（只追加）。读前后关系都用 `store.edges()`（已经去重，也去掉了合并后成环的边），成环的边在 `store.conflictEdges()` 里。
- 附件（PLAN「附件」）：加附件都走 `lib/attachments.ts` 的 `addAttachments`（建行 + 进本机队列 + 开始传），别直接 `store.addAttachment` 后自己传；传好填 key 用 `setAttachmentFile`；显示用 `useAttachmentUrl`（本机队列优先，原生端带 Bearer 取回）。下载用 `downloadAttachment`：先用本机队列或缓存；Web 走浏览器下载，Tauri 桌面弹系统保存框（`save_to_path` / `att_cache_copy`），手机用 `save_download`。本机缓存都走 `lib/attachment-cache.ts`（`cacheAttachment` / `uncacheAttachment`、`useCacheRecord`），记录只存本机 localStorage，不进同步表；24 小时从缓存那一刻算起。附件挂日记时 owner_id 是 `journalEntryId(date)`，加之前先 `ensureJournal(date)`。任务详情里附件区是 `Attachments bare`（没标题、没按钮，排在胶囊下面），入口是胶囊行「+」菜单的「附件」（`PropChips onAttach`，`addMenuItems`）和拖到整列（`useFileDrop` 挂在 `DetailFrame` 的外框上）；`useFileDrop` 只认从页面外面拖进来的文件（Rei 2026-10-25）。R2 的附件 key 是 `<用户哈希>/f/<sha256>`，和公开的资料图 `<用户哈希>/<sha256>` 分开，读附件要登录。
- 附件云端文件清理（PLAN「附件：清理没人用的云端文件」，Rei 2026-10-25）：`apps/server/src/purge.ts`。同步推送后（`handlePush` 的 afterPush → `ctx.waitUntil`）即时删没人引用的附件文件；Worker 的 cron（`wrangler*.jsonc` 的 `triggers.crons`，`0 19 * * *` = 北京 03:00，入口 `index.ts` 的 `scheduled`）每天兜底：删满 30 天、或上传满 30 天从没被引用的才删。「引用」是这个用户任何一行的整行 JSON 里出现了 key，所以新加的表、字段只要把 key 原样存进行里就自动算数，不用改清理。只动 `<哈希>/f/` 下的文件，别让它碰 `/api/assets` 的资料图。改 cron 时间两个 wrangler 配置一起改，部署后看 wrangler 输出里有 `schedule: 0 19 * * *`。手动跑一次：`wrangler dev --test-scheduled` 后请求 `/__scheduled?cron=0+19+*+*+*`。
- 客户端发现云端文件没了（HEAD /api/files 回 404 未找到）走 `lib/attachment-gone.ts`：`checkAttachment` 有本机副本就补传，没有就标「文件已删除」（`useGoneState`）；新地方取附件文件时拿到 404，调 `forgetProbe` 或 `checkAttachment(store, a, true)`，别自己另写一套。
- 日期段（PLAN「日期段」）：结束日是 `task.end_date`，写入都走 Store（`createTask` / `updateTask` 会按 `normalizeRange` 收拾，别自己绕过）；要「到期」那天用 core `taskEndDate`（过期、任务链、项目页到期排序都是它），显示整段用 `formatDateRange` / `TaskDateText`，别自己拼「 – 」。提醒仍按开始日。
- 任务时区（PLAN「任务时区」）：判断任务的「今天」、过期都用 core `taskToday` / `isTaskOverdue`（空时区 = 设备），列表 / 详情日期用 `components/TaskDateText`（带时区小字）；提醒按任务时区换算在 `upcomingReminders` 里，别另算。
- 打卡卡片的活动图（PLAN「打卡卡片的活动图收进圆点」）：行内不再放活动图，左上角圆点（`TipButton` + `isExpanded`）切换卡片下面整行的 `Heatmap fit`；展开了哪几张只存本机 `settings.habitHeatmapOpen`，读写用 `lib/habit-heatmap.ts`（`isHeatmapOpen` / `toggleHeatmapOpen`）。整行宽度算格子用 `fitHeatmap`，别在组件里另算。
- 农历（PLAN「农历」）：日期都存公历，农历只在显示和选择时换算（core `lunar/`，本地查表，别用 `Intl` 的 chinese 历——ICU 有几年初一差一天）；格子小字都走 `useLunar(store).day(d)`（订阅的节日名优先、休 / 班角标），不要自己拼；每年农历重复是 `lunarYearly`（RRULE `RSCALE=CHINESE`）。农历界面显不显示一律用 `useLunarUi()`（本机设置 `chineseLunar` 开着 且 core `isChineseLocale()`，Rei 2026-10-25），新加农历 UI 也要经它；隐藏时 `describeRecurrence(r, { lunar: false, today })`。
- 滴答清单导入（docs/IMPORT-DIDA.md）：解析、拉取、映射都在 core `dida/`，客户端只做界面；两种来源都先变成 `DidaRow`，再走 `planDida` / `applyDida`，别另写一套写入。任务 id 用滴答清单的 taskId 算（`didaTaskId`），重复导入不出重复任务就靠它，别改算法。令牌只存本机（`lib/dida.ts`），不进同步表、不发给云端库；Worker 代理只转发白名单路径。改菜单栏文字时，要同时改 `menu.rs` 的 `MenuLabels` 和 `lib/app-menu.ts`。
- 外链：在 Tauri 里都走 `lib/external.ts`（全局拦截 + `openExternal`），交给系统浏览器打开；不要自己 `window.open` 或另装 opener 调用。
- 资料 / 人物合并后，并进去的那条变成墓碑并记下 `merged_into`：读任务挂的资料都走 `store.itemOf(task)` / `resolveItemId` / `resolvePersonId`（会顺着 merged_into 找到留下的那条），不要直接 `get('library_item', task.library_item_id)`。
- 相关任务（task_link）不是依赖：不进 dependency 表，不过环检测，不影响派生状态；同一对任务如果有前后关系，只按前后关系显示。
- 加依赖边必须过环检测；组件外观只写在皮肤层（tokens + 平台样式），业务组件不写死某个平台的样式；改界面后在三种皮肤（Apple / WinUI / Material）× 桌面 / 手机下截图检查。

## 禁止事项
- 不提交密钥、OAuth secret、`.keys/`、`.env`、`.dev.vars`。
- 不引入遥测或第三方统计。

## 工作约定
- 每轮改完就 commit 并 push 到 `main`（提交说明用中文，前缀 feat/fix/docs/chore，写法同下面「中文文档」）。
- 推送前跑类型检查和单测；动了中文文档再跑 `pnpm lint:zh`。
- 决定变了，就跟着改 `docs/PLAN.md`。

## 中文文档
中文文档要像人说话（Rei 2026-10-25：「现在中文的语言非常难懂，包括句式啦，用词了，被动主动啦，非常不像人说的」）。README、AGENTS、`docs/` 和提交说明都按下面写：

1. 先说结论，再说理由和细节。一段讲一件事，一句讲一层意思，超过 40 字就拆开。
2. 少用被动：写「数据会同步到云端」，不写「数据会被同步到云端」。
3. 删空动词：写「同步数据」，不写「对数据进行同步」；「进行」「加以」「予以」「实现」后面跟动词的，直接用那个动词。
4. 少用「通过」「基于」「作为」「对于」「关于」开头；「该」「其」「此」「一个」能删就删。
5. 「的」连用不超过两个，长定语拆成短句。
6. 用口语常用词：「用」不写「使用」，「改」不写「变更」，「删」不写「移除」（界面文案以 COPY.md 为准）；不用公文腔（旨在、进而、从而、鉴于）。
7. 不改事实：改写只改说法，不改数字、日期、代码、路径、链接和 Rei 的原话（引号里的原话照抄）。

排版交给 AutoCorrect（[huacnlee/autocorrect](https://github.com/huacnlee/autocorrect)），配置在 `.autocorrectrc` 和 `.autocorrectignore`：

- `pnpm lint:zh`：检查中英文空格和标点，只看 Markdown 文档，不改文件。提交前跑一遍。
- `pnpm fix:zh`：自动修。修完看一眼 diff 再提交。
- 不检查的：代码、i18n、`docs/COPY.md`（「」里的字符串要和代码里 tr() 的原文一致，不能自动改）。Rei 原话、界面上的实际字符串、外部文件的列名，在 `.autocorrectrc` 的 `textRules` 里加一条设成 `0`，那一段就不改。
- 目前没接进 CI，只是本地提醒。
- `autocorrect-node` 没有 Linux arm64 的包；在 arm64 Linux 上要用官方发布页的 `autocorrect` 二进制，参数一样。
