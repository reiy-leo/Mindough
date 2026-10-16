/**
 * 豆瓣（影视，尽力而为）：没有公开 API。搜索用网页里的建议接口 movie.douban.com/j/subject_suggest，
 * 详情先用手机版网页的 JSON（m.douban.com/rexxar/api/v2/movie/<id>，剧集会 301 到 /tv/<id>；没有 IMDb 编号），
 * 不行再解析 movie.douban.com/subject/<id>/ 页面（标题、年份、IMDb 编号、海报、是不是剧集）。
 * 2026-10-16 沙箱实测：建议接口、手机版 JSON、doubanio 图片带 Referer 都能拿到，subject 页面会被跳去验证页。
 * 豆瓣常把机房 IP 跳到 sec.douban.com 验证页：这时算「blocked」，搜索里静静降级（不影响 TMDB），
 * 按豆瓣编号取详情时返回 502 错误网关。海报在 doubanio.com，要带 Referer 才拉得到（拉进 R2 时带上）。
 */
import { LookupError, decodeEntities, upstream, yearOf, type LookupResult } from './types';

const LABEL = '豆瓣';
const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  referer: 'https://movie.douban.com/',
  'accept-language': 'zh-CN,zh;q=0.9',
};

async function get(url: string): Promise<Response> {
  const res = await upstream(LABEL, url, { headers: HEADERS, redirect: 'manual' });
  // 跳去验证页 / 拒绝：降级
  if ((res.status >= 300 && res.status < 400) || res.status === 403 || res.status === 418)
    throw new LookupError(502, '502 错误网关：豆瓣拒绝了这次请求（要验证），先用别的来源', 'blocked');
  if (res.status === 404) throw new LookupError(404, '404 未找到：豆瓣上没有这一条');
  if (!res.ok) throw new LookupError(502, `502 错误网关：豆瓣返回 ${res.status}`);
  return res;
}

interface Suggest {
  id?: string;
  title?: string;
  sub_title?: string;
  img?: string;
  year?: string;
  type?: string;
  episode?: string;
}

/** 豆瓣小图 s_ratio_poster → 大一些的 m_ratio_poster / l_ratio_poster。 */
const bigger = (u: string, size: 'm' | 'l') => u.replace(/\/[sml](_ratio_poster|pic)\//, `/${size}_ratio_poster/`).replace(/^http:/, 'https:');

export async function searchDouban(q: string): Promise<LookupResult[]> {
  const res = await get(`https://movie.douban.com/j/subject_suggest?q=${encodeURIComponent(q)}`);
  let list: Suggest[];
  try {
    list = (await res.json()) as Suggest[];
  } catch {
    throw new LookupError(502, '502 错误网关：豆瓣返回的不是 JSON', 'blocked');
  }
  if (!Array.isArray(list)) return [];
  return list
    .filter((x) => x.id && /^\d+$/.test(x.id) && x.title && (x.type ?? 'movie') === 'movie')
    .slice(0, 5)
    .map((x) => {
      const year = yearOf(x.year);
      const fields: LookupResult['fields'] = { douban: x.id!, kind: x.episode ? '剧集' : '电影' };
      if (year) fields.year = year;
      return {
        source: 'douban' as const,
        sourceId: x.id!,
        name: decodeEntities(x.title!),
        ...(year ? { year } : {}),
        ...(x.img ? { thumb: bigger(x.img, 'm'), image: bigger(x.img, 'l') } : {}),
        ...(x.sub_title && x.sub_title !== x.title ? { subtitle: decodeEntities(x.sub_title) } : {}),
        fields,
        url: `https://movie.douban.com/subject/${x.id}/`,
      };
    });
}

/** 解析详情页（导出给测试用 fixture 测）。 */
export function parseDoubanSubject(id: string, html: string): LookupResult {
  const title = /<title>\s*([\s\S]*?)\s*\(豆瓣\)\s*<\/title>/.exec(html)?.[1] ?? /property="v:itemreviewed"[^>]*>([^<]+)</.exec(html)?.[1];
  if (!title) throw new LookupError(502, '502 错误网关：豆瓣页面读不懂（可能是验证页）', 'blocked');
  const name = decodeEntities(title.trim());
  const full = decodeEntities(/property="v:itemreviewed"[^>]*>([^<]+)</.exec(html)?.[1]?.trim() ?? '');
  const year = yearOf(/<span class="year">\(([^)]*)\)<\/span>/.exec(html)?.[1]) ?? yearOf(/property="v:initialReleaseDate"[^>]*>([^<]+)</.exec(html)?.[1]);
  const imdb = /IMDb:?<\/span>\s*(?:<a[^>]*>)?\s*(tt\d{7,10})/.exec(html)?.[1];
  const poster = /<div id="mainpic"[\s\S]*?<img[^>]+src="([^"]+)"/.exec(html)?.[1];
  const series = /集数:?<\/span>/.test(html) || /单集片长:?<\/span>/.test(html);
  const fields: LookupResult['fields'] = { douban: id, kind: series ? '剧集' : '电影' };
  if (year) fields.year = year;
  if (imdb) fields.imdb = imdb;
  const original = full.startsWith(name) ? full.slice(name.length).trim() : '';
  return {
    source: 'douban',
    sourceId: id,
    name,
    ...(year ? { year } : {}),
    ...(poster ? { image: bigger(poster, 'l'), thumb: bigger(poster, 'm') } : {}),
    ...(original ? { subtitle: original } : {}),
    fields,
    url: `https://movie.douban.com/subject/${id}/`,
  };
}

