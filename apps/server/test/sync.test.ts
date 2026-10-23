import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handle, type Env } from '../src/index';
import { GOOGLE_TOKEN_URL, GOOGLE_USERINFO_URL } from '../src/auth';
import { sign } from '../src/session';
import { resetSchemaCache } from '../src/sync';
import { sha256b64url } from '../src/native';
import type { AssetBucket } from '../src/assets';
import { FakeTurso } from './fake-turso';

const ORIGIN = 'https://mindough.rei8t.dev';
let turso: FakeTurso;
let env: Env;

class FakeR2 implements AssetBucket {
  objects = new Map<string, { buf: ArrayBuffer; type?: string }>();
  async get(key: string) {
    const o = this.objects.get(key);
    return o ? { body: new Response(o.buf).body!, httpMetadata: { contentType: o.type }, size: o.buf.byteLength } : null;
  }
  async head(key: string) {
    return this.objects.has(key) ? {} : null;
  }
  async put(key: string, value: ArrayBuffer, opts?: { httpMetadata?: { contentType?: string } }) {
    this.objects.set(key, { buf: value, type: opts?.httpMetadata?.contentType });
    return {};
  }
}

beforeEach(() => {
  turso = new FakeTurso();
  resetSchemaCache();
  env = {
    GOOGLE_CLIENT_ID: 'cid',
    GOOGLE_CLIENT_SECRET: 'csecret',
    SESSION_SECRET: 'test-secret-0123456789',
    ALLOWED_EMAILS: 'reiy.leoz@gmail.com, other@example.com',
    TURSO_DB_URL: turso.url.replace('https://', 'libsql://'),
    TURSO_DB_TOKEN: turso.token,
    FILES: new FakeR2(),
  };
  vi.stubGlobal('fetch', turso.fetch);
});
afterEach(() => vi.unstubAllGlobals());

const req = (path: string, init: Omit<RequestInit, 'body'> & { cookie?: string; bearer?: string; body?: unknown } = {}) => {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set('cookie', init.cookie);
  if (init.bearer) headers.set('authorization', `Bearer ${init.bearer}`);
  const body = init.body === undefined || typeof init.body === 'string' || init.body instanceof ArrayBuffer ? (init.body as BodyInit | undefined) : JSON.stringify(init.body);
  return new Request(ORIGIN + path, { ...init, headers, body });
};

async function session(email = 'reiy.leoz@gmail.com') {
  return sign({ sub: '1', email, name: 'Rei', picture: null, exp: Date.now() + 60_000 }, env.SESSION_SECRET!);
}
const cookie = async (email?: string) => `md_session=${encodeURIComponent(await session(email))}`;

async function syncToken(email?: string): Promise<string> {
  const res = await handle(req('/api/sync/token', { method: 'POST', cookie: await cookie(email) }), env);
  expect(res.status).toBe(200);
  return ((await res.json()) as { token: string }).token;
}

const row = (id: string, updated_at: string, extra: Record<string, unknown> = {}, table = 'task') => ({
  table,
  id,
  updated_at,
  deleted: false,
  row: { id, updated_at, deleted: false, body_md: id, ...extra },
});

async function push(token: string, rows: unknown[]) {
  return handle(req('/api/sync/push', { method: 'POST', bearer: token, body: { rows } }), env);
}
async function pull(token: string, cursor = 0, limit = 500) {
  const res = await handle(req('/api/sync/pull', { method: 'POST', bearer: token, body: { cursor, limit } }), env);
  return { status: res.status, body: (await res.json()) as { rows: Array<Record<string, any>>; cursor: number; more: boolean } };
}

