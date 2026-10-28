import { describe, expect, it } from 'vitest';
import { Store } from '../src/store';
import { MemoryAdapter } from '../src/storage/memory';
import { SqlAdapter, migrate } from '../src/storage/sql';
import { MIGRATIONS } from '../src/storage/schema';
import { SyncEngine } from '../src/sync/engine';
import { MemoryRemote } from '../src/sync/memory-remote';
import { BUILTIN_CATEGORY_IDS } from '../src/seed/builtin-checkin-categories';
import { BUILTIN_TYPE_IDS } from '../src/seed/builtin-types';
import { isMirrored, refsMirrorOf, refsSummary, taskCategoryId, taskItemId } from '../src/task-refs';
import type { Change } from '../src/storage/adapter';
import type { Task } from '../src/types';
import { local } from './helpers';
import { NodeSqliteDriver } from './sql-drivers';

const SPORT = BUILTIN_CATEGORY_IDS.sport;
const GAME = BUILTIN_CATEGORY_IDS.game;
const READ = BUILTIN_CATEGORY_IDS.reading;

async function open(deviceId = 'dev1', t0 = local(2026, 10, 28, 9).getTime()) {
  let t = t0;
  const store = await Store.open(new MemoryAdapter(), { deviceId, now: () => new Date(t) });
  return { store, tick: (ms = 1000) => (t += ms) };
}

/** 旧客户端（alpha.8）推上来的任务行：没有 refs_mirror，单值照旧。 */
function oldClientRow(base: Task, patch: Partial<Task>, updated_at: string): Change {
  const { refs_mirror: _m, ...rest } = { ...base, ...patch, updated_at };
  return { table: 'task', row: rest as unknown as Task };
}

describe('多类型（task_category）', () => {
  it('挂几个类型、按顺序；第一个写进单值（旧客户端看得到），行 id 由这一对算出', async () => {
    const { store } = await open();
    const t = store.createTask({ body_md: '玩生灵重塑' });
    store.setTaskCategories(t.id, [GAME, SPORT]);
    expect(store.categoryIdsOfTask(t.id)).toEqual([GAME, SPORT]);
    const row = store.get('task', t.id)!;
    expect(row.category_id).toBe(GAME);
    expect(row.checkin_category_id).toBe(GAME);
    expect(isMirrored(row)).toBe(true);
    expect(store.raw('task_category', taskCategoryId(t.id, SPORT))?.deleted).toBe(false);
    // 去掉第一个：第二个顶上来
    store.removeTaskCategory(t.id, GAME);
    expect(store.categoryIdsOfTask(t.id)).toEqual([SPORT]);
    expect(store.get('task', t.id)!.category_id).toBe(SPORT);
    expect(store.raw('task_category', taskCategoryId(t.id, GAME))?.deleted).toBe(true);
    // 再挂回来 = 同一行翻回来
    store.addTaskCategory(t.id, GAME);
    expect(store.raw('task_category', taskCategoryId(t.id, GAME))?.deleted).toBe(false);
    expect(store.categoryIdsOfTask(t.id)).toEqual([SPORT, GAME]);
    expect(store.tasksOfCategory(GAME).map((x) => x.id)).toEqual([t.id]);
    store.setTaskCategories(t.id, []);
    expect(store.get('task', t.id)!.category_id).toBeNull();
  });

  it('新建时直接给 category_id（导入、旧代码路径）：自动补进多值', async () => {
    const { store } = await open();
    const t = store.createTask({ body_md: '跑步', category_id: SPORT });
    expect(store.categoryIdsOfTask(t.id)).toEqual([SPORT]);
    expect(store.raw('task_category', taskCategoryId(t.id, SPORT))).toBeTruthy();
  });

  it('最近用过：每个挂着的类型都算', async () => {
    const { store } = await open();
    const t = store.createTask({ body_md: 'x' });
    store.setTaskCategories(t.id, [GAME, READ]);
    const last = store.categoryLastUsed();
    expect(last.has(GAME)).toBe(true);
    expect(last.has(READ)).toBe(true);
  });
});

