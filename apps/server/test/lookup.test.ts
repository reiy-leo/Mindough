import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handle, type Env } from '../src/index';
import { sign } from '../src/session';
import { allowedImageHost } from '../src/lookup';
import { isV4Token } from '../src/lookup/tmdb';
import { parseDoubanRexxar, parseDoubanSubject } from '../src/lookup/douban';
import { steamPlatforms } from '../src/lookup/steam';
import type { AssetBucket, R2Object } from '../src/assets';

const ORIGIN = 'https://mindough.rei8t.dev';
const SECRET = 'test-secret-0123456789';
const V3 = '0123456789abcdef0123456789abcdef';
const V4 = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJ4In0.c2lnbmF0dXJl';

class MemBucket implements AssetBucket {
  data = new Map<string, { buf: ArrayBuffer; type?: string }>();
  async get(key: string): Promise<R2Object | null> {
    const v = this.data.get(key);
    return v ? { body: new Response(v.buf).body!, httpMetadata: { contentType: v.type }, size: v.buf.byteLength } : null;
  }
  async head(key: string) {
    return this.data.has(key) ? {} : null;
  }
  async put(key: string, value: ArrayBuffer, opts?: { httpMetadata?: { contentType?: string } }) {
    this.data.set(key, { buf: value, type: opts?.httpMetadata?.contentType });
    return {};
  }
}

const baseEnv = (p: Partial<Env> = {}): Env => ({ SESSION_SECRET: SECRET, ALLOWED_EMAILS: 'reiy.leoz@gmail.com', ...p });

async function bearer(email = 'reiy.leoz@gmail.com') {
  return `Bearer ${await sign({ sub: 's', email, name: 'Rei', picture: null, exp: Date.now() + 60_000 }, SECRET)}`;
}

async function call(path: string, env: Env, init: RequestInit = {}, auth = true) {
  const headers = new Headers(init.headers);
  if (auth) headers.set('authorization', await bearer());
  return handle(new Request(ORIGIN + path, { ...init, headers }), env);
}

type Route = (url: URL, init?: RequestInit) => Response | Promise<Response>;
function mockFetch(routes: Record<string, Route>) {
  const calls: Array<{ url: URL; init?: RequestInit }> = [];
  const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    calls.push({ url, ...(init ? { init } : {}) });
    const key = Object.keys(routes).find((k) => `${url.origin}${url.pathname}`.startsWith(k));
    if (!key) throw new Error(`没想到的请求：${url}`);
    return routes[key]!(url, init);
  });
  vi.stubGlobal('fetch', f);
  return calls;
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

const TMDB_SEARCH = {
  results: [
    { id: 693134, media_type: 'movie', title: '沙丘2', original_title: 'Dune: Part Two', release_date: '2024-02-27', poster_path: '/p2.jpg' },
    { id: 1, media_type: 'person', name: '某人' },
    { id: 90228, media_type: 'tv', name: '沙丘：预言', original_name: 'Dune: Prophecy', first_air_date: '2024-11-17', poster_path: null },
  ],
};

describe('lookup：登录与参数', () => {
  it('没登录 401、不在名单 403、方法不对 405、参数不对 400', async () => {
    const env = baseEnv();
    expect((await call('/api/lookup/search?kind=movie&q=x', env, {}, false)).status).toBe(401);
    const res403 = await handle(new Request(`${ORIGIN}/api/lookup/search?kind=movie&q=x`, { headers: { authorization: await bearer('x@y.z') } }), env);
    expect(res403.status).toBe(403);
    expect((await call('/api/lookup/search?kind=movie&q=x', env, { method: 'POST' })).status).toBe(405);
    const bad = await call('/api/lookup/search?kind=music&q=x', env);
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toMatch(/^400 请求有误/);
    expect((await call('/api/lookup/search?kind=movie&q=%20', env)).status).toBe(400);
    expect((await call('/api/lookup/item?source=nope&id=1', env)).status).toBe(400);
    expect((await call('/api/lookup/nope', env)).status).toBe(404);
  });
});