describe('POST /api/sync/token', () => {
  it('已登录、在白名单：200 { url, token, expires_at }（约 1 小时）', async () => {
    const res = await handle(req('/api/sync/token', { method: 'POST', cookie: await cookie() }), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string; token: string; expires_at: string };
    expect(body.url).toBe(`${ORIGIN}/api/sync`);
    expect(body.token.split('.')).toHaveLength(2);
    const ttl = new Date(body.expires_at).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(50 * 60_000);
    expect(ttl).toBeLessThanOrEqual(3600_000);
    // 数据库凭据不出 Worker
    expect(JSON.stringify(body)).not.toContain(turso.token);
  });

  it('未登录 401 未登录；会话有效但不在白名单 403 无权限', async () => {
    const a = await handle(req('/api/sync/token', { method: 'POST' }), env);
    expect(a.status).toBe(401);
    expect(await a.json()).toEqual({ error: '401 未登录' });
    const b = await handle(req('/api/sync/token', { method: 'POST', cookie: await cookie('stranger@x.com') }), env);
    expect(b.status).toBe(403);
    expect(((await b.json()) as { error: string }).error).toContain('403 无权限');
  });

  it('原生端用 Bearer 会话也能取', async () => {
    const res = await handle(req('/api/sync/token', { method: 'POST', bearer: await session() }), env);
    expect(res.status).toBe(200);
  });

  it('同步凭据不能当会话用，会话也不能当同步凭据用', async () => {
    const t = await syncToken();
    expect((await handle(req('/api/me', { bearer: t }), env)).status).toBe(401);
    expect((await handle(req('/api/sync/token', { method: 'POST', bearer: t }), env)).status).toBe(401);
    expect((await push(await session(), [])).status).toBe(401);
  });
});

describe('push / pull', () => {
  it('推上去再拉下来；第一次用到时自动建表', async () => {
    const t = await syncToken();
    const p = await push(t, [row('a', '0000000001000-0000-devA'), row('b', '0000000001000-0001-devA')]);
    expect(p.status).toBe(200);
    expect(await p.json()).toEqual({ applied: 2 });
    const { status, body } = await pull(t);
    expect(status).toBe(200);
    expect(body.rows.map((r) => [r.table, r.id, r.seq])).toEqual([
      ['task', 'a', 1],
      ['task', 'b', 2],
    ]);
    expect(body.rows[0]!.row).toMatchObject({ id: 'a', body_md: 'a', deleted: false });
    expect(body.cursor).toBe(2);
    expect(body.more).toBe(false);
  });

  it('行级 LWW：旧的推不上去，新的覆盖并拿到新的 seq；相等不算', async () => {
    const t = await syncToken();
    await push(t, [row('a', '0000000002000-0000-devB', { body_md: '新' })]);
    expect(await (await push(t, [row('a', '0000000001000-0000-devA', { body_md: '旧' })])).json()).toEqual({ applied: 0 });
    expect(await (await push(t, [row('a', '0000000002000-0000-devB', { body_md: '新' })])).json()).toEqual({ applied: 0 });
    const r1 = await pull(t);
    expect(r1.body.rows).toHaveLength(1);
    expect(r1.body.rows[0]!.row.body_md).toBe('新');
    await push(t, [{ ...row('a', '0000000003000-0000-devA'), deleted: true }]);
    const r2 = await pull(t, r1.body.cursor);
    expect(r2.body.rows).toHaveLength(1);
    expect(r2.body.rows[0]).toMatchObject({ id: 'a', deleted: true, seq: 2 });
    expect(r2.body.rows[0]!.row.deleted).toBe(true);
  });

  it('按游标分页：more 与 cursor', async () => {
    const t = await syncToken();
    await push(
      t,
      Array.from({ length: 5 }, (_, i) => row(`r${i}`, `000000000100${i}-0000-devA`)),
    );
    const p1 = await pull(t, 0, 2);
    expect(p1.body.rows.map((r) => r.id)).toEqual(['r0', 'r1']);
    expect(p1.body.more).toBe(true);
    const p2 = await pull(t, p1.body.cursor, 2);
    const p3 = await pull(t, p2.body.cursor, 2);
    expect([...p2.body.rows, ...p3.body.rows].map((r) => r.id)).toEqual(['r2', 'r3', 'r4']);
    expect(p3.body.more).toBe(false);
    const p4 = await pull(t, p3.body.cursor, 2);
    expect(p4.body).toEqual({ rows: [], cursor: p3.body.cursor, more: false });
  });

  it('按用户隔离：别人的行拉不到，seq 各自从 1 开始', async () => {
    const a = await syncToken('reiy.leoz@gmail.com');
    const b = await syncToken('other@example.com');
    await push(a, [row('x', '0000000001000-0000-devA')]);
    await push(b, [row('x', '0000000001000-0000-devZ', { body_md: 'B 的' })]);
    expect((await pull(a)).body.rows.map((r) => [r.id, r.row.body_md, r.seq])).toEqual([['x', 'x', 1]]);
    expect((await pull(b)).body.rows.map((r) => [r.id, r.row.body_md, r.seq])).toEqual([['x', 'B 的', 1]]);
  });

  it('凭据：没有 / 伪造 / 过期 401；签发后被移出白名单 403', async () => {
    expect((await handle(req('/api/sync/pull', { method: 'POST', body: { cursor: 0 } }), env)).status).toBe(401);
    expect((await pull('abc.def')).status).toBe(401);
    const expired = await sign({ k: 'sync', email: 'reiy.leoz@gmail.com', exp: Date.now() - 1 }, env.SESSION_SECRET!);
    expect((await pull(expired)).status).toBe(401);
    const t = await syncToken();
    env.ALLOWED_EMAILS = 'other@example.com';
    expect((await pull(t)).status).toBe(403);
  });

  it('请求有误 400：不是 JSON、行格式不对、太多行；GET 405', async () => {
    const t = await syncToken();
    expect((await handle(req('/api/sync/push', { method: 'POST', bearer: t, body: '{' }), env)).status).toBe(400);
    expect((await push(t, [{ table: 'Task; DROP', id: 'a', updated_at: 'x', row: {} }])).status).toBe(400);
    expect((await push(t, Array.from({ length: 501 }, (_, i) => row(`r${i}`, 'x')))).status).toBe(400);
    expect((await handle(req('/api/sync/pull', { method: 'POST', bearer: t, body: { cursor: -1 } }), env)).status).toBe(400);
    expect((await handle(req('/api/sync/pull', { bearer: t }), env)).status).toBe(405);
  });

  it('同步数据库出错：502 网关错误（带中文说明）', async () => {
    const t = await syncToken();
    turso.broken = true;
    const res = await push(t, [row('a', '0000000001000-0000-devA')]);
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toContain('502 网关错误');
  });
});

