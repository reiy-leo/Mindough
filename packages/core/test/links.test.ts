import { describe, expect, it } from 'vitest';
import { Store } from '../src/store';
import { MemoryAdapter } from '../src/storage/memory';
import { BUILTIN_TASK_TYPES, BUILTIN_TYPE_IDS as T, GAME_PLATFORMS, withNewBuiltinFields } from '../src/seed/builtin-types';
import { seedDemo } from '../src/seed/demo';
import { SITES, detectLinkLabel, isbnOf, linkChips, linksOf, matchOptions, multiValuesOf, normalizeUrl, siteIdOf, siteUrlOf } from '../src/links';
import { factFieldsOf, itemSubtitle, planFieldMigration } from '../src/library';
import { fieldText } from '../src/preview';
import type { LibraryItem, TaskType } from '../src/types';

const now = () => new Date('2026-10-15T12:00:00Z');
const movie = BUILTIN_TASK_TYPES.find((t) => t.id === T.movie)!;
const game = BUILTIN_TASK_TYPES.find((t) => t.id === T.game)!;

describe('站点编号：IMDb / 豆瓣', () => {
  const imdb = SITES.imdb!.parse;
  const douban = SITES.douban!.parse;

  it('IMDb：编号、整条网址（含手机版、带参数）都能认出；只填数字补上 tt', () => {
    expect(imdb('tt0816692')).toBe('tt0816692');
    expect(imdb(' TT0816692 ')).toBe('tt0816692');
    expect(imdb('https://www.imdb.com/title/tt0816692/')).toBe('tt0816692');
    expect(imdb('https://m.imdb.com/title/tt15239678/?ref_=nv_sr_srsg_0')).toBe('tt15239678');
    expect(imdb('imdb.com/zh/title/tt0816692/reviews')).toBe('tt0816692');
    expect(imdb('0816692')).toBe('tt0816692');
  });

  it('IMDb：格式不对的认不出', () => {
    for (const s of ['', 'tt12', 'nm0000123', 'https://www.imdb.com/name/nm0000123/', '星际穿越', 'tt0816692x']) expect(imdb(s), s).toBeNull();
  });

  it('豆瓣：纯数字、电脑版 / 手机版链接都能认出', () => {
    expect(douban('1889243')).toBe('1889243');
    expect(douban('https://movie.douban.com/subject/1889243/')).toBe('1889243');
    expect(douban('https://m.douban.com/movie/subject/1889243/?from=x')).toBe('1889243');
    expect(douban('douban.com/subject/1889243')).toBe('1889243');
    expect(douban('https://www.douban.com/doubanapp/dispatch/movie/1889243')).toBe('1889243');
    expect(douban('https://www.douban.com/people/abc/')).toBeNull();
    expect(douban('星际穿越')).toBeNull();
  });

  it('编号 → 链接', () => {
    expect(SITES.imdb!.url('tt0816692')).toBe('https://www.imdb.com/title/tt0816692/');
    expect(SITES.douban!.url('1889243')).toBe('https://movie.douban.com/subject/1889243/');
    expect(siteIdOf('imdb', 'https://www.imdb.com/title/tt0816692/')).toBe('tt0816692');
    expect(siteIdOf('imdb', 123)).toBeNull();
    expect(siteIdOf('nope', 'tt0816692')).toBeNull();
  });
});

