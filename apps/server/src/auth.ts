/**
 * Google 登录（OAuth 2.0 授权码流程 + OpenID userinfo）。
 * - /auth/login?return_to=/…     → 302 到 Google（state 放在短期签名 cookie 里防 CSRF）
 * - /auth/callback?code&state    → 换 token、取邮箱、查白名单 → 设会话 cookie → 302 回 return_to
 * - /auth/logout                 → 清会话（GET 302 回去；POST 返回 JSON）
 * 失败一律 302 回 return_to 并带 ?login_error=<代码>，由前端显示提示（见 apps/client/src/lib/login.ts）。
 *
 * 白名单 ALLOWED_EMAILS：逗号分隔；为空 = 谁都不能登录（不是“全开放”）。
 */
import { randomToken, readCookie, setCookie, sign, verify } from './session';

export interface AuthEnv {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  SESSION_SECRET?: string;
  ALLOWED_EMAILS?: string;
  /** 允许 return_to 跳回的其他源（逗号分隔，如本地 vite 的 http://localhost:1420）。 */
  APP_ORIGINS?: string;
}

export interface SessionUser {
  sub: string;
  email: string;
  name: string;
  picture: string | null;
  exp: number;
}

export const SESSION_COOKIE = 'md_session';
const OAUTH_COOKIE = 'md_oauth';
export const SESSION_TTL_S = 30 * 24 * 3600;
const OAUTH_TTL_S = 10 * 60;

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

export type LoginError =
  | 'config_missing'
  | 'access_denied'
  | 'state_mismatch'
  | 'token_exchange_failed'
  | 'userinfo_failed'
  | 'email_unverified'
  | 'not_allowed';

export function allowedEmails(env: AuthEnv): Set<string> {
  return new Set(
    (env.ALLOWED_EMAILS ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

const isSecure = (url: URL) => url.protocol === 'https:';
const configured = (env: AuthEnv) => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.SESSION_SECRET);

/** return_to 只能是本站路径，或 APP_ORIGINS 里的源；否则回首页。防开放重定向。 */
export function safeReturnTo(raw: string | null, url: URL, env: AuthEnv): string {
  if (!raw) return '/';
  if (raw.startsWith('/') && !raw.startsWith('//') && !raw.startsWith('/\\')) return raw;
  try {
    const target = new URL(raw);
    const origins = (env.APP_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (target.origin === url.origin || origins.includes(target.origin)) return target.toString();
  } catch {
    /* 非法 URL */
  }
  return '/';
}

/** 在 return_to 上加 ?login_error=…（放在 # 之前，前端用 hash 路由）。 */
export function withLoginError(returnTo: string, code: LoginError): string {
  const hashAt = returnTo.indexOf('#');
  const base = hashAt >= 0 ? returnTo.slice(0, hashAt) : returnTo;
  const hash = hashAt >= 0 ? returnTo.slice(hashAt) : '';
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}login_error=${code}${hash}`;
}

const redirect = (location: string, cookies: string[] = []) => {
  const headers = new Headers({ location, 'cache-control': 'no-store' });
  for (const c of cookies) headers.append('set-cookie', c);
  return new Response(null, { status: 302, headers });
};

/** 会话：Web 端是 md_session cookie；原生端（Tauri）没有 cookie，用 `Authorization: Bearer <会话>`（/auth/exchange 换来的）。 */
export async function sessionFrom(req: Request, env: AuthEnv): Promise<SessionUser | null> {
  if (!env.SESSION_SECRET) return null;
  const bearer = (req.headers.get('authorization') ?? '').match(/^Bearer\s+(.+)$/i)?.[1];
  const user = await verify<SessionUser & { k?: string }>(bearer ?? readCookie(req, SESSION_COOKIE), env.SESSION_SECRET);
  // 只认会话：同步凭据（k = sync）不能当会话用
  if (!user || user.k !== undefined || typeof user.sub !== 'string' || typeof user.email !== 'string') return null;
  return user;
}

export type SessionCheck = { status: 200; user: SessionUser } | { status: 401 } | { status: 403; user: SessionUser };

/** 401 = 没有有效会话；403 = 会话有效但邮箱不在 ALLOWED_EMAILS 里（白名单改了以后的旧会话）。 */
export async function currentSession(req: Request, env: AuthEnv): Promise<SessionCheck> {
  const user = await sessionFrom(req, env);
  if (!user) return { status: 401 };
  if (!allowedEmails(env).has(user.email.toLowerCase())) return { status: 403, user };
  return { status: 200, user };
}

export async function currentUser(req: Request, env: AuthEnv): Promise<SessionUser | null> {
  const s = await currentSession(req, env);
  return s.status === 200 ? s.user : null;
}

/** 原生端（Tauri）登录完成后回到 app 的 deep link。 */
export const NATIVE_RETURN = 'mindough://auth';

interface OAuthState {
  state: string;
  return_to: string;
  exp: number;
  /** 原生端登录：PKCE 式的 challenge = base64url(SHA-256(verifier))，换会话时要出示 verifier。 */
  native?: { challenge: string };
}

export async function handleLogin(req: Request, env: AuthEnv): Promise<Response> {
  const url = new URL(req.url);
  const challenge = url.searchParams.get('challenge');
  const native = url.searchParams.get('native') === '1' && !!challenge && /^[A-Za-z0-9_-]{43}$/.test(challenge);
  const returnTo = native ? NATIVE_RETURN : safeReturnTo(url.searchParams.get('return_to'), url, env);
  if (!configured(env)) return native ? nativeResult(withLoginError(NATIVE_RETURN, 'config_missing'), false) : redirect(withLoginError(returnTo, 'config_missing'));
  const state = randomToken();
  const oauth = await sign(
    { state, return_to: returnTo, exp: Date.now() + OAUTH_TTL_S * 1000, ...(native ? { native: { challenge: challenge! } } : {}) } satisfies OAuthState,
    env.SESSION_SECRET!,
  );
  const auth = new URL(GOOGLE_AUTH_URL);
  auth.searchParams.set('client_id', env.GOOGLE_CLIENT_ID!);
  auth.searchParams.set('redirect_uri', `${url.origin}/auth/callback`);
  auth.searchParams.set('response_type', 'code');
  auth.searchParams.set('scope', 'openid email profile');
  auth.searchParams.set('state', state);
  auth.searchParams.set('prompt', 'select_account');
  return redirect(auth.toString(), [setCookie(OAUTH_COOKIE, oauth, { maxAge: OAUTH_TTL_S, secure: isSecure(url), path: '/auth' })]);
}

/**
 * 原生端登录的结果页：浏览器里显示一句话，并自动跳回 app（mindough://auth?code=… 或 ?login_error=…）。
 * 不直接 302 到自定义协议：有的浏览器会静默拦下，留一个按钮可以再点。
 */
export function nativeResult(link: string, ok: boolean): Response {
  const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const title = ok ? '已登录，回到念头团继续' : '没有登录成功';
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font:16px/1.6 -apple-system,"Segoe UI Variable","Segoe UI",system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;color:#1d1d1f;background:#f5f5f7}main{text-align:center;padding:24px}a{display:inline-block;margin-top:12px;padding:8px 18px;border-radius:999px;background:#0a84ff;color:#fff;text-decoration:none}p{color:#6e6e73}@media(prefers-color-scheme:dark){body{background:#1c1c1e;color:#f5f5f7}p{color:#a1a1a6}}</style></head>
<body><main><h1 style="font-size:22px;font-weight:600">${title}</h1><p>${ok ? '这个页面可以关掉了。' : '回到念头团看看是怎么回事。'}</p><a href="${esc(link)}">打开念头团</a></main>
<script>location.href=${JSON.stringify(link)}</script></body></html>`;
  return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'set-cookie': setCookie(OAUTH_COOKIE, '', { maxAge: 0, secure: true, path: '/auth' }) } });
}

