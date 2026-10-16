/**
 * 在线补全资料（M4）：按名字或编号从 TMDB / 豆瓣 / Open Library / Steam 找到资料，填进资料库。
 * 查询在 Worker 上（apps/server/src/lookup/，GET /api/lookup/search、/api/lookup/item），这里只放纯逻辑：
 * - 哪些类型能在线找（影视 / 书籍 / 游戏这三种内置类型；按类型 id，用户改过名也认）；
 * - Worker 返回的结果形状（与 apps/server/src/lookup/types.ts 一致，两处一起改）；
 * - 资料的来源：存在 library_item.fields 的保留键 `_source`（「tmdb:movie/550」），不加列，界面上显示「资料来自 TMDB」；
 * - 自动补全的逐项计划：哪些字段会填、哪些已经有值（默认只填空缺，勾选才覆盖）。
 * 界面叫法见 docs/COPY.md「资料库 · 在线找」。
 */
import { BUILTIN_TYPE_IDS } from './seed/builtin-types';
import { fieldText } from './preview';
import { linksOf, normalizeUrl, siteIdOf } from './links';
import { tr } from './i18n';
import type { FieldDef, FieldValue, LibraryItem, LinkValue, TaskType } from './types';

export type LookupKind = 'movie' | 'book' | 'game';
export type LookupSource = 'tmdb' | 'douban' | 'openlibrary' | 'steam';

/** Worker 返回的一条结果。fields 的 key 是内置类型的字段 key（year、kind、imdb、author…）。 */
export interface LookupResult {
  source: LookupSource;
  /** 来源里的编号：tmdb 是「movie/550」「tv/1399」，豆瓣是数字，Open Library 是「OL45804W」，Steam 是 appid。 */
  sourceId: string;
  name: string;
  year?: number;
  /** 原图地址（选中后由 Worker 拉进 R2，资料里不存这个地址）。 */
  image?: string;
  /** 搜索结果里的小图（只在列表里显示，不存）。 */
  thumb?: string;
  /** 一行简介：原名 / 作者 / 开发商。 */
  subtitle?: string;
  fields: Record<string, FieldValue>;
  url: string;
}

export type LookupSourceState = 'ok' | 'unconfigured' | 'blocked' | 'error';

export interface LookupSourceStatus {
  source: LookupSource;
  status: LookupSourceState;
  /** HTTP 状态码（503 服务不可用、504 网关超时…）。 */
  code?: number;
  message?: string;
}

export interface LookupSearchResponse {
  results: LookupResult[];
  sources: LookupSourceStatus[];
}

export interface LookupSourceDef {
  /** 署名：只能写「TMDB」或「The Movie Database」（TMDB 的要求）。 */
  label: string;
  home: string;
  kinds: LookupKind[];
  url(sourceId: string): string;
}

export const LOOKUP_SOURCES: Record<LookupSource, LookupSourceDef> = {
  tmdb: { label: 'TMDB', home: 'https://www.themoviedb.org', kinds: ['movie'], url: (id) => `https://www.themoviedb.org/${id}` },
  douban: { get label() { return tr('豆瓣'); }, home: 'https://movie.douban.com', kinds: ['movie'], url: (id) => `https://movie.douban.com/subject/${id}/` },
  openlibrary: { label: 'Open Library', home: 'https://openlibrary.org', kinds: ['book'], url: (id) => `https://openlibrary.org/works/${id}` },
  steam: { label: 'Steam', home: 'https://store.steampowered.com', kinds: ['game'], url: (id) => `https://store.steampowered.com/app/${id}/` },
};

/** 各种类型在界面上列出的来源（「从 TMDB 找」）：豆瓣是尽力而为，不写在标题里。 */
export const PRIMARY_SOURCE: Record<LookupKind, LookupSource> = { movie: 'tmdb', book: 'openlibrary', game: 'steam' };

const KIND_BY_TYPE: Record<string, LookupKind> = {
  [BUILTIN_TYPE_IDS.movie]: 'movie',
  [BUILTIN_TYPE_IDS.book]: 'book',
  [BUILTIN_TYPE_IDS.game]: 'game',
};

