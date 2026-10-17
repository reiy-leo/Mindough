/**
 * 农历订阅代拉（Rei 2026-10-17）：GET /api/calendar/ics?url=<https 地址>[&fresh=1]
 * 浏览器直接拉别人的 ICS 会被 CORS 挡住，这里替客户端拉，原样返回日历文本（客户端用 core 的 parseIcs 解析、存本机）。
 * - 不用登录：没登录也能看节气节日（本地优先）。只代拉日历：只收 http(s)、回来的必须是 BEGIN:VCALENDAR 开头、≤ 2 MB，所以拿它当通用代理没用。
 * - 缓存：Cache API 6 小时（同一个地址所有人共用）；fresh=1（设置里「立即同步」）跳过读缓存，拉到了照样写回。
 * - 状态码附中文：400 请求有误（地址不对）、502 网关错误（订阅源出错，响应里 upstream_status 是源的状态码，如 404）、
 *   415 不支持的格式（不是日历）、413 内容太大、504 网关超时（源 10 秒没响应）。
 */
/** 同 core 的 looksLikeIcs（Worker 不依赖 core）。 */
const looksLikeIcs = (text: string) => /^\uFEFF?\s*BEGIN:VCALENDAR/i.test(text);

export const ICS_TTL = 6 * 3600;
export const ICS_MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 10_000;

const json = (data: unknown, status: number) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

interface CacheLike {
  match(key: Request): Promise<Response | undefined>;
  put(key: Request, res: Response): Promise<void>;
}
const cacheOf = (): CacheLike | null => (globalThis as { caches?: { default?: CacheLike } }).caches?.default ?? null;

/** 只收公网 http(s)；webcal:// 当 https。 */
export function icsTarget(raw: string | null): URL | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim().replace(/^webcals?:\/\//i, 'https://'));
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const h = u.hostname.toLowerCase();
    if (!h.includes('.') || h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || /^\d+\.\d+\.\d+\.\d+$/.test(h) || h.startsWith('[')) return null;
    if (u.username || u.password) return null;
    return u;
  } catch {
    return null;
  }
}

const ok = (text: string, cache: 'hit' | 'miss', upstream: number) =>
  new Response(text, {
    status: 200,
    headers: { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'no-store', 'x-mindough-cache': cache, 'x-upstream-status': String(upstream) },
  });

export async function handleIcsProxy(url: URL, fetcher: typeof fetch = fetch): Promise<Response> {
  const target = icsTarget(url.searchParams.get('url'));
  if (!target) return json({ error: '400 请求有误：订阅地址不对（要 http / https 的公网地址）' }, 400);
  const fresh = url.searchParams.get('fresh') === '1';
  const cache = cacheOf();
  const key = new Request(`https://ics-cache.mindough.internal/v1/${encodeURIComponent(target.toString())}`);
  if (cache && !fresh) {
    const hit = await cache.match(key).catch(() => undefined);
    if (hit) return ok(await hit.text(), 'hit', 200);
  }
  let res: Response;
  try {
    res = await fetcher(target.toString(), {
      headers: { accept: 'text/calendar, text/plain;q=0.9, */*;q=0.5', 'user-agent': 'Mindough/1.0 (+https://mindough.rei8t.dev)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    return timeout ? json({ error: '504 网关超时：订阅源 10 秒没响应' }, 504) : json({ error: '502 网关错误：连不上订阅源' }, 502);
  }
  if (!res.ok) return json({ error: `502 网关错误：订阅源返回 ${res.status}`, upstream_status: res.status }, 502);
  const len = Number(res.headers.get('content-length') ?? '0');
  if (len > ICS_MAX_BYTES) return json({ error: '413 内容太大：日历超过 2 MB' }, 413);
  const buf = await res.arrayBuffer();
  if (buf.byteLength > ICS_MAX_BYTES) return json({ error: '413 内容太大：日历超过 2 MB' }, 413);
  const text = new TextDecoder('utf-8').decode(buf);
  if (!looksLikeIcs(text)) return json({ error: '415 不支持的格式：这个地址不是日历文件（ICS）' }, 415);
  if (cache) await cache.put(key, new Response(text, { headers: { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': `public, max-age=${ICS_TTL}` } })).catch(() => {});
  return ok(text, 'miss', res.status);
}
