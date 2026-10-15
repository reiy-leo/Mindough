import { describe, expect, it, vi } from 'vitest';
import { fetchAccount, loginErrorText, takeLoginError } from './account';

function fakeLocation(url: string) {
  const u = new URL(url);
  const history = { state: { x: 1 }, replaceState: vi.fn() };
  return { loc: { pathname: u.pathname, search: u.search, hash: u.hash } as Location, history: history as unknown as History, spy: history.replaceState };
}

describe('登录错误参数', () => {
  it('取出 login_error 并立刻从地址栏去掉，保留其他参数与 hash 路由', () => {
    const { loc, history, spy } = fakeLocation('https://mindough.rei8t.dev/?skin=winui&login_error=not_allowed#/settings');
    expect(takeLoginError(loc, history)).toBe('not_allowed');
    expect(spy).toHaveBeenCalledWith({ x: 1 }, '', '/?skin=winui#/settings');
  });

  it('没有参数时什么都不做', () => {
    const { loc, history, spy } = fakeLocation('https://mindough.rei8t.dev/#/myday');
    expect(takeLoginError(loc, history)).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('错误代码有中文说明，未知代码也有兜底', () => {
    expect(loginErrorText('not_allowed')).toContain('允许登录的名单');
    expect(loginErrorText('weird')).toBe('登录失败（weird）。');
  });
});

describe('账户状态', () => {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  it('200 → 已登录；401 → 未登录；非 JSON（服务端未上线）→ 不可用；网络错误 → 离线', async () => {
    expect(await fetchAccount((async () => json(200, { user: { email: 'a@b.c', name: 'A', picture: null } })) as typeof fetch)).toEqual({
      status: 'in',
      user: { email: 'a@b.c', name: 'A', picture: null },
    });
    expect(await fetchAccount((async () => json(401, { error: '401 未登录' })) as typeof fetch)).toEqual({ status: 'out' });
    expect((await fetchAccount((async () => new Response('<html>', { status: 200 })) as typeof fetch)).status).toBe('unavailable');
    expect(await fetchAccount((async () => json(503, {})) as typeof fetch)).toEqual({ status: 'unavailable', reason: '服务端返回 503 服务不可用' });
    expect(await fetchAccount((async () => { throw new TypeError('failed'); }) as typeof fetch)).toEqual({ status: 'offline' });
  });
});
