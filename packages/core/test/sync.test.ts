import { describe, expect, it } from 'vitest';
import { Store } from '../src/store';
import { MemoryAdapter } from '../src/storage/memory';
import { SqlAdapter } from '../src/storage/sql';
import { SyncEngine, isSeedRow, resetSyncState } from '../src/sync/engine';
import { MemoryRemote } from '../src/sync/memory-remote';
import { SyncHttpError, type SyncTransport } from '../src/sync/protocol';
import { seedDemo } from '../src/seed/demo';
import { local } from './helpers';
import { NodeSqliteDriver } from './sql-drivers';
import type { StorageAdapter } from '../src/storage/adapter';

const ACCOUNT = 'rei@example.com';

/** 一台模拟设备：自己的时钟、存储、引擎；计时器手动触发。 */
async function device(remote: MemoryRemote, deviceId: string, opts: { adapter?: StorageAdapter; t0?: number; transport?: SyncTransport } = {}) {
  let t = opts.t0 ?? local(2026, 10, 15, 10).getTime();
  const adapter = opts.adapter ?? new MemoryAdapter();
  const store = await Store.open(adapter, { deviceId, now: () => new Date(t) });
  const timers: Array<{ fn: () => void; at: number } | null> = [];
  const engine = new SyncEngine(store, opts.transport ?? remote.transport(), {
    account: ACCOUNT,
    now: () => new Date(t),
    timers: {
      set: (fn, ms) => timers.push({ fn, at: t + ms }) - 1,
      clear: (i) => {
        timers[i as number] = null;
      },
    },
  });
  return {
    store,
    adapter,
    engine,
    advance: (ms: number) => (t += ms),
    /** 跑完到期的计时器（防抖推送）。 */
    async fireTimers() {
      for (let i = 0; i < timers.length; i++) {
        const x = timers[i];
        if (x && x.at <= t) {
          timers[i] = null;
          x.fn();
        }
      }
      await engine.syncNow();
    },
    sync: () => engine.syncNow(),
    bodies: () =>
      store
        .tasks()
        .map((x) => x.body_md)
        .sort(),
  };
}

