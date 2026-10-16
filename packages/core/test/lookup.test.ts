import { describe, expect, it } from 'vitest';
import { BUILTIN_TASK_TYPES, BUILTIN_TYPE_IDS as T } from '../src/seed/builtin-types';
import {
  SOURCE_KEY,
  applyAutofill,
  findLookupTwin,
  itemOfLookup,
  lookupKindOf,
  lookupQueryOf,
  parseSourceRef,
  planAutofill,
  sourceOfFields,
  type LookupResult,
} from '../src/lookup';
import { entryOfItem } from '../src/library';
import { search } from '../src/search';
import type { LibraryItem, TaskType } from '../src/types';

const type = (id: string) => BUILTIN_TASK_TYPES.find((t) => t.id === id)! as TaskType;
const movie = type(T.movie);
const book = type(T.book);
const game = type(T.game);

const dune: LookupResult = {
  source: 'tmdb',
  sourceId: 'movie/693134',
  name: '沙丘2',
  year: 2024,
  image: 'https://image.tmdb.org/t/p/w780/abc.jpg',
  fields: { year: 2024, kind: '电影', imdb: 'tt15239678' },
  url: 'https://www.themoviedb.org/movie/693134',
};

const item = (p: Partial<LibraryItem>): LibraryItem => ({ id: 'i1', updated_at: 'x', deleted: false, type_id: T.movie, name: '', image: null, fields: {}, note_md: '', created_at: '2026-01-01T00:00:00Z', ...p });

describe('在线补全：类型与来源', () => {
  it('只有内置影视 / 书 / 游戏能在线找', () => {
    expect(lookupKindOf(movie)).toBe('movie');
    expect(lookupKindOf(book)).toBe('book');
    expect(lookupKindOf(game)).toBe('game');
    expect(lookupKindOf(type(T.restaurant))).toBeNull();
    expect(lookupKindOf({ id: 'custom' })).toBeNull();
    expect(lookupKindOf(null)).toBeNull();
  });

  it('来源存在 _source，认得出名字与链接', () => {
    expect(parseSourceRef('tmdb:movie/550')).toEqual({ source: 'tmdb', sourceId: 'movie/550', label: 'TMDB', url: 'https://www.themoviedb.org/movie/550' });
    expect(parseSourceRef('steam:1245620')?.url).toBe('https://store.steampowered.com/app/1245620/');
    expect(parseSourceRef('openlibrary:OL17267881W')?.url).toBe('https://openlibrary.org/works/OL17267881W');
    expect(parseSourceRef('nope:1')).toBeNull();
    expect(parseSourceRef('tmdb:')).toBeNull();
    expect(parseSourceRef(3)).toBeNull();
    expect(sourceOfFields({ [SOURCE_KEY]: 'douban:1889243' })?.url).toBe('https://movie.douban.com/subject/1889243/');
  });

  it('资料卡带来源；_source 不进搜索关键词', () => {
    const it0 = item({ name: '沙丘2', fields: { year: 2024, [SOURCE_KEY]: 'tmdb:movie/693134' } });
    const e = entryOfItem(movie, it0, 0, 0);
    expect(e.source?.label).toBe('TMDB');
    expect(e.keywords).not.toContain('tmdb');
    const hits = search({ tasks: [], types: [movie], people: [], groups: [], taskPeople: [], items: [it0] }, 'tmdb');
    expect(hits).toEqual([]);
  });

  it('同一条（同来源编号 / 同 IMDb）直接用已有的', () => {
    const items = [item({ id: 'a', fields: { imdb: 'https://www.imdb.com/title/tt15239678/' } }), item({ id: 'b', fields: { [SOURCE_KEY]: 'tmdb:movie/1' } })];
    expect(findLookupTwin(items, T.movie, dune)).toBe('a');
    expect(findLookupTwin(items, T.movie, { ...dune, sourceId: 'movie/1', fields: {} })).toBe('b');
    expect(findLookupTwin(items, T.book, dune)).toBeNull();
    expect(findLookupTwin([{ ...items[0]!, deleted: true }], T.movie, dune)).toBeNull();
  });
});

