import { describe, expect, it } from 'vitest';
import { Store } from '../src/store';
import { MemoryAdapter } from '../src/storage/memory';
import { CycleError } from '../src/dag';
import { BUILTIN_TASK_TYPES, BUILTIN_TYPE_IDS } from '../src/seed/builtin-types';
import { formatRecurrence } from '../src/recurrence';
import { isUuidv7 } from '../src/uuid';
import { local, mkTask } from './helpers';
import type { TaskStatus } from '../src/types';

async function open(now = local(2026, 10, 15, 10)) {
  let t = now.getTime();
  const adapter = new MemoryAdapter();
  const store = await Store.open(adapter, { deviceId: 'dev1', now: () => new Date(t) });
  return { store, adapter, advance: (ms: number) => (t += ms) };
}

describe('Store', () => {
  it('打开时补齐 11 个内置类型（普通 + 10 种）', async () => {
    const { store, adapter } = await open();
    expect(store.list('task_type')).toHaveLength(11);
    await store.flush();
    expect((await adapter.loadAll()).task_type).toHaveLength(BUILTIN_TASK_TYPES.length);
  });

  it('新建任务：UUIDv7 id、HLC updated_at、类型预填正文模板与默认完成方式', async () => {
    const { store } = await open();
    const t = store.createTask({ type_id: BUILTIN_TYPE_IDS.travel });
    expect(isUuidv7(t.id)).toBe(true);
    expect(t.updated_at).toMatch(/^\d{13}-[0-9a-f]{4}-dev1$/);
    expect(t.body_md).toContain('## 行程');
    expect(t.completion_mode).toBe('countdown');
    expect(t.deleted).toBe(false);
  });

  it('组的默认类型自动套用', async () => {
    const { store } = await open();
    const g = store.insert('group', { name: '看片', icon: '🎬', start_at: null, end_at: null, category_id: null, default_type_id: BUILTIN_TYPE_IDS.movie });
    expect(store.createTask({ group_id: g.id }).type_id).toBe(BUILTIN_TYPE_IDS.movie);
  });

  it('加依赖过环检测，成环不写入', async () => {
    const { store } = await open();
    const a = store.createTask({ body_md: 'a' });
    const b = store.createTask({ body_md: 'b' });
    store.addDependency(a.id, b.id);
    const v = store.version;
    expect(() => store.addDependency(b.id, a.id)).toThrow(CycleError);
    expect(store.version).toBe(v);
    expect(store.edges()).toHaveLength(1);
  });

  it('完成任务返回解锁的后续；派生状态跟着变', async () => {
    const { store } = await open();
    const a = store.createTask({ body_md: 'a' });
    const b = store.createTask({ body_md: 'b' });
    const c = store.createTask({ body_md: 'c' });
    store.addDependency(a.id, c.id);
    store.addDependency(b.id, c.id);
    expect(store.derived().get(c.id)).toEqual({ state: '被阻塞', missing: [a.id, b.id] });
    expect(store.completeTask(a.id).unlocked).toEqual([]);
    const r = store.completeTask(b.id);
    expect(r.unlocked.map((t) => t.id)).toEqual([c.id]);
    expect(store.derived().get(c.id)?.state).toBe('可开始');
    expect(store.get('task', b.id)?.done_at).toBeTruthy();
  });

  it('“然后呢？”新建后续并连上依赖', async () => {
    const { store } = await open();
    const a = store.createTask({ body_md: 'a' });
    const next = store.createSuccessor(a.id, { body_md: '然后' });
    expect(store.edges()).toEqual([{ pred_id: a.id, succ_id: next.id }]);
  });

  it('删除只打墓碑，并连带依赖、我的一天、人物关联', async () => {
    const { store } = await open();
    const a = store.createTask({ body_md: 'a' });
    const b = store.createTask({ body_md: 'b' });
    store.addDependency(a.id, b.id);
    store.addToMyDay(a.id);
    const p = store.insert('person', { name: '小林', avatar_asset_id: null, relation: null, birthday: null, note_md: '' });
    store.linkPerson(a.id, p.id);
    store.deleteTask(a.id);
    expect(store.get('task', a.id)).toBeUndefined();
    expect(store.listAll('task').find((t) => t.id === a.id)?.deleted).toBe(true);
    expect(store.edges()).toEqual([]);
    expect(store.list('my_day')).toEqual([]);
    expect(store.tasksOfPerson(p.id)).toEqual([]);
  });

  it('我的一天：去重、移除、排序', async () => {
    const { store } = await open();
    const a = store.createTask({ body_md: 'a' });
    const b = store.createTask({ body_md: 'b' });
    store.addToMyDay(a.id);
    store.addToMyDay(a.id);
    store.addToMyDay(b.id);
    expect(store.list('my_day')).toHaveLength(2);
    store.reorderMyDay('2026-10-15', [b.id, a.id]);
    const sorted = store.list('my_day').sort((x, y) => x.sort - y.sort);
    expect(sorted.map((e) => e.task_id)).toEqual([b.id, a.id]);
    store.removeFromMyDay(a.id);
    expect(store.isInMyDay(a.id)).toBe(false);
    expect(store.isInMyDay(b.id)).toBe(true);
  });

  it('计量打卡：非重复任务达标自动完成并解锁后续', async () => {
    const { store } = await open();
    const w = store.createTask({ body_md: '喝水', completion_mode: 'count', target_value: 2 });
    const next = store.createSuccessor(w.id, { body_md: '下一步' });
    expect(store.checkIn(w.id, 'add', 1).completed).toBeNull();
    const r = store.checkIn(w.id, 'add', 1);
    expect(r.progress.met).toBe(true);
    expect(r.completed?.unlocked.map((t) => t.id)).toEqual([next.id]);
    expect(store.get('task', w.id)?.status).toBe('完成');
  });

  it('计时打卡：开始→进行中，结束且达标才完成', async () => {
    const { store, advance } = await open();
    const f = store.createTask({ body_md: '断食', completion_mode: 'timer', target_value: 3600_000 });
    store.checkIn(f.id, 'start');
    expect(store.get('task', f.id)?.status).toBe('进行中');
    advance(30 * 60_000);
    expect(store.progress(f.id)?.running).toBe(true);
    advance(31 * 60_000);
    const r = store.checkIn(f.id, 'stop');
    expect(r.progress.met).toBe(true);
    expect(store.get('task', f.id)?.status).toBe('完成');
  });

  it('重复任务的打卡按周期记录，不改任务状态', async () => {
    const { store } = await open();
    const r = store.createTask({ body_md: '冥想', recurrence: formatRecurrence({ kind: 'daily' }) });
    store.checkIn(r.id, 'add', 1);
    expect(store.list('check_in')[0]!.period_key).toBe('2026-10-15');
    expect(store.progress(r.id)?.met).toBe(true);
    expect(store.progress(r.id, '2026-10-16')?.met).toBe(false);
    expect(store.get('task', r.id)?.status).toBe('待办');
  });

  it('“人物”类型的人物字段也算关联', async () => {
    const { store } = await open();
    const p = store.insert('person', { name: '妈妈', avatar_asset_id: null, relation: '家人', birthday: null, note_md: '' });
    const t = store.createTask({ type_id: BUILTIN_TYPE_IDS.person, type_data: { person: p.id } });
    expect(store.tasksOfPerson(p.id).map((x) => x.id)).toEqual([t.id]);
  });

  it('关闭也算结束：解锁后续、记 done_at；可以重新打开', async () => {
    const { store } = await open();
    const a = store.createTask({ body_md: 'a' });
    const c = store.createTask({ body_md: 'c' });
    store.addDependency(a.id, c.id);
    const r = store.closeTask(a.id);
    expect(r.task.status).toBe('关闭');
    expect(r.task.done_at).toBeTruthy();
    expect(r.unlocked.map((t) => t.id)).toEqual([c.id]);
    expect(store.derived().get(a.id)?.state).toBe('关闭');
    const back = store.reopenTask(a.id);
    expect(back.status).toBe('待办');
    expect(back.done_at).toBeNull();
    expect(store.derived().get(c.id)?.state).toBe('被阻塞');
  });

  it('打开时把旧数据的“取消”迁移成“关闭”并进 outbox', async () => {
    const adapter = new MemoryAdapter();
    const legacy = { ...mkTask('t-old'), status: '取消' as unknown as TaskStatus, updated_at: '0000000000001-0000-x' };
    await adapter.applyChanges([{ table: 'task', row: legacy }]);
    await adapter.ackOutbox(1e9);
    const s = await Store.open(adapter, { deviceId: 'dev1' });
    expect(s.get('task', 't-old')?.status).toBe('关闭');
    await s.flush();
    expect((await adapter.loadAll()).task.find((t) => t.id === 't-old')?.status).toBe('关闭');
    expect((await adapter.pendingOutbox()).some((e) => e.id === 't-old')).toBe(true);
  });

  it('批量写入只通知一次、落盘一次；重开后数据还在且时钟不倒退', async () => {
    const { store, adapter } = await open();
    let calls = 0;
    store.subscribe(() => calls++);
    store.batch(() => {
      for (let i = 0; i < 20; i++) store.createTask({ body_md: `t${i}` });
    });
    expect(calls).toBe(1);
    await store.flush();
    const reopened = await Store.open(adapter, { deviceId: 'dev1', now: () => local(2026, 10, 15, 9) });
    expect(reopened.tasks()).toHaveLength(20);
    const maxOld = reopened.tasks().map((t) => t.updated_at).sort().at(-1)!;
    expect(reopened.createTask().updated_at > maxOld).toBe(true);
  });

  it('复制内置类型得到可改的自定义类型', async () => {
    const { store } = await open();
    const copy = store.duplicateType(BUILTIN_TYPE_IDS.book, '漫画');
    expect(copy.builtin).toBe(false);
    expect(copy.fields.map((f) => f.key)).toContain('cover');
    expect(copy.id).not.toBe(BUILTIN_TYPE_IDS.book);
  });

  it('没有 deviceId 时生成并保存', async () => {
    const adapter = new MemoryAdapter();
    const s = await Store.open(adapter);
    expect(await adapter.getMeta('device_id')).toBe(s.deviceId);
  });
});
