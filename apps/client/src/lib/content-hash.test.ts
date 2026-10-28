import { describe, expect, it, vi } from 'vitest';
import { checkExisting, sha256Hex } from './content-hash';

describe('上传前查重', () => {
  it('sha256Hex：内容的 SHA-256', async () => {
    expect(await sha256Hex(new Blob(['abc']))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('有 → 返回服务器给的；404 或问不通 → null', async () => {
    const hit = vi.fn(async (url: string) => new Response(JSON.stringify({ r2_key: 'k', url }), { status: 200 }));
    const r = await checkExisting<{ r2_key: string; url: string }>('files', new Blob(['abc']), hit as unknown as typeof fetch);
    expect(r?.r2_key).toBe('k');
    expect(r?.url).toContain('/api/files/check/ba7816bf');
    expect(await checkExisting('assets', new Blob(['x']), (async () => new Response('{}', { status: 404 })) as unknown as typeof fetch)).toBeNull();
    expect(await checkExisting('assets', new Blob(['x']), (async () => { throw new TypeError('net'); }) as unknown as typeof fetch)).toBeNull();
  });
});
