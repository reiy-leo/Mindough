import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Store, WebStorageAdapter, seedDemo } from '@mindough/core';

const Ctx = createContext<Store | null>(null);

export async function openWebStore(): Promise<Store> {
  const adapter = new WebStorageAdapter(window.localStorage);
  const store = await Store.open(adapter, { onError: (e) => console.error('写入本地存储失败', e) });
  if (!(await adapter.getMeta('demo_seeded')) && store.tasks().length === 0) {
    seedDemo(store);
    await adapter.setMeta('demo_seeded', new Date().toISOString());
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
