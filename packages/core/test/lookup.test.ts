import { describe, expect, it } from 'vitest';
import { BUILTIN_TASK_TYPES, BUILTIN_TYPE_IDS as T } from '../src/seed/builtin-types';
import {
  SOURCE_KEY,
  applyAutofill,
  findLookupTwin,
  itemOfLookup,
  lookupCover,
  lookupKindOf,
  lookupQueryOf,
  lookupSearchText,
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

  it('同名（规范化后）且年份不冲突也算同一条；记着别的来源的不算', () => {
    expect(findLookupTwin([item({ id: 'n', name: '沙丘 2', fields: { year: 2024 } })], T.movie, dune)).toBe('n');
    expect(findLookupTwin([item({ id: 'n', name: '沙丘·2' })], T.movie, dune)).toBe('n');
    expect(findLookupTwin([item({ id: 'n', name: '沙丘2', fields: { year: 1984 } })], T.movie, dune)).toBeNull();
    expect(findLookupTwin([item({ id: 'n', name: '沙丘2', fields: { [SOURCE_KEY]: 'douban:1' } })], T.movie, dune)).toBeNull();
  });
});

describe('在线补全：按什么找', () => {
  it('先 IMDb、再豆瓣编号、再名字', () => {
    expect(lookupQueryOf(movie, { name: '沙丘', fields: { imdb: 'imdb.com/title/tt15239678', douban: '35575567' } })).toEqual({ by: 'id', source: 'imdb', id: 'tt15239678' });
    expect(lookupQueryOf(movie, { name: '沙丘', fields: { douban: 'https://movie.douban.com/subject/35575567/' } })).toEqual({ by: 'id', source: 'douban', id: '35575567' });
    expect(lookupQueryOf(movie, { name: ' 沙丘 ', fields: { imdb: '乱写' } })).toEqual({ by: 'name', q: '沙丘' });
    // 电影只搜电影
    expect(lookupQueryOf(movie, { name: '末日', fields: { kind: '电影' } })).toEqual({ by: 'name', q: '末日', media: 'movie' });
    // 季标记去掉，当剧集搜
    expect(lookupQueryOf(movie, { name: '末日地堡 第三季', fields: {} })).toEqual({ by: 'name', q: '末日地堡', media: 'tv', season: 3 });
    expect(lookupQueryOf(movie, { name: '鱿鱼游戏 第三季', fields: { kind: '剧集' } })).toEqual({ by: 'name', q: '鱿鱼游戏', media: 'tv', season: 3 });
    // 书不管电影 / 剧集
    expect(lookupQueryOf(book, { name: '三体', fields: {} })).toEqual({ by: 'name', q: '三体' });
    // 书：已填 ISBN（或名字栏里粘的是 ISBN）就按 ISBN 取那一版
    expect(lookupQueryOf(book, { name: '三体', fields: { isbn: '978-7-5366-9293-0' } })).toEqual({ by: 'id', source: 'isbn', id: '9787536692930' });
    expect(lookupQueryOf(book, { name: '三体', fields: { isbn: '乱写' } })).toEqual({ by: 'name', q: '三体' });
    expect(lookupQueryOf(book, { name: 'https://openlibrary.org/isbn/7536692935', fields: {} })).toEqual({ by: 'id', source: 'isbn', id: '7536692935' });
    expect(lookupQueryOf(book, { name: '', fields: {} })).toBeNull();
    expect(lookupQueryOf(type(T.meal), { name: '红烧肉', fields: {} })).toBeNull();
  });
});

