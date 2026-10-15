/**
 * 资料上的链接：站点编号字段（site_id，如 IMDb / 豆瓣：只存编号，显示成链接）与「更多链接」（links，各类型通用）。
 * 用户可以直接粘贴整条网址，这里负责认出编号、认出是哪个网站（EXT、烂番茄、Steam…），并排好显示顺序。
 * 界面叫法见 docs/COPY.md「资料库 · 链接」。
 */
import type { FieldDef, FieldValue, LinkValue } from './types';

// ───────────── 站点编号 ─────────────

export interface SiteDef {
  /** 链接上显示的名字。 */
  label: string;
  /** 输入框占位。 */
  placeholder: string;
  /** 格式不对时的轻提示。 */
  hint: string;
  /** 从编号或整条网址里认出编号；认不出返回 null。 */
  parse: (input: string) => string | null;
  url: (id: string) => string;
}

export const SITES: Record<string, SiteDef> = {
  imdb: {
    label: 'IMDb',
    placeholder: 'tt0816692，或粘贴链接',
    hint: 'IMDb 编号是 tt 加数字，比如 tt0816692',
    parse: (input) => {
      const s = input.trim();
      if (!s) return null;
      // 整条网址：imdb.com/title/tt0816692/…（含 m.imdb.com、带语言前缀的）
      const m = /^(tt\d{7,10})$/i.exec(s) ?? (s.includes('/') ? /(?:^|[^a-z0-9])(tt\d{7,10})(?=$|[^a-z0-9])/i.exec(s) : null);
      if (m) return m[1]!.toLowerCase();
      // 只填了数字：补上 tt
      if (/^\d{7,10}$/.test(s)) return `tt${s}`;
      return null;
    },
    url: (id) => `https://www.imdb.com/title/${id}/`,
  },
  douban: {
    label: '豆瓣',
    placeholder: '1889243，或粘贴链接',
    hint: '豆瓣编号是一串数字，在链接 subject/ 后面',
    parse: (input) => {
      const s = input.trim();
      if (!s) return null;
      if (/^\d{4,12}$/.test(s)) return s;
      // movie.douban.com/subject/1889243/、m.douban.com/movie/subject/1889243/、douban.com/doubanapp/…/movie/1889243
      const m = /douban\.com\/(?:[a-z]+\/)*subject\/(\d{4,12})/i.exec(s) ?? /douban\.com\/.*?\/movie\/(\d{4,12})/i.exec(s);
      return m ? m[1]! : null;
    },
    url: (id) => `https://movie.douban.com/subject/${id}/`,
  },
};

/** 一个站点编号字段的值 → 编号（认不出 = null）。 */
export function siteIdOf(site: string | undefined, v: FieldValue | undefined): string | null {
  const def = site ? SITES[site] : undefined;
  if (!def || typeof v !== 'string') return null;
  return def.parse(v);
}

// ───────────── 网址与网站名 ─────────────

