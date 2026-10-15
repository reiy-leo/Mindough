# apps/server — Mindough Worker

Cloudflare Worker `mindough`，域名 `mindough.rei8t.dev`（`workers_dev: false`，custom domain）。**尚未部署。**

| 路径 | 说明 |
|---|---|
| `GET /auth/login?return_to=` | 302 到 Google（scope `openid email profile`，state 存短期签名 cookie） |
| `GET /auth/callback` | 换 token → userinfo → 查 `ALLOWED_EMAILS` → 设 `md_session` cookie → 302 回 return_to；失败带 `?login_error=代码` |
| `GET/POST /auth/logout` | 清会话 |
| `GET /api/me` | 已登录返回 `{ user }`，否则「401 未登录」 |
| `POST /api/sync/token` | 先返回「501 未实现」（M2 签发 Turso token）；未登录「401 未登录」 |
| `GET /api/health` | 健康检查 |
| 其余 | wrangler assets 托管 `apps/client/dist`（SPA 回退，`_headers` 带 COOP / COEP） |

login_error 代码：config_missing、access_denied、state_mismatch、token_exchange_failed、userinfo_failed、email_unverified、not_allowed。

环境变量（`.dev.vars` / `wrangler secret put`）：GOOGLE_CLIENT_ID、GOOGLE_CLIENT_SECRET、SESSION_SECRET、ALLOWED_EMAILS（逗号分隔；空 = 拒绝所有）、APP_ORIGINS（允许跳回的其他源，如 http://localhost:1420）。

Google Cloud OAuth 客户端的重定向 URI：`https://mindough.rei8t.dev/auth/callback`、`http://localhost:8787/auth/callback`。

单测：`pnpm --filter server test`（模拟 Google 的 fetch）。

计划职责（见 `docs/PLAN.md`）：
- 原生端登录：系统浏览器 + deep link 回调（待做）
- 托管 Web 端静态资源（apps/client 的构建产物）
- 同步：Turso Sync 方案下签发每用户数据库的限权 token；自建方案下提供 D1 同步 API
- 图片：R2

本地开发：`pnpm --filter server dev`（需要 `.dev.vars`，参考仓库根的 `.dev.vars.example`）。