describe('多资料（task_item），和类型无关', () => {
  it('同一件任务挂一部电影和一款游戏；第一条写进单值，type_id 跟着第一条的库', async () => {
    const { store } = await open();
    const movie = store.createLibraryItem(BUILTIN_TYPE_IDS.movie, { name: '沙丘2' });
    const game = store.createLibraryItem(BUILTIN_TYPE_IDS.game, { name: '生灵重塑' });
    const t = store.createTask({ body_md: '周末' });
    store.setTaskItems(t.id, [game.id, movie.id]);
    expect(store.itemIdsOfTask(t.id)).toEqual([game.id, movie.id]);
    let row = store.get('task', t.id)!;
    expect(row.library_item_id).toBe(game.id);
    expect(row.type_id).toBe(BUILTIN_TYPE_IDS.game);
    // 类型照选，资料不受影响
    store.setTaskCategories(t.id, [SPORT]);
    expect(store.itemIdsOfTask(t.id)).toEqual([game.id, movie.id]);
    // 去掉一条：只解开关联，资料还在库里
    store.removeTaskItem(t.id, game.id);
    row = store.get('task', t.id)!;
    expect(store.itemIdsOfTask(t.id)).toEqual([movie.id]);
    expect(row.library_item_id).toBe(movie.id);
    expect(row.type_id).toBe(BUILTIN_TYPE_IDS.movie);
    expect(store.get('library_item', game.id)).toBeTruthy();
    expect(store.tasksOfItem(movie.id).map((x) => x.id)).toEqual([t.id]);
    expect(store.tasksOfItem(game.id)).toEqual([]);
  });

  it('资料库「用到它的任务」和用到次数按多值算', async () => {
    const { store } = await open();
    const a = store.createLibraryItem(BUILTIN_TYPE_IDS.movie, { name: 'A' });
    const b = store.createLibraryItem(BUILTIN_TYPE_IDS.movie, { name: 'B' });
    const t1 = store.createTask({ body_md: '1' });
    const t2 = store.createTask({ body_md: '2' });
    store.setTaskItems(t1.id, [a.id, b.id]);
    store.setTaskItems(t2.id, [b.id]);
    const uses = new Map(store.libraryEntries(BUILTIN_TYPE_IDS.movie).map((e) => [e.id, e.uses]));
    expect(uses.get(a.id)).toBe(1);
    expect(uses.get(b.id)).toBe(2);
    expect(store.tasksOfItem(b.id).map((x) => x.id).sort()).toEqual([t1.id, t2.id].sort());
  });

  it('合并资料：关联读出来是留下的那条，撤销后又分开', async () => {
    const { store } = await open();
    const a = store.createLibraryItem(BUILTIN_TYPE_IDS.movie, { name: '沙丘2' });
    const b = store.createLibraryItem(BUILTIN_TYPE_IDS.movie, { name: 'Dune: Part Two' });
    const t = store.createTask({ body_md: 'x' });
    store.setTaskItems(t.id, [b.id]);
    const res = store.mergeLibraryItems(a.id, [b.id]);
    expect(store.itemIdsOfTask(t.id)).toEqual([a.id]);
    expect(store.get('task', t.id)!.library_item_id).toBe(a.id);
    store.undoMerge(res.undo);
    expect(store.itemIdsOfTask(t.id)).toEqual([b.id]);
  });

  it('删掉一条资料：关联打墓碑；还有别的资料就不把资料抄回任务', async () => {
    const { store } = await open();
    const a = store.createLibraryItem(BUILTIN_TYPE_IDS.movie, { name: 'A' });
    const g = store.createLibraryItem(BUILTIN_TYPE_IDS.game, { name: 'G' });
    const t = store.createTask({ body_md: 'x' });
    store.setTaskItems(t.id, [a.id, g.id]);
    store.deleteLibraryItem(a.id);
    expect(store.itemIdsOfTask(t.id)).toEqual([g.id]);
    expect(store.get('task', t.id)!.library_item_id).toBe(g.id);
    expect(store.raw('task_item', taskItemId(t.id, a.id))?.deleted).toBe(true);
  });

  it('删任务：关联一起打墓碑', async () => {
    const { store } = await open();
    const t = store.createTask({ body_md: 'x', category_id: SPORT });
    store.deleteTask(t.id);
    expect(store.raw('task_category', taskCategoryId(t.id, SPORT))?.deleted).toBe(true);
  });
});