/** 补全网址：没写协议的（ext.to/xxx、www.xxx.com）补上 https://；看着不像网址的返回 null。 */
export function normalizeUrl(input: string): string | null {
  const s = input.trim();
  if (!s || /\s/.test(s)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : /^[\w-]+(\.[\w-]+)+([/:?#].*)?$/.test(s) ? `https://${s}` : null;
  const m = withScheme ? /^(https?):\/\/([^/?#:@\s]+)(:\d+)?([/?#].*)?$/i.exec(withScheme) : null;
  if (!m || !m[2]!.includes('.') && m[2]!.toLowerCase() !== 'localhost') return null;
  return `${m[1]!.toLowerCase()}://${m[2]!.toLowerCase()}${m[3] ?? ''}${m[4] ?? '/'}`;
}

export function hostOf(url: string): string {
  const m = /^[a-z]+:\/\/([^/?#:@]+)/i.exec(url.trim());
  return (m ? m[1]! : url.split('/')[0] ?? url).toLowerCase().replace(/^www\./, '');
}

/** 常见网站：域名（含子域名）→ 显示名。先长后短，按顺序匹配。 */
const SITE_LABELS: Array<[RegExp, string]> = [
  [/(^|\.)ext\.to$/, 'EXT'],
  [/(^|\.)rottentomatoes\.com$/, '烂番茄'],
  [/(^|\.)themoviedb\.org$/, 'TMDB'],
  [/(^|\.)letterboxd\.com$/, 'Letterboxd'],
  [/(^|\.)imdb\.com$/, 'IMDb'],
  [/(^|\.)douban\.com$/, '豆瓣'],
  [/(^|\.)metacritic\.com$/, 'Metacritic'],
  [/(^|\.)bilibili\.com$|(^|\.)b23\.tv$/, 'B 站'],
  [/(^|\.)iqiyi\.com$/, '爱奇艺'],
  [/(^|\.)v\.qq\.com$/, '腾讯视频'],
  [/(^|\.)youku\.com$/, '优酷'],
  [/(^|\.)mgtv\.com$/, '芒果 TV'],
  [/(^|\.)netflix\.com$/, 'Netflix'],
  [/(^|\.)disneyplus\.com$/, 'Disney+'],
  [/(^|\.)tv\.apple\.com$/, 'Apple TV'],
  [/(^|\.)youtube\.com$|(^|\.)youtu\.be$/, 'YouTube'],
  [/(^|\.)zh\.wikipedia\.org$/, '维基百科'],
  [/(^|\.)wikipedia\.org$/, 'Wikipedia'],
  // 游戏
  [/(^|\.)steampowered\.com$|(^|\.)steamcommunity\.com$/, 'Steam'],
  [/(^|\.)epicgames\.com$/, 'Epic'],
  [/(^|\.)gog\.com$/, 'GOG'],
  [/(^|\.)playstation\.com$/, 'PlayStation Store'],
  [/(^|\.)xbox\.com$/, 'Xbox'],
  [/(^|\.)microsoft\.com$/, 'Microsoft Store'],
  [/(^|\.)nintendo\.(com|co\.jp|com\.hk)$/, 'Nintendo eShop'],
  [/^apps\.apple\.com$|(^|\.)itunes\.apple\.com$/, 'App Store'],
  [/^play\.google\.com$/, 'Google Play'],
  [/(^|\.)itch\.io$/, 'itch.io'],
  [/(^|\.)igdb\.com$/, 'IGDB'],
  [/(^|\.)xiaoheihe\.cn$/, '小黑盒'],
  [/(^|\.)taptap\.(cn|com|io)$/, 'TapTap'],
  [/(^|\.)github\.com$/, 'GitHub'],
];

/** 按网址认出网站名；不认识的用域名（去掉 www.）。 */
export function detectLinkLabel(url: string): string {
  const host = hostOf(url).toLowerCase();
  for (const [re, label] of SITE_LABELS) if (re.test(host)) return label;
  return host;
}

/** 一条链接显示的名字：用户改过就用用户的。 */
export function linkLabel(l: LinkValue): string {
  return l.label?.trim() || detectLinkLabel(l.url);
}

/** 字段值 → 链接数组（容错：旧数据可能是网址字符串或字符串数组）。 */
export function linksOf(v: FieldValue | undefined): LinkValue[] {
  if (!v) return [];
  const raw = Array.isArray(v) ? v : typeof v === 'string' ? [v] : [];
  const out: LinkValue[] = [];
  for (const x of raw) {
    if (typeof x === 'string') {
      const url = normalizeUrl(x);
      if (url) out.push({ url });
    } else if (x && typeof x === 'object' && typeof x.url === 'string' && x.url.trim()) {
      out.push(x.label?.trim() ? { url: x.url, label: x.label.trim() } : { url: x.url });
    }
  }
  return out;
}

// ───────────── 显示 ─────────────

export interface LinkChip {
  key: string;
  label: string;
  url: string;
}

/** 一条资料上要显示的链接：站点编号字段在前（按字段顺序，如 IMDb、豆瓣），再是更多链接；同一网址只出现一次。 */
export function linkChips(fieldsDef: readonly FieldDef[] | null | undefined, data: Record<string, FieldValue>): LinkChip[] {
  const out: LinkChip[] = [];
  const seen = new Set<string>();
  const push = (key: string, label: string, url: string) => {
    if (seen.has(url)) return;
    seen.add(url);
    out.push({ key, label, url });
  };
  const defs = fieldsDef ?? [];
  for (const f of defs) {
    if (f.kind !== 'site_id' || !f.site) continue;
    const id = siteIdOf(f.site, data[f.key]);
    if (id) push(f.key, SITES[f.site]!.label, SITES[f.site]!.url(id));
  }
  for (const f of defs) {
    if (f.kind !== 'links') continue;
    linksOf(data[f.key]).forEach((l, i) => push(`${f.key}.${i}`, linkLabel(l), l.url));
  }
  return out;
}

/** 链接类字段不在「年份 · 电影」这类简介和事实列表里显示（单独显示成链接）。 */
export const isLinkField = (f: Pick<FieldDef, 'kind'>) => f.kind === 'site_id' || f.kind === 'links';

// ───────────── 多选 ─────────────

/** 游戏平台的别名：自由文本迁移成多选时用（「Switch」「PS5」「Steam」…）。键是规范化后的写法。 */
const OPTION_ALIASES: Record<string, string> = {
  steam: 'PC（Steam）',
  pcsteam: 'PC（Steam）',
  epic: 'PC（Epic）',
  epicgames: 'PC（Epic）',
  pcepic: 'PC（Epic）',
  pc: 'PC（其他）',
  windows: 'PC（其他）',
  win: 'PC（其他）',
  电脑: 'PC（其他）',
  gog: 'PC（其他）',
  ps5: 'PlayStation 5',
  playstation5: 'PlayStation 5',
  ps4: 'PlayStation 4',
  playstation4: 'PlayStation 4',
  xsx: 'Xbox Series X|S',
  xss: 'Xbox Series X|S',
  xbox: 'Xbox Series X|S',
  xboxseries: 'Xbox Series X|S',
  xboxseriesx: 'Xbox Series X|S',
  xboxseriess: 'Xbox Series X|S',
  xboxseriesxs: 'Xbox Series X|S',
  xboxone: 'Xbox One',
  xb1: 'Xbox One',
  switch: 'Nintendo Switch',
  ns: 'Nintendo Switch',
  nintendoswitch: 'Nintendo Switch',
  任天堂switch: 'Nintendo Switch',
  switch2: 'Switch 2',
  ns2: 'Switch 2',
  nintendoswitch2: 'Switch 2',
  ios: 'iOS',
  iphone: 'iOS',
  ipad: 'iOS',
  android: 'Android',
  安卓: 'Android',
  mac: 'macOS',
  macos: 'macOS',
  linux: 'Linux / Steam Deck',
  steamdeck: 'Linux / Steam Deck',
  deck: 'Linux / Steam Deck',
  网页: '网页',
  web: '网页',
  浏览器: '网页',
  手机: '其他',
};

const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[\s()（）·\-_.|/]+/g, '');

/**
 * 把一段自由文本（「Switch / PC」「PS5、Steam」）对到多选的选项上。
 * 先按选项名本身，再按别名；对不上的片段放进 unmatched（调用方决定怎么留住原文）。
 */
export function matchOptions(options: readonly string[], text: string): { values: string[]; unmatched: string[] } {
  const byNorm = new Map(options.map((o) => [norm(o), o]));
  const values: string[] = [];
  const unmatched: string[] = [];
  const parts = text
    .split(/\s*(?:[/,、，+&;；]|\s和\s|\s+or\s+)\s*/i)
    .map((p) => p.trim())
    .filter(Boolean);
  for (const p of parts) {
    const n = norm(p);
    const hit = byNorm.get(n) ?? (OPTION_ALIASES[n] && options.includes(OPTION_ALIASES[n]!) ? OPTION_ALIASES[n] : undefined);
    if (hit) {
      if (!values.includes(hit)) values.push(hit);
    } else unmatched.push(p);
  }
  return { values, unmatched };
}

/** 多选字段的值 → 选中的选项（容错：旧数据是一段文字时按 matchOptions 对一下）。 */
export function multiValuesOf(def: Pick<FieldDef, 'options'>, v: FieldValue | undefined): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string' && !!x);
  if (typeof v === 'string' && v.trim()) return matchOptions(def.options ?? [], v).values;
  return [];
}
