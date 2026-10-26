/**
 * 真实请求 Open Library、Steam（不要密钥）；有 TMDB_API_KEY 时也试 TMDB。平时跳过；手动跑：
 *   E2E_LOOKUP=1 npx vitest run e2e/real-lookup.test.ts
 *   E2E_LOOKUP=1 TMDB_API_KEY=… npx vitest run e2e/real-lookup.test.ts
 */
import { describe, expect, it } from 'vitest';
import { lookupItem, lookupSearch } from '../src/lookup';
import { handle } from '../src/index';
import { sign } from '../src/session';
import type { AssetBucket } from '../src/assets';

const on = !!process.env.E2E_LOOKUP;
const env = { TMDB_API_KEY: process.env.TMDB_API_KEY };

describe.skipIf(!on)('真实来源', () => {
  it('Open Library：三体', async () => {
    const { status, body } = await lookupSearch(env, 'book', '三体', 'zh');
    expect(status).toBe(200);
    const hit = body.results.find((r) => r.name.includes('三体'))!;
    expect(hit).toBeTruthy();
    expect(hit.fields.author).toContain('刘慈欣');
    const item = await lookupItem(env, 'openlibrary', hit.sourceId, 'zh');
    expect(item.name).toBe(hit.name);
    expect(item.image).toBeUndefined(); // 书的封面纯手填
    console.log('openlibrary', JSON.stringify(item));
  }, 30000);

  it('Open Library 按 ISBN：三体（重庆出版社 2008）', async () => {
    const item = await lookupItem(env, 'isbn', '978-7-5366-9293-0', 'zh');
    console.log('isbn', JSON.stringify(item));
    expect(item.sourceId).toMatch(/^OL\d+M$/);
    expect(item.fields.isbn).toBe('9787536692930');
    expect(item.fields.author).toBe('刘慈欣');
    expect(item.fields.publisher).toBeTruthy();
    expect(item.image).toBeUndefined();
  }, 30000);

  it('Steam：艾尔登法环（中文）/ Elden Ring（英文）', async () => {
    const zh = await lookupSearch(env, 'game', 'elden ring', 'zh');
    expect(zh.body.results[0]?.name).toBe('艾尔登法环');
    const item = await lookupItem(env, 'steam', zh.body.results[0]!.sourceId, 'zh');
    expect(item.fields.platform).toContain('PC（Steam）');
    expect(item.year).toBe(2022);
    const en = await lookupItem(env, 'steam', '1245620', 'en');
    expect(en.name).toMatch(/ELDEN RING/i);
    console.log('steam', JSON.stringify(item));
  }, 30000);

  it('豆瓣：拿不到就降级，不报错', async () => {
    const { body } = await lookupSearch({}, 'movie', '沙丘', 'zh');
    const tmdb = body.sources.find((s) => s.source === 'tmdb')!;
    expect(tmdb.status).toBe('unconfigured');
    expect(tmdb.code).toBe(503);
    console.log('douban', JSON.stringify(body.sources.find((s) => s.source === 'douban')), body.results.length);
    try {
      console.log('douban item', JSON.stringify(await lookupItem({}, 'douban', '35575567', 'zh')));
      console.log('douban tv', JSON.stringify(await lookupItem({}, 'douban', '26302614', 'zh')));
    } catch (e) {
      console.log('douban item 降级', (e as Error).message);
    }
  }, 30000);

  it.skipIf(!env.TMDB_API_KEY)('TMDB：沙丘2 + 按 IMDb 编号取', async () => {
    const { body } = await lookupSearch(env, 'movie', '沙丘2', 'zh', 'tmdb');
    expect(body.results.length).toBeGreaterThan(0);
    const item = await lookupItem(env, 'imdb', 'tt15239678', 'zh');
    expect(item.fields.imdb).toBe('tt15239678');
  }, 30000);

  it('封面真的拉得进 R2（Steam、豆瓣带 Referer；书的封面纯手填，不拉 Open Library）', async () => {
    const data = new Map<string, ArrayBuffer>();
    const FILES: AssetBucket = { get: async () => null, head: async (k) => (data.has(k) ? {} : null), put: async (k, v) => (data.set(k, v), {}) };
    const SESSION_SECRET = 'e2e-secret';
    const auth = `Bearer ${await sign({ sub: 's', email: 'e2e@mindough.test', name: 'e', picture: null, exp: Date.now() + 60000 }, SESSION_SECRET)}`;
    for (const url of [
      'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1245620/header.jpg',
      'https://img9.doubanio.com/view/photo/l_ratio_poster/public/p2902227445.jpg',
    ]) {
      const res = await handle(new Request('https://app.mindough.rei8t.dev/api/lookup/image', { method: 'POST', headers: { authorization: auth }, body: JSON.stringify({ url }) }), { SESSION_SECRET, ALLOWED_EMAILS: 'e2e@mindough.test', FILES });
      const body = (await res.json()) as { size?: number; mime?: string; error?: string };
      console.log('image', url, res.status, body.mime, body.size, body.error ?? '');
      expect(res.status).toBe(200);
    }
  }, 60000);
});
