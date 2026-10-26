/**
 * Open Library（书）：
 * - 按名字：search.json 搜书（一次请求就有书名、作者、首版年份、页数中位数），得到的是「作品」（OL…W），
 *   只有作品级的字段：书名、作者、首版年份、页数；出版社、ISBN 是某一版的，按名字给不了。
 *   详情也用 search.json?q=key:/works/<id>（同样的字段，不用再查作者）。
 * - 按 ISBN（Rei 2026-10-17）：/isbn/<isbn>.json（302 跳到那一版 /books/OL…M.json），取那一版的书名、出版社 publishers[0]、
 *   出版年份（publish_date 里的年）、页数 number_of_pages、ISBN；作者先看这一版的 authors，没有就用作品的第一位作者，
 *   再取 /authors/<id>.json 的名字。sourceId 是这一版的编号（OL…M），/api/lookup/item?source=openlibrary&id=OL…M 同样能取。
 * 不给封面：书的封面不对接任何平台，纯手填（Rei 2026-10-17），所以不取 cover_i / covers、不输出 image / thumb。
 * 不需要密钥。Google Books 没加：沙箱里没法验证无 key 接口，Cloudflare 出口 IP 也常被它限流（见 PLAN 待 Rei 确认）。
 */
import { LookupError, upstreamJson, yearOf, type Lang, type LookupResult } from './types';

const LABEL = 'Open Library';
const BASE = 'https://openlibrary.org';
const API = `${BASE}/search.json`;
const FIELDS = 'key,title,subtitle,author_name,first_publish_year,number_of_pages_median';
const HEADERS = { 'user-agent': 'Mindough/1.0 (https://app.mindough.rei8t.dev)', accept: 'application/json' };

interface Doc {
  key?: string;
  title?: string;
  subtitle?: string;
  author_name?: string[];
  first_publish_year?: number;
  number_of_pages_median?: number;
}

function toResult(d: Doc): LookupResult | null {
  const id = /^\/works\/(OL\d+W)$/.exec(d.key ?? '')?.[1];
  if (!id || !d.title) return null;
  // author_name 里常混着译者、插画师（三体：刘慈欣、Vincent Schmitt…），只取第一位
  const author = d.author_name?.[0]?.trim() ?? '';
  const fields: LookupResult['fields'] = {};
  if (author) fields.author = author;
  const year = d.first_publish_year;
  if (year) fields.year = year;
  if (d.number_of_pages_median && d.number_of_pages_median > 0) fields.total_pages = d.number_of_pages_median;
  return {
    source: 'openlibrary',
    sourceId: id,
    name: d.title,
    ...(year ? { year } : {}),
    ...(author ? { subtitle: author } : {}),
    fields,
    url: `${BASE}/works/${id}`,
  };
}

export async function searchOpenLibrary(q: string, lang: Lang): Promise<LookupResult[]> {
  // q 少于 3 个字会被拒（422 无法处理），短的（「三体」）改按书名搜
  const query = [...q].length < 3 ? `title:${q}` : q;
  const u = `${API}?q=${encodeURIComponent(query)}&limit=8&fields=${FIELDS}&lang=${lang === 'zh' ? 'zh' : 'en'}`;
  const data = await upstreamJson<{ docs?: Doc[] }>(LABEL, u, { headers: HEADERS });
  return (data.docs ?? []).map((d) => toResult(d)).filter((x): x is LookupResult => !!x);
}

// ───────────── 某一版（ISBN） ─────────────

interface Edition {
  key?: string;
  title?: string;
  authors?: Array<{ key?: string }>;
  works?: Array<{ key?: string }>;
  publishers?: string[];
  publish_date?: string;
  number_of_pages?: number;
  isbn_13?: string[];
  isbn_10?: string[];
}

