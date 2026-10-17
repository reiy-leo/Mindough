/**
 * 云端存在哪（只读显示）：Worker 的 /api/health 报 storage = turso | d1（由服务器环境变量 STORAGE_BACKEND 决定，
 * Rei 2026-10-17「这个切换数据库用环境变量切换」）。设置 → 账户的「数据怎么走」用它。拿不到（离线 / 开发）就显示「云端数据库」。
 */
import { useEffect, useSyncExternalStore } from 'react';
import { API_BASE } from './account';
import { tr } from './i18n';

export type CloudStorage = 'turso' | 'd1';

let current: CloudStorage | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

export function parseCloudStorage(v: unknown): CloudStorage | null {
  return v === 'turso' || v === 'd1' ? v : null;
}

/** 同步凭据的响应里也带 storage，拿到就顺手更新。 */
export function setCloudStorage(v: unknown) {
  const next = parseCloudStorage(v);
  if (next === current || next === null) return;
  current = next;
  listeners.forEach((l) => l());
}

export async function loadCloudStorage(fetcher: typeof fetch = (...a) => fetch(...a)): Promise<void> {
  loading ??= (async () => {
    try {
      const res = await fetcher(`${API_BASE}/api/health`, { headers: { accept: 'application/json' } });
      if (res.ok) setCloudStorage(((await res.json()) as { storage?: unknown }).storage);
    } catch {
      /* 离线：先不显示具体是哪个库 */
    } finally {
      loading = null;
    }
  })();
  return loading;
}

export const getCloudStorage = (): CloudStorage | null => current;

export function useCloudStorage(): CloudStorage | null {
  const v = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getCloudStorage,
  );
  useEffect(() => {
    if (!current) void loadCloudStorage();
  }, []);
  return v;
}

/** 云端库的名字：Turso（东京）/ Cloudflare D1；不知道时「云端数据库」。 */
export function cloudStorageName(s: CloudStorage | null): string {
  return s === 'turso' ? tr('Turso（东京）') : s === 'd1' ? 'Cloudflare D1' : tr('云端数据库');
}
