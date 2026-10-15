# apps/server — Mindough Worker（占位）

Cloudflare Worker `mindough`，域名 `mindough.rei8t.dev`（`workers_dev: false`，custom domain）。

M0 只有占位：`GET /api/health` 返回 `{ ok: true }`，其余返回「404 未找到」。**尚未部署。**

计划职责（见 `docs/PLAN.md`）：
- Google OAuth 登录（ADMIN_EMAILS 白名单，待定）；原生端走系统浏览器 + deep link 回调
- 托管 Web 端静态资源（apps/client 的构建产物）
- 同步：Turso Sync 方案下签发每用户数据库的限权 token；自建方案下提供 D1 同步 API
- 图片：R2

本地开发：`pnpm --filter server dev`（需要 `.dev.vars`，参考仓库根的 `.dev.vars.example`）。
