import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { MemoryAdapter } from '../src/storage/memory';
import { WebStorageAdapter, type KVStorage } from '../src/storage/web';
import { lwwPick, type StorageAdapter } from '../src/storage/adapter';
import { SqlAdapter, migrate } from '../src/storage/sql';
import { COLUMNS, MIGRATIONS, SCHEMA_VERSION } from '../src/storage/schema';
import { migrateStorage, MIGRATED_META_KEY } from '../src/storage/migrate';
import { Store } from '../src/store';
import { seedDemo } from '../src/seed/demo';
import { TABLES } from '../src/types';
import { local, mkTask } from './helpers';
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

const tmp = mkdtempSync(join(tmpdir(), 'mindough-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('行级 LWW', () => {
  it('updated_at 大者胜，相等保留已有', () => {
    const a = { ...mkTask('x', { body_md: 'a' }), updated_at: '2' };
    const b = { ...mkTask('x', { body_md: 'b' }), updated_at: '1' };
    expect(lwwPick(a, b).body_md).toBe('a');
    expect(lwwPick(b, a).body_md).toBe('a');
    expect(lwwPick(undefined, b).body_md).toBe('b');
  });
});

/** 同一套仓库契约：内存、localStorage、SQLite（node:sqlite）、SQLite（Turso 引擎）都要过。 */
const ADAPTERS: Array<[string, () => Promise<StorageAdapter>]> = [
  ['memory', async () => new MemoryAdapter()],
  ['localStorage', async () => new WebStorageAdapter(new FakeKV())],
  ['sqlite（node:sqlite）', async () => new SqlAdapter(new NodeSqliteDriver())],
  ['sqlite（Turso）', async () => new SqlAdapter(await TursoNodeDriver.open())],
];

describe.each(ADAPTERS)('%s 适配器契约', (_name, make) => {
  it('写入、读回、outbox、ack', async () => {
    const ad = await make();
    await ad.applyChanges([{ table: 'task', row: { ...mkTask('t1'), updated_at: '1' } }]);
    await ad.applyChanges([{ table: 'task', row: { ...mkTask('t1', { body_md: '新' }), updated_at: '2' } }]);
    const snap = await ad.loadAll();
    expect(snap.task).toHaveLength(1);
    expect(snap.task[0]!.body_md).toBe('新');
    const ob = await ad.pendingOutbox();
    expect(ob.map((e) => e.updated_at)).toEqual(['1', '2']);
    expect(ob[0]).toMatchObject({ table: 'task', id: 't1' });
    await ad.ackOutbox(ob[0]!.seq);
    expect((await ad.pendingOutbox()).map((e) => e.updated_at)).toEqual(['2']);
  });

  it('旧数据不覆盖新数据；相同 updated_at 保留已有', async () => {
    const ad = await make();
    await ad.applyChanges([{ table: 'task', row: { ...mkTask('t1', { body_md: '新' }), updated_at: '5' } }]);
    await ad.applyChanges([{ table: 'task', row: { ...mkTask('t1', { body_md: '旧' }), updated_at: '3' } }]);
    await ad.applyChanges([{ table: 'task', row: { ...mkTask('t1', { body_md: '同时' }), updated_at: '5' } }]);
    expect((await ad.loadAll()).task[0]!.body_md).toBe('新');
  });

  it('meta 与 clear（clear 保留 meta、清空 outbox）', async () => {
    const ad = await make();
    await ad.setMeta('device_id', 'abc');
    await ad.setMeta('device_id', 'abd');
    expect(await ad.getMeta('device_id')).toBe('abd');
    expect(await ad.getMeta('nope')).toBeNull();
    await ad.applyChanges([{ table: 'task', row: { ...mkTask('t1'), updated_at: '1' } }]);
    await ad.clear();
    expect((await ad.loadAll()).task).toEqual([]);
    expect(await ad.pendingOutbox()).toEqual([]);
    expect(await ad.getMeta('device_id')).toBe('abd');
  });

  it('每种字段类型都能原样读回（JSON、布尔、可空、数字、墓碑）', async () => {
    const ad = await make();
    const task = {
      ...mkTask('t1', {
        type_data: { title: '沙丘', year: 2024, tags: ['a', 'b'], watched: true, none: null },
        target_value: 1.5,
        recurrence: 'FREQ=DAILY',
        category_id: 'c1',
        checkin_category_id: 'c1',
        deleted: true,
      }),
      updated_at: '1',
    };
    const type = {
      id: 'ty',
      updated_at: '1',
      deleted: false,
      name: '影视',
      icon: 'x',
      color: '#fff',
      layout: 'poster' as const,
      fields: [{ key: 'title', label: '片名', kind: 'text' as const, primary: true }],
      body_template: '## 想看理由',
      builtin: true,
      hidden: false,
      default_completion_mode: 'once' as const,
      sort: 3,
    };
    const asset = { id: 'as', updated_at: '1', deleted: false, sha256: 'h', mime: 'image/png', width: null, height: 30, r2_key: null, url: 'data:x' };
    await ad.applyChanges([
      { table: 'task', row: task },
      { table: 'task_type', row: type },
      { table: 'asset', row: asset },
    ]);
    const snap = await ad.loadAll();
    expect(snap.task[0]).toEqual(task);
    expect(snap.task_type[0]).toEqual(type);
    expect(snap.asset[0]).toEqual(asset);
  });

  it('Store 跑完整演示数据后，重开读回与写入时一致', async () => {
    const ad = await make();
    const now = local(2026, 10, 15, 20);
    const s1 = await Store.open(ad, { deviceId: 'd1', now: () => now });
    seedDemo(s1);
    await s1.flush();
    const s2 = await Store.open(ad, { deviceId: 'd1', now: () => now });
    for (const t of TABLES) {
      const byId = (rows: { id: string }[]) => [...rows].sort((a, b) => (a.id < b.id ? -1 : 1));
      expect(byId(s2.listAll(t))).toEqual(byId(s1.listAll(t)));
    }
    expect(s2.tasks().some((t) => t.status === '关闭')).toBe(true);
  });
});

