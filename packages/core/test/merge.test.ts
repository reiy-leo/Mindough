import { describe, expect, it } from 'vitest';
import { Store, MergeError } from '../src/store';
import { MemoryAdapter } from '../src/storage/memory';
import { SqlAdapter } from '../src/storage/sql';
import { SyncEngine } from '../src/sync/engine';
import { MemoryRemote } from '../src/sync/memory-remote';
import { BUILTIN_TYPE_IDS } from '../src/seed/builtin-types';
import { duplicateGroups, groupKey, mergeCycleSurvivors, mergeNotes, planItemMerge, resolveMerged } from '../src/merge';
import { local } from './helpers';
import { migratedItemId } from '../src/library';
import { NodeSqliteDriver } from './sql-drivers';
import type { LibraryItem } from '../src/types';

const MOVIE = BUILTIN_TYPE_IDS.movie;
const BOOK = BUILTIN_TYPE_IDS.book;

async function open(deviceId = 'devA', adapter = new MemoryAdapter()) {
  let t = local(2026, 10, 16, 10).getTime();
  const store = await Store.open(adapter, { deviceId, now: () => new Date((t += 1)) });
  return { store, adapter, advance: (ms: number) => (t += ms) };
}

async function device(remote: MemoryRemote, deviceId: string) {
  let t = local(2026, 10, 16, 10).getTime();
  const store = await Store.open(new MemoryAdapter(), { deviceId, now: () => new Date(t) });
  const engine = new SyncEngine(store, remote.transport(), { account: 'rei@example.com', now: () => new Date(t), timers: { set: () => 0, clear: () => {} } });
  return { store, engine, advance: (ms: number) => (t += ms), sync: () => engine.syncNow() };
}

const item = (id: string, patch: Partial<LibraryItem> = {}): LibraryItem => ({
  id,
  updated_at: '',
  deleted: false,
  type_id: MOVIE,
  name: id,
  image: null,
  fields: {},
  note_md: '',
  created_at: '2026-10-01T00:00:00.000Z',
  merged_into: null,
  ...patch,
});

describe('合并的纯逻辑', () => {
  it('目标的非空值优先，空的用来源补；两边不一样的字段算冲突；更多链接合在一起', async () => {
    const { store } = await open();
    const type = store.get('task_type', MOVIE)!;
    const t = item('t', { name: '沙丘2', fields: { year: 2024, imdb: 'tt15239678', links: [{ url: 'https://a.example/x' }] } });
    const s = item('s', { name: '沙丘 2', image: 'https://img/poster.jpg', fields: { year: 2023, kind: '电影', links: [{ url: 'https://a.example/x/' }, { url: 'https://b.example' }] } });
    const plan = planItemMerge(type, t, [s]);
    expect(plan.name).toBe('沙丘2');
    expect(plan.image).toBe('https://img/poster.jpg');
    expect(plan.fields).toMatchObject({ year: 2024, kind: '电影', imdb: 'tt15239678' });
    expect(plan.fields.links).toEqual([{ url: 'https://a.example/x' }, { url: 'https://b.example' }]);
    expect(plan.conflicts.map((c) => c.key).sort()).toEqual(['title', 'year']);
    expect(plan.conflicts.find((c) => c.key === 'year')!.chosen).toBe('t');
    // 选来源的值
    const picked = planItemMerge(type, t, [s], { year: 's', title: 's' });
    expect(picked.fields.year).toBe(2023);
    expect(picked.name).toBe('沙丘 2');
    expect(picked.conflicts.find((c) => c.key === 'year')!.chosen).toBe('s');
  });

  it('备注拼接不重复', () => {
    expect(mergeNotes(['好看', '', '好看', '配乐一流'])).toBe('好看\n\n配乐一流');
    expect(mergeNotes(['好看', '好看。配乐一流'])).toBe('好看。配乐一流');
  });

  it('可能重复：同名或同一个 IMDb 编号（传递成一组），点过「不是同一个」的不再出现', async () => {
    const { store } = await open();
    const type = store.get('task_type', MOVIE)!;
    const rows = [
      item('a', { name: '沙丘 2' }),
      item('b', { name: '沙丘2', fields: { imdb: 'tt15239678' } }),
      item('c', { name: 'Dune: Part Two', fields: { imdb: 'https://www.imdb.com/title/tt15239678/' } }),
      item('d', { name: '奥本海默' }),
    ];
    const g = duplicateGroups(type, rows, { uses: new Map([['c', 3]]) });
    expect(g).toHaveLength(1);
    expect(g[0]!.ids).toEqual(['c', 'a', 'b']);
    expect(g[0]!.reason).toContain('IMDb');
    expect(duplicateGroups(type, rows, { dismissed: new Set([groupKey(['a', 'b', 'c'])]) })).toHaveLength(0);
  });

  it('解析 merged_into 链；成环时留 id 最小的', () => {
    const m = new Map([
      ['a', item('a', { deleted: true, merged_into: 'b' })],
      ['b', item('b', { deleted: true, merged_into: 'c' })],
      ['c', item('c')],
      ['x', item('x', { deleted: true, merged_into: 'y' })],
      ['y', item('y', { deleted: true, merged_into: 'x' })],
    ]);
    expect(resolveMerged((id) => m.get(id), 'a')?.id).toBe('c');
    expect(resolveMerged((id) => m.get(id), 'x')).toBeUndefined();
    expect(mergeCycleSurvivors(m.values(), (id) => m.get(id))).toEqual(['x']);
  });
});

