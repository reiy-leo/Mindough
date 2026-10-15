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
const SESSION_TTL_S = 30 * 24 * 3600;
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

export async function currentUser(req: Request, env: AuthEnv): Promise<SessionUser | null> {
  if (!env.SESSION_SECRET) return null;
  const user = await verify<SessionUser>(readCookie(req, SESSION_COOKIE), env.SESSION_SECRET);
  // 白名单改了以后，已登录但不在名单里的会话也失效
  if (user && !allowedEmails(env).has(user.email.toLowerCase())) return null;
  return user;
}

export async function handleLogin(req: Request, env: AuthEnv): Promise<Response> {
  const url = new URL(req.url);
  const returnTo = safeReturnTo(url.searchParams.get('return_to'), url, env);
  if (!configured(env)) return redirect(withLoginError(returnTo, 'config_missing'));
  const state = randomToken();
  const oauth = await sign({ state, return_to: returnTo, exp: Date.now() + OAUTH_TTL_S * 1000 }, env.SESSION_SECRET!);
  const auth = new URL(GOOGLE_AUTH_URL);
  auth.searchParams.set('client_id', env.GOOGLE_CLIENT_ID!);
  auth.searchParams.set('redirect_uri', `${url.origin}/auth/callback`);
  auth.searchParams.set('response_type', 'code');
  auth.searchParams.set('scope', 'openid email profile');
  auth.searchParams.set('state', state);
  auth.searchParams.set('prompt', 'select_account');
  return redirect(auth.toString(), [setCookie(OAUTH_COOKIE, oauth, { maxAge: OAUTH_TTL_S, secure: isSecure(url), path: '/auth' })]);
}

export async function handleCallback(req: Request, env: AuthEnv): Promise<Response> {
  const url = new URL(req.url);
  const secure = isSecure(url);
  const clearOauth = setCookie(OAUTH_COOKIE, '', { maxAge: 0, secure, path: '/auth' });
  if (!configured(env)) return redirect(withLoginError('/', 'config_missing'), [clearOauth]);
  const oauth = await verify<{ state: string; return_to: string; exp: number }>(readCookie(req, OAUTH_COOKIE), env.SESSION_SECRET!);
  const returnTo = oauth?.return_to ?? '/';
  const fail = (code: LoginError) => redirect(withLoginError(returnTo, code), [clearOauth]);

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
