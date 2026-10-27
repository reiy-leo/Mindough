import { describe, expect, it } from 'vitest';
import { Store } from '../src/store';
import { MemoryAdapter } from '../src/storage/memory';
import { SyncEngine } from '../src/sync/engine';
import { MemoryRemote } from '../src/sync/memory-remote';
import { GROUP_SIDEBAR_PREF } from '../src/library';
import { local } from './helpers';

async function open(adapter = new MemoryAdapter(), deviceId = 'dev1', t0 = local(2026, 10, 28, 8).getTime()) {
  let t = t0;
  const store = await Store.open(adapter, { deviceId, now: () => new Date(t) });
  return { store, adapter, advance: (ms: number) => (t += ms), now: () => t };
}

const mk = (store: Store, name: string) =>
  store.insert('group', { name, icon: '📁', start_at: null, end_at: null, category_id: null, default_type_id: null });

describe('侧边栏里的项目（Rei 2026-10-28）', () => {
  it('偏好名是 group.sidebar；默认都不显示', async () => {
    const { store } = await open();
    expect(GROUP_SIDEBAR_PREF).toBe('group.sidebar');
    const g = mk(store, '搬家');
    expect(store.sidebarGroups()).toEqual([]);
    expect(store.isGroupInSidebar(g.id)).toBe(false);
  });

  it('顺序跟项目页（store.list）一样，不按打开的先后', async () => {
    const { store } = await open();
    const a = mk(store, 'A');
    const b = mk(store, 'B');
    const c = mk(store, 'C');
    store.setGroupInSidebar(c.id, true);
    store.setGroupInSidebar(a.id, true);
    const order = store.list('group').map((g) => g.id).filter((id) => id === a.id || id === c.id);
    expect(store.sidebarGroups().map((g) => g.id)).toEqual(order);
    expect(store.sidebarGroups().map((g) => g.id)).not.toContain(b.id);
  });

  it('取消显示；重复设同一个值不写；不改项目行', async () => {
    const { store } = await open();
    const g = mk(store, '搬家');
    const before = store.get('group', g.id)!.updated_at;
    store.setGroupInSidebar(g.id, true);
    expect(store.get('group', g.id)!.updated_at).toBe(before);
    const v = store.version;
    store.setGroupInSidebar(g.id, true);
    expect(store.version).toBe(v);
    store.setGroupInSidebar(g.id, false);
    expect(store.isGroupInSidebar(g.id)).toBe(false);
    expect(store.sidebarGroups()).toEqual([]);
  });

  it('删掉的项目不出现；偏好里的坏 id 不出现', async () => {
    const { store } = await open();
    const g = mk(store, '搬家');
    const h = mk(store, '装修');
    store.setPref(GROUP_SIDEBAR_PREF, [g.id, h.id, 'nope', 3 as unknown as string]);
    store.remove('group', g.id);
    expect(store.sidebarGroups().map((x) => x.id)).toEqual([h.id]);
  });

  it('跟资料库的侧边栏各管各的', async () => {
    const { store } = await open();
    const g = mk(store, '搬家');
    store.setGroupInSidebar(g.id, true);
    expect(store.sidebarLibraries()).toEqual([]);
  });

  it('同步到别的设备', async () => {
    const remote = new MemoryRemote();
    const t0 = local(2026, 10, 28, 8).getTime();
    const dev = async (id: string) => {
      const d = await open(new MemoryAdapter(), id, t0);
      const engine = new SyncEngine(d.store, remote.transport(), { account: 'rei@example.com', now: () => new Date(d.now()), timers: { set: () => 0, clear: () => {} } });
      return { ...d, sync: () => engine.syncNow() };
    };
    const A = await dev('devA');
    const B = await dev('devB');
    const g = mk(A.store, '搬家');
    await A.sync();
    await B.sync();
    A.advance(1000);
    A.store.setGroupInSidebar(g.id, true);
    await A.sync();
    await B.sync();
    expect(B.store.sidebarGroups().map((x) => x.id)).toEqual([g.id]);
    B.advance(5000);
    B.store.setGroupInSidebar(g.id, false);
    await B.sync();
    await A.sync();
    expect(A.store.isGroupInSidebar(g.id)).toBe(false);
  });
});
