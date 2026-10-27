/**
 * 在线找资料：各来源适配器共用的结果形状与请求工具。
 * LookupResult 与 packages/core/src/lookup.ts 的同名类型一致（Worker 不依赖 core，两处一起改）。
 * fields 的 key 是内置类型的字段 key：影视 year / kind（电影、剧集）/ imdb / douban；书 author / publisher / year / isbn / total_pages（按名字只有作品级的 author / year / total_pages）；游戏 platform / links。
 */
export type FieldValue = string | number | boolean | string[] | Array<{ url: string; label?: string }> | null;
export type LookupKind = 'movie' | 'book' | 'game';
export type LookupSource = 'tmdb' | 'douban' | 'openlibrary' | 'steam' | 'igdb';
export type Lang = 'zh' | 'en';

export interface LookupResult {
  source: LookupSource;
  sourceId: string;
  name: string;
  year?: number;
  image?: string;
  thumb?: string;
  subtitle?: string;
  fields: Record<string, FieldValue>;
  url: string;
}

export type LookupSourceState = 'ok' | 'unconfigured' | 'blocked' | 'error';

export interface LookupSourceStatus {
  source: LookupSource;
  status: LookupSourceState;
  code?: number;
  message?: string;
}

export interface LookupEnv {
  /** TMDB：v3 API key（32 位十六进制）或 v4 读访问令牌（eyJ… 开头的长串），两种都认。 */
  TMDB_API_KEY?: string;
  /** IGDB：Twitch 应用的 Client ID 和 Client Secret（client_credentials 换令牌）。 */
  IGDB_CLIENT_ID?: string;
  IGDB_CLIENT_SECRET?: string;
}

/** 来源出错：带 HTTP 状态码与中文说明，接口原样返回给界面。 */
export class LookupError extends Error {
  constructor(
    public status: number,
    message: string,
    public state: LookupSourceState = 'error',
  ) {
    super(message);
  }
}

/** 对外请求的超时（毫秒）。 */
export const UPSTREAM_TIMEOUT_MS = 8000;


/** 带超时的请求；超时 → 504 网关超时，连不上 → 502 错误网关，对方限流 → 429 请求太多，对方 5xx → 502。 */
export async function upstream(label: string, url: string, init: RequestInit = {}, timeoutMs = UPSTREAM_TIMEOUT_MS): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name === 'TimeoutError' || name === 'AbortError') throw new LookupError(504, `504 网关超时：${label} 没有及时回应`);
    throw new LookupError(502, `502 错误网关：连不上 ${label}`);
  }
  if (res.status === 429) throw new LookupError(429, `429 请求太多：${label} 限流了，稍后再试`);
  if (res.status >= 500) throw new LookupError(502, `502 错误网关：${label} 出错了（${res.status}）`);
  return res;
}

export async function upstreamJson<T>(label: string, url: string, init: RequestInit = {}): Promise<T> {
  const res = await upstream(label, url, init);
  if (res.status === 404) throw new LookupError(404, `404 未找到：${label} 上没有这一条`);
  if (res.status === 401 || res.status === 403) throw new LookupError(502, `502 错误网关：${label} 拒绝了请求（${res.status}）`);
  if (!res.ok) throw new LookupError(502, `502 错误网关：${label} 返回 ${res.status}`);
  try {
    return (await res.json()) as T;
  } catch {
    throw new LookupError(502, `502 错误网关：${label} 返回的不是 JSON`);
  }
}

/** 「2024-03-01」「2024 年 3 月 1 日」「Mar 1, 2024」→ 2024。 */
export function yearOf(s: string | null | undefined): number | undefined {
  const m = /(18|19|20)\d{2}/.exec(s ?? '');
  return m ? Number(m[0]) : undefined;
}

/** 简单的 HTML 实体解码（豆瓣页面、Steam 名字里的 &amp; &#39;）。 */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}