describe('更多链接', () => {
  it('补全网址：没写协议的补 https://，不像网址的不收', () => {
    expect(normalizeUrl('ext.to/browse/?q=interstellar')).toBe('https://ext.to/browse/?q=interstellar');
    expect(normalizeUrl('https://Www.RottenTomatoes.com/m/interstellar_2014')).toBe('https://www.rottentomatoes.com/m/interstellar_2014');
    expect(normalizeUrl('https://letterboxd.com')).toBe('https://letterboxd.com/');
    expect(normalizeUrl('星际穿越')).toBeNull();
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('ftp://x.com/a')).toBeNull();
    expect(normalizeUrl('a b.com')).toBeNull();
  });

  it('按域名认出网站名，不认识的用域名', () => {
    const cases: Array<[string, string]> = [
      ['https://ext.to/movie/123', 'EXT'],
      ['https://www.rottentomatoes.com/m/interstellar_2014', '烂番茄'],
      ['https://www.themoviedb.org/movie/157336', 'TMDB'],
      ['https://letterboxd.com/film/interstellar/', 'Letterboxd'],
      ['https://www.bilibili.com/bangumi/play/ss1', 'B 站'],
      ['https://b23.tv/abc', 'B 站'],
      ['https://www.iqiyi.com/v_1.html', '爱奇艺'],
      ['https://v.qq.com/x/cover/1.html', '腾讯视频'],
      ['https://v.youku.com/v_show/1.html', '优酷'],
      ['https://www.netflix.com/title/1', 'Netflix'],
      ['https://youtu.be/xyz', 'YouTube'],
      ['https://zh.wikipedia.org/wiki/星际穿越', '维基百科'],
      ['https://en.wikipedia.org/wiki/Interstellar_(film)', 'Wikipedia'],
      ['https://store.steampowered.com/app/413150/', 'Steam'],
      ['https://store.epicgames.com/p/hades', 'Epic'],
      ['https://www.gog.com/game/x', 'GOG'],
      ['https://store.playstation.com/zh-hans-hk/product/x', 'PlayStation Store'],
      ['https://www.xbox.com/games/store/x', 'Xbox'],
      ['https://apps.microsoft.com/detail/x', 'Microsoft Store'],
      ['https://www.nintendo.com/us/store/products/x', 'Nintendo eShop'],
      ['https://apps.apple.com/cn/app/id1', 'App Store'],
      ['https://play.google.com/store/apps/details?id=x', 'Google Play'],
      ['https://supergiant.itch.io/x', 'itch.io'],
      ['https://www.igdb.com/games/x', 'IGDB'],
      ['https://www.metacritic.com/game/x', 'Metacritic'],
      ['https://www.xiaoheihe.cn/app/x', '小黑盒'],
      ['https://www.taptap.cn/app/1', 'TapTap'],
      ['https://www.example.org/x', 'example.org'],
    ];
    for (const [url, label] of cases) expect(detectLinkLabel(url), url).toBe(label);
  });

  it('字段值容错：网址字符串、字符串数组、对象数组；空的、坏的跳过', () => {
    expect(linksOf('ext.to/x')).toEqual([{ url: 'https://ext.to/x' }]);
    expect(linksOf(['https://a.com/', '不是网址'])).toEqual([{ url: 'https://a.com/' }]);
    expect(linksOf([{ url: 'https://a.com/', label: ' 我的 ' }, { url: '' }])).toEqual([{ url: 'https://a.com/', label: '我的' }]);
    expect(linksOf(null)).toEqual([]);
    expect(fieldText([{ url: 'https://ext.to/x' }, { url: 'https://a.com/', label: '自己起的' }])).toBe('EXT、自己起的');
  });

  it('显示顺序：IMDb、豆瓣在前，再是更多链接（改过的名字优先），同一网址只出现一次', () => {
    const chips = linkChips(movie.fields, {
      imdb: 'https://www.imdb.com/title/tt0816692/',
      douban: '1889243',
      links: [{ url: 'https://ext.to/x' }, { url: 'https://www.rottentomatoes.com/m/i', label: 'RT' }, { url: 'https://www.imdb.com/title/tt0816692/' }],
    });
    expect(chips.map((c) => c.label)).toEqual(['IMDb', '豆瓣', 'EXT', 'RT']);
    expect(chips[0]!.url).toBe('https://www.imdb.com/title/tt0816692/');
    // 格式不对的编号不出链接
    expect(linkChips(movie.fields, { imdb: 'tt12' })).toEqual([]);
  });

  it('链接字段不进简介和事实列表', () => {
    expect(factFieldsOf(movie).map((f) => f.key)).toEqual(['year', 'kind']);
    expect(itemSubtitle(movie, { year: 2014, kind: '电影', imdb: 'tt0816692', links: [{ url: 'https://ext.to/x' }] })).toBe('2014 · 电影');
  });
});

