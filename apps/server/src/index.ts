/**
 * Mindough Worker：Google 登录、/api、Web 静态资源（wrangler assets）。
 * 状态码都带中文说明，如 401 未登录、501 未实现。
 */
import { serveFromR2, type R2Like } from './static-r2';
import { currentUser, handleCallback, handleLogin, handleLogout, type AuthEnv } from './auth';

export interface Env extends AuthEnv {
  /** wrangler assets 绑定（apps/client/dist）；本地单测里没有。 */
  ASSETS?: { fetch(req: Request): Promise<Response> };
  /** 线上：Web 静态文件放 R2（wrangler.deploy.jsonc） */
  WEB?: R2Like;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

export async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;

  if (pathname === '/api/health') return json({ ok: true, name: 'mindough', stage: 'M1' });
  if (pathname === '/auth/login' && method === 'GET') return handleLogin(request, env);
  if (pathname === '/auth/callback' && method === 'GET') return handleCallback(request, env);
  if (pathname === '/auth/logout' && (method === 'GET' || method === 'POST')) return handleLogout(request, env);

  if (pathname === '/api/me' && method === 'GET') {
    const user = await currentUser(request, env);
    if (!user) return json({ error: '401 未登录' }, 401);
    return json({ user: { email: user.email, name: user.name, picture: user.picture } });
  }

  if (pathname === '/api/sync/token') {
    if (method !== 'POST') return json({ error: '405 方法不允许：请用 POST' }, 405);
    if (!(await currentUser(request, env))) return json({ error: '401 未登录' }, 401);
    // M2：经 Turso Platform API 给该用户的数据库签发限权 token
    return json({ error: '501 未实现：同步凭据要到 M2（Turso Sync）才签发' }, 501);
  }

  if (pathname.startsWith('/api/') || pathname.startsWith('/auth/')) return json({ error: '404 未找到' }, 404);
  if (env.ASSETS) return env.ASSETS.fetch(request);
  if (env.WEB) return serveFromR2(request, env.WEB);
  return json({ error: '404 未找到' }, 404);
}

export default {
  fetch: (request: Request, env: Env) => handle(request, env),
} satisfies ExportedHandler<Env>;
