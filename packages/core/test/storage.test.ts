import { describe, expect, it } from 'vitest';
import { MemoryAdapter } from '../src/storage/memory';
import { WebStorageAdapter, type KVStorage } from '../src/storage/web';
import { lwwPick } from '../src/storage/adapter';
import { mkTask } from './helpers';

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

describe('行级 LWW', () => {
  it('updated_at 大者胜，相等保留已有', () => {
    const a = { ...mkTask('x', { body_md: 'a' }), updated_at: '2' };
    const b = { ...mkTask('x', { body_md: 'b' }), updated_at: '1' };
    expect(lwwPick(a, b).body_md).toBe('a');
    expect(lwwPick(b, a).body_md).toBe('a');
    expect(lwwPick(undefined, b).body_md).toBe('b');
  });
});

describe.each([
  ['memory', () => new MemoryAdapter()],
  ['localStorage', () => new WebStorageAdapter(new FakeKV())],
])('%s 适配器', (_name, make) => {
  it('写入、读回、outbox、ack', async () => {
    const ad = make();
    await ad.applyChanges([{ table: 'task', row: { ...mkTask('t1'), updated_at: '1' } }]);
    await ad.applyChanges([{ table: 'task', row: { ...mkTask('t1', { body_md: '新' }), updated_at: '2' } }]);
    const snap = await ad.loadAll();
    expect(snap.task).toHaveLength(1);
    expect(snap.task[0]!.body_md).toBe('新');
    const ob = await ad.pendingOutbox();
    expect(ob.map((e) => e.updated_at)).toEqual(['1', '2']);
    await ad.ackOutbox(ob[0]!.seq);
    expect((await ad.pendingOutbox()).map((e) => e.updated_at)).toEqual(['2']);
  });

  it('旧数据不覆盖新数据', async () => {
    const ad = make();
    await ad.applyChanges([{ table: 'task', row: { ...mkTask('t1', { body_md: '新' }), updated_at: '5' } }]);
    await ad.applyChanges([{ table: 'task', row: { ...mkTask('t1', { body_md: '旧' }), updated_at: '3' } }]);
    expect((await ad.loadAll()).task[0]!.body_md).toBe('新');
  });

  it('meta 与 clear', async () => {
    const ad = make();
    await ad.setMeta('device_id', 'abc');
    expect(await ad.getMeta('device_id')).toBe('abc');
    await ad.applyChanges([{ table: 'task', row: { ...mkTask('t1'), updated_at: '1' } }]);
    await ad.clear();
    expect((await ad.loadAll()).task).toEqual([]);
    expect(await ad.getMeta('device_id')).toBe('abc');
  });
});

describe('localStorage 适配器持久化', () => {
  it('重新打开后数据和 outbox 都还在', async () => {
    const kv = new FakeKV();
    const a = new WebStorageAdapter(kv);
    await a.applyChanges([{ table: 'task', row: { ...mkTask('t1'), updated_at: '1' } }]);
    await a.setMeta('k', 'v');
    const b = new WebStorageAdapter(kv);
    expect((await b.loadAll()).task.map((t) => t.id)).toEqual(['t1']);
    expect(await b.getMeta('k')).toBe('v');
    expect(await b.pendingOutbox()).toHaveLength(1);
    await b.applyChanges([{ table: 'task', row: { ...mkTask('t2'), updated_at: '2' } }]);
    expect((await b.pendingOutbox()).map((e) => e.seq)).toEqual([1, 2]);
  });

  it('损坏的 JSON 不会让 app 打不开', async () => {
    const kv = new FakeKV();
    kv.setItem('mindough:v1:table:task', '{坏了');
    expect((await new WebStorageAdapter(kv).loadAll()).task).toEqual([]);
  });
});
