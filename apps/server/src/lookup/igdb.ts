/**
 * IGDB（游戏，Rei 2026-10-27 要补 Steam 搜不到的：Switch / PS 独占、手游）。
 * - 认证：Twitch 应用的 client_credentials（IGDB_CLIENT_ID + IGDB_CLIENT_SECRET，Worker secret），
 *   换来的访问令牌（约 60 天）放 Cache API 30 天，401 时丢掉重换一次。
 * - 搜索 POST /v4/games（Apicalypse 语法），只要本体、重制、复刻、扩展版、移植（game_type 0/8/9/10/11）。
 * - 中文界面：有「Chinese title - simplified」别名就用它当名字，英文名放到简介里。
 * - 平台按游戏类型的多选项映射；PC 看有没有 Steam / Epic 商店链接。封面用竖版 t_cover_big_2x（528×748）。
 * - sourceId 用 slug（页面地址 igdb.com/games/{slug}），详情按 slug 取。
 */
import { LookupError, upstream, type Lang, type LookupEnv, type LookupResult } from './types';

const LABEL = 'IGDB';
const API = 'https://api.igdb.com/v4/games';
const FIELDS =
  'fields name,slug,first_release_date,platforms,cover.image_id,alternative_names.name,alternative_names.comment,websites.url,websites.type,involved_companies.company.name,involved_companies.developer;';
const WHERE_TYPES = 'game_type = (0,8,9,10,11)';

/** IGDB 平台 id → 游戏类型的平台选项（存中文，显示时翻译）。PC（6）另看商店链接。 */
const PLATFORM: Record<number, string> = {
  167: 'PlayStation 5',
  48: 'PlayStation 4',
  169: 'Xbox Series X|S',
  49: 'Xbox One',
  130: 'Nintendo Switch',
  508: 'Switch 2',
  39: 'iOS',
  34: 'Android',
  14: 'macOS',
  3: 'Linux / Steam Deck',
  82: '网页',
};
/** websites.type：1 官网、13 Steam、16 Epic。 */
const SITE_OFFICIAL = 1;
const SITE_STEAM = 13;
const SITE_EPIC = 16;

interface Game {
  name?: string;
  slug?: string;
  first_release_date?: number;
  platforms?: number[];
  cover?: { image_id?: string };
  alternative_names?: Array<{ name?: string; comment?: string }>;
  websites?: Array<{ url?: string; type?: number }>;
  involved_companies?: Array<{ company?: { name?: string }; developer?: boolean }>;
}

export function igdbPlatforms(g: Pick<Game, 'platforms' | 'websites'>): string[] {
  const ids = new Set(g.platforms ?? []);
  const sites = new Set((g.websites ?? []).map((w) => w.type));
  const out: string[] = [];
  if (ids.has(6)) {
    if (sites.has(SITE_STEAM)) out.push('PC（Steam）');
    if (sites.has(SITE_EPIC)) out.push('PC（Epic）');
    if (!sites.has(SITE_STEAM) && !sites.has(SITE_EPIC)) out.push('PC（其他）');
  }
  for (const [id, label] of Object.entries(PLATFORM)) if (ids.has(Number(id)) && !out.includes(label)) out.push(label);
  return out;
}

/** 中文名：优先简体别名，其次任何中文别名。 */
export function igdbChineseName(g: Pick<Game, 'alternative_names'>): string | undefined {
  const alts = (g.alternative_names ?? []).filter((a) => a.name && /chinese/i.test(a.comment ?? ''));
  return (alts.find((a) => /simplified/i.test(a.comment ?? '')) ?? alts.find((a) => !/traditional/i.test(a.comment ?? '')) ?? alts[0])?.name;
}

export function igdbResult(g: Game, lang: Lang): LookupResult | null {
  if (!g.name || !g.slug) return null;
  const zh = lang === 'zh' ? igdbChineseName(g) : undefined;
  const year = g.first_release_date ? new Date(g.first_release_date * 1000).getUTCFullYear() : undefined;
  const dev = (g.involved_companies ?? [])
    .filter((c) => c.developer && c.company?.name)
    .slice(0, 2)
    .map((c) => c.company!.name!)
    .join(', ');
  const subtitle = [zh ? g.name : '', dev].filter(Boolean).join(' · ');
  const fields: LookupResult['fields'] = {};
  const platform = igdbPlatforms(g);
  if (platform.length) fields.platform = platform;
  const links = igdbLinks(g);
  if (links.length) fields.links = links;
  const img = g.cover?.image_id;
  return {
    source: 'igdb',
    sourceId: g.slug,
    name: zh ?? g.name,
    ...(year ? { year } : {}),
    ...(img ? { image: `https://images.igdb.com/igdb/image/upload/t_cover_big_2x/${img}.jpg`, thumb: `https://images.igdb.com/igdb/image/upload/t_cover_small/${img}.jpg` } : {}),
    ...(subtitle ? { subtitle } : {}),
    fields,
    url: `https://www.igdb.com/games/${g.slug}`,
  };
}

/**
 * 资料「更多链接」：官网 + 各商店（Rei 2026-10-28：游戏信息里要有 Steam、Nintendo 这些链接）。
 * IGDB website_types：1 官网、10 iPhone、11 iPad、12 Android、13 Steam、15 itch、16 Epic、17 GOG、22 Xbox、23 PlayStation、24 Nintendo。
 * 按这个顺序排，同一网址只留一次；显示名由 core 的 detectLinkLabel 按域名认。
 */
