/**
 * TMDB（影视）：v3 search/multi 搜电影和剧集，movie / tv 详情 + external_ids 拿 IMDb 编号，find 按 IMDb 编号直接取。
 * 密钥是 Worker secret TMDB_API_KEY：v3 API key 走 ?api_key=，v4 读访问令牌（eyJ… 开头）走 Authorization: Bearer。
 * 没配置 → 503 服务不可用（界面显示「TMDB 还没配置」）。中文界面要 zh-CN 标题，英文界面 en-US。
 * 署名：只能叫「TMDB」或「The Movie Database」，资料卡上写「资料来自 TMDB」，设置的关于里放 TMDB 的 logo 与声明。
 */
import { LookupError, upstream, yearOf, type Lang, type LookupEnv, type LookupResult } from './types';

export const TMDB_API = 'https://api.themoviedb.org/3';
export const TMDB_IMAGE = 'https://image.tmdb.org/t/p';
const LABEL = 'TMDB';

/** v4 读访问令牌是 JWT（三段 base64，eyJ 开头）；其余当 v3 key。 */
export const isV4Token = (key: string) => /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(key.trim());

function requireKey(env: LookupEnv): string {
  const key = env.TMDB_API_KEY?.trim();
  if (!key) throw new LookupError(503, '503 服务不可用：TMDB 还没配置（Worker secret TMDB_API_KEY）', 'unconfigured');
  return key;
}

async function tmdb<T>(env: LookupEnv, path: string, params: Record<string, string>): Promise<T> {
  const key = requireKey(env);
  const u = new URL(TMDB_API + path);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const headers: Record<string, string> = { accept: 'application/json' };
  if (isV4Token(key)) headers.authorization = `Bearer ${key}`;
  else u.searchParams.set('api_key', key);
  const res = await upstream(LABEL, u.toString(), { headers });
  // 密钥不对：TMDB 回 401 未授权
  if (res.status === 401) throw new LookupError(503, '503 服务不可用：TMDB 密钥不对或已失效（TMDB 回 401 未授权）', 'unconfigured');
  if (res.status === 404) throw new LookupError(404, '404 未找到：TMDB 上没有这一条');
  if (!res.ok) throw new LookupError(502, `502 错误网关：TMDB 返回 ${res.status}`);
  try {
    return (await res.json()) as T;
  } catch {
    throw new LookupError(502, '502 错误网关：TMDB 返回的不是 JSON');
  }
}

const language = (lang: Lang) => (lang === 'zh' ? 'zh-CN' : 'en-US');

interface TmdbMedia {
  id: number;
  media_type?: 'movie' | 'tv' | 'person';
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
  poster_path?: string | null;
  imdb_id?: string | null;
  external_ids?: { imdb_id?: string | null };
}

function toResult(m: TmdbMedia, mediaType: 'movie' | 'tv', imdb?: string | null): LookupResult {
  const name = (mediaType === 'movie' ? m.title : m.name) ?? m.original_title ?? m.original_name ?? '';
  const original = mediaType === 'movie' ? m.original_title : m.original_name;
  const year = yearOf(mediaType === 'movie' ? m.release_date : m.first_air_date);
  const sourceId = `${mediaType}/${m.id}`;
  const fields: LookupResult['fields'] = { kind: mediaType === 'movie' ? '电影' : '剧集' };
  if (year) fields.year = year;
  if (imdb && /^tt\d{7,10}$/.test(imdb)) fields.imdb = imdb;
  return {
    source: 'tmdb',
    sourceId,
    name,
    ...(year ? { year } : {}),
    ...(m.poster_path ? { image: `${TMDB_IMAGE}/w780${m.poster_path}`, thumb: `${TMDB_IMAGE}/w185${m.poster_path}` } : {}),
    ...(original && original !== name ? { subtitle: original } : {}),
    fields,
    url: `https://www.themoviedb.org/${sourceId}`,
  };
}

export async function searchTmdb(env: LookupEnv, q: string, lang: Lang): Promise<LookupResult[]> {
  const data = await tmdb<{ results?: TmdbMedia[] }>(env, '/search/multi', { query: q, language: language(lang), include_adult: 'false', page: '1' });
  return (data.results ?? [])
    .filter((m) => m.media_type === 'movie' || m.media_type === 'tv')
    .slice(0, 8)
    .map((m) => toResult(m, m.media_type as 'movie' | 'tv'));
}

/** id：「movie/550」「tv/1399」。 */
export async function tmdbItem(env: LookupEnv, id: string, lang: Lang): Promise<LookupResult> {
  const m = /^(movie|tv)\/(\d{1,10})$/.exec(id);
  if (!m) throw new LookupError(400, '400 请求有误：TMDB 编号要写成 movie/550 或 tv/1399');
  const mediaType = m[1] as 'movie' | 'tv';
  const data = await tmdb<TmdbMedia>(env, `/${mediaType}/${m[2]}`, { language: language(lang), append_to_response: 'external_ids' });
  return toResult(data, mediaType, data.imdb_id ?? data.external_ids?.imdb_id);
}

/** 按 IMDb 编号直接取（find）。 */
export async function tmdbByImdb(env: LookupEnv, imdb: string, lang: Lang): Promise<LookupResult> {
  if (!/^tt\d{7,10}$/.test(imdb)) throw new LookupError(400, '400 请求有误：IMDb 编号是 tt 加数字');
  const data = await tmdb<{ movie_results?: TmdbMedia[]; tv_results?: TmdbMedia[] }>(env, `/find/${imdb}`, { external_source: 'imdb_id', language: language(lang) });
  const movie = data.movie_results?.[0];
  if (movie) return toResult(movie, 'movie', imdb);
  const tv = data.tv_results?.[0];
  if (tv) return toResult(tv, 'tv', imdb);
  throw new LookupError(404, `404 未找到：TMDB 上没有 ${imdb}`);
}
