# AGENTS.md — Mindough

给 AI 编程代理与协作者的项目说明。产品细节见 [docs/PRODUCT.md](docs/PRODUCT.md)，完整计划与决策见 [docs/PLAN.md](docs/PLAN.md)。

## 目标
多端任务管理 app：任务不靠层层分类，而靠 FS（完成→开始）依赖串起来（前导图 PDM）；琐事用 Agenda 式时间线随手记。macOS、Windows、iOS、Android、Web 都可用，本地优先 + 多端同步。

## 边界（MVP 不做）
- 多人协作与共享
- 多层文件夹式分类
- SS/FF/SF、lag、关键路径、甘特图（数据模型先留字段）
- 任务正文逐字合并（同步按整段后写赢）

## 技术栈（计划，开工时落定版本）
- Tauri 2（桌面 + iOS/Android）+ TypeScript（strict）+ React + Vite
- UI：Kumo（`@cloudflare/kumo`，kumo-design 统筹设计）；lucide 线条图标；明暗主题跟随系统
- Markdown 编辑：Milkdown 或 TipTap，正文以 .md 文本入库
- 依赖图：React Flow（xyflow）+ elkjs
- 本地存储：原生 SQLite（tauri-plugin-sql）/ Web SQLite WASM（OPFS），同一 schema
- 同步：引擎待定（Turso Sync 推荐 / 自建 Worker + D1），见 PLAN“同步引擎选型”；Worker `mindough`（域名 `mindough.rei8t.dev`）负责 Google OAuth、Web 静态资源与签发同步凭据；图片放 R2
- 包管理：pnpm；测试 Vitest

## 目录（计划）
```
apps/client/        React 前端（Tauri 与 Web 共用）
apps/client/src-tauri/  Tauri 外壳
apps/server/        Cloudflare Worker（同步 API + Web 静态资源）
packages/core/      纯逻辑：数据模型、DAG/环检测、状态派生、同步合并（必须有单测）
docs/               PLAN.md、PRODUCT.md
.agents/            skills / rules / prompts / memory
```

## 代码规范
- 界面文案中文；HTTP 状态码出现时附中文说明（如「408 请求超时」）。
- 术语固定：任务 / 组 / 分类 / 前置 / 后续 / 可开始 / 被阻塞 / 琐事列表 / 任务类型（含显示变体与创建模板）/ 完成方式（点一下、计时、计量、倒数日）。
- 进度一律由 check_in 事件累加得出，不直接覆盖进度字段（多端合并靠它）。
- 类型只管展示与新建模板，不替代正文；内置类型与自定义类型走同一套 layout + fields + body_template 机制，不要写死特例。
- 任务没有标题字段，列表里显示 body_md 首行作预览。
- 本地优先：UI 永不等待网络；写操作落本地并进 outbox。
- 所有记录 UUIDv7 id + HLC updated_at + deleted 墓碑，不物理删除。
- 加依赖边必须过环检测；能用 Kumo 组件就不手写。

## 禁止事项
- 不提交密钥、OAuth secret、`.keys/`、`.env`、`.dev.vars`。
- 不引入遥测或第三方统计。

## 工作约定
- 每轮修改完成后 commit 并 push 到 `main`（提交信息中文，前缀 feat/fix/docs/chore）。
- 推送前跑类型检查与单测。
- 决策有变时同步更新 `docs/PLAN.md`。
