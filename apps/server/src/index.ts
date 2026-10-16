/**
 * Mindough Worker：Google 登录（Web + 原生端 deep link）、同步 API（Turso Cloud）、图片（R2）、在线找资料（lookup/）、Web 静态资源。
 * 状态码都带中文说明，如 401 未登录、403 无权限。
 */
import { serveFromR2, type R2Like } from './static-r2';
import { currentSession, handleCallback, handleLogin, handleLogout } from './auth';
import { handlePull, handlePush, handleSyncToken, type SyncEnv } from './sync';
import { handleExchange, issueNativeCode } from './native';
import { handleAssetGet, handleAssetUpload, type AssetEnv } from './assets';
import { handleLookup } from './lookup';
import type { LookupEnv } from './lookup/types';

export interface Env extends SyncEnv, AssetEnv, LookupEnv {
  /** wrangler assets 绑定（apps/client/dist）；本地单测里没有。 */
  ASSETS?: { fetch(req: Request): Promise<Response> };
  /** 线上：Web 静态文件放 R2（wrangler.deploy.jsonc） */
  WEB?: R2Like;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

/** 原生端 WebView 的源（Tauri 2：macOS / iOS / Linux 是 tauri://localhost，Windows / Android 是 http(s)://tauri.localhost）。 */
export const NATIVE_ORIGINS = ['tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost'];

function corsOrigin(req: Request, env: Env): string | null {
  const origin = req.headers.get('origin');
  if (!origin) return null;
  const extra = (env.APP_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return NATIVE_ORIGINS.includes(origin) || extra.includes(origin) ? origin : null;
}

function withCors(res: Response, origin: string | null): Response {
  if (!origin) return res;
  const out = new Response(res.body, res);
  out.headers.set('access-control-allow-origin', origin);
  out.headers.set('access-control-allow-headers', 'authorization, content-type');
  out.headers.set('access-control-allow-methods', 'GET, POST, OPTIONS');
  out.headers.set('access-control-max-age', '600');
  out.headers.append('vary', 'origin');
  return out;
}

export async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;
  const cors = pathname.startsWith('/api/') || pathname === '/auth/exchange' ? corsOrigin(request, env) : null;
  if (method === 'OPTIONS' && cors) return withCors(new Response(null, { status: 204 }), cors);
  return withCors(await route(request, env, url, pathname, method), cors);
}

async function route(request: Request, env: Env, url: URL, pathname: string, method: string): Promise<Response> {
  if (pathname === '/api/health') return json({ ok: true, name: 'mindough', stage: 'M2' });
  if (pathname === '/auth/login' && method === 'GET') return handleLogin(request, env);
  if (pathname === '/auth/callback' && method === 'GET')
    return handleCallback(request, env, { issueNativeCode: (user, challenge) => issueNativeCode(env, user, challenge) });
  if (pathname === '/auth/logout' && (method === 'GET' || method === 'POST')) return handleLogout(request, env);
  if (pathname === '/auth/exchange') {
    if (method !== 'POST') return json({ error: '405 方法不允许：请用 POST' }, 405);
    return handleExchange(request, env);
  }

  if (pathname === '/api/me' && method === 'GET') {
    const s = await currentSession(request, env);
    if (s.status === 401) return json({ error: '401 未登录' }, 401);
    if (s.status === 403) return json({ error: '403 无权限：这个账户不在允许登录的名单里' }, 403);
    return json({ user: { email: s.user.email, name: s.user.name, picture: s.user.picture } });
  }

  if (pathname.startsWith('/api/sync/')) {
    if (method !== 'POST') return json({ error: '405 方法不允许：请用 POST' }, 405);
    if (pathname === '/api/sync/token') return handleSyncToken(request, env);
    if (pathname === '/api/sync/push') return handlePush(request, env);
    if (pathname === '/api/sync/pull') return handlePull(request, env);
    return json({ error: '404 未找到' }, 404);
  }

  if (pathname === '/api/assets') {
    if (method !== 'POST') return json({ error: '405 方法不允许：请用 POST' }, 405);
    return handleAssetUpload(request, env);
  }
  if (pathname.startsWith('/api/assets/') && method === 'GET') return handleAssetGet(pathname.slice('/api/assets/'.length), env);

  // 在线找资料（TMDB / 豆瓣 / Open Library / Steam），要登录
  if (pathname.startsWith('/api/lookup/')) return handleLookup(request, env, url);

  if (pathname.startsWith('/api/') || pathname.startsWith('/auth/')) return json({ error: '404 未找到' }, 404);
  if (env.ASSETS) return env.ASSETS.fetch(request);
  if (env.WEB) return serveFromR2(request, env.WEB);
  void url;
  return json({ error: '404 未找到' }, 404);
}

export default {
  fetch: (request: Request, env: Env) => handle(request, env),
} satisfies ExportedHandler<Env>;