/** 这个类型能不能在线找：只认内置的影视 / 书籍 / 游戏（字段 key 是对得上的）。 */
export function lookupKindOf(type: Pick<TaskType, 'id'> | null | undefined): LookupKind | null {
  return (type && KIND_BY_TYPE[type.id]) ?? null;
}

// ───────────── 来源 ─────────────

/** 资料来源存在 fields 的这个键里（「tmdb:movie/550」）。下划线开头的键不是类型字段，不显示、不参与搜索。 */
export const SOURCE_KEY = '_source';
export const isHiddenFieldKey = (k: string) => k.startsWith('_');

export interface ItemSource {
  source: LookupSource;
  sourceId: string;
  label: string;
  url: string;
}

export const sourceRef = (r: Pick<LookupResult, 'source' | 'sourceId'>) => `${r.source}:${r.sourceId}`;

export function parseSourceRef(v: FieldValue | undefined): ItemSource | null {
  if (typeof v !== 'string') return null;
  const i = v.indexOf(':');
  if (i <= 0) return null;
  const source = v.slice(0, i) as LookupSource;
  const sourceId = v.slice(i + 1);
  const def = LOOKUP_SOURCES[source];
  if (!def || !sourceId) return null;
  return { source, sourceId, label: def.label, url: def.url(sourceId) };
}

export function sourceOfFields(fields: Record<string, FieldValue> | null | undefined): ItemSource | null {
  return parseSourceRef(fields?.[SOURCE_KEY]);
}

/** 资料库里已经有的同一条（同来源同编号，或同一个 IMDb / 豆瓣编号）：选中在线结果时直接用它，不再新建。 */
export function findLookupTwin(items: readonly Pick<LibraryItem, 'id' | 'type_id' | 'fields' | 'deleted'>[], typeId: string, r: Pick<LookupResult, 'source' | 'sourceId' | 'fields'>): string | null {
  const ref = sourceRef(r);
  const imdb = siteIdOf('imdb', r.fields.imdb);
  const douban = siteIdOf('douban', r.fields.douban);
  for (const it of items) {
    if (it.deleted || it.type_id !== typeId) continue;
    if (it.fields[SOURCE_KEY] === ref) return it.id;
    if (imdb && siteIdOf('imdb', it.fields.imdb) === imdb) return it.id;
    if (douban && siteIdOf('douban', it.fields.douban) === douban) return it.id;
  }
  return null;
}

// ───────────── 自动补全 ─────────────

/** 按什么去找：先认已填的 IMDb、再豆瓣编号（精确），都没有就按名字搜。 */
export type LookupQuery = { by: 'id'; source: 'imdb' | 'douban'; id: string } | { by: 'name'; q: string };

export function lookupQueryOf(type: Pick<TaskType, 'id' | 'fields'>, draft: { name: string; fields: Record<string, FieldValue> }): LookupQuery | null {
  const kind = lookupKindOf(type);
  if (!kind) return null;
  if (kind === 'movie') {
    const imdbDef = type.fields.find((f) => f.kind === 'site_id' && f.site === 'imdb');
    const doubanDef = type.fields.find((f) => f.kind === 'site_id' && f.site === 'douban');
    const imdb = imdbDef ? siteIdOf('imdb', draft.fields[imdbDef.key]) : null;
    if (imdb) return { by: 'id', source: 'imdb', id: imdb };
    const douban = doubanDef ? siteIdOf('douban', draft.fields[doubanDef.key]) : null;
    if (douban) return { by: 'id', source: 'douban', id: douban };
  }
  const q = draft.name.trim();
  return q ? { by: 'name', q } : null;
}

export interface FillRow {
  /** 字段 key；主字段是 name 那一行（key 用主字段的 key），图片那一行 media = true。 */
  key: string;
  def: FieldDef;
  current: FieldValue | undefined;
  next: FieldValue;
  /** 现在已经有值（默认不覆盖）。 */
  filled: boolean;
  /** 默认勾不勾。 */
  apply: boolean;
}

