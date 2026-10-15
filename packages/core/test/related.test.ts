import { describe, expect, it } from 'vitest';
import { Store } from '../src/store';
import { MemoryAdapter } from '../src/storage/memory';
import { WebStorageAdapter, type KVStorage } from '../src/storage/web';
import { SqlAdapter, migrate } from '../src/storage/sql';
import { MIGRATIONS } from '../src/storage/schema';
import { deriveAll } from '../src/dag';
import { seedDemo } from '../src/seed/demo';
import { LinkedByDependencyError, SelfLinkError, canonicalPair, relatedIdsOf, taskLinkId, visibleLinks } from '../src/related';
import type { TaskLink } from '../src/types';
import type { StorageAdapter } from '../src/storage/adapter';
import { local } from './helpers';
import { NodeSqliteDriver, TursoNodeDriver } from './sql-drivers';

class FakeKV implements KVStorage {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

async function open(adapter: StorageAdapter = new MemoryAdapter(), deviceId = 'dev1') {
  let t = local(2026, 10, 15, 10).getTime();
  const store = await Store.open(adapter, { deviceId, now: () => new Date((t += 1000)) });
  return store;
}

const link = (a: string, b: string, patch: Partial<TaskLink> = {}): TaskLink => ({
  id: taskLinkId(a, b),
  updated_at: '',
  deleted: false,
  a_task_id: canonicalPair(a, b)[0],
  b_task_id: canonicalPair(a, b)[1],
  note: '',
  created_at: '2026-10-15T00:00:00.000Z',
  ...patch,
});

describe('相关任务：纯函数', () => {
  it('规范顺序与确定 id 和先后无关，像 UUID', () => {
    expect(canonicalPair('b', 'a')).toEqual(['a', 'b']);
    expect(taskLinkId('x', 'y')).toBe(taskLinkId('y', 'x'));
    expect(taskLinkId('x', 'y')).not.toBe(taskLinkId('x', 'z'));
    expect(taskLinkId('x', 'y')).toMatch(/^00000000-[0-9a-f]{4}-7[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('有前后关系的一对不显示（前后关系优先），墓碑与自连也不显示', () => {
    const links = [link('a', 'b'), link('a', 'c'), link('c', 'd', { deleted: true }), { ...link('e', 'e') }];
    const shown = visibleLinks(links, [{ pred_id: 'b', succ_id: 'a' }]);
    expect(shown.map((l) => l.id)).toEqual([taskLinkId('a', 'c')]);
    expect(relatedIdsOf(shown, 'c')).toEqual(['a']);
  });
});

describe('Store 相关任务', () => {
  it('连上、两边都能看到、重复连是同一行、去掉', async () => {
    const s = await open();
    const a = s.createTask({ body_md: 'A' });
    const b = s.createTask({ body_md: 'B' });
    const l1 = s.linkTasks(a.id, b.id);
    const l2 = s.linkTasks(b.id, a.id);
    expect(l2.id).toBe(l1.id);
    expect(s.list('task_link')).toHaveLength(1);
    expect(s.relatedTasks(a.id).map((t) => t.id)).toEqual([b.id]);
    expect(s.relatedTasks(b.id).map((t) => t.id)).toEqual([a.id]);
    expect(s.isRelated(b.id, a.id)).toBe(true);
    s.unlinkTasks(b.id, a.id);
    expect(s.relatedTasks(a.id)).toEqual([]);
    expect(s.listAll('task_link')[0]!.deleted).toBe(true);
    // 再连上：同一行墓碑翻回来，不多出一行
    s.linkTasks(a.id, b.id);
    expect(s.listAll('task_link')).toHaveLength(1);
    expect(s.relatedTasks(a.id)).toHaveLength(1);
  });

  it('不阻塞：相关不影响可开始，也不进环检测', async () => {
    const s = await open();
    const a = s.createTask({ body_md: 'A' });
    const b = s.createTask({ body_md: 'B' });
    const c = s.createTask({ body_md: 'C' });
    s.linkTasks(a.id, b.id);
    s.linkTasks(b.id, c.id);
    s.linkTasks(c.id, a.id); // 相关可以绕成圈，没关系
    expect(deriveAll(s.list('task'), s.edges()).get(b.id)!.state).toBe('可开始');
    expect(s.edges()).toHaveLength(0);
    // 依赖照常可加，不被相关当成环
    s.addDependency(a.id, b.id);
    s.addDependency(b.id, c.id);
    expect(s.derived().get(c.id)!.state).toBe('被阻塞');
    expect(s.completeTask(a.id).unlocked.map((t) => t.id)).toEqual([b.id]);
  });

  it('自己和自己、已有前后关系的两件不能连', async () => {
    const s = await open();
    const a = s.createTask({ body_md: 'A' });
    const b = s.createTask({ body_md: 'B' });
    expect(() => s.linkTasks(a.id, a.id)).toThrow(SelfLinkError);
    s.addDependency(a.id, b.id);
    expect(() => s.linkTasks(b.id, a.id)).toThrow(LinkedByDependencyError);
    expect(s.list('task_link')).toHaveLength(0);
  });

  it('先相关、后加了前后关系：只按前后关系显示；去掉前后关系又回来', async () => {
    const s = await open();
    const a = s.createTask({ body_md: 'A' });
    const b = s.createTask({ body_md: 'B' });
    s.linkTasks(a.id, b.id);
    s.addDependency(a.id, b.id);
    expect(s.relatedTasks(a.id)).toEqual([]);
    expect(s.taskLinks()).toEqual([]);
    s.removeDependency(a.id, b.id);
    expect(s.relatedTasks(a.id).map((t) => t.id)).toEqual([b.id]);
  });

  it('删除任务时它的相关行一起打墓碑', async () => {
    const s = await open();
    const a = s.createTask({ body_md: 'A' });
    const b = s.createTask({ body_md: 'B' });
    const c = s.createTask({ body_md: 'C' });
    s.linkTasks(a.id, b.id);
    s.linkTasks(c.id, b.id);
    s.deleteTask(b.id);
    expect(s.list('task_link')).toHaveLength(0);
    expect(s.relatedTasks(a.id)).toEqual([]);
    expect(s.listAll('task_link').every((l) => l.deleted)).toBe(true);
  });

  it('两台设备各自连同一对：同一个 id，合并后只有一行', async () => {
    const s1 = await open(new MemoryAdapter(), 'd1');
    const a = s1.createTask({ id: '01890000-0000-7000-8000-00000000000a', body_md: 'A' });
    const b = s1.createTask({ id: '01890000-0000-7000-8000-00000000000b', body_md: 'B' });
    const s2 = await open(new MemoryAdapter(), 'd2');
    s2.createTask({ id: a.id, body_md: 'A' });
    s2.createTask({ id: b.id, body_md: 'B' });
    expect(s1.linkTasks(a.id, b.id).id).toBe(s2.linkTasks(b.id, a.id).id);
  });

  it('演示数据里有相关任务，且都不和前后关系重叠', async () => {
    const s = await open();
    seedDemo(s);
    expect(s.list('task_link').length).toBeGreaterThanOrEqual(2);
    expect(s.taskLinks()).toHaveLength(s.list('task_link').length);
  });
});

describe('相关任务落盘', () => {
  const cases: Array<[string, () => Promise<() => Promise<StorageAdapter>>]> = [
    [
      'localStorage（旧数据没有这张表）',
      async () => {
        const kv = new FakeKV();
        kv.setItem('mindough:v1:table:task', '[]');
        return async () => new WebStorageAdapter(kv);
      },
    ],
    [
      'SQLite v2 → v3（node:sqlite）',
      async () => {
        const d = new NodeSqliteDriver();
        await migrate(d, MIGRATIONS.slice(0, 2));
        return async () => new SqlAdapter(d);
      },
    ],
    [
      'SQLite v2 → v3（Turso）',
      async () => {
        const d = await TursoNodeDriver.open();
        await migrate(d, MIGRATIONS.slice(0, 2));
        return async () => new SqlAdapter(d);
      },
    ],
  ];

  it.each(cases)('%s：连上、重开还在', async (_n, make) => {
    const adapter = await make();
    const s1 = await open(await adapter());
    const a = s1.createTask({ body_md: 'A' });
    const b = s1.createTask({ body_md: 'B' });
    s1.linkTasks(a.id, b.id);
    await s1.flush();
    const s2 = await open(await adapter());
    expect(s2.relatedTasks(b.id).map((t) => t.body_md)).toEqual(['A']);
    expect(s2.list('task_link')[0]).toMatchObject({ a_task_id: canonicalPair(a.id, b.id)[0], note: '' });
  });
});