describe('CORS（原生端 WebView）', () => {
  it('tauri://localhost 预检 204 并带允许头；不认识的源不带', async () => {
    const pre = await handle(req('/api/sync/pull', { method: 'OPTIONS', headers: { origin: 'tauri://localhost' } }), env);
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe('tauri://localhost');
    expect(pre.headers.get('access-control-allow-headers')).toContain('authorization');
    const evil = await handle(req('/api/health', { headers: { origin: 'https://evil.example' } }), env);
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
    const ok = await handle(req('/api/health', { headers: { origin: 'http://tauri.localhost' } }), env);
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://tauri.localhost');
  });
});

describe('原生端登录（deep link + 一次性登录码）', () => {
  const verifier = 'v'.repeat(20) + '-0123456789abcdefghijklmnopqrstuvwxyz';

  async function nativeLogin(email = 'reiy.leoz@gmail.com') {
    const challenge = await sha256b64url(verifier);
    const start = await handle(req(`/auth/login?native=1&challenge=${challenge}`), env);
    expect(start.status).toBe(302);
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    const oauth = start.headers.get('set-cookie')!.match(/md_oauth=([^;]*)/)![1]!;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === GOOGLE_TOKEN_URL) return Response.json({ access_token: 'at' });
      if (url === GOOGLE_USERINFO_URL) return Response.json({ sub: '42', email, email_verified: true, name: 'Rei', picture: null });
      return turso.fetch(input, init);
    });
    const cb = await handle(req(`/auth/callback?code=c&state=${state}`, { cookie: `md_oauth=${oauth}` }), env);
    vi.stubGlobal('fetch', turso.fetch);
    return cb;
  }

  it('登录成功：结果页跳回 mindough://auth?code=…，用 verifier 换到会话；码只能用一次', async () => {
    const cb = await nativeLogin();
    expect(cb.status).toBe(200);
    expect(cb.headers.get('content-type')).toContain('text/html');
    const html = await cb.text();
    expect(html).toContain('已登录，回到思想团继续');
    const code = html.match(/mindough:\/\/auth\?code=([A-Za-z0-9_-]+)/)![1]!;
    expect(html).not.toContain('md_session');

    const wrong = await handle(req('/auth/exchange', { method: 'POST', body: { code, verifier: 'x'.repeat(43) } }), env);
    expect(wrong.status).toBe(400);
    const ex = await handle(req('/auth/exchange', { method: 'POST', body: { code, verifier } }), env);
    // 上一次用错 verifier 不会把码作废
    expect(ex.status).toBe(200);
    const body = (await ex.json()) as { session: string; user: { email: string } };
    expect(body.user.email).toBe('reiy.leoz@gmail.com');
    expect((await handle(req('/api/me', { bearer: body.session }), env)).status).toBe(200);
    expect((await handle(req('/api/sync/token', { method: 'POST', bearer: body.session }), env)).status).toBe(200);
    const again = await handle(req('/auth/exchange', { method: 'POST', body: { code, verifier } }), env);
    expect(again.status).toBe(400);
    expect(((await again.json()) as { error: string }).error).toContain('400 请求有误');
  });

  it('不在白名单：结果页带 login_error=not_allowed 跳回 app', async () => {
    const cb = await nativeLogin('stranger@x.com');
    expect(await cb.text()).toContain('mindough://auth?login_error=not_allowed');
  });

  it('没有 challenge 的 native=1 按 Web 登录处理', async () => {
    const res = await handle(req('/auth/login?native=1&return_to=/%23/settings'), env);
    const oauth = res.headers.get('set-cookie')!;
    expect(oauth).toContain('md_oauth=');
    expect(res.status).toBe(302);
  });
});