const isEmpty = (v: FieldValue | undefined) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

function same(def: FieldDef, a: FieldValue | undefined, b: FieldValue | undefined): boolean {
  if (def.kind === 'site_id') return siteIdOf(def.site, a) === siteIdOf(def.site, b);
  if (def.kind === 'links') {
    const k = (v: FieldValue | undefined) => JSON.stringify(linksOf(v).map((l) => (normalizeUrl(l.url) ?? l.url).replace(/\/+$/, '')));
    return k(a) === k(b);
  }
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
  return fieldText(a).trim() === fieldText(b).trim();
}

/** 更多链接：已有的保留，补上新的（按网址去重），不会把用户自己加的链接覆盖掉。 */
function mergeLinks(cur: FieldValue | undefined, add: FieldValue): LinkValue[] {
  const out = [...linksOf(cur)];
  const key = (u: string) => (normalizeUrl(u) ?? u).replace(/\/+$/, '');
  const seen = new Set(out.map((l) => key(l.url)));
  for (const l of linksOf(add)) {
    const k = key(l.url);
    if (!seen.has(k)) {
      out.push(l);
      seen.add(k);
    }
  }
  return out;
}

/**
 * 自动补全的逐项计划：结果里有、类型里也有的资料字段，一项一行。
 * 值一样的不列；空缺的默认勾上，已有值的默认不勾（勾上 = 覆盖）。
 * 图片那一行的 next 是结果的原图地址（真正填进去前由 Worker 拉进 R2）。
 */
export function planAutofill(type: Pick<TaskType, 'fields'>, draft: { name: string; image: string | null; fields: Record<string, FieldValue> }, r: LookupResult): FillRow[] {
  const rows: FillRow[] = [];
  for (const def of type.fields) {
    if (def.scope === 'task' && !def.primary && !def.media) continue;
    let current: FieldValue | undefined;
    let next: FieldValue | undefined;
    if (def.primary) {
      current = draft.name;
      next = r.name;
    } else if (def.media) {
      current = draft.image;
      next = r.image ?? null;
    } else {
      current = draft.fields[def.key];
      next = r.fields[def.key];
      if (def.kind === 'links' && !isEmpty(next)) next = mergeLinks(current, next!);
    }
    if (isEmpty(next) || same(def, current, next)) continue;
    const filled = !isEmpty(current);
    // 链接是合并的，不会丢东西，默认也勾上
    rows.push({ key: def.key, def, current, next: next!, filled, apply: !filled || def.kind === 'links' });
  }
  return rows;
}

/** 把勾上的几行填进草稿；image 由调用方先换成 asset id 再传进来（拉图失败就传 null，图片那行不填）。 */
export function applyAutofill<D extends { name: string; image: string | null; fields: Record<string, FieldValue> }>(
  draft: D,
  rows: readonly FillRow[],
  chosen: ReadonlySet<string>,
  r: Pick<LookupResult, 'source' | 'sourceId'>,
  image?: string | null,
): D {
  const out: D = { ...draft, fields: { ...draft.fields } };
  let any = false;
  for (const row of rows) {
    if (!chosen.has(row.key)) continue;
    if (row.def.primary) out.name = fieldText(row.next);
    else if (row.def.media) {
      if (!image) continue;
      out.image = image;
    } else out.fields[row.key] = row.next;
    any = true;
  }
  if (any) out.fields[SOURCE_KEY] = sourceRef(r);
  return out;
}

/** 选中一条在线结果，直接建资料用的数据（图片另由 Worker 拉进 R2）。 */
export function itemOfLookup(type: Pick<TaskType, 'fields'>, r: LookupResult): { name: string; fields: Record<string, FieldValue> } {
  const fields: Record<string, FieldValue> = {};
  for (const def of type.fields) {
    if (def.primary || def.media || def.scope === 'task') continue;
    const v = r.fields[def.key];
    if (!isEmpty(v)) fields[def.key] = v!;
  }
  fields[SOURCE_KEY] = sourceRef(r);
  return { name: r.name, fields };
}
