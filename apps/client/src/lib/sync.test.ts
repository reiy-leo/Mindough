import { describe, expect, it, vi } from 'vitest';
import { SyncHttpError } from '@mindough/core';
import { TokenSource, httpTransport } from './sync';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const future = () => new Date(Date.now() + 3600_000).toISOString();

describe('同步凭据与传输层', () => {
  it('凭据缓存到快过期；force 时重新取；401 报「401 未登录」', async () => {
    let n = 0;
    const f = vi.fn(async () => json(200, { url: 'https://x/api/sync', token: `t${++n}`, expires_at: future() }));
    const ts = new TokenSource(f as unknown as typeof fetch);
    expect((await ts.get()).token).toBe('t1');
    expect((await ts.get()).token).toBe('t1');
    expect((await ts.get(true)).token).toBe('t2');
    const denied = new TokenSource((async () => json(401, { error: '401 未登录' })) as unknown as typeof fetch);
    await expect(denied.get()).rejects.toMatchObject({ status: 401, message: expect.stringContaining('401 未登录') });
  });

  it('推送被拒（401）时换新凭据重试一次', async () => {
    let n = 0;
    const tokens = new TokenSource((async () => json(200, { url: 'https://x/api/sync', token: `t${++n}`, expires_at: future() })) as unknown as typeof fetch);
    const seen: string[] = [];
    const f = vi.fn(async (_url: string, init: RequestInit) => {
      const auth = new Headers(init.headers).get('authorization')!;
      seen.push(auth);
      return auth === 'Bearer t1' ? json(401, { error: '401 未登录' }) : json(200, { applied: 1 });
    });
    const tr = httpTransport(tokens, f as unknown as typeof fetch);
    expect(await tr.push([])).toEqual({ applied: 1 });
    expect(seen).toEqual(['Bearer t1', 'Bearer t2']);
    expect(f.mock.calls[0]![0]).toBe('https://x/api/sync/push');
  });

  it('断网 → SyncHttpError(0)；其他错误带状态码与中文说明', async () => {
    const tokens = new TokenSource((async () => json(200, { url: 'https://x/api/sync', token: 't', expires_at: future() })) as unknown as typeof fetch);
    const offline = httpTransport(tokens, (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch);
    await expect(offline.pull(0, 10)).rejects.toSatisfy((e: unknown) => e instanceof SyncHttpError && e.offline);
    const bad = httpTransport(tokens, (async () => json(502, { error: '502 网关错误：连不上同步数据库' })) as unknown as typeof fetch);
    await expect(bad.pull(0, 10)).rejects.toMatchObject({ status: 502, message: '502 网关错误：连不上同步数据库' });
  });
});
