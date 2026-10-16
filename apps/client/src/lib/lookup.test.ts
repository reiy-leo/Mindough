import { describe, expect, it, vi } from 'vitest';
import { BUILTIN_TYPE_IDS, MemoryAdapter, SOURCE_KEY, Store, type LookupResult } from '@mindough/core';
import { createItemFromLookup, fetchLookupItem, searchOnline } from './lookup';

const r: LookupResult = {
  source: 'tmdb',
  sourceId: 'movie/693134',
  name: '沙丘2',
  year: 2024,
  image: 'https://image.tmdb.org/t/p/w780/p.jpg',
  fields: { year: 2024, kind: '电影' },
  url: 'https://www.themoviedb.org/movie/693134',
};

const flush = () => new Promise((x) => setTimeout(x, 0));

describe('在线找资料（客户端）', () => {
  it('选中在线结果：马上建资料，后台补详情和封面（只补空缺）', async () => {
    const store = await Store.open(new MemoryAdapter());
    const type = store.get('task_type', BUILTIN_TYPE_IDS.movie)!;
    const fetchItem = vi.fn(async () => ({ ...r, fields: { ...r.fields, imdb: 'tt15239678' } }));
    const importImage = vi.fn(async () => 'asset-1');
    const { id, created } = createItemFromLookup(store, type, r, { fetchItem, importImage });
    expect(created).toBe(true);
    expect(store.get('library_item', id)).toMatchObject({ name: '沙丘2', image: null, fields: { year: 2024, kind: '电影', [SOURCE_KEY]: 'tmdb:movie/693134' } });
    await flush();
    await flush();
    expect(fetchItem).toHaveBeenCalledWith('tmdb', 'movie/693134');
    expect(importImage).toHaveBeenCalledWith(store, r.image, 'poster');
    expect(store.get('library_item', id)).toMatchObject({ image: 'asset-1', fields: { imdb: 'tt15239678' } });
  });

  it('库里已有同名的：用它，不新建；已有的值不动', async () => {
    const store = await Store.open(new MemoryAdapter());
    const type = store.get('task_type', BUILTIN_TYPE_IDS.movie)!;
    const mine = store.createLibraryItem(type.id, { name: '沙丘 2', fields: { kind: '剧集' } });
    const { id, created } = createItemFromLookup(store, type, r, { fetchItem: async () => r, importImage: async () => null });
    expect(created).toBe(false);
    expect(id).toBe(mine.id);
    await flush();
    await flush();
    expect(store.get('library_item', id)!.fields).toEqual({ kind: '剧集', year: 2024, [SOURCE_KEY]: 'tmdb:movie/693134' });
  });

  it('书：封面纯手填，选中 Open Library 的结果不拉图（Rei 2026-10-17）', async () => {
    const store = await Store.open(new MemoryAdapter());
    const type = store.get('task_type', BUILTIN_TYPE_IDS.book)!;
    const book: LookupResult = { source: 'openlibrary', sourceId: 'OL17267881W', name: '三体', year: 2008, image: 'https://covers.openlibrary.org/b/id/9157544-L.jpg', fields: { author: '刘慈欣' }, url: 'https://openlibrary.org/works/OL17267881W' };
    const importImage = vi.fn(async () => 'asset-1');
    const { id } = createItemFromLookup(store, type, book, { fetchItem: async () => book, importImage });
    await flush();
    await flush();
    expect(importImage).not.toHaveBeenCalled();
    expect(store.get('library_item', id)).toMatchObject({ name: '三体', image: null, fields: { author: '刘慈欣', [SOURCE_KEY]: 'openlibrary:OL17267881W' } });
  });

  it('书按 ISBN 取那一版：source=isbn；选中后建的资料带出版社、ISBN，补详情按这一版（OL…M）取', async () => {
    const f = vi.fn(async () => Response.json({}));
    await fetchLookupItem('isbn', '9787536692930', undefined, f as unknown as typeof fetch);
    expect(String((f.mock.calls[0] as unknown[])[0])).toMatch(/\/api\/lookup\/item\?source=isbn&id=9787536692930&lang=zh$/);
    const store = await Store.open(new MemoryAdapter());
    const type = store.get('task_type', BUILTIN_TYPE_IDS.book)!;
    const ed: LookupResult = { source: 'openlibrary', sourceId: 'OL25840916M', name: '三体', year: 2008, fields: { author: '刘慈欣', publisher: 'Chongqing Press', year: 2008, isbn: '9787536692930', total_pages: 302 }, url: 'https://openlibrary.org/books/OL25840916M' };
    const fetchItem = vi.fn(async () => ed);
    const { id } = createItemFromLookup(store, type, ed, { fetchItem, importImage: async () => 'asset-1' });
    await flush();
    await flush();
    expect(fetchItem).toHaveBeenCalledWith('openlibrary', 'OL25840916M');
    expect(store.get('library_item', id)).toMatchObject({ image: null, fields: { publisher: 'Chongqing Press', isbn: '9787536692930', total_pages: 302 } });
  });

  it('搜索带上 media 与 alt', async () => {
    const f = vi.fn(async () => Response.json({ results: [], sources: [] }));
    await searchOnline('movie', '末日', undefined, f as unknown as typeof fetch, { media: 'movie', alt: ['Doomsday'] });
    expect(String((f.mock.calls[0] as unknown[])[0])).toMatch(/\/api\/lookup\/search\?kind=movie&q=%E6%9C%AB%E6%97%A5&lang=zh&media=movie&alt=Doomsday$/);
    // 所有来源都失败（如 503）但带 sources：照样返回，界面按来源显示
    const g = vi.fn(async () => Response.json({ results: [], sources: [{ source: 'tmdb', status: 'unconfigured', code: 503 }] }, { status: 503 }));
    expect((await searchOnline('movie', 'x', undefined, g as unknown as typeof fetch)).sources[0]!.status).toBe('unconfigured');
  });
});