describe('TMDB', () => {
  it('认得出 v3 key 和 v4 令牌', () => {
    expect(isV4Token(V4)).toBe(true);
    expect(isV4Token(V3)).toBe(false);
  });

  it('没配置：TMDB 503 服务不可用（unconfigured），豆瓣照样有结果', async () => {
    mockFetch({
      'https://movie.douban.com/j/subject_suggest': () =>
        Response.json([{ id: '35575567', title: '沙丘2', sub_title: 'Dune: Part Two', year: '2024', type: 'movie', episode: '', img: 'https://img9.doubanio.com/view/photo/s_ratio_poster/public/p2.jpg' }]),
    });
    const res = await call('/api/lookup/search?kind=movie&q=%E6%B2%99%E4%B8%98&lang=zh', baseEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: Array<{ source: string; image?: string; fields: Record<string, unknown> }>; sources: Array<{ source: string; status: string; code?: number; message?: string }> };
    expect(body.sources).toContainEqual(expect.objectContaining({ source: 'tmdb', status: 'unconfigured', code: 503 }));
    expect(body.sources.find((s) => s.source === 'tmdb')!.message).toMatch(/^503 服务不可用/);
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({ source: 'douban', fields: { douban: '35575567', kind: '电影', year: 2024 } });
    expect(body.results[0]!.image).toBe('https://img9.doubanio.com/view/photo/l_ratio_poster/public/p2.jpg');
  });

  it('只问 TMDB 且没配置：整体 503', async () => {
    mockFetch({});
    const res = await call('/api/lookup/search?kind=movie&q=dune&source=tmdb', baseEnv());
    expect(res.status).toBe(503);
    const res2 = await call('/api/lookup/item?source=imdb&id=tt15239678', baseEnv());
    expect(res2.status).toBe(503);
    expect(((await res2.json()) as { state: string }).state).toBe('unconfigured');
  });

  it('v3 key 走 api_key，中文界面 zh-CN；人物不算；豆瓣同名同年去重', async () => {
    const calls = mockFetch({
      'https://api.themoviedb.org/3/search/multi': () => Response.json(TMDB_SEARCH),
      'https://movie.douban.com/j/subject_suggest': () => Response.json([{ id: '35575567', title: '沙丘2', year: '2024', type: 'movie' }, { id: '3001114', title: '沙丘', year: '2021', type: 'movie' }]),
    });
    const res = await call('/api/lookup/search?kind=movie&q=%E6%B2%99%E4%B8%98&lang=zh', baseEnv({ TMDB_API_KEY: V3 }));
    const body = (await res.json()) as { results: Array<{ source: string; sourceId: string; name: string; fields: Record<string, unknown>; thumb?: string; subtitle?: string; url: string }> };
    const t = calls.find((c) => c.url.hostname === 'api.themoviedb.org')!;
    expect(t.url.searchParams.get('api_key')).toBe(V3);
    expect(t.url.searchParams.get('language')).toBe('zh-CN');
    expect(new Headers(t.init?.headers).get('authorization')).toBeNull();
    expect(body.results.map((r) => `${r.source}:${r.sourceId}`)).toEqual(['tmdb:movie/693134', 'tmdb:tv/90228', 'douban:3001114']);
    expect(body.results[0]).toMatchObject({ name: '沙丘2', subtitle: 'Dune: Part Two', fields: { year: 2024, kind: '电影' }, thumb: 'https://image.tmdb.org/t/p/w185/p2.jpg', url: 'https://www.themoviedb.org/movie/693134' });
    expect(body.results[1]!.fields.kind).toBe('剧集');
  });

  it('v4 令牌走 Bearer，英文界面 en-US 且不问豆瓣', async () => {
    const calls = mockFetch({ 'https://api.themoviedb.org/3/search/multi': () => Response.json(TMDB_SEARCH) });
    const res = await call('/api/lookup/search?kind=movie&q=dune&lang=en', baseEnv({ TMDB_API_KEY: V4 }));
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(new Headers(calls[0]!.init?.headers).get('authorization')).toBe(`Bearer ${V4}`);
    expect(calls[0]!.url.searchParams.get('api_key')).toBeNull();
    expect(calls[0]!.url.searchParams.get('language')).toBe('en-US');
  });

  it('只要电影：用 /search/movie，豆瓣的剧集也过滤掉（试跑：《末日》被排成剧集《末日地堡》）', async () => {
    const calls = mockFetch({
      'https://api.themoviedb.org/3/search/movie': () => Response.json({ results: [{ id: 1, title: '末日', release_date: '2024-01-01' }] }),
      'https://movie.douban.com/j/subject_suggest': () => Response.json([{ id: '1', title: '末日地堡', year: '2023', type: 'movie', episode: '10' }, { id: '2', title: '末日2', year: '2024', type: 'movie', episode: '' }]),
    });
    const res = await call('/api/lookup/search?kind=movie&q=%E6%9C%AB%E6%97%A5&media=movie', baseEnv({ TMDB_API_KEY: V3 }));
    const body = (await res.json()) as { results: Array<{ source: string; name: string; fields: Record<string, unknown> }> };
    expect(calls.some((c) => c.url.pathname === '/3/search/multi')).toBe(false);
    expect(body.results.map((r) => r.name)).toEqual(['末日', '末日2']);
    expect(body.results[0]!.fields.kind).toBe('电影');
  });

  it('中文名在 TMDB 搜不到：用豆瓣给的原名（带年份）补搜；alt 参数也会试', async () => {
    const tmdbQueries: string[] = [];
    mockFetch({
      'https://api.themoviedb.org/3/search/movie': (u) => {
        tmdbQueries.push(`${u.searchParams.get('query')}|${u.searchParams.get('primary_release_year') ?? ''}`);
        return Response.json({ results: u.searchParams.get('query') === 'The SpongeBob Movie: Search for SquarePants' ? [{ id: 9, title: '海绵宝宝：深海大冒险', release_date: '2025-12-19' }] : [] });
      },
      'https://movie.douban.com/j/subject_suggest': () => Response.json([{ id: '3', title: '海绵宝宝大电影·寻找方裤', sub_title: 'The SpongeBob Movie: Search for SquarePants', year: '2025', type: 'movie' }]),
    });
    const res = await call(`/api/lookup/search?kind=movie&q=${encodeURIComponent('海绵宝宝大电影·寻找方裤')}&media=movie`, baseEnv({ TMDB_API_KEY: V3 }));
    const body = (await res.json()) as { results: Array<{ source: string; name: string }> };
    expect(tmdbQueries).toEqual(['海绵宝宝大电影·寻找方裤|', 'The SpongeBob Movie: Search for SquarePants|2025']);
    expect(body.results.map((r) => `${r.source}:${r.name}`)).toEqual(['tmdb:海绵宝宝：深海大冒险', 'douban:海绵宝宝大电影·寻找方裤']);
    // 英文界面：豆瓣只拿来补搜，不列出；alt 先试
    tmdbQueries.length = 0;
    const en = await call(`/api/lookup/search?kind=movie&q=${encodeURIComponent('海绵宝宝大电影·寻找方裤')}&media=movie&lang=en&alt=Nope`, baseEnv({ TMDB_API_KEY: V3 }));
    const enBody = (await en.json()) as { results: Array<{ source: string }> };
    expect(tmdbQueries[1]).toBe('Nope|');
    expect(enBody.results.map((r) => r.source)).toEqual(['tmdb']);
  });

  it('详情带 IMDb；按 IMDb 编号 find；剧集从 external_ids 拿', async () => {
    mockFetch({
      'https://api.themoviedb.org/3/movie/693134': () => Response.json({ id: 693134, title: '沙丘2', release_date: '2024-02-27', poster_path: '/p2.jpg', imdb_id: 'tt15239678' }),
      'https://api.themoviedb.org/3/tv/1399': () => Response.json({ id: 1399, name: '权力的游戏', first_air_date: '2011-04-17', external_ids: { imdb_id: 'tt0944947' } }),
      'https://api.themoviedb.org/3/find/tt15239678': (u) => {
        expect(u.searchParams.get('external_source')).toBe('imdb_id');
        return Response.json({ movie_results: [{ id: 693134, title: '沙丘2', release_date: '2024-02-27' }], tv_results: [] });
      },
      'https://api.themoviedb.org/3/find/tt0000001': () => Response.json({ movie_results: [], tv_results: [] }),
    });
    const env = baseEnv({ TMDB_API_KEY: V3 });
    const m = (await (await call('/api/lookup/item?source=tmdb&id=movie/693134', env)).json()) as { fields: Record<string, unknown>; image: string };
    expect(m.fields).toEqual({ kind: '电影', year: 2024, imdb: 'tt15239678' });
    expect(m.image).toBe('https://image.tmdb.org/t/p/w780/p2.jpg');
    const tv = (await (await call('/api/lookup/item?source=tmdb&id=tv/1399', env)).json()) as { fields: Record<string, unknown> };
    expect(tv.fields).toEqual({ kind: '剧集', year: 2011, imdb: 'tt0944947' });
    const f = (await (await call('/api/lookup/item?source=imdb&id=TT15239678', env)).json()) as { sourceId: string; fields: Record<string, unknown> };
    expect(f).toMatchObject({ sourceId: 'movie/693134', fields: { imdb: 'tt15239678' } });
    expect((await call('/api/lookup/item?source=imdb&id=tt0000001', env)).status).toBe(404);
    expect((await call('/api/lookup/item?source=tmdb&id=550', env)).status).toBe(400);
  });

  it('密钥不对（TMDB 回 401）→ 503，带说明', async () => {
    mockFetch({ 'https://api.themoviedb.org/3/movie/1': () => new Response('{}', { status: 401 }) });
    const res = await call('/api/lookup/item?source=tmdb&id=movie/1', baseEnv({ TMDB_API_KEY: V3 }));
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toContain('密钥不对');
  });

  it('超时 → 504 网关超时；限流 → 429', async () => {
    mockFetch({
      'https://api.themoviedb.org/3/movie/1': () => {
        throw Object.assign(new Error('t'), { name: 'TimeoutError' });
      },
      'https://api.themoviedb.org/3/movie/2': () => new Response('', { status: 429 }),
    });
    const env = baseEnv({ TMDB_API_KEY: V3 });
    const r1 = await call('/api/lookup/item?source=tmdb&id=movie/1', env);
    expect(r1.status).toBe(504);
    expect(((await r1.json()) as { error: string }).error).toMatch(/^504 网关超时/);
    expect((await call('/api/lookup/item?source=tmdb&id=movie/2', env)).status).toBe(429);
  });
});

