# Mindough（念头团）

中文名「念头团」，英文名 Mindough。

一个多端任务管理 app。任务之间用 FS 依赖（完成→开始）串起来，琐事记在一条 Agenda 式的时间线上。支持 macOS、Windows、iOS、Android 和 Web，数据先存在本机，再在各端之间同步。

- 产品说明：[docs/PRODUCT.md](docs/PRODUCT.md)
- 计划与里程碑：[docs/PLAN.md](docs/PLAN.md)
- 协作约定：[AGENTS.md](AGENTS.md)

现状：**M1 进行中**。

- 本地用 SQLite 存数据（Web 端是 Turso wasm + OPFS，原生端是 rusqlite），旧的 localStorage 数据会自动搬过来。
- GitHub Actions 打桌面包和 Android 包。
- Worker 的 Google 登录写好了，还没部署。
- 同步放在 M2。

## 运行

要先装 Node 22+ 和 pnpm。

```bash
pnpm install
pnpm dev                 # Web 客户端：http://localhost:1420
pnpm test                # 全部单测（Vitest）
pnpm typecheck           # 全部类型检查
pnpm build               # 构建（客户端产物在 apps/client/dist）
pnpm --filter client preview   # 预览构建产物：http://localhost:4173
pnpm --filter server dev       # Worker 本地（http://localhost:8787，需 apps/server/.dev.vars，参考 .dev.vars.example）
pnpm lint:zh             # 检查中文文档的空格和标点（AutoCorrect）
```

Web 端的 SQLite 要求页面跨源隔离（COOP / COEP），dev 和 preview 都配好了；浏览器不支持 OPFS 时，自动退回 localStorage。

本地联调登录：同时开 `pnpm dev` 和 `pnpm --filter server dev`，vite 会把 `/api`、`/auth` 转给 Worker。

第一次打开时，app 会生成一份演示数据：项目、依赖链、人物、各种类型的任务，还有一年的打卡记录。想重来，就到「设置 → 重置演示数据」。

调试皮肤：在设置里切，或者在地址后面加 `?skin=apple|winui|material&theme=light|dark`。

### 桌面 / 移动端（Tauri 2）

要装 Rust 工具链（https://rustup.rs）和各平台的依赖（见 https://tauri.app/start/prerequisites/）。

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

## 写中文文档

中文文档按「像人说话」的写法来：先说结论，少用「被」「进行」「通过」，长句拆短。提交前跑一遍 `pnpm lint:zh`，它只检查空格和标点，用 `pnpm fix:zh` 自动修。详见 [AGENTS.md](AGENTS.md)「中文文档」一节。

MIT License