interface Rexxar {
  id?: string;
  title?: string;
  original_title?: string;
  year?: string;
  is_tv?: boolean;
  type?: string;
  pic?: { large?: string; normal?: string };
}

/** 解析手机版 JSON（导出给测试用）。 */
export function parseDoubanRexxar(id: string, d: Rexxar): LookupResult {
  if (!d.title) throw new LookupError(502, '502 错误网关：豆瓣返回的内容读不懂', 'blocked');
  const year = yearOf(d.year);
  const fields: LookupResult['fields'] = { douban: id, kind: d.is_tv || d.type === 'tv' ? '剧集' : '电影' };
  if (year) fields.year = year;
  const pic = d.pic?.large ?? d.pic?.normal;
  return {
    source: 'douban',
    sourceId: id,
    name: d.title,
    ...(year ? { year } : {}),
    ...(pic ? { image: bigger(pic, 'l'), thumb: bigger(pic, 'm') } : {}),
    ...(d.original_title && d.original_title !== d.title ? { subtitle: d.original_title } : {}),
    fields,
    url: `https://movie.douban.com/subject/${id}/`,
  };
}

const REXXAR_HEADERS = { ...HEADERS, referer: 'https://m.douban.com/movie/' };

async function rexxar(id: string): Promise<LookupResult> {
  let res = await upstream(LABEL, `https://m.douban.com/rexxar/api/v2/movie/${id}`, { headers: REXXAR_HEADERS, redirect: 'manual' });
  // 剧集：301 到 /rexxar/api/v2/tv/<id>（只跟这一种跳转，别的跳转是验证页）
  const loc = res.headers.get('location') ?? '';
  if (res.status >= 300 && res.status < 400 && /^https:\/\/m\.douban\.com\/rexxar\/api\/v2\/tv\/\d+$/.test(loc))
    res = await upstream(LABEL, loc, { headers: REXXAR_HEADERS, redirect: 'manual' });
  if (res.status === 404) throw new LookupError(404, '404 未找到：豆瓣上没有这一条');
  if (!res.ok) throw new LookupError(502, `502 错误网关：豆瓣返回 ${res.status}`, 'blocked');
  let d: Rexxar;
  try {
    d = (await res.json()) as Rexxar;
  } catch {
    throw new LookupError(502, '502 错误网关：豆瓣返回的不是 JSON', 'blocked');
  }
  return parseDoubanRexxar(id, d);
}

export async function doubanItem(id: string): Promise<LookupResult> {
  if (!/^\d{4,12}$/.test(id)) throw new LookupError(400, '400 请求有误：豆瓣编号是一串数字');
  try {
    return await rexxar(id);
  } catch (e) {
    if (e instanceof LookupError && e.status === 404) throw e;
    const res = await get(`https://movie.douban.com/subject/${id}/`);
    return parseDoubanSubject(id, await res.text());
  }
}

/** 拉豆瓣图片要带的请求头。 */
export const DOUBAN_IMAGE_HEADERS = { referer: HEADERS.referer, 'user-agent': HEADERS['user-agent'] };