describe('在线补全：按什么找', () => {
  it('先 IMDb、再豆瓣编号、再名字', () => {
    expect(lookupQueryOf(movie, { name: '沙丘', fields: { imdb: 'imdb.com/title/tt15239678', douban: '35575567' } })).toEqual({ by: 'id', source: 'imdb', id: 'tt15239678' });
    expect(lookupQueryOf(movie, { name: '沙丘', fields: { douban: 'https://movie.douban.com/subject/35575567/' } })).toEqual({ by: 'id', source: 'douban', id: '35575567' });
    expect(lookupQueryOf(movie, { name: ' 沙丘 ', fields: { imdb: '乱写' } })).toEqual({ by: 'name', q: '沙丘' });
    expect(lookupQueryOf(book, { name: '', fields: {} })).toBeNull();
    expect(lookupQueryOf(type(T.meal), { name: '红烧肉', fields: {} })).toBeNull();
  });
});

describe('在线补全：逐项计划', () => {
  it('空缺的默认勾上，已有值的默认不勾，一样的不列', () => {
    const rows = planAutofill(movie, { name: '沙丘2', image: null, fields: { year: 2023, kind: '电影' } }, dune);
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(Object.keys(by).sort()).toEqual(['imdb', 'poster', 'year']);
    expect(by.poster!.apply).toBe(true);
    expect(by.imdb!.apply).toBe(true);
    expect(by.year).toMatchObject({ filled: true, apply: false, current: 2023, next: 2024 });
  });

  it('名字不同也列出来（默认不覆盖）；编号写法不同但相同不列', () => {
    const rows = planAutofill(movie, { name: '沙丘 第二部', image: 'asset-1', fields: { imdb: 'https://www.imdb.com/title/tt15239678/' } }, dune);
    expect(rows.find((r) => r.key === 'title')).toMatchObject({ filled: true, apply: false, next: '沙丘2' });
    expect(rows.find((r) => r.key === 'imdb')).toBeUndefined();
    expect(rows.find((r) => r.key === 'poster')).toMatchObject({ filled: true, apply: false });
  });

  it('更多链接是合并，不覆盖用户自己的', () => {
    const r: LookupResult = { source: 'steam', sourceId: '1', name: 'X', fields: { links: [{ url: 'https://store.steampowered.com/app/1/' }] }, url: '' };
    const rows = planAutofill(game, { name: 'X', image: null, fields: { links: [{ url: 'https://example.com/' }] } }, r);
    const links = rows.find((x) => x.key === 'links')!;
    expect(links.apply).toBe(true);
    expect(links.next).toEqual([{ url: 'https://example.com/' }, { url: 'https://store.steampowered.com/app/1/' }]);
    // 已经有了就不列
    expect(planAutofill(game, { name: 'X', image: null, fields: { links: [{ url: 'https://store.steampowered.com/app/1' }] } }, r).find((x) => x.key === 'links')).toBeUndefined();
  });

  it('任务字段（看到哪）不填', () => {
    const rows = planAutofill(movie, { name: '', image: null, fields: {} }, { ...dune, fields: { ...dune.fields, episode: { season: 1, episode: 2 } } });
    expect(rows.some((r) => r.key === 'episode')).toBe(false);
  });

  it('只填勾上的；图片要传进 asset id；填了就记下来源', () => {
    const draft = { name: '沙丘2', image: null, fields: { year: 2023 }, note_md: 'x' };
    const rows = planAutofill(movie, draft, dune);
    const out = applyAutofill(draft, rows, new Set(['imdb', 'poster']), dune, 'asset-9');
    expect(out).toEqual({ name: '沙丘2', image: 'asset-9', fields: { year: 2023, imdb: 'tt15239678', [SOURCE_KEY]: 'tmdb:movie/693134' }, note_md: 'x' });
    // 拉图失败：图片那行不填
    expect(applyAutofill(draft, rows, new Set(['poster']), dune, null)).toEqual(draft);
    // 覆盖
    expect(applyAutofill(draft, rows, new Set(['year']), dune).fields.year).toBe(2024);
  });

  it('选中结果直接建资料：只留资料字段 + 来源', () => {
    expect(itemOfLookup(movie, { ...dune, fields: { ...dune.fields, episode: 'S01E01', junk: 1 } })).toEqual({
      name: '沙丘2',
      fields: { year: 2024, kind: '电影', imdb: 'tt15239678', [SOURCE_KEY]: 'tmdb:movie/693134' },
    });
  });
});