describe('图片（R2）', () => {
  it('登录后上传图片：返回地址，GET 能读回、长缓存；同内容只存一份', async () => {
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]).buffer;
    const up = await handle(req('/api/assets', { method: 'POST', cookie: await cookie(), headers: { 'content-type': 'image/png' }, body: png }), env);
    expect(up.status).toBe(200);
    const body = (await up.json()) as { url: string; r2_key: string; sha256: string };
    expect(body.url).toBe(`${ORIGIN}/api/assets/${body.r2_key}`);
    const again = await handle(req('/api/assets', { method: 'POST', bearer: await syncToken(), headers: { 'content-type': 'image/png' }, body: png }), env);
    expect(((await again.json()) as { r2_key: string }).r2_key).toBe(body.r2_key);
    expect((env.FILES as FakeR2).objects.size).toBe(1);
    const get = await handle(req(`/api/assets/${body.r2_key}`), env);
    expect(get.status).toBe(200);
    expect(get.headers.get('content-type')).toBe('image/png');
    expect(get.headers.get('cache-control')).toContain('immutable');
    expect(new Uint8Array(await get.arrayBuffer())).toEqual(new Uint8Array(png));
  });

  it('未登录 401；不是图片 415；不存在 404', async () => {
    expect((await handle(req('/api/assets', { method: 'POST', headers: { 'content-type': 'image/png' }, body: 'x' }), env)).status).toBe(401);
    expect((await handle(req('/api/assets', { method: 'POST', cookie: await cookie(), headers: { 'content-type': 'text/html' }, body: 'x' }), env)).status).toBe(415);
    expect((await handle(req(`/api/assets/${'0'.repeat(16)}/${'0'.repeat(64)}`), env)).status).toBe(404);
    expect((await handle(req('/api/assets/../../etc'), env)).status).toBe(404);
  });
});
