/**
 * 在线找资料（M4）：都要登录（会话或同步凭据，同 /api/assets）。状态码附中文说明。
 * - GET  /api/lookup/search?kind=movie|book|game&q=…&lang=zh|en[&source=tmdb|douban|openlibrary|steam]
 *        → { results: LookupResult[], sources: [{ source, status: ok|unconfigured|blocked|error, code?, message? }] }
 *        影视同时问 TMDB 和豆瓣（豆瓣只在中文界面问，尽力而为）；一个来源出错不影响另一个。
 *        所有来源都失败时返回第一个失败的状态码（如 TMDB 没配置 → 503 服务不可用）。
 * - GET  /api/lookup/item?source=tmdb|douban|openlibrary|steam|imdb&id=…&lang=zh|en → LookupResult
 *        source=imdb：按 IMDb 编号经 TMDB find 直接取。
 * - POST /api/lookup/image { url } → 把选中结果的封面拉进 R2（mindough-assets），返回同 POST /api/assets 的 { url, r2_key, sha256, mime, size }。
 *        只拉这几个来源的图床（防止拿 Worker 去请求任意地址）。
 * 缓存：Cache API（caches.default），每个来源的搜索结果 1 天、详情 7 天；只缓存成功的。对外请求 8 秒超时（504 网关超时）。
 */
import { requestUser, storeAsset, MAX_ASSET_BYTES, type AssetEnv } from '../assets';
import { doubanItem, searchDouban, DOUBAN_IMAGE_HEADERS } from './douban';
import { openLibraryItem, searchOpenLibrary } from './openlibrary';
import { searchSteam, steamItem } from './steam';
import { searchTmdb, tmdbByImdb, tmdbItem } from './tmdb';
import { LookupError, upstream, type Lang, type LookupEnv, type LookupKind, type LookupResult, type LookupSource, type LookupSourceStatus } from './types';

export interface LookupWorkerEnv extends AssetEnv, LookupEnv {}

export const SEARCH_TTL = 24 * 3600;
export const ITEM_TTL = 7 * 24 * 3600;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

const KIND_SOURCES: Record<LookupKind, LookupSource[]> = { movie: ['tmdb', 'douban'], book: ['openlibrary'], game: ['steam'] };

/** Cache API：Worker 里是 caches.default；单测（node）里没有就直接查。 */
interface CacheLike {
  match(key: Request): Promise<Response | undefined>;
  put(key: Request, res: Response): Promise<void>;
}
const cacheOf = (): CacheLike | null => (globalThis as { caches?: { default?: CacheLike } }).caches?.default ?? null;