describe('同步引擎（两台设备 + 假云端）', () => {
  it('单行超过 2 MB：扣下不推、不挡别的行；变小后下次推上去', async () => {
    const remote = new MemoryRemote();
    const A = await device(remote, 'devA');
    const B = await device(remote, 'devB');
    await A.sync();
    await B.sync();
    const big = A.store.insert('asset', { sha256: '', mime: 'image/png', width: 1, height: 1, r2_key: null, url: 'data:image/png;base64,' + 'A'.repeat(2_200_000) });
    A.store.createTask({ body_md: '买牛奶' });
    await A.sync();
    expect(A.engine.snapshot.phase).toBe('error');
    expect(A.engine.snapshot.error).toContain('1');
    await B.sync();
    expect(B.bodies()).toEqual(['买牛奶']);
    expect(B.store.raw('asset', big.id)).toBeUndefined();
    A.advance(1000);
    A.store.update('asset', big.id, { url: 'https://example.com/a.webp', r2_key: 'k' });
    await A.sync();
    expect(A.engine.snapshot.phase).toBe('idle');
    await B.sync();
    expect(B.store.raw('asset', big.id)?.url).toBe('https://example.com/a.webp');
  });

  it('A 新建的任务，B 同步后看到；状态回到已同步并记下时间', async () => {
    const remote = new MemoryRemote();
    const A = await device(remote, 'devA');
    const B = await device(remote, 'devB');
    A.store.createTask({ body_md: '买牛奶' });
    await A.sync();
    expect(A.engine.snapshot.phase).toBe('idle');
    expect(A.engine.snapshot.lastSyncedAt).not.toBeNull();
    await B.sync();
    expect(B.bodies()).toEqual(['买牛奶']);
  });

  it('第一次登录：两台设备各自已有的数据都保留（推上去 + 拉下来）', async () => {
    const remote = new MemoryRemote();
    const A = await device(remote, 'devA');
    const B = await device(remote, 'devB');
    A.store.createTask({ body_md: 'A 的事' });
    B.store.createTask({ body_md: 'B 的事' });
    await A.sync();
    await B.sync();
    await A.sync();
    expect(A.bodies()).toEqual(['A 的事', 'B 的事']);
    expect(B.bodies()).toEqual(['A 的事', 'B 的事']);
    // 内置类型两边都有、不重复
    expect(A.store.list('task_type').length).toBe(B.store.list('task_type').length);
  });

  it('同一件任务两边离线都改：updated_at 晚的赢，与推送先后无关', async () => {
    const remote = new MemoryRemote();
    const A = await device(remote, 'devA');
    const B = await device(remote, 'devB');
    const t = A.store.createTask({ body_md: '原文' });
    await A.sync();
    await B.sync();
    A.advance(1000);
    A.store.updateTask(t.id, { body_md: 'A 早改的' });
    B.advance(5000);
    B.store.updateTask(t.id, { body_md: 'B 晚改的' });
    // 晚改的先推，早改的后推：云端不能被早改的覆盖
    await B.sync();
    await A.sync();
    await B.sync();
    expect(A.store.get('task', t.id)!.body_md).toBe('B 晚改的');
    expect(B.store.get('task', t.id)!.body_md).toBe('B 晚改的');
    expect(remote.get('task', t.id)!.row).toMatchObject({ body_md: 'B 晚改的' });
  });

  it('同一毫秒同一计数：按设备 id 定先后，两边结果一样', async () => {
    const remote = new MemoryRemote();
    const t0 = local(2026, 10, 15, 10).getTime();
    const A = await device(remote, 'devA', { t0 });
    const B = await device(remote, 'devB', { t0 });
    const t = A.store.createTask({ body_md: '原文' });
    await A.sync();
    await B.sync();
    A.advance(60_000);
    B.advance(60_000);
    const a = A.store.updateTask(t.id, { body_md: '来自 A' });
    const b = B.store.updateTask(t.id, { body_md: '来自 B' });
    expect(a.updated_at.slice(0, 18)).toBe(b.updated_at.slice(0, 18));
    await A.sync();
    await B.sync();
    await A.sync();
    expect(A.store.get('task', t.id)!.body_md).toBe('来自 B');
    expect(B.store.get('task', t.id)!.body_md).toBe('来自 B');
  });

  it('删除（墓碑）比编辑晚：删除赢；编辑比删除晚：编辑赢（行级 LWW）', async () => {
    const remote = new MemoryRemote();
    const A = await device(remote, 'devA');
    const B = await device(remote, 'devB');
    const x = A.store.createTask({ body_md: '要删的' });
    const y = A.store.createTask({ body_md: '删了又改' });
    await A.sync();
    await B.sync();
    B.advance(1000);
    B.store.updateTask(x.id, { body_md: '先改了一下' });
    A.advance(2000);
    A.store.deleteTask(x.id);
    A.store.deleteTask(y.id);
    B.advance(5000);
    B.store.updateTask(y.id, { body_md: '删了又改（后改）' });
    await A.sync();
    await B.sync();
    await A.sync();
    for (const D of [A, B]) {
      expect(D.store.get('task', x.id)).toBeUndefined();
      expect(D.store.raw('task', x.id)!.deleted).toBe(true);
      expect(D.store.get('task', y.id)?.body_md).toBe('删了又改（后改）');
    }
  });

  it('check_in 只追加：两边离线各打一次卡，合并后进度是两次之和', async () => {
    const remote = new MemoryRemote();
    const A = await device(remote, 'devA');
    const B = await device(remote, 'devB');
    const t = A.store.createTask({ body_md: '喝水', completion_mode: 'count', target_value: 8, unit: '杯', recurrence: 'FREQ=DAILY' });
    await A.sync();
    await B.sync();
    A.advance(1000);
    B.advance(1000);
    A.store.checkIn(t.id, 'add', 2);
    B.store.checkIn(t.id, 'add', 3);
    await A.sync();
    await B.sync();
    await A.sync();
    expect(A.store.checkInsOf(t.id)).toHaveLength(2);
    expect(B.store.checkInsOf(t.id)).toHaveLength(2);
    expect(A.store.progress(t.id)!.value).toBe(5);
    expect(B.store.progress(t.id)!.value).toBe(5);
  });

  it('两台设备各加一条边、合并后成环：后到的那条标冲突，两边一致，生效的图无环', async () => {
    const remote = new MemoryRemote();
    const A = await device(remote, 'devA');
    const B = await device(remote, 'devB');
    const x = A.store.createTask({ body_md: 'X' });
    const y = A.store.createTask({ body_md: 'Y' });
    await A.sync();
    await B.sync();
    A.advance(1000);
    A.store.addDependency(x.id, y.id);
    B.advance(3000);
    B.store.addDependency(y.id, x.id);
    await A.sync();
    await B.sync();
    await A.sync();
    for (const D of [A, B]) {
      expect(D.store.edges()).toEqual([{ pred_id: x.id, succ_id: y.id }]);
      expect(D.store.conflictEdges().map((e) => [e.pred_id, e.succ_id])).toEqual([[y.id, x.id]]);
      expect(D.store.derived().get(y.id)?.state).toBe('被阻塞');
    }
    // 去掉冲突那条，冲突消失并同步到另一台
    B.store.removeDependency(y.id, x.id);
    await B.sync();
    await A.sync();
    expect(A.store.conflictEdges()).toEqual([]);
  });

  it('两台设备连了同一对：只算一条边，去掉时两行一起去掉', async () => {
    const remote = new MemoryRemote();
    const A = await device(remote, 'devA');
    const B = await device(remote, 'devB');
    const x = A.store.createTask({ body_md: 'X' });
    const y = A.store.createTask({ body_md: 'Y' });
    await A.sync();
    await B.sync();
    A.store.addDependency(x.id, y.id);
    B.store.addDependency(x.id, y.id);
    await A.sync();
    await B.sync();
    await A.sync();
    expect(A.store.list('dependency')).toHaveLength(2);
    expect(A.store.edges()).toHaveLength(1);
    expect(A.store.conflictEdges()).toHaveLength(0);
    A.store.removeDependency(x.id, y.id);
    await A.sync();
    await B.sync();
    expect(B.store.edges()).toHaveLength(0);
  });

  it('新设备只有演示数据、云端已有数据：演示数据不带上去，只留云端的', async () => {
    const remote = new MemoryRemote();
    const A = await device(remote, 'devA');
    A.store.createTask({ body_md: '真的事' });
    await A.sync();
    const B = await device(remote, 'devB');
    seedDemo(B.store);
    await B.adapter.setMeta('demo_seeded', 'x');
    await B.store.flush();
    expect(B.store.tasks().length).toBeGreaterThan(5);
    expect(await B.engine.isPristineDemo()).toBe(true);
    await B.sync();
    expect(B.bodies()).toEqual(['真的事']);
    await A.sync();
    expect(A.bodies()).toEqual(['真的事']);
    // 云端里演示数据只有墓碑
    expect(remote.size).toBeGreaterThan(1);
  });

  it('演示数据被改过：不算“只有演示数据”，照常合并、一行不丢', async () => {
    const remote = new MemoryRemote();
    const A = await device(remote, 'devA');
    A.store.createTask({ body_md: '真的事' });
    await A.sync();
    const B = await device(remote, 'devB');
    seedDemo(B.store);
    await B.adapter.setMeta('demo_seeded', 'x');
    await B.store.flush();
    B.advance(60_000);
    B.store.createTask({ body_md: 'B 自己加的' });
    expect(await B.engine.isPristineDemo()).toBe(false);
    const before = B.store.tasks().length;
    await B.sync();
    expect(B.store.tasks().length).toBe(before + 1);
  });

  it('第一台设备只有演示数据、云端是空的：照常推上去', async () => {
    const remote = new MemoryRemote();
    const A = await device(remote, 'devA');
    seedDemo(A.store);
    await A.adapter.setMeta('demo_seeded', 'x');
    const n = A.store.tasks().length;
    await A.sync();
    const B = await device(remote, 'devB');
    await B.sync();
    expect(B.store.tasks()).toHaveLength(n);
  });

  it('离线：状态是 offline，改动留在本机；联网后推上去', async () => {
    const remote = new MemoryRemote();
    const A = await device(remote, 'devA');
    await A.sync();
    remote.offline = true;
    A.store.createTask({ body_md: '离线写的' });
    await A.sync();
    expect(A.engine.snapshot.phase).toBe('offline');
    expect((await A.adapter.pendingOutbox()).length).toBeGreaterThan(0);
    remote.offline = false;
    await A.sync();
    expect(A.engine.snapshot.phase).toBe('idle');
    expect(await A.adapter.pendingOutbox()).toHaveLength(0);
    const B = await device(remote, 'devB');
    await B.sync();
    expect(B.bodies()).toEqual(['离线写的']);
  });

  it('凭据被拒（401）：状态 error + needsLogin，说明里带「401 未登录」', async () => {
    const remote = new MemoryRemote();
    const transport: SyncTransport = {
      push: async () => {
        throw new SyncHttpError(401, '401 未登录');
      },
      pull: async () => {
        throw new SyncHttpError(401, '401 未登录');
      },
    };
    const A = await device(remote, 'devA', { transport });
    await A.sync();
    expect(A.engine.snapshot).toMatchObject({ phase: 'error', needsLogin: true });
    expect(A.engine.snapshot.error).toContain('401 未登录');
  });

  it('本机写入后防抖推送；拉下来的行不会再触发推送', async () => {
    const remote = new MemoryRemote();
    const A = await device(remote, 'devA');
    const B = await device(remote, 'devB');
    await A.engine.start();
    await A.sync();
    const pushes = remote.pushes;
    A.store.createTask({ body_md: '防抖' });
    A.store.createTask({ body_md: '防抖 2' });
    A.advance(2000);
    await A.fireTimers();
    expect(remote.pushes).toBe(pushes + 1);
    await B.engine.start();
    await B.sync();
    const p2 = remote.pushes;
    B.advance(5000);
    await B.fireTimers();
    // B 只是拉到了 A 的两件事：没有本机写入，就不会推送
    expect(B.bodies()).toEqual(['防抖', '防抖 2']);
    expect(remote.pushes).toBe(p2);
    await A.engine.stop();
    await B.engine.stop();
  });

  it('退出登录（stop）后本机数据还在，不再推送', async () => {
    const remote = new MemoryRemote();
    const A = await device(remote, 'devA');
    await A.engine.start();
    await A.sync();
    await A.engine.stop();
    A.store.createTask({ body_md: '退出后写的' });
    await A.sync();
    expect(A.bodies()).toEqual(['退出后写的']);
    expect(remote.get('task', A.store.tasks()[0]!.id)).toBeUndefined();
  });

  it('SQLite 存储：拉下来的行写进库但不进 outbox，重开后还在', async () => {
    const remote = new MemoryRemote();
    const A = await device(remote, 'devA');
    A.store.createTask({ body_md: '从 A 来' });
    await A.sync();
    const driver = new NodeSqliteDriver();
    const sql = new SqlAdapter(driver);
    const B = await device(remote, 'devB', { adapter: sql });
    await B.sync();
    expect(await sql.pendingOutbox()).toHaveLength(0);
    const reopened = await Store.open(new SqlAdapter(driver), { deviceId: 'devB' });
    expect(reopened.tasks().map((t) => t.body_md)).toEqual(['从 A 来']);
  });

  it('本机清空（重置）后 resetSyncState：下次重新合并，云端的数据全部回来', async () => {
    const remote = new MemoryRemote();
    const A = await device(remote, 'devA');
    A.store.createTask({ body_md: '云端有的' });
    await A.engine.start();
    await A.sync();
    await A.engine.stop();
    await A.adapter.clear();
    await resetSyncState(A.adapter);
    const A2 = await device(remote, 'devA', { adapter: A.adapter });
    expect(A2.store.tasks()).toHaveLength(0);
    await A2.sync();
    expect(A2.bodies()).toEqual(['云端有的']);
  });

  it('内置类型与打卡分类是种子行（时间戳 0），不算数据', () => {
    expect(isSeedRow({ updated_at: '0000000000000-0002-builtin' })).toBe(true);
    expect(isSeedRow({ updated_at: '1792077308000-0000-devA' })).toBe(false);
  });
});