describe('SQLite 迁移', () => {
  it('建出 schema_version，重复迁移是幂等的', async () => {
    const d = new NodeSqliteDriver();
    expect(await migrate(d)).toBe(SCHEMA_VERSION);
    expect(await migrate(d)).toBe(SCHEMA_VERSION);
    const rows = await d.all<{ version: number }>('SELECT version FROM schema_version');
    expect(rows.map((r) => Number(r.version))).toEqual(MIGRATIONS.map((m) => m.version));
  });

  it('每张表的实际列 = id/updated_at/deleted + COLUMNS（与数据模型一致）', async () => {
    const d = new NodeSqliteDriver();
    await migrate(d);
    for (const t of TABLES) {
      const cols = (await d.all<{ name: string }>(`PRAGMA table_info("${t}")`)).map((c) => c.name).sort();
      expect(cols, t).toEqual(['id', 'updated_at', 'deleted', ...Object.keys(COLUMNS[t])].sort());
    }
  });

  it('后加的迁移只跑一次', async () => {
    const d = new NodeSqliteDriver();
    await migrate(d);
    const extra = [...MIGRATIONS, { version: SCHEMA_VERSION + 1, name: '测试', sql: 'CREATE TABLE "x_test" ("a" TEXT);' }];
    expect(await migrate(d, extra)).toBe(SCHEMA_VERSION + 1);
    expect(await migrate(d, extra)).toBe(SCHEMA_VERSION + 1);
  });

  it('文件库：关闭重开后数据、meta、outbox 序号都还在（序号不回退）', async () => {
    const path = join(tmp, 'a.db');
    const d1 = new NodeSqliteDriver(path);
    const a = new SqlAdapter(d1);
    await a.applyChanges([{ table: 'task', row: { ...mkTask('t1'), updated_at: '1' } }]);
    await a.setMeta('k', 'v');
    await a.ackOutbox(1);
    await d1.close();
    const b = new SqlAdapter(new NodeSqliteDriver(path));
    expect((await b.loadAll()).task.map((t) => t.id)).toEqual(['t1']);
    expect(await b.getMeta('k')).toBe('v');
    await b.applyChanges([{ table: 'task', row: { ...mkTask('t2'), updated_at: '2' } }]);
    expect((await b.pendingOutbox()).map((e) => e.seq)).toEqual([2]);
  });

  it('事务：一批里有一行写失败，整批回滚（不留半批、不进 outbox）', async () => {
    const ad = new SqlAdapter(new NodeSqliteDriver());
    const bad = { ...mkTask('t2'), updated_at: '1', created_at: null as unknown as string }; // created_at NOT NULL
    await expect(ad.applyChanges([{ table: 'task', row: { ...mkTask('t1'), updated_at: '1' } }, { table: 'task', row: bad }])).rejects.toThrow();
    expect((await ad.loadAll()).task).toEqual([]);
    expect(await ad.pendingOutbox()).toEqual([]);
    // 之后还能正常写
    await ad.applyChanges([{ table: 'task', row: { ...mkTask('t3'), updated_at: '1' } }]);
    expect((await ad.loadAll()).task).toHaveLength(1);
  });
});

describe('localStorage → SQLite 一次性迁移', () => {
  it('行与 device_id 原样带过去，只迁一次', async () => {
    const kv = new FakeKV();
    const now = local(2026, 10, 15, 20);
    const old = new WebStorageAdapter(kv);
    const s = await Store.open(old, { now: () => now });
    seedDemo(s);
    await s.flush();
    await old.setMeta('demo_seeded', 'x');
    const target = new SqlAdapter(new NodeSqliteDriver());
    const r = await migrateStorage(new WebStorageAdapter(kv), target);
    expect(r.migrated).toBe(true);
    expect(r.rows).toBeGreaterThan(100);
    expect(await target.getMeta('device_id')).toBe(s.deviceId);
    expect(await target.getMeta('demo_seeded')).toBe('x');
    expect(await target.getMeta(MIGRATED_META_KEY)).toBeTruthy();
    const reopened = await Store.open(target, { now: () => now });
    expect(reopened.deviceId).toBe(s.deviceId);
    expect(reopened.tasks().length).toBe(s.tasks().length);
    expect(await migrateStorage(new WebStorageAdapter(kv), target)).toEqual({ migrated: false, rows: 0 });
  });

  it('localStorage 是空的：只打标记', async () => {
    const target = new SqlAdapter(new NodeSqliteDriver());
    expect(await migrateStorage(new WebStorageAdapter(new FakeKV()), target)).toEqual({ migrated: false, rows: 0 });
    expect(await target.getMeta(MIGRATED_META_KEY)).toBeTruthy();
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
