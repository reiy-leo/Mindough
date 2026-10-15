/**
 * 账户（Google 登录，经 Worker `mindough`）。app 不登录也能完整离线使用；登录只为以后的同步。
 *
 * 登录失败时 Worker 会 302 回来并带 ?login_error=<代码>。按 Rei 的规则：
 * 收到参数的页面立刻用 history.replaceState 去掉它（刷新 / 分享链接都不会再出现），
 * 显示一条可关闭的提示；登录成功后不会再显示。
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { isTauri } from '../store/sqlite-tauri';

/** API 基址：Web 端同源（''）；本地 vite 开发经 proxy 转到 wrangler dev（:8787）。 */
export const API_BASE: string = import.meta.env.VITE_API_BASE ?? '';

export interface Account {
  email: string;
  name: string;
  picture: string | null;
}

export type AccountState =
  | { status: 'loading' }
  | { status: 'in'; user: Account }
  | { status: 'out' }
  | { status: 'offline' }
  /** 服务端不可用（未部署 / 本地没开 wrangler dev / 原生端还没接）。 */
  | { status: 'unavailable'; reason: string };

export const LOGIN_ERROR_TEXT: Record<string, string> = {
  config_missing: '登录暂不可用：服务端还没配置 Google 登录。',
  access_denied: '你取消了 Google 登录。',
  state_mismatch: '登录已过期或被打断，请重新点“用 Google 登录”。',
  token_exchange_failed: 'Google 没有通过这次登录（换取凭据失败），请再试一次。',
  userinfo_failed: '没拿到 Google 账户信息，请再试一次。',
  email_unverified: '这个 Google 邮箱还没有验证，换一个账户试试。',
  not_allowed: '这个 Google 账户不在允许登录的名单里。',
};

export function loginErrorText(code: string): string {
  return LOGIN_ERROR_TEXT[code] ?? `登录失败（${code}）。`;
}

/** 从地址栏取出 login_error 并立刻去掉（保留 hash 路由与其他参数）。启动时调用一次。 */
export function takeLoginError(loc: Location = window.location, hist: History = window.history): string | null {
  const params = new URLSearchParams(loc.search);
  const code = params.get('login_error');
  if (code === null) return null;
  params.delete('login_error');
  const qs = params.toString();
  hist.replaceState(hist.state, '', `${loc.pathname}${qs ? `?${qs}` : ''}${loc.hash}`);
  return code || 'unknown';
}

// ───── 登录错误提示（全局、可关闭、只在这次打开时显示） ─────
let pendingError: string | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());

export function initLoginError() {
  pendingError = takeLoginError();
}
export function dismissLoginError() {
  pendingError = null;
  emit();
}
export function useLoginError(): string | null {
  return useSyncExternalStore(
    (f) => (listeners.add(f), () => listeners.delete(f)),
    () => pendingError,
  );
}

// ───── 账户状态 ─────
export async function fetchAccount(fetcher: typeof fetch = fetch): Promise<AccountState> {
  if (isTauri()) return { status: 'unavailable', reason: '原生端的登录（系统浏览器 + deep link 回调）在 M2 接入' };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { status: 'offline' };
  try {
    const res = await fetcher(`${API_BASE}/api/me`, { credentials: 'include', headers: { accept: 'application/json' } });
    const isJson = (res.headers.get('content-type') ?? '').includes('application/json');
    if (res.status === 200 && isJson) return { status: 'in', user: ((await res.json()) as { user: Account }).user };
    if (res.status === 401 && isJson) return { status: 'out' };
    return { status: 'unavailable', reason: isJson ? `服务端返回 ${res.status} ${statusZh(res.status)}` : '同步服务尚未上线' };
  } catch {
    return { status: 'offline' };
  }
}

export function statusZh(code: number): string {
  const m: Record<number, string> = { 401: '未登录', 403: '无权限', 404: '未找到', 500: '服务器内部错误', 501: '未实现', 502: '网关错误', 503: '服务不可用', 504: '网关超时' };
  return m[code] ?? '';
}

export function loginUrl(returnTo = `${window.location.origin}${window.location.pathname}#/settings`): string {
  return `${API_BASE}/auth/login?return_to=${encodeURIComponent(returnTo)}`;
}

export async function logout(fetcher: typeof fetch = fetch): Promise<void> {
  await fetcher(`${API_BASE}/auth/logout`, { method: 'POST', credentials: 'include' });
}

export function useAccount(): [AccountState, () => void] {
  const [state, setState] = useState<AccountState>({ status: 'loading' });
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    fetchAccount().then((s) => {
      if (!alive) return;
      setState(s);
      // 已登录就不再提示之前的登录错误
      if (s.status === 'in') dismissLoginError();
    });
    const on = () => setN((x) => x + 1);
    window.addEventListener('online', on);
    window.addEventListener('offline', on);
    return () => {
      alive = false;
      window.removeEventListener('online', on);
      window.removeEventListener('offline', on);
    };
  }, [n]);
  return [state, () => setN((x) => x + 1)];
}
