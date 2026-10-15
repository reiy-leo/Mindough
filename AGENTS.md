# AGENTS.md — Mindough

给 AI 编程代理与协作者的项目说明。产品细节见 [docs/PRODUCT.md](docs/PRODUCT.md)，完整计划与决策见 [docs/PLAN.md](docs/PLAN.md)。

## 目标
多端任务管理 app：任务不靠层层分类，而靠 FS（完成→开始）依赖串起来（前导图 PDM）；琐事用 Agenda 式时间线随手记。macOS、Windows、iOS、Android、Web 都可用，本地优先 + 多端同步。

## 边界（MVP 不做）
- 多人协作与共享
- 多层文件夹式分类
- SS/FF/SF、lag、关键路径、甘特图（数据模型先留字段）
- 任务正文逐字合并（同步按整段后写赢）

## 技术栈（M0 已落定的版本标 ✅）
- ✅ TypeScript 5.9（strict + noUncheckedIndexedAccess）、React 19、Vite 8、Vitest 4、pnpm workspace
- ✅ React Aria Components 1.x（headless）+ lucide-react；✅ @xyflow/react 12 + elkjs 0.11（依赖图，按需加载）；Markdown 预览 marked + DOMPurify（编辑先用 textarea）
- Tauri 2（桌面 + iOS/Android；本机 cargo check 通过，GitHub Actions build.yml 打包）
- UI：React Aria Components（headless）+ 每端原生皮肤：Apple（macOS/iOS）、WinUI 3 / Windows 11 风格（Windows）、Material 3（Android）；移动端可用 Konsta UI；lucide 线条图标；明暗主题跟随系统。不用 Kumo
- Markdown 编辑：Milkdown 或 TipTap，正文以 .md 文本入库
- 依赖图：React Flow（xyflow）+ elkjs
- ✅ 本地存储：原生 SQLite（rusqlite 命令层，src-tauri/src/db.rs）/ Web Turso database-wasm（OPFS），同一 schema 与迁移（packages/core/src/storage/schema.ts）
- ✅ 同步：云端是 Turso Cloud 库 `mindough`（东京），客户端经 Worker `/api/sync/*` 用 core 的 outbox + 游标协议推拉（行级 LWW），没用 Turso Sync SDK（原因见 PLAN“同步引擎选型”）；Worker `mindough`（`mindough.rei8t.dev`）负责 Google OAuth（Web + 原生 deep link）、同步 API、Web 静态资源；图片放 R2 `mindough-assets`
- 包管理：pnpm；测试 Vitest

