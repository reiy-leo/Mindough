import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handle, type Env } from '../src/index';
import { GOOGLE_TOKEN_URL, GOOGLE_USERINFO_URL, safeReturnTo, withLoginError } from '../src/auth';
import { sign, verify } from '../src/session';

const ORIGIN = 'https://mindough.rei8t.dev';
const env: Env = {
  GOOGLE_CLIENT_ID: 'cid',
  GOOGLE_CLIENT_SECRET: 'csecret',
  SESSION_SECRET: 'test-secret-0123456789',
  ALLOWED_EMAILS: 'reiy.leoz@gmail.com, Other@Example.com',
  APP_ORIGINS: 'http://localhost:1420',
};

const req = (path: string, init: RequestInit & { cookie?: string } = {}) => {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set('cookie', init.cookie);
  return new Request(ORIGIN + path, { ...init, headers });
};

/** 从 set-cookie 里取出 name=value。 */
function cookieFrom(res: Response, name: string): string | null {
  const all = res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie') ?? ''];
  for (const c of all) {
    const m = c.match(new RegExp(`(?:^|, )${name}=([^;]*)`));
    if (m) return decodeURIComponent(m[1]!);
  }
  return null;
}

/** 模拟 Google：token 交换 + userinfo。 */
function mockGoogle(info: Record<string, unknown>, opts: { tokenOk?: boolean } = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === GOOGLE_TOKEN_URL) {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get('code')).toBe('the-code');
      expect(body.get('client_secret')).toBe('csecret');
      expect(body.get('redirect_uri')).toBe(`${ORIGIN}/auth/callback`);
      return opts.tokenOk === false ? new Response('{"error":"invalid_grant"}', { status: 400 }) : Response.json({ access_token: 'at', id_token: 'x' });
    }
    if (url === GOOGLE_USERINFO_URL) {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer at');
      return Response.json(info);
    }
    throw new Error(`没想到的请求：${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** 走一遍 /auth/login，拿到 state 与 oauth cookie。 */
async function startLogin(returnTo = '/#/settings') {
  const res = await handle(req(`/auth/login?return_to=${encodeURIComponent(returnTo)}`), env);
  expect(res.status).toBe(302);
  const loc = new URL(res.headers.get('location')!);
  return { loc, state: loc.searchParams.get('state')!, oauth: cookieFrom(res, 'md_oauth')! };
}

async function callback(qs: string, oauth: string | null) {
  return handle(req(`/auth/callback?${qs}`, oauth ? { cookie: `md_oauth=${encodeURIComponent(oauth)}` } : {}), env);
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe('会话签名', () => {
  it('签名能验、改一个字节就失效、过期失效', async () => {
    const t = await sign({ a: 1, exp: Date.now() + 1000 }, 's');
    expect(await verify(t, 's')).toMatchObject({ a: 1 });
    expect(await verify(t, 'other')).toBeNull();
    expect(await verify(t.slice(0, -2) + 'xx', 's')).toBeNull();
    expect(await verify(await sign({ exp: Date.now() - 1 }, 's'), 's')).toBeNull();
    expect(await verify('垃圾', 's')).toBeNull();
  });
});

describe('return_to 与 login_error', () => {
  const u = new URL(ORIGIN);
  it('只允许本站路径与 APP_ORIGINS', () => {
    expect(safeReturnTo('/#/settings', u, env)).toBe('/#/settings');
    expect(safeReturnTo('//evil.com', u, env)).toBe('/');
    expect(safeReturnTo('https://evil.com/x', u, env)).toBe('/');
    expect(safeReturnTo('http://localhost:1420/#/settings', u, env)).toBe('http://localhost:1420/#/settings');
  });
  it('login_error 放在 # 之前', () => {
    expect(withLoginError('/#/settings', 'not_allowed')).toBe('/?login_error=not_allowed#/settings');
    expect(withLoginError('/?a=1', 'access_denied')).toBe('/?a=1&login_error=access_denied');
  });
});

describe('/auth/login', () => {
  it('302 到 Google，带 client_id、回调地址、openid email profile 与 state；state 存在签名 cookie', async () => {
    const { loc, state, oauth } = await startLogin();
    expect(loc.origin + loc.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(loc.searchParams.get('client_id')).toBe('cid');
    expect(loc.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/auth/callback`);
    expect(loc.searchParams.get('scope')).toBe('openid email profile');
    expect(state.length).toBeGreaterThan(20);
    expect(await verify<{ state: string; exp: number }>(oauth, env.SESSION_SECRET!)).toMatchObject({ state, return_to: '/#/settings' });
  });

  it('没配置 Google 时回到原页并带 login_error=config_missing', async () => {
    const res = await handle(req('/auth/login?return_to=/%23/settings'), { ALLOWED_EMAILS: 'a@b.c' });
    expect(res.headers.get('location')).toBe('/?login_error=config_missing#/settings');
  });
});

