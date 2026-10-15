/**
 * 客户端同步：把 core 的 SyncEngine 接到 Worker（/api/sync/*）。
 * - 登录后启动：取同步凭据（Web 带 cookie；原生端带 Bearer 会话），先合并再增量；退出登录就停，本机数据不动。
 * - 什么时候同步：本机写入后（防抖 1.5 秒）、回到前台 / 窗口获得焦点、联网、每 60 秒（只在前台）。
 * - 永不挡界面：全部在后台，结果只反映在状态上（设置 → 账户）。
 *
 * Web 与原生端只差在凭据怎么取（authInit）和基址（API_BASE），引擎同一份。
 */
import { useSyncExternalStore } from 'react';
import { SyncEngine, SyncHttpError, type PullResult, type PushResult, type Store, type SyncStatus, type SyncToken, type SyncTransport, type WireRow } from '@mindough/core';
import { API_BASE, authInit, getAccount, statusZh, subscribeAccount } from './account';

import { tr } from './i18n';
const INTERVAL_MS = 60_000;

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) return body.error;
  } catch {
    /* 不是 JSON */
  }
  return `${res.status} ${statusZh(res.status)}`.trim();
}

/** 取同步凭据；快过期（2 分钟内）就重新取。 */
export class TokenSource {
  private cached: SyncToken | null = null;
  constructor(private readonly fetcher: typeof fetch = (...a) => fetch(...a)) {}

  async get(force = false): Promise<SyncToken> {
    const exp = this.cached?.expires_at ? new Date(this.cached.expires_at).getTime() : 0;
    if (!force && this.cached && exp - Date.now() > 120_000) return this.cached;
    let res: Response;
    try {
      res = await this.fetcher(`${API_BASE}/api/sync/token`, authInit({ method: 'POST', headers: { accept: 'application/json' } }));
    } catch {
      throw new SyncHttpError(0, tr('网络不通'));
    }
    if (!res.ok) throw new SyncHttpError(res.status, await readError(res));
    this.cached = (await res.json()) as SyncToken;
    return this.cached;
  }

  clear() {
    this.cached = null;
  }
}

/** HTTP 传输层：凭据被拒（401）时重新取一次再试。 */
export function httpTransport(tokens: TokenSource, fetcher: typeof fetch = (...a) => fetch(...a)): SyncTransport {
  async function call<T>(path: 'push' | 'pull', body: unknown, retried = false): Promise<T> {
    const t = await tokens.get(retried);
    let res: Response;
    try {
      res = await fetcher(`${t.url}/${path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${t.token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'omit',
      });
    } catch {
      throw new SyncHttpError(0, tr('网络不通'));
    }
    if (res.status === 401 && !retried) return call<T>(path, body, true);
    if (!res.ok) throw new SyncHttpError(res.status, await readError(res));
    return (await res.json()) as T;
  }
  return {
    push: (rows: readonly WireRow[]) => call<PushResult>('push', { rows }),
    pull: (cursor: number, limit: number) => call<PullResult>('pull', { cursor, limit }),
  };
}

// ───── 全局同步状态 ─────

export type SyncView = { enabled: false } | ({ enabled: true } & SyncStatus);

let engine: SyncEngine | null = null;
let engineAccount: string | null = null;
let view: SyncView = { enabled: false };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());
let unsubEngine: (() => void) | null = null;
let intervalId: ReturnType<typeof setInterval> | null = null;
const tokens = new TokenSource();

function setView(v: SyncView) {
  view = v;
  emit();
}

function onForeground() {
  if (document.visibilityState === 'visible') void engine?.syncNow();
}
function onOnline() {
  void engine?.syncNow();
}

async function startFor(store: Store, email: string) {
  if (engine && engineAccount === email) return;
  await stopSync();
  engineAccount = email;
  engine = new SyncEngine(store, httpTransport(tokens), { account: email, onError: (e) => console.warn('同步出错', e) });
  unsubEngine = engine.subscribe(() => engine && setView({ enabled: true, ...engine.snapshot }));
  setView({ enabled: true, ...engine.snapshot, phase: navigator.onLine === false ? 'offline' : 'syncing' });
  window.addEventListener('focus', onForeground);
  document.addEventListener('visibilitychange', onForeground);
  window.addEventListener('online', onOnline);
  intervalId = setInterval(() => {
    if (document.visibilityState === 'visible') void engine?.syncNow();
  }, INTERVAL_MS);
  await engine.start();
}

export async function stopSync() {
  const e = engine;
  engine = null;
  engineAccount = null;
  unsubEngine?.();
  unsubEngine = null;
  tokens.clear();
  window.removeEventListener('focus', onForeground);
  document.removeEventListener('visibilitychange', onForeground);
  window.removeEventListener('online', onOnline);
  if (intervalId) clearInterval(intervalId);
  intervalId = null;
  setView({ enabled: false });
  await e?.stop();
}

/** 跟着账户状态开 / 停同步。StoreProvider 打开 Store 后调用一次。 */
export function bindSync(store: Store): () => void {
  const apply = () => {
    const a = getAccount();
    if (a.status === 'in') void startFor(store, a.user.email.toLowerCase());
    else if (a.status === 'out' || a.status === 'unavailable') void stopSync();
    // loading / offline：保持现状
  };
  apply();
  return subscribeAccount(apply);
}

/** 立即同步（设置里的按钮、出错后的重试）。 */
export function syncNow(): Promise<void> {
  return engine?.syncNow() ?? Promise.resolve();
}

export function useSyncView(): SyncView {
  return useSyncExternalStore(
    (f) => (listeners.add(f), () => listeners.delete(f)),
    () => view,
  );
}

/** 同步出错时说的话（COPY.md）。 */
export function syncErrorText(v: SyncView): string {
  if (!v.enabled || v.phase !== 'error') return '';
  return v.error ?? tr('同步出错');
}
