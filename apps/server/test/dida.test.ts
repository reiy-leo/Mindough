import { describe, expect, it, vi } from 'vitest';
import { handle, type Env } from '../src/index';
import { allowedDidaPath, handleDidaProxy } from '../src/dida';
import { sign } from '../src/session';

const ORIGIN = 'https://mindough.rei8t.dev';
const SECRET = 'test-secret-0123456789';
const env = (): Env => ({ SESSION_SECRET: SECRET, ALLOWED_EMAILS: 'reiy.leoz@gmail.com' });
const bearer = async () => `Bearer ${await sign({ sub: 's', email: 'reiy.leoz@gmail.com', name: 'Rei', picture: null, exp: Date.now() + 60_000 }, SECRET)}`;

async function call(path: string, init: RequestInit & { token?: string | null } = {}, f?: typeof fetch) {
  const headers = new Headers(init.headers);
  if (!headers.has('authorization')) headers.set('authorization', await bearer());
  if (init.token !== null) headers.set('x-dida-token', init.token ?? 'dp_test_token');
  const req = new Request(`${ORIGIN}/api/dida/${path}`, { ...init, headers });
  return handleDidaProxy(req, env(), new URL(req.url), f);
}

describe('/api/dida/* 滴答清单代理', () => {
  it('白名单：只放导入要用的只读路径', () => {
    expect(allowedDidaPath('GET', 'open/v1/project')).toBe(true);
    expect(allowedDidaPath('GET', 'open/v1/project/group')).toBe(true);
    expect(allowedDidaPath('GET', 'open/v1/project/inbox/data')).toBe(true);
    expect(allowedDidaPath('GET', 'open/v1/project/6226ff9877acee87727f6bca/data')).toBe(true);
    expect(allowedDidaPath('POST', 'open/v1/task/completed')).toBe(true);
    expect(allowedDidaPath('POST', 'open/v1/task/filter')).toBe(true);
    for (const [m, p] of [
      ['POST', 'open/v1/task'],
      ['GET', 'open/v1/project/../../x/data'],
      ['GET', 'open/v1/project/a%2Fb/data'],
      ['POST', 'open/v1/project/p1/task/t1/complete'],
      ['GET', 'oauth/token'],
      ['DELETE', 'open/v1/project/p1'],
    ] as const)
      expect(allowedDidaPath(m, p)).toBe(false);
  });

  it('转发：令牌放进 Authorization，路径、查询、JSON 体原样', async () => {
    const f = vi.fn(async (_u: string | URL | Request, _i?: RequestInit) => new Response('[{"id":"p1"}]', { status: 200 }));
    const res = await call('open/v1/task/completed', { method: 'POST', body: '{"startDate":"2026-01-01T00:00:00.000+0000"}' }, f as unknown as typeof fetch);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: 'p1' }]);
    const [u, i] = f.mock.calls[0]!;
    expect(u).toBe('https://api.dida365.com/open/v1/task/completed');
    expect((i!.headers as Record<string, string>).authorization).toBe('Bearer dp_test_token');
    expect(i!.body).toBe('{"startDate":"2026-01-01T00:00:00.000+0000"}');
    expect(i!.method).toBe('POST');
  });

  it('要登录 Mindough：401 未登录，不转发', async () => {
    const f = vi.fn();
    const req = new Request(`${ORIGIN}/api/dida/open/v1/project`, { headers: { 'x-dida-token': 't' } });
    const res = await handleDidaProxy(req, env(), new URL(req.url), f as unknown as typeof fetch);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe('401 未登录');
    expect(f).not.toHaveBeenCalled();
  });

  it('没带令牌 / 不在白名单 / 方法不对', async () => {
    expect((await call('open/v1/project', { token: null })).status).toBe(400);
    expect((await call('open/v1/task', { method: 'POST', body: '{}' })).status).toBe(404);
    expect((await call('open/v1/project', { method: 'DELETE' })).status).toBe(405);
    expect((await call('open/v1/task/filter', { method: 'POST', body: 'nope' })).status).toBe(400);
  });

  it('上游出错附中文说明：401 令牌不对、500 → 502、连不上 502', async () => {
    const r401 = await call('open/v1/project', {}, (async () => new Response('', { status: 401 })) as unknown as typeof fetch);
    expect(r401.status).toBe(401);
    expect(await r401.json()).toEqual({ error: '401 未授权：滴答清单的令牌不对或已经失效', upstream_status: 401 });
    const r500 = await call('open/v1/project', {}, (async () => new Response('', { status: 500 })) as unknown as typeof fetch);
    expect(r500.status).toBe(502);
    expect(await r500.json()).toMatchObject({ upstream_status: 500 });
    const down = await call('open/v1/project', {}, (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch);
    expect(down.status).toBe(502);
  });

  it('路由与 CORS：原生端可以带 x-dida-token', async () => {
    const res = await handle(new Request(`${ORIGIN}/api/dida/open/v1/project`, { method: 'OPTIONS', headers: { origin: 'tauri://localhost' } }), env());
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-headers')).toContain('x-dida-token');
    const r = await handle(new Request(`${ORIGIN}/api/dida/open/v1/task`, { method: 'POST' }), env());
    expect(r.status).toBe(404);
  });
});
