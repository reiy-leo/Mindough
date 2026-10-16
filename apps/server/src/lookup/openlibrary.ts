/**
 * Open Library（书）：search.json 搜书（一次请求就有书名、作者、首版年份、页数中位数、封面编号），
 * 详情也用 search.json?q=key:/works/<id>（同样的字段，不用再查作者）。封面 covers.openlibrary.org/b/id/<cover_i>-L.jpg。
 * 不需要密钥。Google Books 没加：沙箱里没法验证无 key 接口，Cloudflare 出口 IP 也常被它限流（见 PLAN 待 Rei 确认）。
 */
import { LookupError, upstreamJson, type Lang, type LookupResult } from './types';

const LABEL = 'Open Library';
const API = 'https://openlibrary.org/search.json';
const FIELDS = 'key,title,subtitle,author_name,first_publish_year,cover_i,number_of_pages_median';
const HEADERS = { 'user-agent': 'Mindough/1.0 (https://mindough.rei8t.dev)', accept: 'application/json' };

interface Doc {
  key?: string;
  title?: string;
  subtitle?: string;
  author_name?: string[];
  first_publish_year?: number;
  cover_i?: number;
  number_of_pages_median?: number;
}

function toResult(d: Doc): LookupResult | null {
  const id = /^\/works\/(OL\d+W)$/.exec(d.key ?? '')?.[1];
  if (!id || !d.title) return null;
  // author_name 里常混着译者、插画师（三体：刘慈欣、Vincent Schmitt…），只取第一位
  const author = d.author_name?.[0]?.trim() ?? '';
  const fields: LookupResult['fields'] = {};
  if (author) fields.author = author;
  if (d.number_of_pages_median && d.number_of_pages_median > 0) fields.total_pages = d.number_of_pages_median;
  const year = d.first_publish_year;
  return {
    source: 'openlibrary',
    sourceId: id,
    name: d.title,
    ...(year ? { year } : {}),
    ...(d.cover_i ? { image: `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg`, thumb: `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` } : {}),
    ...(author ? { subtitle: author } : {}),
    fields,
    url: `https://openlibrary.org/works/${id}`,
  };
}

export async function searchOpenLibrary(q: string, lang: Lang): Promise<LookupResult[]> {
  // q 少于 3 个字会被拒（422 无法处理），短的（「三体」）改按书名搜
  const query = [...q].length < 3 ? `title:${q}` : q;
  const u = `${API}?q=${encodeURIComponent(query)}&limit=8&fields=${FIELDS}&lang=${lang === 'zh' ? 'zh' : 'en'}`;
  const data = await upstreamJson<{ docs?: Doc[] }>(LABEL, u, { headers: HEADERS });
  return (data.docs ?? []).map((d) => toResult(d)).filter((x): x is LookupResult => !!x);
}

export async function openLibraryItem(id: string): Promise<LookupResult> {
  if (!/^OL\d+W$/.test(id)) throw new LookupError(400, '400 请求有误：Open Library 编号要写成 OL45804W');
  const u = `${API}?q=${encodeURIComponent(`key:/works/${id}`)}&limit=1&fields=${FIELDS}`;
  const data = await upstreamJson<{ docs?: Doc[] }>(LABEL, u, { headers: HEADERS });
  const r = data.docs?.[0] ? toResult(data.docs[0]) : null;
  if (!r) throw new LookupError(404, '404 未找到：Open Library 上没有这本书');
  return r;
}