describe('内置类型 r2：影视去掉平台，游戏平台改多选', () => {
  it('影视：IMDb / 豆瓣 / 更多链接，没有平台；游戏：平台多选 + 更多链接', () => {
    expect(movie.fields.map((f) => f.key)).toEqual(['title', 'poster', 'year', 'kind', 'imdb', 'douban', 'links', 'episode']);
    const platform = game.fields.find((f) => f.key === 'platform')!;
    expect(platform.kind).toBe('multiselect');
    expect(platform.options).toEqual(GAME_PLATFORMS);
    expect(game.fields.some((f) => f.kind === 'links')).toBe(true);
  });

  it('平台文字对到选项：别名、多个平台、对不上的单独列出', () => {
    expect(matchOptions(GAME_PLATFORMS, 'Switch')).toEqual({ values: ['Nintendo Switch'], unmatched: [] });
    expect(matchOptions(GAME_PLATFORMS, 'PC / PS5')).toEqual({ values: ['PC（其他）', 'PlayStation 5'], unmatched: [] });
    expect(matchOptions(GAME_PLATFORMS, 'Steam、Switch 2、xbox series x|s').values).toEqual(['PC（Steam）', 'Switch 2', 'Xbox Series X|S']);
    expect(matchOptions(GAME_PLATFORMS, 'iPhone，安卓').values).toEqual(['iOS', 'Android']);
    expect(matchOptions(GAME_PLATFORMS, 'Steam Deck').values).toEqual(['Linux / Steam Deck']);
    expect(matchOptions(GAME_PLATFORMS, 'Nintendo Switch')).toEqual({ values: ['Nintendo Switch'], unmatched: [] });
    expect(matchOptions(GAME_PLATFORMS, 'Switch / 街机')).toEqual({ values: ['Nintendo Switch'], unmatched: ['街机'] });
    expect(multiValuesOf({ options: GAME_PLATFORMS }, 'PS4')).toEqual(['PlayStation 4']);
    expect(multiValuesOf({ options: GAME_PLATFORMS }, ['iOS', ''])).toEqual(['iOS']);
  });

  const item = (id: string, type_id: string, fields: LibraryItem['fields'], note_md = ''): LibraryItem => ({ id, type_id, name: id, image: null, fields, note_md, created_at: '2026-01-01T00:00:00Z', updated_at: '', deleted: false });

  it('迁移：对得上的选上；对不上的加选「其他」并把原文记进备注；已经是数组的、影视的不动', () => {
    const items = [
      item('g1', T.game, { platform: 'Switch' }),
      item('g2', T.game, { platform: 'PC / 街机' }, '很好玩'),
      item('g3', T.game, { platform: ['iOS'] }),
      item('g4', T.game, { platform: '  ' }),
      item('m1', T.movie, { platform: '影院', year: 2014 }),
    ];
    const plan = planFieldMigration(items, BUILTIN_TASK_TYPES);
    const by = Object.fromEntries(plan.map((p) => [p.id, p]));
    expect(Object.keys(by).sort()).toEqual(['g1', 'g2', 'g4']);
    expect(by.g1).toEqual({ id: 'g1', fields: { platform: ['Nintendo Switch'] }, note_md: '' });
    expect(by.g2).toEqual({ id: 'g2', fields: { platform: ['PC（其他）', '其他'] }, note_md: '很好玩\n\n平台：PC / 街机' });
    expect(by.g4!.fields).toEqual({});
    // 再跑一次：没有要改的
    const after = items.map((it) => (by[it.id] ? { ...it, ...by[it.id] } : it));
    expect(planFieldMigration(after, BUILTIN_TASK_TYPES)).toEqual([]);
  });

  it('打开时：旧内置定义升级；游戏平台文字迁成多选；影视的平台值留在资料里但不显示', async () => {
    const ad = new MemoryAdapter();
    const old = (t: TaskType, fields: TaskType['fields']) => ({ ...t, updated_at: '0000000000000-0001-builtin', fields });
    await ad.applyChanges([
      { table: 'task_type', row: old(movie, [...movie.fields.filter((f) => f.scope !== undefined || f.primary || f.media || f.key === 'year'), { key: 'platform', label: '平台', kind: 'text' }]) },
      { table: 'task_type', row: old(game, game.fields.map((f) => (f.key === 'platform' ? { key: 'platform', label: '平台', kind: 'text' as const } : f)).filter((f) => f.kind !== 'links')) },
      { table: 'library_item', row: item('g1', T.game, { platform: 'Switch / PS5' }) },
      { table: 'library_item', row: item('m1', T.movie, { platform: 'Netflix', year: 2014 }) },
    ]);
    const s = await Store.open(ad, { deviceId: 'd', now });
    const mv = s.get('task_type', T.movie)!;
    expect(mv.fields.some((f) => f.key === 'platform')).toBe(false);
    expect(mv.fields.some((f) => f.key === 'imdb')).toBe(true);
    expect(s.get('library_item', 'g1')!.fields.platform).toEqual(['Nintendo Switch', 'PlayStation 5']);
    // 影视的旧平台：数据还在，简介里不出现
    const m1 = s.get('library_item', 'm1')!;
    expect(m1.fields.platform).toBe('Netflix');
    expect(s.libraryEntries(T.movie).find((e) => e.id === 'm1')!.subtitle).toBe('2014');
    // 落盘了
    const snap = await ad.loadAll();
    expect((snap.library_item as LibraryItem[]).find((r) => r.id === 'g1')!.fields.platform).toEqual(['Nintendo Switch', 'PlayStation 5']);
  });

  it('演示数据：星际穿越带 IMDb / 豆瓣 / 更多链接，资料条目上就有链接', async () => {
    const s = await Store.open(new MemoryAdapter(), { deviceId: 'd', now });
    seedDemo(s);
    const e = s.libraryEntries(T.movie).find((x) => x.name === '星际穿越')!;
    expect(e.links!.map((l) => l.label)).toEqual(['IMDb', '豆瓣', '烂番茄', 'TMDB']);
    expect(e.links![0]!.url).toBe('https://www.imdb.com/title/tt0816692/');
    const stardew = s.libraryEntries(T.game).find((x) => x.name === '星露谷物语')!;
    expect(stardew.subtitle).toBe('PC（Steam）、Nintendo Switch、iOS');
    expect(stardew.links!.map((l) => l.label)).toEqual(['Steam']);
  });
});

