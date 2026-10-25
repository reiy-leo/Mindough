# Mindough（念头团）

中文名「念头团」，英文名 Mindough。

多端任务管理：用 FS（完成→开始）依赖把任务串起来，再配一条 Agenda 式琐事时间线。macOS / Windows / iOS / Android / Web，本地优先、多端同步。

- 产品：[docs/PRODUCT.md](docs/PRODUCT.md)
- 计划与里程碑：[docs/PLAN.md](docs/PLAN.md)
- 协作约定：[AGENTS.md](AGENTS.md)

状态：**M1 进行中**——本地 SQLite 存储（Web：Turso wasm + OPFS；原生：rusqlite），从 localStorage 自动迁移；GitHub Actions 打桌面与 Android 包；Worker 的 Google 登录写好未部署；同步在 M2。

## 运行

需要 Node 22+ 与 pnpm。

```bash
pnpm install
pnpm dev                 # Web 客户端：http://localhost:1420
pnpm test                # 全部单测（Vitest）
pnpm typecheck           # 全部类型检查
pnpm build               # 构建（客户端产物在 apps/client/dist）
pnpm --filter client preview   # 预览构建产物：http://localhost:4173
pnpm --filter server dev       # Worker 本地（http://localhost:8787，需 apps/server/.dev.vars，参考 .dev.vars.example）
```

Web 端的 SQLite 需要页面跨源隔离（COOP / COEP），dev 与 preview 已配好；浏览器不支持 OPFS 时自动退回 localStorage。本地联调登录：同时开 `pnpm dev` 与 `pnpm --filter server dev`，vite 会把 `/api`、`/auth` 转给 Worker。

第一次打开会生成一份演示数据（组、依赖链、人物、各类型任务、一年的打卡记录）。设置 → 重置演示数据 可重来。

调试皮肤：设置里切换，或在地址后加 `?skin=apple|winui|material&theme=light|dark`。

### 桌面 / 移动端（Tauri 2）

需要 Rust 工具链（https://rustup.rs）和各平台依赖（见 https://tauri.app/start/prerequisites/）。

```bash
pnpm tauri dev           # 桌面开发
pnpm tauri build         # 打包
pnpm tauri android init  # 生成 Android 工程（gen/ 不进仓库）
pnpm tauri android build --apk --debug
pnpm tauri ios init
```

## 目录

```
packages/core/        纯 TS 逻辑（无 DOM）：数据模型、UUIDv7/HLC、DAG 环检测与派生状态、打卡事件折叠、重复与连续天数、热力图、我的一天、搜索、存储接口与适配器、内置类型、演示数据
apps/client/          Vite + React + React Aria Components；skin/ 是皮肤层（tokens + 平台形状）
apps/client/src-tauri Tauri 2 外壳（identifier dev.rei8t.mindough）
apps/server/          Cloudflare Worker `mindough`：Google 登录、/api、静态资源（未部署）
.github/workflows/    ci.yml（检查）、build.yml（打包：macOS / Windows / Linux / Android）
```

MIT License