describe('Store.mergeLibraryItems', () => {
  it('任务全部改指目标，来源打墓碑并记 merged_into；字段按选择', async () => {
    const { store } = await open();
    const a = store.createLibraryItem(MOVIE, { name: '沙丘2', fields: { year: 2024 }, note_md: '想二刷' });
    const b = store.createLibraryItem(MOVIE, { name: '沙丘 2', fields: { year: 2023, kind: '电影' }, note_md: 'IMAX' });
    const t1 = store.createTask({ type_id: MOVIE, library_item_id: a.id });
    const t2 = store.createTask({ type_id: MOVIE, library_item_id: b.id, type_data: { episode: { episode: 3 } } });
    const r = store.mergeLibraryItems(a.id, [b.id], { year: b.id });
    expect(r).toMatchObject({ targetId: a.id, merged: 1, movedTasks: 1 });
    const merged = store.get('library_item', a.id)!;
    expect(merged.fields).toMatchObject({ year: 2023, kind: '电影' });
    expect(merged.note_md).toBe('想二刷\n\nIMAX');
    expect(store.get('library_item', b.id)).toBeUndefined();
    expect(store.raw('library_item', b.id)).toMatchObject({ deleted: true, merged_into: a.id });
    expect(store.get('task', t2.id)!.library_item_id).toBe(a.id);
    // 任务字段留在任务上
    expect(store.taskData(store.get('task', t2.id)!)).toMatchObject({ title: '沙丘2', episode: { episode: 3 } });
    expect(store.tasksOfItem(a.id).map((t) => t.id).sort()).toEqual([t1.id, t2.id].sort());
    expect(store.libraryEntries(MOVIE).find((e) => e.id === a.id)!.uses).toBe(2);
  });

  it('不同类型、只选一条、来源不在了：抛 MergeError，不写入', async () => {
    const { store } = await open();
    const a = store.createLibraryItem(MOVIE, { name: '三体' });
    const b = store.createLibraryItem(BOOK, { name: '三体' });
    const v = store.version;
    expect(() => store.mergeLibraryItems(a.id, [b.id])).toThrow(MergeError);
    expect(() => store.mergeLibraryItems(a.id, [a.id])).toThrow(MergeError);
    expect(() => store.mergeLibraryItems(a.id, ['nope'])).toThrow(MergeError);
    expect(store.version).toBe(v);
  });

  it('撤销：目标回到原样，来源回来，改指的任务指回去', async () => {
    const { store } = await open();
    const a = store.createLibraryItem(MOVIE, { name: '沙丘', fields: { year: 2021 } });
    const b = store.createLibraryItem(MOVIE, { name: 'Dune', fields: { kind: '电影' }, note_md: '原著' });
    const t = store.createTask({ type_id: MOVIE, library_item_id: b.id });
    const r = store.mergeLibraryItems(a.id, [b.id]);
    store.undoMerge(r.undo);
    expect(store.get('library_item', a.id)).toMatchObject({ name: '沙丘', fields: { year: 2021 }, note_md: '' });
    expect(store.get('library_item', b.id)).toMatchObject({ name: 'Dune', merged_into: null, note_md: '原著' });
    expect(store.get('task', t.id)!.library_item_id).toBe(b.id);
  });

  it('A 并进 B、再 B 并进 C：最早指着 A 的任务读到 C', async () => {
    const { store } = await open();
    const a = store.createLibraryItem(MOVIE, { name: 'A' });
    const b = store.createLibraryItem(MOVIE, { name: 'B' });
    const c = store.createLibraryItem(MOVIE, { name: 'C' });
    const t = store.createTask({ type_id: MOVIE, library_item_id: a.id });
    store.mergeLibraryItems(b.id, [a.id]);
    store.mergeLibraryItems(c.id, [b.id]);
    expect(store.get('task', t.id)!.library_item_id).toBe(c.id);
    expect(store.itemOf({ library_item_id: a.id })?.id).toBe(c.id);
  });

  it('SQLite：merged_into 落盘，重开后还在', async () => {
    const adapter = new SqlAdapter(new NodeSqliteDriver());
    const { store } = await open('devA', adapter as unknown as MemoryAdapter);
    const a = store.createLibraryItem(MOVIE, { name: '沙丘' });
    const b = store.createLibraryItem(MOVIE, { name: '沙丘 ' });
    store.mergeLibraryItems(a.id, [b.id]);
    await store.flush();
    const again = await Store.open(adapter, { deviceId: 'devA' });
    expect(again.raw('library_item', b.id)).toMatchObject({ deleted: true, merged_into: a.id });
    expect(again.raw('library_item', a.id)!.merged_into).toBeNull();
  });

  it('迁移出来的确定 id 已经被合并掉：旧任务迁移时挂到合并后的那条，不复活墓碑', async () => {
    const { store } = await open();
    // 别的设备迁移出「沙丘」（确定 id），又把它并进了「Dune」
    const sandId = migratedItemId(MOVIE, '沙丘');
    store.insert('library_item', { id: sandId, type_id: MOVIE, name: '沙丘', image: null, fields: {}, note_md: '', created_at: '2026-01-01T00:00:00.000Z' });
    const dune = store.createLibraryItem(MOVIE, { name: 'Dune' });
    store.mergeLibraryItems(dune.id, [sandId]);
    // 这台设备上还有一件没迁移的旧任务（资料直接写在 type_data 里）
    const old = store.createTask({ type_id: MOVIE });
    store.updateTask(old.id, { type_data: { title: '沙丘' } });
    expect(store.migrateToLibrary()).toBe(1);
    expect(store.raw('library_item', sandId)).toMatchObject({ deleted: true, merged_into: dune.id });
    expect(store.get('task', old.id)!.library_item_id).toBe(dune.id);
  });
});

