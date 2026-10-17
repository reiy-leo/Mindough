/**
 * 原生端（Tauri）登录：app 生成 verifier，用系统浏览器打开
 *   /auth/login?native=1&challenge=base64url(SHA-256(verifier))
 * Google 登录成功后 Worker 发一个 5 分钟有效、只能用一次的登录码，结果页跳回 mindough://auth?code=…；
 * app 收到 deep link 后 POST /auth/exchange { code, verifier } 换成会话（Bearer 用），之后和 Web 端一样取同步凭据。
 * 登录码存在云端库（Turso 或 D1，看 STORAGE_BACKEND）的 auth_code 表（Worker 没有别的存储）。verifier 只在 app 里，别的 app 截到 deep link 也换不走。
 */
import { SESSION_TTL_S, allowedEmails, type SessionUser } from './auth';
import { randomToken, sign } from './session';
import { ensureSchema, type SyncEnv } from './sync';
import { openDb } from './storage';

const CODE_TTL_MS = 5 * 60 * 1000;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

export async function sha256b64url(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  let s = '';
  for (const b of digest) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function issueNativeCode(env: SyncEnv, user: SessionUser, challenge: string, fetcher: typeof fetch = fetch): Promise<string> {
  const db = openDb(env, fetcher);
  await ensureSchema(db);
  const code = randomToken(32);
  const now = Date.now();
  await db.execute([
      { sql: `DELETE FROM "auth_code" WHERE "expires_at" < ?`, args: [now] },
      { sql: `INSERT INTO "auth_code" ("code", "payload", "challenge", "expires_at") VALUES (?, ?, ?, ?)`, args: [code, JSON.stringify(user), challenge, now + CODE_TTL_MS] },
  ]);
  return code;
}

/** POST /auth/exchange { code, verifier } → { session, user, expires_at }；码不对 / 用过 / 过期 → 400。 */
export async function handleExchange(req: Request, env: SyncEnv, fetcher: typeof fetch = fetch): Promise<Response> {
  if (!env.SESSION_SECRET) return json({ error: '503 服务不可用：登录还没配置' }, 503);
  let body: { code?: unknown; verifier?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: '400 请求有误：不是 JSON' }, 400);
  }
  if (typeof body.code !== 'string' || typeof body.verifier !== 'string' || body.verifier.length < 43) return json({ error: '400 请求有误：缺少 code 或 verifier' }, 400);
  try {
    const db = openDb(env, fetcher);
    await ensureSchema(db);
    const challenge = await sha256b64url(body.verifier);
    // 一次性：只有 used = 0、没过期、challenge 对得上的那一行会被改成 used = 1 并返回
    const [rows] = await db.execute(
      [
        {
          sql: `UPDATE "auth_code" SET "used" = 1 WHERE "code" = ? AND "used" = 0 AND "expires_at" >= ? AND "challenge" = ? RETURNING "payload"`,
          args: [body.code, Date.now(), challenge],
        },
      ],
    );
    const payload = rows?.[0]?.payload;
    if (typeof payload !== 'string') return json({ error: '400 请求有误：登录码无效、已用过或已过期，请重新登录' }, 400);
    const user = JSON.parse(payload) as SessionUser;
    if (!allowedEmails(env).has(user.email.toLowerCase())) return json({ error: '403 无权限' }, 403);
    const exp = Date.now() + SESSION_TTL_S * 1000;
    const session = await sign({ ...user, exp }, env.SESSION_SECRET);
    return json({ session, user: { email: user.email, name: user.name, picture: user.picture }, expires_at: new Date(exp).toISOString() });
  } catch (e) {
    return json({ error: `502 网关错误：${e instanceof Error ? e.message : String(e)}` }, 502);
  }
}
