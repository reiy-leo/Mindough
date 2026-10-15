import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { challengeOf, handleDeepLink } from './native-login';
import { nativeSession, useLoginError } from './account';

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));
afterEach(() => vi.unstubAllGlobals());
void useLoginError;

describe('原生端登录 deep link', () => {
  it('challenge = base64url(SHA-256(verifier))（与 Worker 一致）', async () => {
    // 与 Python hashlib + urlsafe_b64encode 的结果对照
    expect(await challengeOf('dBjftJeZ4CVP-mJ92K1cKeuNVpoBbWgCb4MS7_4j6oM')).toBe('KWaaIFoAM-ebsUNBY7C3pA5spKeJqZwwtviB8f4gAA4');
  });

  it('mindough://auth?code=… → 用 verifier 换会话并存下', async () => {
    localStorage.setItem('mindough:login_verifier', 'v'.repeat(43));
    const f = vi.fn(async (_u: string, init: RequestInit) => {
      expect(JSON.parse(String(init.body))).toEqual({ code: 'abc', verifier: 'v'.repeat(43) });
      return new Response(JSON.stringify({ session: 'S' }), { status: 200 });
    });
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 401, headers: { 'content-type': 'application/json' } }));
    expect(await handleDeepLink('mindough://auth?code=abc', f as unknown as typeof fetch)).toBe(true);
    expect(nativeSession()).toBe('S');
    expect(localStorage.getItem('mindough:login_verifier')).toBeNull();
  });

  it('不是登录回调的链接不管', async () => {
    expect(await handleDeepLink('mindough://task/123')).toBe(false);
    expect(await handleDeepLink('https://example.com')).toBe(false);
  });
});