describe('人物合并', () => {
  it('人物关联改指留下的人，同一件任务不重复；撤销还原', async () => {
    const { store } = await open();
    const p1 = store.insert('person', { name: '王小明', avatar_asset_id: null, relation: '朋友', birthday: null, note_md: '' });
    const p2 = store.insert('person', { name: '小明', avatar_asset_id: 'https://img/a.png', relation: '同事', birthday: '1990-05-01', note_md: '爱喝咖啡' });
    const t1 = store.createTask({ body_md: '吃饭' });
    const t2 = store.createTask({ body_md: '还书' });
    store.linkPerson(t1.id, p1.id);
    store.linkPerson(t1.id, p2.id);
    store.linkPerson(t2.id, p2.id);
    const r = store.mergePeople(p1.id, [p2.id], { relation: p2.id });
    expect(r.movedTasks).toBe(2);
    expect(store.get('person', p1.id)).toMatchObject({ name: '王小明', avatar_asset_id: 'https://img/a.png', relation: '同事', birthday: '1990-05-01', note_md: '爱喝咖啡' });
    expect(store.list('task_person').filter((x) => x.task_id === t1.id)).toHaveLength(1);
    expect(store.peopleOf(t2.id).map((p) => p.id)).toEqual([p1.id]);
    expect(store.tasksOfPerson(p1.id)).toHaveLength(2);
    store.undoMerge(r.undo);
    expect(store.get('person', p2.id)).toMatchObject({ name: '小明', merged_into: null });
    expect(store.get('person', p1.id)).toMatchObject({ relation: '朋友', avatar_asset_id: null });
    expect(store.peopleOf(t2.id).map((p) => p.id)).toEqual([p2.id]);
    expect(store.peopleOf(t1.id).map((p) => p.id).sort()).toEqual([p1.id, p2.id].sort());
  });

  it('人物库里同名的人算可能重复', async () => {
    const { store } = await open();
    store.insert('person', { name: '妈妈', avatar_asset_id: null, relation: null, birthday: null, note_md: '' });
    store.insert('person', { name: '妈妈 ', avatar_asset_id: null, relation: null, birthday: null, note_md: '' });
    const g = store.duplicateGroups(BUILTIN_TYPE_IDS.person);
    expect(g.filter((x) => x.ids.length === 2).length).toBeGreaterThanOrEqual(1);
    store.dismissDuplicateGroup(g[0]!.key);
    expect(store.duplicateGroups(BUILTIN_TYPE_IDS.person).find((x) => x.key === g[0]!.key)).toBeUndefined();
  });
});