const LINK_ORDER = [SITE_OFFICIAL, SITE_STEAM, 24, 23, 22, SITE_EPIC, 17, 15, 10, 11, 12];
export function igdbLinks(g: Pick<Game, 'websites'>): Array<{ url: string }> {
  const out: Array<{ url: string }> = [];
  const seen = new Set<string>();
  // 编号对不上时按域名认商店（IGDB 的编号表改过几次）
  const STORE_HOST = /(^|\.)(steampowered\.com|nintendo\.(com|co\.jp|com\.hk)|playstation\.com|xbox\.com|epicgames\.com|gog\.com|itch\.io|apps\.apple\.com|play\.google\.com)$/;
  const typeOf = (w: { url?: string; type?: number }) => {
    if (w.type && LINK_ORDER.includes(w.type)) return w.type;
    try { if (STORE_HOST.test(new URL(w.url ?? '').hostname)) return 99; } catch { /* 坏网址 */ }
    return undefined;
  };
  for (const type of [...LINK_ORDER, 99]) {
    for (const w of g.websites ?? []) {
      if (typeOf(w) !== type || !w.url || !/^https?:\/\//.test(w.url) || seen.has(w.url)) continue;
      if (type === 11 && out.some((l) => /apps\.apple\.com/.test(l.url))) continue;
      seen.add(w.url);
      out.push({ url: w.url });
    }
  }
  return out;
}

/** Steam appid（IGDB 的 Steam 商店链接里取），用来和 Steam 的结果去重。 */
export function igdbSteamId(g: Pick<Game, 'websites'>): string | undefined {
  for (const w of g.websites ?? []) {
    const m = w.type === SITE_STEAM ? /\/app\/(\d+)/.exec(w.url ?? '') : null;
    if (m) return m[1];
  }
  return undefined;
}

// ───────── 令牌 ─────────

interface CacheLike {
  match(key: Request): Promise<Response | undefined>;
  put(key: Request, res: Response): Promise<void>;
  delete?(key: Request): Promise<boolean>;
}
const cacheOf = (): CacheLike | null => (globalThis as { caches?: { default?: CacheLike } }).caches?.default ?? null;
const TOKEN_KEY = () => new Request('https://lookup-cache.mindough.internal/v1/igdb-token');
let memToken: { token: string; until: number } | null = null;

async function token(env: LookupEnv, fresh = false): Promise<string> {
  const id = env.IGDB_CLIENT_ID?.trim();
  const secret = env.IGDB_CLIENT_SECRET?.trim();
  if (!id || !secret) throw new LookupError(503, '503 服务不可用：IGDB 还没配置（缺 IGDB_CLIENT_ID / IGDB_CLIENT_SECRET）', 'unconfigured');
  const cache = cacheOf();
  if (!fresh) {
    if (memToken && memToken.until > Date.now()) return memToken.token;
    const hit = cache ? await cache.match(TOKEN_KEY()).catch(() => undefined) : undefined;
    if (hit) {
      const t = (await hit.text()).trim();
      if (t) return t;
    }
  }
  const res = await upstream('Twitch', `https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(id)}&client_secret=${encodeURIComponent(secret)}&grant_type=client_credentials`, { method: 'POST' });
  if (res.status === 400 || res.status === 401 || res.status === 403) throw new LookupError(503, `503 服务不可用：Twitch 不认这组 IGDB 密钥（${res.status}）`, 'unconfigured');
  if (!res.ok) throw new LookupError(502, `502 错误网关：Twitch 返回 ${res.status}`);
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new LookupError(502, '502 错误网关：Twitch 没给访问令牌');
  const ttl = Math.min(30 * 24 * 3600, Math.max(60, (body.expires_in ?? 3600) - 3600));
  memToken = { token: body.access_token, until: Date.now() + ttl * 1000 };
  if (cache) await cache.put(TOKEN_KEY(), new Response(body.access_token, { headers: { 'cache-control': `public, max-age=${ttl}` } })).catch(() => {});
  return body.access_token;
}

async function query(env: LookupEnv, body: string): Promise<Game[]> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const t = await token(env, attempt > 0);
    const res = await upstream(LABEL, API, { method: 'POST', headers: { 'Client-ID': env.IGDB_CLIENT_ID!.trim(), Authorization: `Bearer ${t}`, 'content-type': 'text/plain' }, body });
    if (res.status === 401 && attempt === 0) {
      memToken = null;
      continue;
    }
    if (res.status === 401 || res.status === 403) throw new LookupError(502, `502 错误网关：IGDB 拒绝了请求（${res.status}）`);
    if (!res.ok) throw new LookupError(502, `502 错误网关：IGDB 返回 ${res.status}`);
    try {
      return (await res.json()) as Game[];
    } catch {
      throw new LookupError(502, '502 错误网关：IGDB 返回的不是 JSON');
    }
  }
  return [];
}

const quote = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

export interface IgdbHit extends LookupResult {
  /** 只给 Worker 去重用，不返回给客户端。 */
  steamId?: string;
}

export async function searchIgdb(env: LookupEnv, q: string, lang: Lang): Promise<IgdbHit[]> {
  const games = await query(env, `search ${quote(q)}; ${FIELDS} where ${WHERE_TYPES}; limit 8;`);
  const out: IgdbHit[] = [];
  for (const g of games) {
    const r = igdbResult(g, lang);
    if (!r) continue;
    const steamId = igdbSteamId(g);
    out.push(steamId ? { ...r, steamId } : r);
  }
  return out;
}

export async function igdbItem(env: LookupEnv, slug: string, lang: Lang): Promise<LookupResult> {
  if (!/^[a-z0-9][a-z0-9-]{0,199}$/.test(slug)) throw new LookupError(400, '400 请求有误：IGDB 编号是网址里的那段（如 hollow-knight）');
  const [g] = await query(env, `${FIELDS} where slug = ${quote(slug)}; limit 1;`);
  const r = g ? igdbResult(g, lang) : null;
  if (!r) throw new LookupError(404, '404 未找到：IGDB 上没有这款游戏');
  return r;
}
