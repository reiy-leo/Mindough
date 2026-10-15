/**
 * 原生端（Tauri）登录：系统浏览器里登 Google，deep link 带回一次性登录码，再换成会话。
 *
 * 1. 生成 verifier（随机 32 字节），challenge = base64url(SHA-256(verifier))；verifier 只留在本机。
 * 2. 用系统浏览器打开 {SERVER}/auth/login?native=1&challenge=…
 * 3. Worker 登录成功后结果页跳回 mindough://auth?code=…（失败是 ?login_error=…）
 * 4. app 收到 deep link：POST /auth/exchange { code, verifier } → 会话，存本机，之后请求带 Bearer。
 * 别的 app 就算截到 deep link，没有 verifier 也换不走。
 */
import { API_BASE, refreshAccount, setNativeSession, showLoginError } from './account';
import { isTauri } from '../store/sqlite-tauri';
import { openExternal } from './external';

const VERIFIER_KEY = 'mindough:login_verifier';

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function challengeOf(verifier: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

/** 「用 Google 登录」（原生端）：打开系统浏览器。 */
export async function startNativeLogin(): Promise<void> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  localStorage.setItem(VERIFIER_KEY, verifier);
  const url = `${API_BASE}/auth/login?native=1&challenge=${await challengeOf(verifier)}`;
  await openExternal(url);
}

/** 处理一个 deep link；不是登录回调就返回 false。 */
export async function handleDeepLink(raw: string, fetcher: typeof fetch = (...a) => fetch(...a)): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'mindough:' || (url.host !== 'auth' && url.pathname.replace(/^\/+/, '') !== 'auth')) return false;
  const err = url.searchParams.get('login_error');
  if (err) {
    showLoginError(err);
    return true;
  }
  const code = url.searchParams.get('code');
  const verifier = localStorage.getItem(VERIFIER_KEY);
  if (!code || !verifier) {
    showLoginError('state_mismatch');
    return true;
  }
  try {
    const res = await fetcher(`${API_BASE}/auth/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, verifier }),
      credentials: 'omit',
    });
    if (!res.ok) {
      showLoginError(res.status === 403 ? 'not_allowed' : 'state_mismatch');
      return true;
    }
    const body = (await res.json()) as { session: string };
    setNativeSession(body.session);
    localStorage.removeItem(VERIFIER_KEY);
    await refreshAccount();
  } catch {
    showLoginError('token_exchange_failed');
  }
  return true;
}

/** 启动时：监听 deep link，并处理冷启动时带进来的那个。 */
export async function initNativeLogin(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { getCurrent, onOpenUrl } = await import('@tauri-apps/plugin-deep-link');
    await onOpenUrl((urls) => urls.forEach((u) => void handleDeepLink(u)));
    for (const u of (await getCurrent()) ?? []) await handleDeepLink(u);
  } catch (e) {
    console.warn('deep link 不可用', e);
  }
}