export interface CallbackHooks {
  /** 原生端登录成功：发一次性登录码，返回 deep link（见 native.ts）。 */
  issueNativeCode?: (user: SessionUser, challenge: string) => Promise<string>;
}

export async function handleCallback(req: Request, env: AuthEnv, hooks: CallbackHooks = {}): Promise<Response> {
  const url = new URL(req.url);
  const secure = isSecure(url);
  const clearOauth = setCookie(OAUTH_COOKIE, '', { maxAge: 0, secure, path: '/auth' });
  if (!configured(env)) return redirect(withLoginError('/', 'config_missing'), [clearOauth]);
  const oauth = await verify<OAuthState>(readCookie(req, OAUTH_COOKIE), env.SESSION_SECRET!);
  const returnTo = oauth?.return_to ?? '/';
  const fail = (code: LoginError) =>
    oauth?.native ? nativeResult(withLoginError(NATIVE_RETURN, code), false) : redirect(withLoginError(returnTo, code), [clearOauth]);

  if (url.searchParams.get('error')) return fail('access_denied');
  const code = url.searchParams.get('code');
  if (!oauth || !code || url.searchParams.get('state') !== oauth.state) return fail('state_mismatch');

  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${url.origin}/auth/callback`,
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) return fail('token_exchange_failed');
  const token = (await tokenRes.json()) as { access_token?: string };
  if (!token.access_token) return fail('token_exchange_failed');

  const infoRes = await fetch(GOOGLE_USERINFO_URL, { headers: { authorization: `Bearer ${token.access_token}` } });
  if (!infoRes.ok) return fail('userinfo_failed');
  const info = (await infoRes.json()) as { sub?: string; email?: string; email_verified?: boolean; name?: string; picture?: string };
  if (!info.sub || !info.email) return fail('userinfo_failed');
  if (info.email_verified !== true) return fail('email_unverified');
  if (!allowedEmails(env).has(info.email.toLowerCase())) return fail('not_allowed');

  const user: SessionUser = {
    sub: info.sub,
    email: info.email,
    name: info.name ?? info.email,
    picture: info.picture ?? null,
    exp: Date.now() + SESSION_TTL_S * 1000,
  };
  if (oauth.native) {
    if (!hooks.issueNativeCode) return fail('config_missing');
    try {
      const code = await hooks.issueNativeCode(user, oauth.native.challenge);
      return nativeResult(`${NATIVE_RETURN}?code=${encodeURIComponent(code)}`, true);
    } catch {
      return fail('config_missing');
    }
  }
  const session = await sign(user, env.SESSION_SECRET!);
  return redirect(returnTo, [clearOauth, setCookie(SESSION_COOKIE, session, { maxAge: SESSION_TTL_S, secure })]);
}

export function handleLogout(req: Request, env: AuthEnv): Response {
  const url = new URL(req.url);
  const clear = setCookie(SESSION_COOKIE, '', { maxAge: 0, secure: isSecure(url) });
  if (req.method === 'POST') {
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'set-cookie': clear } });
  }
  return redirect(safeReturnTo(url.searchParams.get('return_to'), url, env), [clear]);
}