describe('填了编号就是链接（回归：Rei「添加 IMDb 和豆瓣号后是要形成可点击的链接的」）', () => {
  const r1Movie = (updated_at: string): TaskType => ({
    ...movie,
    updated_at,
    fields: [...movie.fields.filter((f) => f.kind !== 'site_id' && f.kind !== 'links'), { key: 'platform', label: '平台', kind: 'text' }],
  });

  it('中文输入法打出的全角编号、夹着零宽字符、存成数字的都认', () => {
    expect(SITES.imdb!.parse('ｔｔ０８１６６９２')).toBe('tt0816692');
    expect(SITES.douban!.parse('１８８９２４３\u200b')).toBe('1889243');
    expect(siteIdOf('douban', 1889243)).toBe('1889243');
    expect(siteUrlOf('imdb', 'tt0816692')).toBe('https://www.imdb.com/title/tt0816692/');
    expect(siteUrlOf('douban', 'https://m.douban.com/movie/subject/1889243/')).toBe('https://movie.douban.com/subject/1889243/');
    expect(siteUrlOf('imdb', 'tt12')).toBeNull();
  });

  it('老用户（内置影视还是 r1）：打开后有 IMDb / 豆瓣，编辑资料填上编号，资料条目上就有两个链接', async () => {
    const ad = new MemoryAdapter();
    await ad.applyChanges([{ table: 'task_type', row: r1Movie('0000000000000-0001-builtin') }]);
    const s = await Store.open(ad, { deviceId: 'd', now });
    const it = s.createLibraryItem(T.movie, { name: '千与千寻', fields: { year: 2001 } });
    s.updateLibraryItem(it.id, { fields: { ...it.fields, imdb: 'tt0816692', douban: '1889243' } });
    const e = s.libraryEntries(T.movie).find((x) => x.id === it.id)!;
    expect(e.links!.map((l) => [l.label, l.url])).toEqual([
      ['IMDb', 'https://www.imdb.com/title/tt0816692/'],
      ['豆瓣', 'https://movie.douban.com/subject/1889243/'],
    ]);
  });

  it('内置影视被改过（真实 HLC）：不覆盖，但补上 IMDb / 豆瓣 / 更多链接字段（只在内存，不改写）', async () => {
    const ad = new MemoryAdapter();
    const edited = { ...r1Movie('1760000000000-0000-abcdef123456'), color: '#123456' };
    await ad.applyChanges([{ table: 'task_type', row: edited }]);
    const s = await Store.open(ad, { deviceId: 'd', now });
    const mv = s.get('task_type', T.movie)!;
    expect(mv.color).toBe('#123456');
    expect(mv.fields.map((f) => f.key)).toEqual(expect.arrayContaining(['platform', 'imdb', 'douban', 'links']));
    // 新字段排在新定义里的位置（年份 / 电影剧集之后），旧字段原样
    const keys = mv.fields.map((f) => f.key);
    expect(keys.indexOf('imdb')).toBeLessThan(keys.indexOf('platform'));
    expect(linkChips(mv.fields, { imdb: 'tt0816692', douban: '1889243' }).map((l) => l.label)).toEqual(['IMDb', '豆瓣']);
    // 落盘的那一行没动
    const snap = await ad.loadAll();
    expect((snap.task_type as TaskType[]).find((t) => t.id === T.movie)!.fields.some((f) => f.key === 'imdb')).toBe(false);
  });

  it('更晚的内置版本（别的设备先升级过）不会被降级', async () => {
    const ad = new MemoryAdapter();
    const future = { ...movie, updated_at: '0000000000000-0009-builtin', name: '影视（新）' };
    await ad.applyChanges([{ table: 'task_type', row: future }]);
    const s = await Store.open(ad, { deviceId: 'd', now });
    expect(s.get('task_type', T.movie)!.name).toBe('影视（新）');
  });

  it('withNewBuiltinFields：已有字段一个不动，新字段按新定义的前一个字段插入', () => {
    const cur = [{ key: 'a', label: 'A', kind: 'text' as const }, { key: 'x', label: '自己加的', kind: 'text' as const }];
    const next = [{ key: 'a', label: 'A2', kind: 'text' as const }, { key: 'b', label: 'B', kind: 'text' as const }, { key: 'c', label: 'C', kind: 'text' as const }];
    expect(withNewBuiltinFields(cur, next).map((f) => `${f.key}:${f.label}`)).toEqual(['a:A', 'b:B', 'c:C', 'x:自己加的']);
  });
});

