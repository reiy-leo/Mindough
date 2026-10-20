/**
 * 滴答清单 Open API 代理（/api/dida/*，Rei 2026-10-21「不能直接连接dida365么」）。
 * 浏览器不能直接调 api.dida365.com（跨域），Web 和 Tauri 都走这里。
 * - 要登录 Mindough（会话 cookie / 原生 Bearer / 同步凭据，同 /api/assets）。
 * - 滴答清单的个人 API 令牌由客户端每次放在 `x-dida-token` 头里带来（Authorization 已经用来证明是 Mindough 的谁），
 *   这里只转发，不存、不记日志。
 * - 只转发导入要用的几条只读路径（白名单），别的 404。
 * - 出错带中文说明：401 未授权（令牌不对或失效）、403、404、429、上游 5xx → 502 错误网关、超时 → 504 网关超时。
 */
import { requestUser, type AssetEnv } from './assets';

export const DIDA_API = 'https://api.dida365.com';
const MAX_BODY = 64 * 1024;
const TIMEOUT_MS = 25_000;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** 允许的 方法 + 路径（不含 /api/dida/ 前缀）。 */
export function allowedDidaPath(method: string, path: string): boolean {
  if (method === 'GET') {
    if (path === 'open/v1/project' || path === 'open/v1/project/group') return true;
    const m = /^open\/v1\/project\/([^/]+)\/data$/.exec(path);
    return !!m && ID.test(m[1]!);
  }
  if (method === 'POST') return path === 'open/v1/task/completed' || path === 'open/v1/task/filter' || path === 'open/v1/preference';
  return false;
}

const UPSTREAM_MESSAGE: Record<number, string> = {
  400: '400 请求有误：滴答清单不认这次请求',
  401: '401 未授权：滴答清单的令牌不对或已经失效',
  403: '403 无权限：这个令牌不能读这些内容',
  404: '404 未找到：滴答清单里没有这个清单',
  429: '429 请求太多：滴答清单让歇一会儿再试',
};

export async function handleDidaProxy(req: Request, env: AssetEnv, url: URL, fetcher: typeof fetch = (...a) => fetch(...a)): Promise<Response> {
  const method = req.method;
  const path = url.pathname.replace(/^\/api\/dida\//, '');
  if (method !== 'GET' && method !== 'POST') return json({ error: '405 方法不允许：只能 GET 或 POST' }, 405);
  if (!allowedDidaPath(method, path)) return json({ error: '404 未找到' }, 404);
  const who = await requestUser(req, env);
  if (who instanceof Response) return who;
  const token = (req.headers.get('x-dida-token') ?? '').trim();
  if (!token) return json({ error: '400 请求有误：没带滴答清单的令牌' }, 400);
  if (token.length > 512 || /[\s\r\n]/.test(token)) return json({ error: '400 请求有误：令牌格式不对' }, 400);

  let body: string | undefined;
  if (method === 'POST') {
    body = await req.text();
    if (body.length > MAX_BODY) return json({ error: '413 内容太大' }, 413);
    if (body) {
      try {
        JSON.parse(body);
      } catch {
        return json({ error: '400 请求有误：要 JSON' }, 400);
      }
    } else body = '{}';
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetcher(`${DIDA_API}/${path}${url.search}`, {
      method,
      headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      ...(body !== undefined ? { body } : {}),
      signal: ctl.signal,
      redirect: 'manual',
    });
  } catch {
    return ctl.signal.aborted ? json({ error: '504 网关超时：滴答清单太久没回' }, 504) : json({ error: '502 错误网关：连不上滴答清单' }, 502);
  } finally {
    clearTimeout(timer);
  }

  if (res.ok) {
    const text = await res.text();
    return new Response(text || 'null', { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
  }
  const msg = UPSTREAM_MESSAGE[res.status];
  if (msg) return json({ error: msg, upstream_status: res.status }, res.status);
  return json({ error: `502 错误网关：滴答清单返回 ${res.status}`, upstream_status: res.status }, 502);
}