describe('迁移：原来的单值搬进新表', () => {
  it('v11 的库升到 v12：建表加列，打开后单值进多值（不进 outbox），重开结果一样', async () => {
    const d = new NodeSqliteDriver();
    expect(await migrate(d, MIGRATIONS.filter((m) => m.version <= 11))).toBe(11);
    const OLD = '0001761000000000-0000-dev0';
    await d.run(`INSERT INTO "library_item" ("id","updated_at","deleted","type_id","name","image","fields","note_md","created_at") VALUES ('it1',?,0,?,'沙丘2',NULL,'{}','','2026-01-01T00:00:00.000Z')`, [OLD, BUILTIN_TYPE_IDS.movie]);
    await d.run(
      `INSERT INTO "task" ("id","updated_at","deleted","body_md","status","type_id","type_data","completion_mode","category_id","checkin_category_id","library_item_id","sort","created_at") VALUES ('t1',?,0,'看沙丘','待办',?,'{}','once',?,?,'it1',1,'2026-01-01T00:00:00.000Z')`,
      [OLD, BUILTIN_TYPE_IDS.movie, SPORT, SPORT],
    );
    expect(await migrate(d, MIGRATIONS)).toBe(12);
    const ad = new SqlAdapter(d);
    const s = await Store.open(ad, { deviceId: 'dev1' });
    expect(s.categoryIdsOfTask('t1')).toEqual([SPORT]);
    expect(s.itemIdsOfTask('t1')).toEqual(['it1']);
    await s.flush();
    expect((await ad.pendingOutbox()).filter((e) => e.table === 'task_category' || e.table === 'task_item')).toEqual([]);
    const again = await Store.open(new SqlAdapter(d), { deviceId: 'dev1' });
    expect(again.raw('task_category', taskCategoryId('t1', SPORT))?.updated_at).toBe(OLD);
    expect(again.itemIdsOfTask('t1')).toEqual(['it1']);
  });
});

describe('老客户端兼容', () => {
  it('旧客户端把单值改成别的：补进多值当第一个，原来的都留着（只加不删）', async () => {
    const { store, tick } = await open();
    const t = store.createTask({ body_md: 'x' });
    store.setTaskCategories(t.id, [GAME, SPORT]);
    tick();
    const cur = store.get('task', t.id)!;
    store.applyRemote([oldClientRow(cur, { category_id: READ, checkin_category_id: READ, body_md: '旧端改了' }, '9999761000000000-0000-old0')]);
    expect(store.categoryIdsOfTask(t.id)).toEqual([READ, GAME, SPORT]);
    expect(store.get('task', t.id)!.body_md).toBe('旧端改了');
  });

  it('旧客户端只改了正文（单值没变）：多值不动', async () => {
    const { store } = await open();
    const t = store.createTask({ body_md: 'x' });
    store.setTaskCategories(t.id, [GAME, SPORT]);
    const cur = store.get('task', t.id)!;
    store.applyRemote([oldClientRow(cur, { body_md: 'y' }, '9999761000000000-0000-old0')]);
    expect(store.categoryIdsOfTask(t.id)).toEqual([GAME, SPORT]);
  });

  it('旧客户端清空了单值：不删多值（分不清是清掉还是没看到）', async () => {
    const { store } = await open();
    const t = store.createTask({ body_md: 'x' });
    store.setTaskCategories(t.id, [GAME]);
    const cur = store.get('task', t.id)!;
    store.applyRemote([oldClientRow(cur, { category_id: null, checkin_category_id: null }, '9999761000000000-0000-old0')]);
    expect(store.categoryIdsOfTask(t.id)).toEqual([GAME]);
  });

  it('新客户端后来去掉的（墓碑更新）：旧客户端更早的那行不会把它翻回来', async () => {
    const { store, tick } = await open();
    const t = store.createTask({ body_md: 'x' });
    store.setTaskCategories(t.id, [GAME]);
    const stale = store.get('task', t.id)!;
    tick();
    store.setTaskCategories(t.id, [SPORT]);
    // 旧客户端那行比墓碑早（LWW 输了，任务行不变），也不补关联
    store.applyRemote([oldClientRow(stale, {}, stale.updated_at.replace(/^\d/, '0'))]);
    expect(store.categoryIdsOfTask(t.id)).toEqual([SPORT]);
  });

  it('旧客户端挂了一条资料：补进多值', async () => {
    const { store } = await open();
    const g = store.createLibraryItem(BUILTIN_TYPE_IDS.game, { name: 'G' });
    const m = store.createLibraryItem(BUILTIN_TYPE_IDS.movie, { name: 'M' });
    const t = store.createTask({ body_md: 'x' });
    store.setTaskItems(t.id, [m.id]);
    const cur = store.get('task', t.id)!;
    store.applyRemote([oldClientRow(cur, { library_item_id: g.id, type_id: BUILTIN_TYPE_IDS.game }, '9999761000000000-0000-old0')]);
    expect(store.itemIdsOfTask(t.id)).toEqual([g.id, m.id]);
  });

  it('签名：单值改了签名就对不上', () => {
    const t = { category_id: 'a', library_item_id: null };
    expect(refsMirrorOf(t)).toBe('a|');
    expect(isMirrored({ ...t, refs_mirror: 'a|' })).toBe(true);
    expect(isMirrored({ ...t, category_id: 'b', refs_mirror: 'a|' })).toBe(false);
    expect(isMirrored({ ...t, refs_mirror: null })).toBe(false);
  });
});

