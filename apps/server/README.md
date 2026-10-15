# apps/server — Mindough Worker

Cloudflare Worker `mindough`，域名 `mindough.rei8t.dev`（`workers_dev: false`，custom domain）。已部署（M2，2026-10-15）。

| 路径 | 说明 |
|---|---|
| `GET /auth/login?return_to=` | 302 到 Google（scope `openid email profile`，state 存短期签名 cookie） |
| `GET /auth/callback` | 换 token → userinfo → 查 `ALLOWED_EMAILS` → 设 `md_session` cookie → 302 回 return_to；失败带 `?login_error=代码` |
| `GET/POST /auth/logout` | 清会话 |
| `GET /api/me` | 已登录返回 `{ user }`；没登录「401 未登录」；会话有效但已移出白名单「403 无权限」。会话可以是 cookie，也可以是原生端的 `Authorization: Bearer` |
| `GET /auth/login?native=1&challenge=` | 原生端登录：成功后结果页跳回 `mindough://auth?code=…`（失败 `?login_error=`） |
| `POST /auth/exchange` | `{ code, verifier }` → `{ session, user, expires_at }`；码无效 / 用过 / 过期「400 请求有误」 |
| `POST /api/sync/token` | 会话 → `{ url, token, expires_at }`（1 小时）；「401 未登录」/「403 无权限」/「503 服务不可用」（没配数据库） |
| `POST /api/sync/push` | Bearer 同步凭据，`{ rows }` → `{ applied }`（行级 LWW；最多 500 行，单行 ≤ 2 MB） |
| `POST /api/sync/pull` | Bearer 同步凭据，`{ cursor, limit }` → `{ rows, cursor, more }` |
| `POST /api/assets` | 图片上传 R2（≤ 10 MB，image/*）→ `{ url, r2_key, sha256 }`；`GET /api/assets/<key>` 公开读 |
| `GET /api/health` | 健康检查 |
| 其余 | wrangler assets 托管 `apps/client/dist`（SPA 回退，`_headers` 带 COOP / COEP） |

login_error 代码：config_missing、access_denied、state_mismatch、token_exchange_failed、userinfo_failed、email_unverified、not_allowed。

环境变量（`.dev.vars` / `wrangler secret put`）：GOOGLE_CLIENT_ID、GOOGLE_CLIENT_SECRET、SESSION_SECRET、ALLOWED_EMAILS（逗号分隔；空 = 拒绝所有）、APP_ORIGINS（允许跳回 / CORS 的其他源，如 http://localhost:1420）、TURSO_DB_URL、TURSO_DB_TOKEN（同步数据库；token 只放 Worker 密钥）。绑定：R2 `WEB`（mindough-web，线上静态文件）、R2 `FILES`（mindough-assets，图片）。

Google Cloud OAuth 客户端的重定向 URI：`https://mindough.rei8t.dev/auth/callback`、`http://localhost:8787/auth/callback`。

单测：`pnpm --filter server test`（模拟 Google 的 fetch）。

职责（见 `docs/PLAN.md`“多端同步怎么做”）：Google 登录（Web + 原生 deep link）、同步 API（Turso Cloud `mindough`，Hrana HTTP）、图片（R2）、托管 Web 端静态资源。

本地开发：`pnpm --filter server dev`（需要 `.dev.vars`，参考仓库根的 `.dev.vars.example`）。

## 线上部署（2026-10-15 起）
- 地址：https://mindough.rei8t.dev（Worker 名 mindough，custom domain）。
- Hark 的 API Token 网关下 wrangler 静态资源上传会 401 未授权，所以线上用 `wrangler.deploy.jsonc`：Web 端 `apps/client/dist` 放 R2 桶 `mindough-web`，Worker（`src/static-r2.ts`）读出并加 COOP / COEP。
- 一键：`pnpm --filter server deploy`（先构建 client，再 `scripts/upload-web.sh` 上传，再 `wrangler deploy -c wrangler.deploy.jsonc`）。
- 已设密钥：SESSION_SECRET、ALLOWED_EMAILS（reiy.leoz@gmail.com）、TURSO_DB_URL、TURSO_DB_TOKEN（2026-10-15）。GOOGLE_CLIENT_ID、GOOGLE_CLIENT_SECRET 由 Rei 在控制台配好（2026-10-15），`keep_vars: true` 保证部署时不被清掉。