describe('在线补全：书的 ISBN（Rei 2026-10-17）', () => {
  it('选择框里输入 / 粘贴 ISBN：按 ISBN 取；只在书里认，影视里照旧按名字', () => {
    expect(lookupSearchText('978 7 5366 9293 0', 'book')).toEqual({ by: 'id', source: 'isbn', id: '9787536692930' });
    expect(lookupSearchText('ISBN 7-5366-9293-5', 'book')).toEqual({ by: 'id', source: 'isbn', id: '7536692935' });
    expect(lookupSearchText('openlibrary.org/isbn/9787536692931', 'book')).toBeNull(); // 链接里的校验位错：不当书名搜
    expect(lookupSearchText('9787536692930', 'movie')).toEqual({ by: 'name', q: '9787536692930' });
    expect(lookupSearchText('三体', 'book')).toEqual({ by: 'name', q: '三体' });
  });

  it('某一版（OL…M）的来源链接指向 /books/，作品指向 /works/；同一 ISBN 算库里的同一本', () => {
    expect(parseSourceRef('openlibrary:OL25840916M')?.url).toBe('https://openlibrary.org/books/OL25840916M');
    const ed: LookupResult = { source: 'openlibrary', sourceId: 'OL25840916M', name: '三体', fields: { isbn: '9787536692930', publisher: 'Chongqing Press' }, url: '' };
    const items = [item({ id: 'b1', type_id: T.book, name: '三体（典藏版）', fields: { isbn: '978-7-5366-9293-0' } })];
    expect(findLookupTwin(items, T.book, ed)).toBe('b1');
  });

  it('按 ISBN 取到的一版：逐项列出出版社、出版年份、ISBN、页数，没有封面那行', () => {
    const ed: LookupResult = { source: 'openlibrary', sourceId: 'OL25840916M', name: '三体', year: 2008, fields: { author: '刘慈欣', publisher: 'Chongqing Press', year: 2008, isbn: '9787536692930', total_pages: 302 }, url: '' };
    const rows = planAutofill(book, { name: '三体', image: null, fields: { isbn: '978-7-5366-9293-0' } }, ed);
    expect(rows.map((r) => r.key).sort()).toEqual(['author', 'publisher', 'total_pages', 'year']);
    expect(itemOfLookup(book, ed).fields).toEqual({ author: '刘慈欣', publisher: 'Chongqing Press', year: 2008, isbn: '9787536692930', total_pages: 302, [SOURCE_KEY]: 'openlibrary:OL25840916M' });
  });
});

describe('在线补全：输入框里的字', () => {
  it('去掉各种季标记（试跑里的 7 部剧）', () => {
    const cases: Array<[string, string, number]> = [
      ['末日地堡 第三季', '末日地堡', 3],
      ['七国骑士 第一季', '七国骑士', 1],
      ['IT：欢迎来到德里镇 第一季', 'IT：欢迎来到德里镇', 1],
      ['异形：地球 第一季', '异形：地球', 1],
      ['中国奇谭 第二季', '中国奇谭', 2],
      ['Severance Season 2', 'Severance', 2],
      ['The Bear S03', 'The Bear', 3],
    ];
    for (const [text, q, season] of cases) expect(lookupSearchText(text)).toEqual({ by: 'name', q: q.normalize('NFKC'), media: 'tv', season });
    expect(lookupSearchText('绝命毒师 S02E03')).toEqual({ by: 'name', q: '绝命毒师', media: 'tv', season: 2 });
    expect(lookupSearchText('封神第二部：战火西岐')).toEqual({ by: 'name', q: '封神第二部：战火西岐' });
    expect(lookupSearchText('  ')).toBeNull();
  });

  it('粘贴编号或链接：按编号取', () => {
    expect(lookupSearchText('tt0816692')).toEqual({ by: 'id', source: 'imdb', id: 'tt0816692' });
    expect(lookupSearchText('https://www.imdb.com/title/tt0816692/?ref_=x')).toEqual({ by: 'id', source: 'imdb', id: 'tt0816692' });
    expect(lookupSearchText('https://movie.douban.com/subject/1889243/')).toEqual({ by: 'id', source: 'douban', id: '1889243' });
    expect(lookupSearchText('1917')).toEqual({ by: 'name', q: '1917' });
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

  it('书的封面纯手填（Rei 2026-10-17）：Open Library 的结果不列图片那行，书名、作者、年份照填', () => {
    // 就算 Worker（旧版本 / 缓存）还带着封面地址，也不用
    const three: LookupResult = {
      source: 'openlibrary',
      sourceId: 'OL17267881W',
      name: '三体',
      year: 2008,
      image: 'https://covers.openlibrary.org/b/id/9157544-L.jpg',
      thumb: 'https://covers.openlibrary.org/b/id/9157544-M.jpg',
      fields: { author: '刘慈欣', total_pages: 417 },
      url: 'https://openlibrary.org/works/OL17267881W',
    };
    expect(lookupCover(three)).toEqual({});
    const rows = planAutofill(book, { name: '', image: null, fields: {} }, three);
    expect(rows.some((r) => r.def.media && !r.def.primary)).toBe(false);
    expect(rows.map((r) => r.next)).toEqual(expect.arrayContaining(['三体', '刘慈欣']));
    // 已有手动上传的封面：不动
    const draft = { name: '', image: 'asset-mine', fields: {} };
    const out = applyAutofill(draft, planAutofill(book, draft, three), new Set(rows.map((r) => r.key)), three, 'asset-x');
    expect(out.image).toBe('asset-mine');
    expect(out.name).toBe('三体');
    // 别的来源照旧带封面
    expect(lookupCover(dune)).toEqual({ image: dune.image });
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