describe('合并与同步', () => {
  it('B 离线时新建的任务还指着旧 id：同步后读到目标，并改写成目标 id，两边一致', async () => {
    const remote = new MemoryRemote();
    const A = await device(remote, 'devA');
    const B = await device(remote, 'devB');
    const keep = A.store.createLibraryItem(MOVIE, { name: '沙丘2' });
    const dup = A.store.createLibraryItem(MOVIE, { name: '沙丘 2' });
    await A.sync();
    await B.sync();
    // B 离线：用旧的那条新建任务
    B.advance(1000);
    const t = B.store.createTask({ type_id: MOVIE, library_item_id: dup.id, body_md: '二刷' });
    // A 合并
    A.advance(2000);
    A.store.mergeLibraryItems(keep.id, [dup.id]);
    await A.sync();
    await B.sync();
    // B 拉到合并：自己的任务改写到目标
    expect(B.store.get('task', t.id)!.library_item_id).toBe(keep.id);
    await B.sync();
    await A.sync();
    expect(A.store.get('task', t.id)!.library_item_id).toBe(keep.id);
    expect(A.store.itemOf(A.store.get('task', t.id))!.id).toBe(keep.id);
    expect(A.store.tasksOfItem(keep.id).map((x) => x.id)).toEqual([t.id]);
    expect(B.store.libraryItems(MOVIE).map((i) => i.id)).toEqual([keep.id]);
  });

  it('两台设备同时把同一对合并：结果收敛成一条', async () => {
    const remote = new MemoryRemote();
    const A = await device(remote, 'devA');
    const B = await device(remote, 'devB');
    const x = A.store.createLibraryItem(MOVIE, { name: '星际穿越', fields: { year: 2014 } });
    const y = A.store.createLibraryItem(MOVIE, { name: 'Interstellar', fields: { kind: '电影' } });
    const t = A.store.createTask({ type_id: MOVIE, library_item_id: y.id });
    await A.sync();
    await B.sync();
    A.advance(1000);
    B.advance(1500);
    A.store.mergeLibraryItems(x.id, [y.id]);
    B.store.mergeLibraryItems(x.id, [y.id]);
    await A.sync();
    await B.sync();
    await A.sync();
    for (const d of [A, B]) {
      expect(d.store.libraryItems(MOVIE).map((i) => i.id)).toEqual([x.id]);
      expect(d.store.get('library_item', x.id)!.fields).toMatchObject({ year: 2014, kind: '电影' });
      expect(d.store.get('task', t.id)!.library_item_id).toBe(x.id);
    }
  });

  it('两台设备反方向合并（A 并进 B、B 并进 A）：成环的留 id 小的那条，两边一致，任务不丢', async () => {
    const remote = new MemoryRemote();
    const A = await device(remote, 'devA');
    const B = await device(remote, 'devB');
    const x = A.store.createLibraryItem(MOVIE, { name: '星际穿越' });
    const y = A.store.createLibraryItem(MOVIE, { name: 'Interstellar' });
    const tx = A.store.createTask({ type_id: MOVIE, library_item_id: x.id });
    const ty = A.store.createTask({ type_id: MOVIE, library_item_id: y.id });
    await A.sync();
    await B.sync();
    A.advance(1000);
    B.advance(1000);
    A.store.mergeLibraryItems(x.id, [y.id]);
    B.store.mergeLibraryItems(y.id, [x.id]);
    await A.sync();
    await B.sync();
    await A.sync();
    await B.sync();
    const ids = (d: typeof A) => d.store.libraryItems(MOVIE).map((i) => i.id).sort();
    expect(ids(A)).toEqual(ids(B));
    expect(ids(A).length).toBeGreaterThanOrEqual(1);
    for (const d of [A, B])
      for (const t of [tx, ty]) {
        const item = d.store.itemOf(d.store.get('task', t.id));
        expect(item).toBeDefined();
      }
    // 两边同一件任务看到的是同一条
    for (const t of [tx, ty]) expect(A.store.itemOf(A.store.get('task', t.id))!.id).toBe(B.store.itemOf(B.store.get('task', t.id))!.id);
  });

  it('人物：别的设备离线新加的人物关联，同步后改指留下的人', async () => {
    const remote = new MemoryRemote();
    const A = await device(remote, 'devA');
    const B = await device(remote, 'devB');
    const p1 = A.store.insert('person', { name: '王小明', avatar_asset_id: null, relation: null, birthday: null, note_md: '' });
    const p2 = A.store.insert('person', { name: '小明', avatar_asset_id: null, relation: null, birthday: null, note_md: '' });
    const t = A.store.createTask({ body_md: '吃饭' });
    await A.sync();
    await B.sync();
    B.advance(1000);
    B.store.linkPerson(t.id, p2.id);
    A.advance(2000);
    A.store.mergePeople(p1.id, [p2.id]);
    await A.sync();
    await B.sync();
    await A.sync();
    for (const d of [A, B]) {
      expect(d.store.peopleOf(t.id).map((p) => p.id)).toEqual([p1.id]);
      expect(d.store.list('task_person').filter((x) => x.task_id === t.id).map((x) => x.person_id)).toEqual([p1.id]);
    }
  });
});
