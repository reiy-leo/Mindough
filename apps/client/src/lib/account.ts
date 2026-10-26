/**
 * 账户（Google 登录，经 Worker `mindough`）。app 不登录也能完整离线使用；登录后多设备同步（lib/sync.ts）。
 * Web 端靠同源的会话 cookie；原生端（Tauri）没有 cookie：系统浏览器登录 → deep link 带回一次性登录码 →
 * 换成会话（lib/native-login.ts），存在本机，请求时放进 Authorization: Bearer。
 *
 * 登录失败时 Worker 会 302 回来并带 ?login_error=<代码>。按 Rei 的规则：
 * 收到参数的页面立刻用 history.replaceState 去掉它（刷新 / 分享链接都不会再出现），
 * 显示一条可关闭的提示；登录成功后不会再显示。
 */
import { useSyncExternalStore } from 'react';
import { isTauri } from '../store/sqlite-tauri';

import { tr } from './i18n';
/** 线上 Worker。 */
export const SERVER_ORIGIN = 'https://mindough.rei8t.dev';

/** API 基址：Web 端同源（''，本地 vite 开发经 proxy 转到 wrangler dev :8787）；原生端直连线上 Worker。 */
export const API_BASE: string = import.meta.env.VITE_API_BASE ?? (isTauri() ? SERVER_ORIGIN : '');

// ───── 原生端会话（Bearer） ─────
const NATIVE_SESSION_KEY = 'mindough:native_session';

export function nativeSession(): string | null {
  try {
    return localStorage.getItem(NATIVE_SESSION_KEY);
  } catch {
    return null;
  }
}

export function setNativeSession(token: string | null) {
  if (token) localStorage.setItem(NATIVE_SESSION_KEY, token);
  else localStorage.removeItem(NATIVE_SESSION_KEY);
}

/** 带上会话的请求选项：Web 端带 cookie，原生端带 Bearer。 */
export function authInit(init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers);
  if (isTauri()) {
    const s = nativeSession();
    if (s) headers.set('authorization', `Bearer ${s}`);
    return { ...init, headers, credentials: 'omit' };
  }
  return { ...init, headers, credentials: 'include' };
}

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
  get config_missing() { return tr('登录暂不可用：服务端还没配置 Google 登录。'); },
  get access_denied() { return tr('你取消了 Google 登录。'); },
  get state_mismatch() { return tr('登录已过期或被打断，请重新点“用 Google 登录”。'); },
  get token_exchange_failed() { return tr('Google 没有通过这次登录（换取凭据失败），请再试一次。'); },
  get userinfo_failed() { return tr('没拿到 Google 账户信息，请再试一次。'); },
  get email_unverified() { return tr('这个 Google 邮箱还没有验证，换一个账户试试。'); },
  get not_allowed() { return tr('这个 Google 账户不在允许登录的名单里。'); },
};

export function loginErrorText(code: string): string {
  return LOGIN_ERROR_TEXT[code] ?? tr('登录失败（{code}）。', { code });
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
/** 原生端：deep link 带回的登录错误也走同一条提示。 */
export function showLoginError(code: string) {
  pendingError = code;
  emit();
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
  if (isTauri() && !nativeSession()) return { status: 'out' };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { status: 'offline' };
  try {
    const res = await fetcher(`${API_BASE}/api/me`, authInit({ headers: { accept: 'application/json' } }));
    const isJson = (res.headers.get('content-type') ?? '').includes('application/json');
    if (res.status === 200 && isJson) return { status: 'in', user: ((await res.json()) as { user: Account }).user };
    if (res.status === 401 && isJson) {
      // 原生端的会话过期了：忘掉它
      if (isTauri()) setNativeSession(null);
      return { status: 'out' };
    }
    if (res.status === 403 && isJson) return { status: 'unavailable', reason: tr('这个 Google 账户不在允许登录的名单里（403 无权限）') };
    return { status: 'unavailable', reason: isJson ? tr('服务端返回 {status} {statusZh}', { status: res.status, statusZh: statusZh(res.status) }) : tr('同步服务尚未上线') };
  } catch {
    return { status: 'offline' };
  }
}

export function statusZh(code: number): string {
  const m: Record<number, string> = { 400: tr('请求有误'), 401: tr('未登录'), 403: tr('无权限'), 404: tr('未找到'), 408: tr('请求超时'), 413: tr('内容太大'), 415: tr('不支持的格式'), 429: tr('请求太多'), 500: tr('服务器内部错误'), 501: tr('未实现'), 502: tr('网关错误'), 503: tr('服务不可用'), 504: tr('网关超时') };
  return m[code] ?? '';
}

export function loginUrl(returnTo = `${window.location.origin}${window.location.pathname}#/settings/account`): string {
  return `${API_BASE}/auth/login?return_to=${encodeURIComponent(returnTo)}`;
}

/** 退出登录：只清会话，本机数据原样保留（同步停下，见 lib/sync.ts）。 */
export async function logout(fetcher: typeof fetch = fetch): Promise<void> {
  if (isTauri()) setNativeSession(null);
  else await fetcher(`${API_BASE}/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => {});
  setAccount({ status: 'out' });
}

// 全局账户状态：启动时查一次，联网 / 断网 / 回到前台时再查；同步模块和设置页都订阅它
let account: AccountState = { status: 'loading' };
const accountListeners = new Set<() => void>();

export function getAccount(): AccountState {
  return account;
}

export function setAccount(s: AccountState) {
  account = s;
  if (s.status === 'in') dismissLoginError();
  accountListeners.forEach((f) => f());
}

export function subscribeAccount(fn: () => void): () => void {
  accountListeners.add(fn);
  return () => accountListeners.delete(fn);
}

let inflight: Promise<void> | null = null;
export function refreshAccount(): Promise<void> {
  if (!inflight) {
    inflight = fetchAccount()
      .then((s) => {
        // 已登录时偶尔断网：账户状态不改成离线（同步状态会显示离线），免得设置页里账户闪没
        if (s.status === 'offline' && account.status === 'in') return;
        setAccount(s);
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

let watching = false;
/** 启动时调用一次。 */
export function startAccountWatch() {
  if (watching) return;
  watching = true;
  void refreshAccount();
  window.addEventListener('online', () => void refreshAccount());
}

export function useAccount(): [AccountState, () => void] {
  const s = useSyncExternalStore(subscribeAccount, getAccount);
  return [s, () => void refreshAccount()];
}