describe('书籍 r3：ISBN、出版社、出版年份（Rei 2026-10-17）', () => {
  const book = BUILTIN_TASK_TYPES.find((t) => t.id === T.book)!;

  it('认 ISBN-10 / 13：容许连字符、空格、ISBN 前缀，也认 openlibrary.org/isbn/ 链接；校验位不对的不认', () => {
    expect(isbnOf('9787536692930')).toBe('9787536692930');
    expect(isbnOf('978-7-5366-9293-0')).toBe('9787536692930');
    expect(isbnOf('ISBN 7 5366 9293 5')).toBe('7536692935');
    expect(isbnOf('isbn：0-8044-2957-x')).toBe('080442957X');
    expect(isbnOf('https://openlibrary.org/isbn/9787536692930')).toBe('9787536692930');
    expect(isbnOf('openlibrary.org/isbn/0451526538.json')).toBe('0451526538');
    expect(isbnOf('9787536692931')).toBeNull(); // 校验位错
    expect(isbnOf('1917')).toBeNull();
    expect(isbnOf('三体')).toBeNull();
    expect(siteUrlOf('isbn', '978-7-5366-9293-0')).toBe('https://openlibrary.org/isbn/9787536692930');
  });

  it('书籍类型：作者后面是出版社、出版年份、ISBN，再是页数', () => {
    expect(book.fields.map((f) => f.key)).toEqual(['title', 'cover', 'author', 'publisher', 'year', 'isbn', 'total_pages', 'pages']);
    expect(book.fields.find((f) => f.key === 'isbn')).toMatchObject({ kind: 'site_id', site: 'isbn' });
  });

  it('打开时：r2 的内置书籍换成新定义；用户改过的只补新字段（插在原位置，已有字段不动）', async () => {
    const ad = new MemoryAdapter();
    const r2 = book.fields.filter((f) => !['publisher', 'year', 'isbn'].includes(f.key));
    await ad.applyChanges([{ table: 'task_type', row: { ...book, updated_at: '0000000000000-0002-builtin', fields: r2 } }]);
    const s = await Store.open(ad, { deviceId: 'd', now });
    expect(s.get('task_type', T.book)!.fields.map((f) => f.key)).toEqual(book.fields.map((f) => f.key));
    const mine = r2.map((f) => (f.key === 'author' ? { ...f, label: '著者' } : f));
    expect(withNewBuiltinFields(mine, book.fields).map((f) => `${f.key}:${f.label}`)).toEqual(['title:书名', 'cover:封面', 'author:著者', 'publisher:出版社', 'year:出版年份', 'isbn:ISBN', 'total_pages:页数', 'pages:读到第几页']);
  });
});