## 目录（M1 实际）
```
packages/core/src/      纯逻辑，无 DOM（每个模块都有 test/*.test.ts）
  types.ts              全部表的行类型（UUIDv7 id + HLC updated_at + deleted）
  uuid.ts hlc.ts        UUIDv7 生成、混合逻辑时钟
  dag.ts                环检测、派生状态（可开始/被阻塞+缺哪些）、解锁后续
  related.ts            相关任务（task_link，无方向、不阻塞）：规范顺序、确定 id、前后关系优先
  recurrence.ts         RRULE 子集、周期键、连续天数
  checkin.ts            check_in 事件折叠出进度（计时/计量/点一下/倒数日）、热力图比例索引
  heatmap.ts myday.ts   热力图网格与档位、我的一天（昨天没做完、建议）
  preview.ts search.ts  无标题任务的预览、⌘K 搜索
  library.ts            资料库：库名叫法、资料 / 任务字段拆分、去重与模糊搜索、旧数据迁移计划、占位图配色
  links.ts money.ts episode.ts  字段种类的逻辑：站点编号（IMDb / 豆瓣）与更多链接、金额 + 币种、看到第几季第几集
  store.ts              内存快照 + 领域操作（UI 同步读、写入异步落盘并进 outbox）；applyRemote 合并拉下来的行（不进 outbox）；edges() / conflictEdges()
  sync/                 同步：protocol.ts（WireRow、SyncTransport、SyncHttpError）、engine.ts（SyncEngine：推、拉、第一次合并、状态）、memory-remote.ts（假云端 / 协议参考实现）
  storage/              StorageAdapter 接口；memory、localStorage、SQLite（sql.ts + schema.ts 迁移）适配器；migrate.ts（localStorage → SQLite）
  seed/                 内置 11 种类型、27 个打卡分类（固定 id）、演示数据
apps/client/src/
  skin/                 皮肤层：tokens.css（三套令牌 × 明暗）、skins.css（平台形状）、platform.ts（检测）
  styles/app.css        结构样式（只用令牌变量）
  ui/primitives.tsx     React Aria 包装（Button、Sheet、PopoverPanel、OverflowMenu、ConfirmDialog、InlineNumber、AutoTextarea、Tip…）
  components/task/      新建面板 TaskComposer、任务详情 TaskDetail、共用选择件 pickers、日期面板 DatePanel、挑任务 TaskSearch
  components/library/   资料库共用件：占位图 ItemArt、选择框 LibraryPicker、资料编辑 ItemEditor / ItemSheet、资料卡 ItemCard
                        LinkFields（站点编号 / 更多链接 / 链接小标签）、MoneyField（金额 + 可搜索币种）、NoteField（Markdown 备注）
  pages/Library.tsx     资料库页与资料详情（人物库沿用 pages/People.tsx 的人物详情）
  components/ pages/    业务组件与页面（不写死平台样式）
  styles/task.css       新建面板与详情的结构样式
  styles/library.css    资料库（占位图、选择框、资料卡、资料库页）的结构样式
  lib/ store/           设置、路由、提示、账户（account.ts：全局账户状态，Web cookie / 原生 Bearer）、同步（sync.ts：凭据、HTTP 传输、开停与触发）、原生登录（native-login.ts）、图片上传（upload.ts）、Store 上下文与存储选择（sqlite-web.ts / sqlite-tauri.ts）
apps/client/src-tauri/  Tauri 2 外壳（src/db.rs：rusqlite 命令层；opener + deep-link（mindough://）+ 桌面 single-instance）
apps/server/            Cloudflare Worker：auth.ts（Google 登录、会话）、native.ts（原生端一次性登录码）、sync.ts（同步 API + 云端 schema）、turso.ts（Hrana HTTP）、assets.ts（R2 图片）、static-r2.ts
  test/                 单测（fake-turso.ts：node:sqlite 实现的假 Turso）；e2e/real-turso.test.ts 对真实 Turso（默认跳过）
.github/workflows/      ci.yml、build.yml
docs/                   PLAN.md、PRODUCT.md、COPY.md（界面文案）
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
| 重新生成图标 | `pnpm --filter client tauri icon src-tauri/icons/source.svg -o src-tauri/icons` |
| Worker 本地 | `pnpm --filter server dev`（:8787，需 `apps/server/.dev.vars`，见 `.dev.vars.example`） |
| Worker 单测 | `pnpm --filter server test` |
| 同步端到端（真实 Turso） | `cd apps/server && E2E_TURSO_URL=https://mindough-rei8.aws-ap-northeast-1.turso.io E2E_TURSO_TOKEN_FILE=<放数据库 token 的文件> npx vitest run e2e/real-turso.test.ts`（测试账户 e2e@mindough.test，跑完自动删行） |
| 部署 | `cd apps/server && CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… pnpm deploy`（`keep_vars` 保留控制台里的 Google 变量） |
| Rust 检查 | `cd apps/client/src-tauri && cargo check`（Linux 需 libwebkit2gtk-4.1-dev 等） |
| Android | `pnpm tauri android init` → `pnpm tauri android build --apk --debug` |
| 打包 CI | GitHub Actions `build.yml`（手动 / 推 `v*` 标签）；`ci.yml` 每次推送跑检查 |