describe('两台新设备经云端同步', () => {
  it('A 挂上两个类型和两条资料、再去掉一个；B 拉下来一样', async () => {
    const remote = new MemoryRemote();
    const mk = async (id: string) => {
      const t = local(2026, 10, 28, 9).getTime();
      const store = await Store.open(new MemoryAdapter(), { deviceId: id, now: () => new Date(t) });
      const engine = new SyncEngine(store, remote.transport(), { account: 'rei@example.com', now: () => new Date(t), timers: { set: () => 0, clear: () => {} } });
      return { store, engine };
    };
    const A = await mk('devA');
    const B = await mk('devB');
    const m = A.store.createLibraryItem(BUILTIN_TYPE_IDS.movie, { name: 'M' });
    const g = A.store.createLibraryItem(BUILTIN_TYPE_IDS.game, { name: 'G' });
    const t = A.store.createTask({ body_md: 'x' });
    A.store.setTaskCategories(t.id, [GAME, SPORT]);
    A.store.setTaskItems(t.id, [m.id, g.id]);
    A.store.removeTaskCategory(t.id, GAME);
    await A.engine.syncNow();
    await B.engine.syncNow();
    expect(B.store.categoryIdsOfTask(t.id)).toEqual([SPORT]);
    expect(B.store.itemIdsOfTask(t.id)).toEqual([m.id, g.id]);
    expect(B.store.get('task', t.id)!.category_id).toBe(SPORT);
    // B 再挂回 GAME，A 拉到
    B.store.addTaskCategory(t.id, GAME);
    await B.engine.syncNow();
    await A.engine.syncNow();
    expect(A.store.categoryIdsOfTask(t.id)).toEqual([SPORT, GAME]);
  });
});

describe('列表摘要', () => {
  it('第一个类型 · 第一条资料 +其余个数', () => {
    expect(refsSummary(['游戏'], ['生灵重塑', '沙丘2', '小明'])).toEqual({ parts: ['游戏', '生灵重塑'], more: 2 });
    expect(refsSummary([], [])).toEqual({ parts: [], more: 0 });
    expect(refsSummary(['游戏', '运动'], [])).toEqual({ parts: ['游戏'], more: 1 });
  });
});

describe('导出 / 导入 Markdown', () => {
  it('两个以上的类型和资料写进 categories / items，导回来顺序不变', async () => {
    const { exportArchive, planImport, applyImport } = await import('../src/archive/index');
    const { store: src } = await open('devA');
    const m = src.createLibraryItem(BUILTIN_TYPE_IDS.movie, { name: 'M' });
    const g = src.createLibraryItem(BUILTIN_TYPE_IDS.game, { name: 'G' });
    const t = src.createTask({ body_md: '周末' });
    src.setTaskCategories(t.id, [GAME, SPORT]);
    src.setTaskItems(t.id, [g.id, m.id]);
    const { files } = exportArchive(src);
    const { store: dst } = await open('devB');
    applyImport(dst, planImport(dst, files));
    expect(dst.categoryIdsOfTask(t.id)).toEqual([GAME, SPORT]);
    expect(dst.itemIdsOfTask(t.id)).toEqual([g.id, m.id]);
    expect(dst.get('task', t.id)!.category_id).toBe(GAME);
  });
});
