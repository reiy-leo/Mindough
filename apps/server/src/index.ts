/**
 * Mindough Worker：Google 登录（Web + 原生端 deep link）、介绍页（旧域名根路径，landing/）、农历订阅代拉（calendar.ts）、同步 API（Turso Cloud，或 STORAGE_BACKEND=d1 时 Cloudflare D1）、图片与附件（R2）、在线找资料（lookup/）、滴答清单导入代理（dida.ts）、Web 静态资源。
 * 状态码都带中文说明，如 401 未登录、403 无权限。
 */
import { serveFromR2, type R2Like } from './static-r2';
import { currentSession, handleCallback, handleLogin, handleLogout } from './auth';
import { handlePull, handlePush, handleSyncToken, type SyncEnv } from './sync';
import { handleExchange, issueNativeCode } from './native';
import { handleAssetCheck, handleAssetGet, handleAssetUpload, type AssetEnv } from './assets';
import { handleLookup } from './lookup';
import { handleFileCheck, handleFileGet, handleFileUpload } from './files';
import { handleIcsProxy } from './calendar';
import { handleDidaProxy } from './dida';
import { purgeAfterPush, purgeOrphans, type PurgeBucket } from './purge';
import { openDb, storageBackend } from './storage';
import type { LookupEnv } from './lookup/types';
import { isLegacyHost } from './hosts';
import { serveLanding, serveLegacySw } from './landing';

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
  out.headers.set('access-control-allow-headers', 'authorization, content-type, x-dida-token');
  out.headers.set('access-control-allow-methods', 'GET, HEAD, POST, OPTIONS');
  out.headers.set('access-control-max-age', '600');
  out.headers.append('vary', 'origin');
  return out;
}

/** 能做清理的桶（真 R2 有 list / delete；测试里的简单假桶没有，就不清理）。 */
export function purgeBucket(b: unknown): PurgeBucket | undefined {
  const x = b as Partial<PurgeBucket> | undefined;
  return x && typeof x.list === 'function' && typeof x.delete === 'function' && typeof x.head === 'function' ? (x as PurgeBucket) : undefined;
}

/** 后台任务：线上是 ctx.waitUntil；没有 ctx（单测直接调 handle）时不等它跑完。 */
export type WaitUntil = (p: Promise<unknown>) => void;

export async function handle(request: Request, env: Env, waitUntil: WaitUntil = (p) => void p.catch(() => {})): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;
  const cors = pathname.startsWith('/api/') || pathname === '/auth/exchange' ? corsOrigin(request, env) : null;
  if (method === 'OPTIONS' && cors) return withCors(new Response(null, { status: 204 }), cors);
  return withCors(await route(request, env, url, pathname, method, waitUntil), cors);
}

async function route(request: Request, env: Env, url: URL, pathname: string, method: string, waitUntil: WaitUntil): Promise<Response> {
  // storage：云端数据库是哪个（turso | d1，由 STORAGE_BACKEND 决定；写错了是 null），设置页只读显示
  if (pathname === '/api/health') return json({ ok: true, name: 'mindough', stage: 'M2', storage: storageBackend(env) });
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
    if (pathname === '/api/sync/push')
      return handlePush(request, env, fetch, (db, user, tombstones) => {
        // 附件删了、没别的行用着同一个文件，就删 R2 里的文件（Rei 2026-10-25）；失败交给每天的定期清理
        const files = purgeBucket(env.FILES);
        if (files) waitUntil(purgeAfterPush(db, files, user, tombstones));
      });
    if (pathname === '/api/sync/pull') return handlePull(request, env);
    return json({ error: '404 未找到' }, 404);
  }

  if (pathname === '/api/assets') {
    if (method !== 'POST') return json({ error: '405 方法不允许：请用 POST' }, 405);
    return handleAssetUpload(request, env);
  }
  if (pathname.startsWith('/api/assets/check/') && method === 'GET') return handleAssetCheck(request, pathname.slice('/api/assets/check/'.length), env);
  if (pathname.startsWith('/api/assets/') && method === 'GET') return handleAssetGet(pathname.slice('/api/assets/'.length), env);

  // 附件（任务、日记）：传、读都要登录，只能读自己的
  if (pathname === '/api/files') {
    if (method !== 'POST') return json({ error: '405 方法不允许：请用 POST' }, 405);
    return handleFileUpload(request, env);
  }
  if (pathname.startsWith('/api/files/check/') && method === 'GET') return handleFileCheck(request, pathname.slice('/api/files/check/'.length), env);
  if (pathname.startsWith('/api/files/') && (method === 'GET' || method === 'HEAD')) return handleFileGet(request, pathname.slice('/api/files/'.length), env, url);

  // 农历订阅：代拉 ICS（不用登录，只收日历文件）
  if (pathname === '/api/calendar/ics') {
    if (method !== 'GET') return json({ error: '405 方法不允许：请用 GET' }, 405);
    return handleIcsProxy(url);
  }

  // 在线找资料（TMDB / 豆瓣 / Open Library / Steam），要登录
  if (pathname.startsWith('/api/lookup/')) return handleLookup(request, env, url);
  // 滴答清单 Open API 代理（导入用，令牌在 x-dida-token 头里，不存）
  if (pathname.startsWith('/api/dida/')) return handleDidaProxy(request, env, url);

  if (pathname.startsWith('/api/') || pathname.startsWith('/auth/')) return json({ error: '404 未找到' }, 404);
  // 旧域名 mindough.rei8t.dev 留给介绍页（Rei 2026-10-26）：根路径出介绍页，/sw.js 换成注销自己的版本；
  // 上面的 /api/*、/auth/* 照常（老客户端和旧图片地址还连这里），其他路径照旧出 app（/local/ 用来导出本机数据）。
  if (isLegacyHost(url) && (method === 'GET' || method === 'HEAD')) {
    if (pathname === '/' || pathname === '/index.html') return serveLanding(request);
    if (pathname === '/sw.js') return serveLegacySw();
  }
  if (env.ASSETS) return env.ASSETS.fetch(request);
  if (env.WEB) return serveFromR2(request, env.WEB);
  void url;
  return json({ error: '404 未找到' }, 404);
}

/** 定期清理附件文件（cron，wrangler 的 triggers.crons：每天 UTC 19:00 = 北京 03:00）。 */
export async function scheduled(env: Env, now = Date.now()) {
  const files = purgeBucket(env.FILES);
  const db = openDb(env);
  if (!files || !db.configured) return console.warn(JSON.stringify({ msg: '附件定期清理跳过：R2 或数据库没配置' }));
  return purgeOrphans(db, files, now);
}

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => handle(request, env, (p) => ctx.waitUntil(p)),
  scheduled: (_event: ScheduledController, env: Env, ctx: ExecutionContext) => ctx.waitUntil(scheduled(env)),
} satisfies ExportedHandler<Env>;
