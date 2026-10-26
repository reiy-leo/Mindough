import { describe, expect, it } from 'vitest';
import { Store } from '../src/store';
import { MemoryAdapter } from '../src/storage/memory';
import { SyncEngine } from '../src/sync/engine';
import { MemoryRemote } from '../src/sync/memory-remote';
import { BUILTIN_TYPE_IDS as T } from '../src/seed/builtin-types';
import { LIBRARY_SIDEBAR_PREF, sidebarLibraryIds, withSidebarLibrary } from '../src/library';
import { local } from './helpers';

async function open(adapter = new MemoryAdapter(), deviceId = 'dev1', t0 = local(2026, 10, 26, 19).getTime()) {
  let t = t0;
  const store = await Store.open(adapter, { deviceId, now: () => new Date(t) });
  return { store, adapter, advance: (ms: number) => (t += ms), now: () => t };
}

describe('侧边栏里的资料库（Rei 2026-10-26）', () => {
  it('纯函数：坏值丢掉、去重；打开追加、关掉删除', () => {
    expect(sidebarLibraryIds(undefined)).toEqual([]);
    expect(sidebarLibraryIds('x')).toEqual([]);
    expect(sidebarLibraryIds(['a', 1, '', 'a', 'b'])).toEqual(['a', 'b']);
    expect(withSidebarLibrary(['a'], 'b', true)).toEqual(['a', 'b']);
    expect(withSidebarLibrary(['a', 'b'], 'b', true)).toEqual(['a', 'b']);
    expect(withSidebarLibrary(['a', 'b'], 'a', false)).toEqual(['b']);
  });

  it('默认都不显示', async () => {
    const { store } = await open();
    expect(store.sidebarLibraries()).toEqual([]);
    expect(store.isLibraryInSidebar(T.movie)).toBe(false);
  });

  it('显示的库按资料库顺序排，不按打开的先后；人物库也能放', async () => {
    const { store } = await open();
    store.setLibraryInSidebar(T.game, true);
    store.setLibraryInSidebar(T.movie, true);
    store.setLibraryInSidebar(T.person, true);
    const order = store.orderedTypes().map((t) => t.id);
    const ids = store.sidebarLibraries().map((t) => t.id);
    expect(ids.sort((a, b) => order.indexOf(a) - order.indexOf(b))).toEqual(store.sidebarLibraries().map((t) => t.id));
    expect(new Set(ids)).toEqual(new Set([T.game, T.movie, T.person]));
    // 资料库换了顺序，侧边栏跟着变
    store.reorderTypes([T.game, T.movie]);
    expect(store.sidebarLibraries().map((t) => t.id).indexOf(T.game)).toBeLessThan(store.sidebarLibraries().map((t) => t.id).indexOf(T.movie));
    store.reorderTypes([T.movie, T.game]);
    expect(store.sidebarLibraries().map((t) => t.id).indexOf(T.movie)).toBeLessThan(store.sidebarLibraries().map((t) => t.id).indexOf(T.game));
  });

  it('取消显示；重复设同一个值不写', async () => {
    const { store } = await open();
    store.setLibraryInSidebar(T.book, true);
    const v = store.version;
    store.setLibraryInSidebar(T.book, true);
    expect(store.version).toBe(v);
    store.setLibraryInSidebar(T.book, false);
    expect(store.isLibraryInSidebar(T.book)).toBe(false);
    expect(store.sidebarLibraries()).toEqual([]);
  });

  it('归档的不出现，取消归档后回来；不改类型行', async () => {
    const { store } = await open();
    const before = store.get('task_type', T.game)!.updated_at;
    store.setLibraryInSidebar(T.game, true);
    expect(store.get('task_type', T.game)!.updated_at).toBe(before);
    store.archiveType(T.game);
    expect(store.sidebarLibraries().map((t) => t.id)).not.toContain(T.game);
    expect(store.isLibraryInSidebar(T.game)).toBe(true);
    store.unarchiveType(T.game);
    expect(store.sidebarLibraries().map((t) => t.id)).toContain(T.game);
  });

  it('没有资料库的类型（普通）不出现', async () => {
    const { store } = await open();
    store.setPref(LIBRARY_SIDEBAR_PREF, ['plain', T.movie]);
    expect(store.sidebarLibraries().map((t) => t.id)).toEqual([T.movie]);
  });

  it('同步到别的设备', async () => {
    const remote = new MemoryRemote();
    const t0 = local(2026, 10, 26, 19).getTime();
    const mk = async (id: string) => {
      const d = await open(new MemoryAdapter(), id, t0);
      const engine = new SyncEngine(d.store, remote.transport(), { account: 'rei@example.com', now: () => new Date(d.now()), timers: { set: () => 0, clear: () => {} } });
      return { ...d, sync: () => engine.syncNow() };
    };
    const A = await mk('devA');
    const B = await mk('devB');
    await A.sync();
    await B.sync();
    A.advance(1000);
    A.store.setLibraryInSidebar(T.movie, true);
    await A.sync();
    await B.sync();
    expect(B.store.sidebarLibraries().map((t) => t.id)).toEqual([T.movie]);
    B.advance(5000);
    B.store.setLibraryInSidebar(T.movie, false);
    await B.sync();
    await A.sync();
    expect(A.store.isLibraryInSidebar(T.movie)).toBe(false);
  });
});