describe('豆瓣（尽力而为）', () => {
  it('被跳去验证页：搜索里降级成 blocked，不影响 TMDB', async () => {
    mockFetch({
      'https://api.themoviedb.org/3/search/multi': () => Response.json(TMDB_SEARCH),
      'https://movie.douban.com/j/subject_suggest': () => new Response(null, { status: 302, headers: { location: 'https://sec.douban.com/b?r=x' } }),
    });
    const res = await call('/api/lookup/search?kind=movie&q=dune', baseEnv({ TMDB_API_KEY: V3 }));
    const body = (await res.json()) as { results: unknown[]; sources: Array<{ source: string; status: string }> };
    expect(res.status).toBe(200);
    expect(body.results).toHaveLength(2);
    expect(body.sources.find((s) => s.source === 'douban')!.status).toBe('blocked');
  });

  it('按编号取：先手机版 JSON（剧集跟 301 到 /tv/），不行再解析页面，都不行 502', async () => {
    mockFetch({
      'https://m.douban.com/rexxar/api/v2/movie/26302614': () => new Response(null, { status: 301, headers: { location: 'https://m.douban.com/rexxar/api/v2/tv/26302614' } }),
      'https://m.douban.com/rexxar/api/v2/tv/26302614': () => Response.json({ id: '26302614', title: '请回答1988', original_title: '응답하라 1988', year: '2015', is_tv: true, pic: { large: 'https://img9.doubanio.com/view/photo/m_ratio_poster/public/p1.jpg' } }),
      'https://m.douban.com/rexxar/api/v2/movie/1889243': () => new Response(null, { status: 302, headers: { location: 'https://sec.douban.com/b' } }),
      'https://movie.douban.com/subject/1889243': () => new Response(SUBJECT_HTML),
      'https://m.douban.com/rexxar/api/v2/movie/1111111': () => new Response('', { status: 403 }),
      'https://movie.douban.com/subject/1111111': () => new Response(null, { status: 302, headers: { location: 'https://sec.douban.com/b' } }),
    });
    const env = baseEnv();
    const tv = (await (await call('/api/lookup/item?source=douban&id=26302614', env)).json()) as { name: string; fields: Record<string, unknown>; image: string };
    expect(tv).toMatchObject({ name: '请回答1988', fields: { douban: '26302614', kind: '剧集', year: 2015 }, image: 'https://img9.doubanio.com/view/photo/l_ratio_poster/public/p1.jpg' });
    const page = (await (await call('/api/lookup/item?source=douban&id=1889243', env)).json()) as { name: string; fields: Record<string, unknown> };
    expect(page).toMatchObject({ name: '星际穿越', fields: { douban: '1889243', kind: '电影', year: 2014, imdb: 'tt0816692' } });
    const blocked = await call('/api/lookup/item?source=douban&id=1111111', env);
    expect(blocked.status).toBe(502);
    expect(((await blocked.json()) as { state: string }).state).toBe('blocked');
  });

  it('页面解析：剧集、原名、海报', () => {
    const r = parseDoubanSubject('1', SUBJECT_HTML.replace('<span class="pl">片长:</span>', '<span class="pl">集数:</span>'));
    expect(r.fields.kind).toBe('剧集');
    expect(r.subtitle).toBe('Interstellar');
    expect(r.image).toBe('https://img9.doubanio.com/view/photo/l_ratio_poster/public/p2206088801.jpg');
    expect(() => parseDoubanSubject('1', '<html>验证</html>')).toThrow(/读不懂/);
    expect(parseDoubanRexxar('2', { title: 'A', year: '1999' }).fields).toEqual({ douban: '2', kind: '电影', year: 1999 });
  });
});

