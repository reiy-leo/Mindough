import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { DEMO_STAMP_META, SqlAdapter, Store, TABLES, WebStorageAdapter, migrateStorage, seedDemo, type BaseRow, type StorageAdapter } from '@mindough/core';
import { bindSync } from '../lib/sync';
import { openWebSqlite, webSqliteSupported } from './sqlite-web';
import { isTauri, openTauriSqlite } from './sqlite-tauri';

const Ctx = createContext<Store | null>(null);

/** 记在 localStorage 里：这台设备已经用上 SQLite。之后 SQLite 打不开就报错，而不是悄悄退回 localStorage（会分叉数据）。 */
const ENGINE_KEY = 'mindough:engine';

export interface StorageInfo {
  engine: 'sqlite' | 'localStorage';
  detail: string;
  /** 退回 localStorage 的原因。 */
  fallbackReason?: string;
  /** 本次启动从 localStorage 迁过来的行数。 */
  migratedRows?: number;
}

export let storageInfo: StorageInfo = { engine: 'localStorage', detail: 'localStorage' };

/**
 * 选存储：Tauri → 原生 SQLite；浏览器 → Turso wasm（OPFS）；都不行 → localStorage。
 * 第一次用上 SQLite 时，把 localStorage 里的旧数据迁过去（只迁一次，旧数据保留作备份）。
 */
async function openAdapter(): Promise<StorageAdapter> {
  const legacy = () => new WebStorageAdapter(window.localStorage);
  let reason: string | undefined;
  try {
    const driver = isTauri() ? await openTauriSqlite() : await openWebSqlite();
    if (driver) {
      const sql = new SqlAdapter(driver);
      await sql.schemaVersion();
      const r = await migrateStorage(legacy(), sql);
      localStorage.setItem(ENGINE_KEY, 'sqlite');
      storageInfo = { engine: 'sqlite', detail: sql.kind, migratedRows: r.rows };
      return sql;
    }
    reason = webSqliteSupported().reason;
  } catch (e) {
    if (localStorage.getItem(ENGINE_KEY) === 'sqlite') {
      throw new Error(`本地数据库打不开（可能在另一个标签页里开着，关掉它再刷新）：${String(e)}`);
    }
    reason = `SQLite 启动失败：${String(e)}`;
    console.warn(reason);
  }
  storageInfo = { engine: 'localStorage', detail: 'localStorage', ...(reason ? { fallbackReason: reason } : {}) };
  return legacy();
}

export async function openWebStore(): Promise<Store> {
  const adapter = await openAdapter();
  const store = await Store.open(adapter, { onError: (e) => console.error('写入本地存储失败', e) });
  if (!(await adapter.getMeta('demo_seeded')) && store.tasks().length === 0) {
    seedDemo(store);
    await adapter.setMeta('demo_seeded', new Date().toISOString());
    // 记下演示数据的最后一笔：第一次登录时，没动过演示数据的新设备不会把它带进账户（见 core sync/engine.ts）
    let stamp = '';
    for (const t of TABLES) for (const r of store.listAll(t) as BaseRow[]) if (r.updated_at > stamp) stamp = r.updated_at;
    await adapter.setMeta(DEMO_STAMP_META, stamp);
    await store.flush();
  }
  return store;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<Store | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    openWebStore().then(setStore, (e: unknown) => setError(String(e)));
  }, []);
  // 登录后多设备同步；退出登录就停（本机数据不动）
  useEffect(() => (store ? bindSync(store) : undefined), [store]);
  if (error) return <div className="boot-error">打不开本地数据：{error}</div>;
  if (!store) return <div className="boot">Mindough</div>;
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

/** 取 Store，并在任何数据变化时重渲染。 */
export function useStore(): Store {
  const store = useContext(Ctx);
  if (!store) throw new Error('StoreProvider 缺失');
  useSyncExternalStore(
    (fn) => store.subscribe(fn),
    () => store.version,
  );
  return store;
}

/** 当前时间：计时器用 1 秒刷新，其他用 30 秒（顺便跨过零点换天）。 */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