describe('/auth/callback', () => {
  it('白名单内：设会话 cookie，回到 return_to；/api/me 返回账户', async () => {
    mockGoogle({ sub: '1', email: 'reiy.leoz@gmail.com', email_verified: true, name: 'Rei', picture: 'https://p/x.png' });
    const { state, oauth } = await startLogin();
    const res = await callback(`code=the-code&state=${state}`, oauth);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/#/settings');
    const session = cookieFrom(res, 'md_session')!;
    expect(session).toBeTruthy();
    expect(res.headers.getSetCookie().find((c) => c.startsWith('md_session='))).toMatch(/HttpOnly; SameSite=Lax; Secure/);
    const me = await handle(req('/api/me', { cookie: `md_session=${encodeURIComponent(session)}` }), env);
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({ user: { email: 'reiy.leoz@gmail.com', name: 'Rei', picture: 'https://p/x.png' } });
  });

  it('白名单大小写不敏感', async () => {
    mockGoogle({ sub: '2', email: 'other@example.com', email_verified: true });
    const { state, oauth } = await startLogin('/');
    const res = await callback(`code=the-code&state=${state}`, oauth);
    expect(res.headers.get('location')).toBe('/');
    expect(cookieFrom(res, 'md_session')).toBeTruthy();
  });

  it('不在白名单：not_allowed，不发会话', async () => {
    mockGoogle({ sub: '3', email: 'stranger@gmail.com', email_verified: true });
    const { state, oauth } = await startLogin();
    const res = await callback(`code=the-code&state=${state}`, oauth);
    expect(res.headers.get('location')).toBe('/?login_error=not_allowed#/settings');
    expect(cookieFrom(res, 'md_session')).toBeNull();
  });

  it('白名单为空 = 谁都不能登录', async () => {
    mockGoogle({ sub: '1', email: 'reiy.leoz@gmail.com', email_verified: true });
    const { state, oauth } = await startLogin();
    const res = await handle(req(`/auth/callback?code=the-code&state=${state}`, { cookie: `md_oauth=${encodeURIComponent(oauth)}` }), { ...env, ALLOWED_EMAILS: ' , ' });
    expect(res.headers.get('location')).toContain('login_error=not_allowed');
  });

  it('邮箱未验证：email_unverified', async () => {
    mockGoogle({ sub: '1', email: 'reiy.leoz@gmail.com', email_verified: false });
    const { state, oauth } = await startLogin();
    expect((await callback(`code=the-code&state=${state}`, oauth)).headers.get('location')).toContain('login_error=email_unverified');
  });

  it('state 不对或没有 oauth cookie：state_mismatch，不请求 Google', async () => {
    const f = mockGoogle({});
    const { oauth } = await startLogin();
    expect((await callback('code=the-code&state=wrong', oauth)).headers.get('location')).toContain('login_error=state_mismatch');
    expect((await callback('code=the-code&state=x', null)).headers.get('location')).toBe('/?login_error=state_mismatch');
    expect(f).not.toHaveBeenCalled();
  });

  it('用户在 Google 页面点了取消：access_denied', async () => {
    const { state, oauth } = await startLogin();
    expect((await callback(`error=access_denied&state=${state}`, oauth)).headers.get('location')).toBe('/?login_error=access_denied#/settings');
  });

  it('换 token 失败：token_exchange_failed', async () => {
    mockGoogle({}, { tokenOk: false });
    const { state, oauth } = await startLogin();
    expect((await callback(`code=the-code&state=${state}`, oauth)).headers.get('location')).toContain('login_error=token_exchange_failed');
  });
});

describe('/api 与 /auth/logout', () => {
  async function loggedInCookie(email = 'reiy.leoz@gmail.com') {
    const s = await sign({ sub: '1', email, name: 'Rei', picture: null, exp: Date.now() + 60_000 }, env.SESSION_SECRET!);
    return `md_session=${encodeURIComponent(s)}`;
  }

  it('/api/me 未登录：401 未登录；伪造 / 过期 / 已移出白名单的会话也是 401', async () => {
    expect((await handle(req('/api/me'), env)).status).toBe(401);
    expect(await (await handle(req('/api/me'), env)).json()).toEqual({ error: '401 未登录' });
    expect((await handle(req('/api/me', { cookie: 'md_session=abc.def' }), env)).status).toBe(401);
    const expired = await sign({ sub: '1', email: 'reiy.leoz@gmail.com', exp: Date.now() - 1 }, env.SESSION_SECRET!);
    expect((await handle(req('/api/me', { cookie: `md_session=${encodeURIComponent(expired)}` }), env)).status).toBe(401);
    expect((await handle(req('/api/me', { cookie: await loggedInCookie('removed@x.com') }), env)).status).toBe(401);
  });

  it('POST /api/sync/token：未登录 401；登录后 501 未实现；GET 405', async () => {
    expect((await handle(req('/api/sync/token', { method: 'POST' }), env)).status).toBe(401);
    const res = await handle(req('/api/sync/token', { method: 'POST', cookie: await loggedInCookie() }), env);
    expect(res.status).toBe(501);
    expect((await res.json()) as { error: string }).toEqual({ error: expect.stringContaining('501 未实现') });
    expect((await handle(req('/api/sync/token'), env)).status).toBe(405);
  });

  it('/auth/logout：清掉会话 cookie（GET 跳回、POST 返回 JSON）', async () => {
    const g = await handle(req('/auth/logout?return_to=/%23/settings', { cookie: await loggedInCookie() }), env);
    expect(g.status).toBe(302);
    expect(g.headers.get('location')).toBe('/#/settings');
    expect(g.headers.get('set-cookie')).toMatch(/md_session=; .*Max-Age=0/);
    const p = await handle(req('/auth/logout', { method: 'POST' }), env);
    expect(p.status).toBe(200);
    expect(p.headers.get('set-cookie')).toMatch(/Max-Age=0/);
  });

  it('未知 /api 路径 404；健康检查', async () => {
    expect((await handle(req('/api/nope'), env)).status).toBe(404);
    expect(await (await handle(req('/api/health'), env)).json()).toMatchObject({ ok: true });
  });

  it('其他路径交给静态资源', async () => {
    const assets = { fetch: vi.fn(async () => new Response('<html>')) };
    const res = await handle(req('/'), { ...env, ASSETS: assets });
    expect(await res.text()).toBe('<html>');
  });
});
