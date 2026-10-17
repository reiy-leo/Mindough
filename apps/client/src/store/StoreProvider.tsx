import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { DEMO_STAMP_META, SqlAdapter, Store, TABLES, WebStorageAdapter, migrateStorage, seedDemo, type BaseRow, type StorageAdapter } from '@mindough/core';
import { bindSync } from '../lib/sync';
import { installUploader } from '../lib/attachments';
import { installWindowSync, isMiniWindow } from '../lib/windows';
import { installWidgetSnapshot } from '../lib/widget-snapshot';
import { migrateFromTurso, openWebSqlite, terminateWebSqlite, webSqliteSupported } from './sqlite-web';
import { acquireTabLock, type TabLock } from './tab-lock';
import { isTauri, openTauriSqlite } from './sqlite-tauri';

import { tr } from '../lib/i18n';
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
 * 选存储：Tauri → 原生 SQLite；浏览器 → sqlite-wasm（OPFS）；都不行 → localStorage。
 * 浏览器第一次用上新引擎时，把以前 Turso wasm 库里的数据搬过来；再往前用 localStorage 的，把 localStorage 搬过来
 * （都只搬一次，旧数据保留作备份）。
 */
async function openAdapter(): Promise<StorageAdapter> {
  const legacy = () => new WebStorageAdapter(window.localStorage);
  let reason: string | undefined;
  try {
    const driver = isTauri() ? await openTauriSqlite() : await openWebSqlite();
    if (driver) {
      const sql = new SqlAdapter(driver);
      await sql.schemaVersion();
      let rows = 0;
      if (!isTauri()) rows += await migrateFromTurso(sql);
      rows += (await migrateStorage(legacy(), sql)).rows;
      localStorage.setItem(ENGINE_KEY, 'sqlite');
      storageInfo = { engine: 'sqlite', detail: sql.kind, migratedRows: rows };
      return sql;
    }
    reason = webSqliteSupported().reason;
  } catch (e) {
    if (localStorage.getItem(ENGINE_KEY) === 'sqlite') {
      throw new Error(tr('本地数据库打不开：{String}', { String: String(e) }));
    }
    reason = tr('SQLite 启动失败：{String}', { String: String(e) });
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
  /** 另一个标签页正开着（拿着标签页锁）：这一页只显示提示。 */
  const [blocked, setBlocked] = useState<null | 'other' | 'taken'>(null);
  const [attempt, setAttempt] = useState<{ steal: boolean } | null>({ steal: false });
  useEffect(() => {
    if (!attempt) return;
    let alive = true;
    let opened: Store | null = null;
    (async () => {
      // 标签页锁只管浏览器；Tauri 的窗口之间另有办法（小窗不开库）
      const lock: TabLock | null = isTauri() || isMiniWindow() ? { lost: new Promise<void>(() => {}) } : await acquireTabLock(attempt.steal);
      if (!alive) return;
      if (!lock) return setBlocked('other');
      setBlocked(null);
      const s = await openWebStore();
      if (!alive) return;
      opened = s;
      setStore(s);
      lock.lost.then(async () => {
        // 被别的标签页「在这里用」抢走：先把手上的改动写下去，再停掉数据库，换成提示
        await Promise.race([s.flush().catch(() => {}), new Promise((r) => setTimeout(r, 800))]);
        terminateWebSqlite();
        if (!alive) return;
        setStore(null);
        setBlocked('taken');
      });
    })().catch((e: unknown) => alive && setError(String(e)));
    return () => {
      alive = false;
      void opened;
    };
  }, [attempt]);
  // 登录后多设备同步；退出登录就停（本机数据不动）
  // 同步只在主窗口跑（小窗的写入经窗口事件交给主窗口，主窗口照常推）
  useEffect(() => (store && !isMiniWindow() ? bindSync(store) : undefined), [store]);
  useEffect(() => (store ? installWindowSync(store) : undefined), [store]);
  useEffect(() => (store ? installWidgetSnapshot(store) : undefined), [store]);
  // 附件上传队列：只在主窗口跑（和同步一样）
  useEffect(() => (store && !isMiniWindow() ? installUploader(store) : undefined), [store]);
  if (error) return <div className="boot-error">{tr('打不开本地数据：{error}', { error })}</div>;
  if (blocked)
    return (
      <div className="tab-blocked" role="alert">
        <div className="tab-blocked-card">
          <div className="tab-blocked-title">{tr('Mindough 已在另一个标签页打开')}</div>
          <p className="tab-blocked-text">
            {blocked === 'taken' ? tr('你在另一个标签页里点了「在这里用」，这一页先停下了。') : tr('同一时间只能在一个标签页里用，免得两边的改动打架。')}
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setBlocked(null);
              setAttempt({ steal: true });
            }}
          >
            {tr('在这里用')}
          </button>
        </div>
      </div>
    );
  if (!store) return <div className="boot">Mindough</div>;
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

/** 取 Store，并在任何数据变化时重渲染。 */
export function useStore(): Store {
  const store = useContext(Ctx);
  if (!store) throw new Error(tr('StoreProvider 缺失'));
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
