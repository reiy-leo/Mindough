import { describe, expect, it } from 'vitest';
import { contentType, serveFromR2, type R2Like } from '../src/static-r2';

const bucket = (files: Record<string, string>): R2Like => ({
  async get(key) {
    if (!(key in files)) return null;
    return { body: new Response(files[key]).body!, httpEtag: '"e"' };
  },
});

describe('serveFromR2', () => {
  const b = bucket({ 'index.html': '<html>', 'assets/a.js': 'x' });
  it('根路径回 index.html 并带跨源隔离头', async () => {
    const r = await serveFromR2(new Request('https://x/'), b);
    expect(r.status).toBe(200);
    expect(r.headers.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(r.headers.get('cross-origin-embedder-policy')).toBe('credentialless');
    expect(await r.text()).toBe('<html>');
  });
  it('单页路由回 index.html', async () => {
    expect(await (await serveFromR2(new Request('https://x/groups/1'), b)).text()).toBe('<html>');
  });
  it('静态资源长缓存，缺失时 404 未找到', async () => {
    const r = await serveFromR2(new Request('https://x/assets/a.js'), b);
    expect(r.headers.get('cache-control')).toContain('immutable');
    expect((await serveFromR2(new Request('https://x/assets/none.js'), b)).status).toBe(404);
  });
  it('类型', () => {
    expect(contentType('a.wasm')).toBe('application/wasm');
  });
});