截图检查：`?skin=apple|winui|material&theme=light|dark` 可临时指定皮肤；桌面 1366 宽 + 手机 390 宽各看一遍。

## 代码规范
- 界面文案中文，**一律按 [docs/COPY.md](docs/COPY.md)**（术语表 + 语气原则：简洁、口语但不随便、不用技术术语）；新词先补进术语表。HTTP 状态码出现时附中文说明（如「408 请求超时」）。
- 代码与文档里的概念名固定：任务 / 组 / 分类 / 前置 / 后续 / 可开始 / 被阻塞 / 琐事列表 / 任务类型（含显示变体与创建模板）/ 完成方式（once 勾选完成、timer 计时、count 计数、countdown 倒数日）。界面上的叫法以 COPY.md 为准（如“前置/后续”在界面上叫「先做完这些 / 做完后解锁」，“被阻塞”叫「还不能开始」）。
- 新建与详情分开：新建是 `components/task/TaskComposer.tsx`（快速、安静，完成方式在新建时选），详情是 `components/task/TaskDetail.tsx`（内容在前、状态用操作按钮、属性列表、关系（前后关系 + 相关任务））；两者共用 `components/task/pickers.tsx`。
- 进度一律由 check_in 事件累加得出，不直接覆盖进度字段（多端合并靠它）。
- 资料库：类型字段分 资料字段（`scope` 省略 = item，存在 library_item 上）与 任务字段（`scope: 'task'`，存在 task.type_data）；显示任务时一律用 `store.taskData(task)` / `lib/view.ts` 的 `viewOf` / `titleOf`，不要直接读 `task.type_data` 当完整数据。
- 新字段种类（多选、金额、站点编号、更多链接、看到哪）逻辑写在 core，界面在 `FieldInput` 里按 kind 分派；改内置类型定义就把 `BUILTIN_TYPES_REVISION` 加一，旧值的迁移写进 `planFieldMigration`（只动旧形状的值）。
- 类型只管展示与新建模板，不替代正文；内置类型与自定义类型走同一套 layout + fields + body_template 机制，不要写死特例。
- 任务没有标题字段，列表里显示 body_md 首行作预览。
- 本地优先：UI 永不等待网络；写操作落本地并进 outbox。
- 所有记录 UUIDv7 id + HLC updated_at + deleted 墓碑，不物理删除。
- 同步：所有写入走 Store（进 outbox 才会被推）；拉下来的行只能经 `store.applyRemote`（不进 outbox，否则会回推）。合并是行级 LWW（`updated_at` 字符串比较）——别在别处另写合并规则；云端（`apps/server/src/sync.ts`）与 `MemoryRemote` 规则一致，改一处要两处一起改。云端只存整行 JSON：客户端加列 / 加表不动云端 schema；云端自己的表加在 `SERVER_MIGRATIONS`（只追加）。读前后关系一律用 `store.edges()`（已去重、去掉合并后成环的边），成环的在 `store.conflictEdges()`。
- 外链：在 Tauri 里一律经 `lib/external.ts`（全局拦截 + `openExternal`）交给系统浏览器；不要自己 `window.open` 或另装 opener 调用。
- 相关任务（task_link）不是依赖：不进 dependency 表、不过环检测、不影响派生状态；同一对任务有前后关系时只按前后关系显示。
- 加依赖边必须过环检测；组件外观只写在皮肤层（tokens + 平台样式），业务组件不写死某个平台的样式；改界面后在三种皮肤（Apple / WinUI / Material）× 桌面 / 手机下截图检查。

## 禁止事项
- 不提交密钥、OAuth secret、`.keys/`、`.env`、`.dev.vars`。
- 不引入遥测或第三方统计。

## 工作约定
- 每轮修改完成后 commit 并 push 到 `main`（提交信息中文，前缀 feat/fix/docs/chore）。
- 推送前跑类型检查与单测。
- 决策有变时同步更新 `docs/PLAN.md`。