describe('Open Library 与 Steam', () => {
  it('Open Library：短查询按书名搜；作者只取第一位；封面', async () => {
    const calls = mockFetch({
      'https://openlibrary.org/search.json': () =>
        Response.json({ docs: [{ key: '/works/OL17267881W', title: '三体', author_name: ['刘慈欣', 'Vincent Schmitt'], first_publish_year: 2008, cover_i: 9157544, number_of_pages_median: 417 }, { key: '/books/OL1M', title: '不是作品' }] }),
    });
    const res = await call('/api/lookup/search?kind=book&q=%E4%B8%89%E4%BD%93', baseEnv());
    const body = (await res.json()) as { results: Array<Record<string, unknown>> };
    expect(calls[0]!.url.searchParams.get('q')).toBe('title:三体');
    expect(body.results).toEqual([
      {
        source: 'openlibrary',
        sourceId: 'OL17267881W',
        name: '三体',
        year: 2008,
        image: 'https://covers.openlibrary.org/b/id/9157544-L.jpg',
        thumb: 'https://covers.openlibrary.org/b/id/9157544-M.jpg',
        subtitle: '刘慈欣',
        fields: { author: '刘慈欣', total_pages: 417 },
        url: 'https://openlibrary.org/works/OL17267881W',
      },
    ]);
    await call('/api/lookup/search?kind=book&q=three%20body', baseEnv());
    expect(calls[1]!.url.searchParams.get('q')).toBe('three body');
  });

  it('Steam：中文 schinese/CN，英文 english/US；平台映射；官网进更多链接', async () => {
    const calls = mockFetch({
      'https://store.steampowered.com/api/storesearch': () => Response.json({ items: [{ type: 'app', id: 1245620, name: '艾尔登法环', tiny_image: 'https://shared.akamai.steamstatic.com/a.jpg', platforms: { windows: true } }, { type: 'sub', id: 1, name: '礼包' }] }),
      'https://store.steampowered.com/api/appdetails': (u) =>
        Response.json({ [u.searchParams.get('appids')!]: { success: true, data: { name: 'ELDEN RING', header_image: 'https://shared.akamai.steamstatic.com/h.jpg', release_date: { date: '24 Feb, 2022' }, platforms: { windows: true, mac: true, linux: true }, developers: ['FromSoftware, Inc.'], website: 'https://www.eldenring.com' } } }),
    });
    const s = (await (await call('/api/lookup/search?kind=game&q=elden', baseEnv())).json()) as { results: Array<Record<string, unknown>> };
    expect(calls[0]!.url.searchParams.get('l')).toBe('schinese');
    expect(calls[0]!.url.searchParams.get('cc')).toBe('CN');
    expect(s.results).toHaveLength(1);
    expect(s.results[0]).toMatchObject({ sourceId: '1245620', fields: { platform: ['PC（Steam）'] } });
    const d = (await (await call('/api/lookup/item?source=steam&id=1245620&lang=en', baseEnv())).json()) as Record<string, unknown>;
    expect(calls[1]!.url.searchParams.get('l')).toBe('english');
    expect(d).toMatchObject({ name: 'ELDEN RING', year: 2022, subtitle: 'FromSoftware, Inc.', fields: { platform: ['PC（Steam）', 'macOS', 'Linux / Steam Deck'], links: [{ url: 'https://www.eldenring.com' }] } });
    expect(steamPlatforms(undefined)).toEqual([]);
  });

  it('Steam 看不到这款：404', async () => {
    mockFetch({ 'https://store.steampowered.com/api/appdetails': () => Response.json({ '9': { success: false } }) });
    expect((await call('/api/lookup/item?source=steam&id=9', baseEnv())).status).toBe(404);
  });
});