/** ISBN-10 / 13 校验位对不对（输入已去掉连字符、空格）。 */
export function validIsbn(s: string): boolean {
  if (/^\d{9}[\dX]$/.test(s)) {
    let sum = 0;
    for (let i = 0; i < 10; i++) sum += (s[i] === 'X' ? 10 : Number(s[i])) * (10 - i);
    return sum % 11 === 0;
  }
  if (/^97[89]\d{10}$/.test(s)) {
    let sum = 0;
    for (let i = 0; i < 13; i++) sum += Number(s[i]) * (i % 2 ? 3 : 1);
    return sum % 10 === 0;
  }
  return false;
}

async function authorName(key: string | undefined): Promise<string> {
  if (!key || !/^\/authors\/OL\d+A$/.test(key)) return '';
  try {
    const a = await upstreamJson<{ name?: string; personal_name?: string }>(LABEL, `${BASE}${key}.json`, { headers: HEADERS });
    return (a.name ?? a.personal_name ?? '').trim();
  } catch {
    return '';
  }
}

/** 这一版的作者：这一版写了就用，没写（常见，如三体重庆版）用作品的第一位；取不到就空着。 */
async function editionAuthor(e: Edition): Promise<string> {
  const own = await authorName(e.authors?.[0]?.key);
  if (own) return own;
  const work = e.works?.[0]?.key;
  if (!work || !/^\/works\/OL\d+W$/.test(work)) return '';
  try {
    const w = await upstreamJson<{ authors?: Array<{ author?: { key?: string } }> }>(LABEL, `${BASE}${work}.json`, { headers: HEADERS });
    return await authorName(w.authors?.[0]?.author?.key);
  } catch {
    return '';
  }
}

async function editionResult(e: Edition, isbn?: string): Promise<LookupResult> {
  const id = /^\/books\/(OL\d+M)$/.exec(e.key ?? '')?.[1];
  if (!id || !e.title) throw new LookupError(404, '404 未找到：Open Library 上没有这一版');
  const author = await editionAuthor(e);
  const fields: LookupResult['fields'] = {};
  if (author) fields.author = author;
  const publisher = e.publishers?.[0]?.trim();
  if (publisher) fields.publisher = publisher;
  const year = yearOf(e.publish_date);
  if (year) fields.year = year;
  const code = isbn ?? e.isbn_13?.[0] ?? e.isbn_10?.[0];
  if (code) fields.isbn = code.replace(/[\s-]/g, '').toUpperCase();
  if (e.number_of_pages && e.number_of_pages > 0) fields.total_pages = e.number_of_pages;
  const sub = [author, publisher].filter(Boolean).join(' · ');
  return {
    source: 'openlibrary',
    sourceId: id,
    name: e.title.trim(),
    ...(year ? { year } : {}),
    ...(sub ? { subtitle: sub } : {}),
    fields,
    url: `${BASE}/books/${id}`,
  };
}

/** 按 ISBN 取那一版。isbn 容许连字符、空格。 */
export async function openLibraryByIsbn(raw: string): Promise<LookupResult> {
  const isbn = raw.replace(/[\s-]/g, '').toUpperCase();
  if (!validIsbn(isbn)) throw new LookupError(400, '400 请求有误：ISBN 要是 10 位或 13 位（如 9787536692930），校验位要对');
  const e = await upstreamJson<Edition>(LABEL, `${BASE}/isbn/${isbn}.json`, { headers: HEADERS });
  return editionResult(e, isbn);
}

export async function openLibraryItem(id: string): Promise<LookupResult> {
  if (/^OL\d+M$/.test(id)) return editionResult(await upstreamJson<Edition>(LABEL, `${BASE}/books/${id}.json`, { headers: HEADERS }));
  if (!/^OL\d+W$/.test(id)) throw new LookupError(400, '400 请求有误：Open Library 编号要写成 OL45804W（作品）或 OL25840916M（某一版）');
  const u = `${API}?q=${encodeURIComponent(`key:/works/${id}`)}&limit=1&fields=${FIELDS}`;
  const data = await upstreamJson<{ docs?: Doc[] }>(LABEL, u, { headers: HEADERS });
  const r = data.docs?.[0] ? toResult(data.docs[0]) : null;
  if (!r) throw new LookupError(404, '404 未找到：Open Library 上没有这本书');
  return r;
}