async function cached<T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T> {
  const cache = cacheOf();
  const req = new Request(`https://lookup-cache.mindough.internal/v1/${key}`);
  if (cache) {
    const hit = await cache.match(req).catch(() => undefined);
    if (hit) return (await hit.json()) as T;
  }
  const value = await fn();
  if (cache) await cache.put(req, new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${ttl}` } })).catch(() => {});
  return value;
}

const langOf = (url: URL): Lang => (url.searchParams.get('lang') === 'en' ? 'en' : 'zh');

function searchOne(env: LookupEnv, source: LookupSource, q: string, lang: Lang): Promise<LookupResult[]> {
  const key = `search/${source}/${lang}/${encodeURIComponent(q.toLowerCase())}`;
  return cached(key, SEARCH_TTL, () => {
    switch (source) {
      case 'tmdb':
        return searchTmdb(env, q, lang);
      case 'douban':
        return searchDouban(q);
      case 'openlibrary':
        return searchOpenLibrary(q, lang);
      case 'steam':
        return searchSteam(q, lang);
    }
  });
}

const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[\s·・.,，。:：!！?？'"“”()（）\-—]+/g, '');

export async function lookupSearch(env: LookupEnv, kind: LookupKind, q: string, lang: Lang, only?: LookupSource): Promise<{ status: number; body: { results: LookupResult[]; sources: LookupSourceStatus[] } }> {
  let sources = KIND_SOURCES[kind];
  if (only) sources = sources.filter((s) => s === only);
  // 豆瓣的结果全是中文：英文界面不问
  else if (lang === 'en') sources = sources.filter((s) => s !== 'douban');
  const settled = await Promise.allSettled(sources.map((s) => searchOne(env, s, q, lang)));
  const statuses: LookupSourceStatus[] = [];
  const results: LookupResult[] = [];
  const seen = new Set<string>();
  settled.forEach((r, i) => {
    const source = sources[i]!;
    if (r.status === 'fulfilled') {
      statuses.push({ source, status: 'ok' });
      for (const x of r.value) {
        // 豆瓣与 TMDB 同名同年的算一条，留先来的（TMDB）
        const k = `${norm(x.name)}|${x.year ?? ''}`;
        if (source === 'douban' && seen.has(k)) continue;
        seen.add(k);
        results.push(x);
      }
    } else {
      const e = r.reason;
      if (e instanceof LookupError) statuses.push({ source, status: e.state, code: e.status, message: e.message });
      else statuses.push({ source, status: 'error', code: 500, message: '500 服务器出错' });
    }
  });
  const anyOk = statuses.some((s) => s.status === 'ok');
  const status = anyOk || statuses.length === 0 ? 200 : (statuses[0]!.code ?? 502);
  return { status, body: { results, sources: statuses } };
}

export function lookupItem(env: LookupEnv, source: string, id: string, lang: Lang): Promise<LookupResult> {
  const key = `item/${source}/${lang}/${encodeURIComponent(id)}`;
  switch (source) {
    case 'tmdb':
      return cached(key, ITEM_TTL, () => tmdbItem(env, id, lang));
    case 'imdb':
      return cached(key, ITEM_TTL, () => tmdbByImdb(env, id.toLowerCase(), lang));
    case 'douban':
      return cached(key, ITEM_TTL, () => doubanItem(id));
    case 'openlibrary':
      return cached(key, ITEM_TTL, () => openLibraryItem(id));
    case 'steam':
      return cached(key, ITEM_TTL, () => steamItem(id, lang));
    default:
      return Promise.reject(new LookupError(400, '400 请求有误：source 只能是 tmdb、douban、openlibrary、steam、imdb'));
  }
}

/** 能拉进 R2 的图床（来源的官方图片域名）。 */
export function allowedImageHost(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  const h = u.hostname.toLowerCase();
  return h === 'image.tmdb.org' || h === 'covers.openlibrary.org' || h.endsWith('.steamstatic.com') || /^img\d+\.doubanio\.com$/.test(h);
}

async function importImage(req: Request, env: LookupWorkerEnv, who: string): Promise<Response> {
  if (!env.FILES) return json({ error: '503 服务不可用：图片存储还没配置' }, 503);
  let body: { url?: unknown };
  try {
    body = (await req.json()) as { url?: unknown };
  } catch {
    return json({ error: '400 请求有误：要 JSON { url }' }, 400);
  }
  const url = typeof body.url === 'string' ? body.url : '';
  if (!allowedImageHost(url)) return json({ error: '400 请求有误：只能拉 TMDB、豆瓣、Open Library、Steam 的图片' }, 400);
  let res: Response;
  try {
    res = await upstream('图床', url, { headers: new URL(url).hostname.endsWith('doubanio.com') ? DOUBAN_IMAGE_HEADERS : {} }, 10000);
  } catch (e) {
    const err = e as LookupError;
    return json({ error: err.message ?? '502 错误网关' }, err.status ?? 502);
  }
  if (res.status === 404) return json({ error: '404 未找到：这张图已经没有了' }, 404);
  if (!res.ok) return json({ error: `502 错误网关：图床返回 ${res.status}` }, 502);
  const mime = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (!/^image\/(png|jpeg|gif|webp|avif)$/.test(mime)) return json({ error: '415 不支持的格式：拉到的不是图片' }, 415);
  if (Number(res.headers.get('content-length') ?? 0) > MAX_ASSET_BYTES) return json({ error: '413 内容太大：图片不能超过 10 MB' }, 413);
  const buf = await res.arrayBuffer();
  if (buf.byteLength === 0) return json({ error: '502 错误网关：拉到的是空文件' }, 502);
  if (buf.byteLength > MAX_ASSET_BYTES) return json({ error: '413 内容太大：图片不能超过 10 MB' }, 413);
  return json(await storeAsset(env.FILES, who, buf, mime, new URL(req.url).origin));
}

export async function handleLookup(req: Request, env: LookupWorkerEnv, url: URL): Promise<Response> {
  const path = url.pathname;
  const method = req.method;
  const known = path === '/api/lookup/search' || path === '/api/lookup/item' || path === '/api/lookup/image';
  if (!known) return json({ error: '404 未找到' }, 404);
  const wantMethod = path === '/api/lookup/image' ? 'POST' : 'GET';
  if (method !== wantMethod) return json({ error: `405 方法不允许：请用 ${wantMethod}` }, 405);
  const who = await requestUser(req, env);
  if (who instanceof Response) return who;
  if (path === '/api/lookup/image') return importImage(req, env, who);

  const lang = langOf(url);
  if (path === '/api/lookup/search') {
    const kind = url.searchParams.get('kind') as LookupKind | null;
    const q = (url.searchParams.get('q') ?? '').trim();
    const only = (url.searchParams.get('source') ?? '') as LookupSource | '';
    if (!kind || !(kind in KIND_SOURCES)) return json({ error: '400 请求有误：kind 只能是 movie、book、game' }, 400);
    if (!q) return json({ error: '400 请求有误：q 不能为空' }, 400);
    if (q.length > 200) return json({ error: '400 请求有误：q 太长了' }, 400);
    if (only && !KIND_SOURCES[kind].includes(only)) return json({ error: `400 请求有误：${kind} 没有 ${only} 这个来源` }, 400);
    const { status, body } = await lookupSearch(env, kind, q, lang, only || undefined);
    return json(status === 200 ? body : { ...body, error: body.sources[0]?.message }, status);
  }
  const source = url.searchParams.get('source') ?? '';
  const id = (url.searchParams.get('id') ?? '').trim();
  if (!id) return json({ error: '400 请求有误：id 不能为空' }, 400);
  try {
    return json(await lookupItem(env, source, id, lang));
  } catch (e) {
    if (e instanceof LookupError) return json({ error: e.message, state: e.state }, e.status);
    return json({ error: '500 服务器出错' }, 500);
  }
}