describe('封面拉进 R2', () => {
  it('raw：只代拉原图字节，不存 R2（没配 FILES 也行）', async () => {
    const jpg = new Uint8Array([255, 216, 255, 1, 2]);
    mockFetch({ 'https://image.tmdb.org/': () => new Response(jpg, { headers: { 'content-type': 'image/jpeg' } }) });
    const res = await call('/api/lookup/image', baseEnv(), { method: 'POST', body: JSON.stringify({ url: 'https://image.tmdb.org/t/p/w780/a.jpg', raw: true }) });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(jpg);
  });

  it('只拉来源图床的 https 图片', () => {
    expect(allowedImageHost('https://image.tmdb.org/t/p/w780/a.jpg')).toBe(true);
    expect(allowedImageHost('https://covers.openlibrary.org/b/id/1-L.jpg')).toBe(true);
    expect(allowedImageHost('https://shared.akamai.steamstatic.com/h.jpg')).toBe(true);
    expect(allowedImageHost('https://img9.doubanio.com/view/photo/l/public/p.jpg')).toBe(true);
    expect(allowedImageHost('http://image.tmdb.org/a.jpg')).toBe(false);
    expect(allowedImageHost('https://evil.example/image.tmdb.org')).toBe(false);
    expect(allowedImageHost('https://169.254.169.254/')).toBe(false);
    expect(allowedImageHost('不是网址')).toBe(false);
  });

  it('拉图存进 R2（同 /api/assets 的 key），豆瓣带 Referer；不是图片 415；别的域名 400', async () => {
    const FILES = new MemBucket();
    const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    const calls = mockFetch({
      'https://img9.doubanio.com/': () => new Response(png, { headers: { 'content-type': 'image/jpeg' } }),
      'https://image.tmdb.org/': () => new Response('<html>', { headers: { 'content-type': 'text/html' } }),
    });
    const env = baseEnv({ FILES });
    const res = await call('/api/lookup/image', env, { method: 'POST', body: JSON.stringify({ url: 'https://img9.doubanio.com/view/photo/l_ratio_poster/public/p.jpg' }) });
    expect(res.status).toBe(200);
    const up = (await res.json()) as { url: string; r2_key: string; mime: string; size: number };
    expect(up.mime).toBe('image/jpeg');
    expect(up.size).toBe(png.byteLength);
    expect(up.r2_key).toMatch(/^[0-9a-f]{16}\/[0-9a-f]{64}$/);
    expect(up.url).toBe(`${ORIGIN}/api/assets/${up.r2_key}`);
    expect(FILES.data.has(up.r2_key)).toBe(true);
    expect(new Headers(calls[0]!.init?.headers).get('referer')).toBe('https://movie.douban.com/');
    // 读得回来
    expect((await handle(new Request(up.url), env)).status).toBe(200);
    expect((await call('/api/lookup/image', env, { method: 'POST', body: JSON.stringify({ url: 'https://image.tmdb.org/t/p/w780/a.jpg' }) })).status).toBe(415);
    expect((await call('/api/lookup/image', env, { method: 'POST', body: JSON.stringify({ url: 'https://example.com/a.jpg' }) })).status).toBe(400);
    expect((await call('/api/lookup/image', env, { method: 'POST', body: JSON.stringify({ url: 'https://example.com/a.jpg', raw: true }) })).status).toBe(400);
    expect((await call('/api/lookup/image', env, { method: 'POST', body: 'x' })).status).toBe(400);
    expect((await call('/api/lookup/image', baseEnv(), { method: 'POST', body: JSON.stringify({ url: 'https://image.tmdb.org/a.jpg' }) })).status).toBe(503);
    expect((await call('/api/lookup/image', env, { method: 'POST', body: '{}' }, false)).status).toBe(401);
  });
});

