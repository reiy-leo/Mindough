import { describe, expect, it } from 'vitest';
import { handle, type Env } from '../src/index';
import { sign } from '../src/session';
import type { AssetBucket, R2Object } from '../src/assets';
import { MAX_FILE_BYTES, cleanMime, contentDisposition, ownerHash } from '../src/files';

const ORIGIN = 'https://mindough.rei8t.dev';
const SECRET = 'test-secret-0123456789';

class MemBucket implements AssetBucket {
  data = new Map<string, { buf: ArrayBuffer; type?: string }>();
  puts = 0;
  async get(key: string): Promise<R2Object | null> {
    const v = this.data.get(key);
    return v ? { body: new Response(v.buf).body!, httpMetadata: { contentType: v.type }, size: v.buf.byteLength } : null;
  }
  async head(key: string) {
    return this.data.has(key) ? {} : null;
  }
  async put(key: string, value: ArrayBuffer, opts?: { httpMetadata?: { contentType?: string } }) {
    this.puts++;
    this.data.set(key, { buf: value, type: opts?.httpMetadata?.contentType });
    return {};
  }
}

const envOf = (FILES?: MemBucket): Env => ({ SESSION_SECRET: SECRET, ALLOWED_EMAILS: 'reiy.leoz@gmail.com, other@example.com', ...(FILES ? { FILES } : {}) });
const bearer = async (email = 'reiy.leoz@gmail.com') => `Bearer ${await sign({ sub: 's', email, name: 'Rei', picture: null, exp: Date.now() + 60_000 }, SECRET)}`;

async function call(path: string, env: Env, init: RequestInit = {}, who: string | null = 'reiy.leoz@gmail.com') {
  const headers = new Headers(init.headers);
  if (who) headers.set('authorization', await bearer(who));
  return handle(new Request(ORIGIN + path, { ...init, headers }), env);
}

const upload = (env: Env, body: BodyInit, type: string, who?: string | null) => call('/api/files', env, { method: 'POST', body, headers: { 'content-type': type } }, who);

describe('附件 /api/files', () => {
  it('传上去：任何格式都收，key = 用户哈希/f/SHA-256，同内容同一个 key（重写一遍刷新上传时间）', async () => {
    const FILES = new MemBucket();
    const env = envOf(FILES);
    const pdf = new TextEncoder().encode('%PDF-1.7 hello');
    const res = await upload(env, pdf, 'application/pdf');
    expect(res.status).toBe(200);
    const up = (await res.json()) as { r2_key: string; sha256: string; mime: string; size: number };
    expect(up.r2_key).toMatch(/^[0-9a-f]{16}\/f\/[0-9a-f]{64}$/);
    expect(up.r2_key.startsWith(await ownerHash('reiy.leoz@gmail.com'))).toBe(true);
    expect(up).toMatchObject({ mime: 'application/pdf', size: pdf.byteLength });
    const again = (await (await upload(env, pdf, 'application/pdf')).json()) as { r2_key: string };
    expect(again.r2_key).toBe(up.r2_key);
    expect(FILES.puts).toBe(2);
    expect(FILES.data.size).toBe(1);
    // 怪的 content-type 存成 octet-stream
    const odd = (await (await upload(env, new Uint8Array([1, 2, 3]), 'not a mime')).json()) as { mime: string };
    expect(odd.mime).toBe('application/octet-stream');
  });

  it('没登录 401 未登录；空文件 400；超过 50 MB 413；没配 R2 503；GET 以外 405', async () => {
    const env = envOf(new MemBucket());
    expect((await upload(env, new Uint8Array([1]), 'text/plain', null)).status).toBe(401);
    expect((await upload(env, new Uint8Array(0), 'text/plain')).status).toBe(400);
    const big = await upload(env, new Uint8Array(1), 'text/plain').then(() =>
      call('/api/files', env, { method: 'POST', body: new Uint8Array(MAX_FILE_BYTES + 1), headers: { 'content-type': 'application/zip' } }),
    );
    expect(big.status).toBe(413);
    expect(((await big.json()) as { error: string }).error).toContain('413 内容太大');
    expect((await upload(envOf(), new Uint8Array([1]), 'text/plain')).status).toBe(503);
    expect((await call('/api/files', env, { method: 'PUT', body: 'x' })).status).toBe(405);
  });

  it('读：要登录、只能读自己的（别人的 key 404）；图片 inline，其余 attachment 带原文件名', async () => {
    const FILES = new MemBucket();
    const env = envOf(FILES);
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]);
    const img = (await (await upload(env, png, 'image/png')).json()) as { r2_key: string };
    const doc = (await (await upload(env, new TextEncoder().encode('<script>alert(1)</script>'), 'text/html')).json()) as { r2_key: string };

    const g = await call(`/api/files/${img.r2_key}`, env);
    expect(g.status).toBe(200);
    expect(g.headers.get('content-type')).toBe('image/png');
    expect(g.headers.get('content-disposition')).toBe('inline');
    expect(g.headers.get('cache-control')).toContain('private');
    expect(new Uint8Array(await g.arrayBuffer())).toEqual(png);

    const d = await call(`/api/files/${doc.r2_key}?name=${encodeURIComponent('报告 v2.html')}`, env);
    expect(d.headers.get('content-disposition')).toBe(`attachment; filename="__ v2.html"; filename*=UTF-8''${encodeURIComponent('报告 v2.html')}`);
    expect(d.headers.get('x-content-type-options')).toBe('nosniff');
    expect(d.headers.get('content-security-policy')).toContain('sandbox');
    // dl=1：图片也下载
    expect((await call(`/api/files/${img.r2_key}?dl=1&name=a.png`, env)).headers.get('content-disposition')).toMatch(/^attachment;/);

    expect((await call(`/api/files/${img.r2_key}`, env, {}, null)).status).toBe(401);
    expect((await call(`/api/files/${img.r2_key}`, env, {}, 'other@example.com')).status).toBe(404);
    expect((await call('/api/files/../../etc', env)).status).toBe(404);
    expect((await call(`/api/files/${img.r2_key.replace(/.$/, img.r2_key.endsWith('0') ? '1' : '0')}`, env)).status).toBe(404);
  });

  it('cleanMime / contentDisposition', () => {
    expect(cleanMime('Image/PNG; charset=x')).toBe('image/png');
    expect(cleanMime('')).toBe('application/octet-stream');
    expect(cleanMime('a/b/c')).toBe('application/octet-stream');
    expect(contentDisposition('inline', null)).toBe('inline');
    expect(contentDisposition('attachment', 'a"b\r\n.txt')).toBe(`attachment; filename="a_b__.txt"; filename*=UTF-8''a_b__.txt`);
    expect(contentDisposition('attachment', "it's (1).pdf")).toContain("filename*=UTF-8''it%27s%20%281%29.pdf");
  });
});