describe('缓存', () => {
  it('有 Cache API 时：搜索结果缓存 1 天，第二次不再请求；失败的不缓存', async () => {
    const store = new Map<string, Response>();
    const puts: string[] = [];
    vi.stubGlobal('caches', {
      default: {
        match: async (r: Request) => store.get(r.url)?.clone(),
        put: async (r: Request, res: Response) => {
          puts.push(res.headers.get('cache-control') ?? '');
          store.set(r.url, res);
        },
      },
    });
    let n = 0;
    const f = vi.fn(async () => {
      n++;
      return Response.json({ items: [{ type: 'app', id: 1, name: 'A' }] });
    });
    vi.stubGlobal('fetch', f);
    await call('/api/lookup/search?kind=game&q=a', baseEnv());
    await call('/api/lookup/search?kind=game&q=A', baseEnv());
    expect(n).toBe(1);
    expect(puts).toEqual(['public, max-age=86400']);
    // 详情 7 天
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ '1': { success: true, data: { name: 'A' } } })));
    await call('/api/lookup/item?source=steam&id=1', baseEnv());
    expect(puts[1]).toBe('public, max-age=604800');
    // 失败不缓存
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    await call('/api/lookup/item?source=steam&id=2', baseEnv());
    expect(puts).toHaveLength(2);
  });
});

const SUBJECT_HTML = `<!DOCTYPE html><html><head><title>
        星际穿越 (豆瓣)
</title></head><body>
<h1><span property="v:itemreviewed">星际穿越 Interstellar</span>
    <span class="year">(2014)</span></h1>
<div id="mainpic" class="">
  <a class="nbgnbg" href="https://movie.douban.com/subject/1889243/photos?type=R" title="点击看更多海报">
    <img src="https://img9.doubanio.com/view/photo/s_ratio_poster/public/p2206088801.jpg" title="点击看更多海报" alt="Interstellar" rel="v:image" />
  </a>
</div>
<div id="info">
  <span class="pl">片长:</span> <span property="v:runtime" content="169">169分钟</span><br/>
  <span class="pl">IMDb:</span> tt0816692<br>
</div></body></html>`;
