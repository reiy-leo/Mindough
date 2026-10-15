import { describe, expect, it } from 'vitest';
import { Store } from '../src/store';
import { MemoryAdapter } from '../src/storage/memory';
import { WebStorageAdapter, type KVStorage } from '../src/storage/web';
import { SqlAdapter, migrate } from '../src/storage/sql';
import { MIGRATIONS } from '../src/storage/schema';
import { BUILTIN_TASK_TYPES, BUILTIN_TYPE_IDS as T } from '../src/seed/builtin-types';
import { seedDemo } from '../src/seed/demo';
import { search } from '../src/search';
import {
  LIBRARY_COPY,
  fuzzyScore,
  hasLibrary,
  isTaskField,
  migratedItemId,
  normalizeName,
  placeholderArt,
  planLibraryMigration,
  searchLibrary,
  type LibraryEntry,
} from '../src/library';
import type { Task, TaskType } from '../src/types';
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

const now = local(2026, 10, 15, 12);
const types = BUILTIN_TASK_TYPES as TaskType[];
/** 资料库之前的任务：资料直接写在 type_data 里，没有 library_item_id。 */
function legacy(id: string, patch: Partial<Task>, minute = 0): Task {
  const t = mkTask(id, { created_at: new Date(2026, 0, 1, 8, minute).toISOString(), updated_at: `0000000000100-000${minute}-dev`, ...patch }) as Partial<Task>;
  delete t.library_item_id;
  return t as Task;
}

describe('内置类型的 资料字段 / 任务字段', () => {
  it('每个非普通类型都有库和叫法；主字段、图片字段都是资料字段', () => {
    for (const t of BUILTIN_TASK_TYPES.slice(1)) {
      expect(hasLibrary(t), t.name).toBe(true);
      expect(LIBRARY_COPY[t.id], t.name).toBeTruthy();
      for (const f of t.fields) if (f.primary || f.media) expect(isTaskField(f)).toBe(false);
    }
    const movie = BUILTIN_TASK_TYPES.find((t) => t.id === T.movie)!;
    expect(movie.fields.filter(isTaskField).map((f) => f.key)).toEqual(['episode']);
    const book = BUILTIN_TASK_TYPES.find((t) => t.id === T.book)!;
    expect(book.fields.filter(isTaskField).map((f) => f.key)).toEqual(['pages']);
    expect(hasLibrary(BUILTIN_TASK_TYPES[0])).toBe(false);
  });
});

describe('名字规范化与模糊搜索', () => {
  it('空白、全角、标点不影响去重', () => {
    expect(normalizeName('沙丘 2')).toBe(normalizeName('沙丘2'));
    expect(normalizeName('沙丘·２')).toBe('沙丘2');
    expect(normalizeName('  The Last of Us ')).toBe('thelastofus');
  });

  it('完全一致 > 开头 > 包含 > 按顺序出现', () => {
    const a = fuzzyScore('王国之泪', '王国之泪');
    const b = fuzzyScore('王国之泪 DLC', '王国之泪');
    const c = fuzzyScore('塞尔达传说 王国之泪', '王国之泪');
    const d = fuzzyScore('塞尔达传说 王国之泪', '塞泪');
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
    expect(c).toBeGreaterThan(d);
    expect(d).toBeGreaterThan(0);
    expect(fuzzyScore('三体', '沙丘')).toBe(0);
  });

  it('空查询按最近用到排；有查询按匹配分，同分按最近；简介也能搜到', () => {
    const e = (id: string, name: string, recency: number, subtitle = ''): LibraryEntry => ({ kind: 'item', id, type_id: 't', name, image: null, subtitle, keywords: '', recency, uses: 0 });
    const list = [e('a', '沙丘', 1), e('b', '沙丘 2', 5), e('c', '三体', 9, '刘慈欣'), e('d', '流浪地球', 3, '刘慈欣')];
    expect(searchLibrary(list, '').map((x) => x.id)).toEqual(['c', 'b', 'd', 'a']);
    expect(searchLibrary(list, '沙丘').map((x) => x.id)).toEqual(['a', 'b']);
    expect(searchLibrary(list, '刘慈欣').map((x) => x.id)).toEqual(['c', 'd']);
    expect(searchLibrary(list, '星际')).toEqual([]);
  });

  it('占位图：同名同色，中文取前两个字，英文取首字母', () => {
    expect(placeholderArt('沙丘 2')).toEqual(placeholderArt('沙丘 2'));
    expect(placeholderArt('沙丘 2').initials).toBe('沙丘');
    expect(placeholderArt('Hollow Knight').initials).toBe('HK');
    expect(placeholderArt('CS50').initials).toBe('CS');
  });
});

describe('旧任务迁移到资料库', () => {
  const old = [
    legacy('m1', { type_id: T.movie, type_data: { title: '沙丘 2', poster: 'https://x/p.jpg', year: 2024, episode: 'S1E1' }, body_md: '想看' }, 0),
    legacy('m2', { type_id: T.movie, type_data: { title: '沙丘2', platform: '影院', year: 2099 } }, 1),
    legacy('m3', { type_id: T.movie, type_data: { title: '繁花', kind: '剧集' } }, 2),
    legacy('b1', { type_id: T.book, type_data: { title: '三体', author: '刘慈欣', pages: 230 } }, 3),
    legacy('n1', { type_id: T.movie, type_data: { year: 2020 } }, 4), // 没有片名：不动
    legacy('p1', { type_id: T.person, type_data: { person: 'someone', reason: '打电话' } }, 5), // 人物：不动
    legacy('x1', { body_md: '普通任务' }, 6),
  ];

  it('按 类型 + 规范化名字 去重；资料字段搬到资料上，任务只留任务字段；后来者只补空缺', () => {
    const plan = planLibraryMigration(old, types, []);
    expect(plan.items.map((i) => i.name)).toEqual(['沙丘 2', '繁花', '三体']);
    const dune = plan.items[0]!;
    expect(dune).toMatchObject({ type_id: T.movie, image: 'https://x/p.jpg', fields: { year: 2024, platform: '影院' } });
    const byTask = Object.fromEntries(plan.tasks.map((t) => [t.id, t]));
    expect(byTask.m1).toEqual({ id: 'm1', library_item_id: dune.id, type_data: { episode: 'S1E1' } });
    expect(byTask.m2!.library_item_id).toBe(dune.id);
    expect(byTask.m2!.type_data).toEqual({});
    expect(byTask.b1!.type_data).toEqual({ pages: 230 });
    expect(plan.items[2]!.fields).toEqual({ author: '刘慈欣' });
    expect(Object.keys(byTask).sort()).toEqual(['b1', 'm1', 'm2', 'm3']);
  });

  it('资料 id 是确定的（两台设备各自迁移得到同一条），且是 UUID 形状', () => {
    const a = planLibraryMigration(old, types, []);
    const b = planLibraryMigration([...old].reverse(), types, []);
    expect(a.items.map((i) => i.id).sort()).toEqual(b.items.map((i) => i.id).sort());
    expect(migratedItemId(T.movie, '沙丘 2')).toBe(migratedItemId(T.movie, '沙丘2'));
    expect(migratedItemId(T.movie, '沙丘 2')).not.toBe(migratedItemId(T.book, '沙丘 2'));
    expect(migratedItemId(T.movie, '沙丘 2')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('库里已有同名资料：直接挂上，不新建', () => {
    const existing = [{ id: 'lib-dune', updated_at: '1', deleted: false, type_id: T.movie, name: '沙丘２', image: null, fields: {}, note_md: '', created_at: '2026-01-01T00:00:00Z' }];
    const plan = planLibraryMigration(old, types, existing);
    expect(plan.items.map((i) => i.name)).toEqual(['繁花', '三体']);
    expect(plan.tasks.find((t) => t.id === 'm1')!.library_item_id).toBe('lib-dune');
  });

  const adapters: Array<[string, () => Promise<{ seed: (rows: Task[]) => Promise<void>; adapter: () => Promise<import('../src/storage/adapter').StorageAdapter> }>]> = [
    [
      'localStorage（旧数据没有 library_item 表）',
      async () => {
        const kv = new FakeKV();
        return {
          seed: async (rows) => kv.setItem('mindough:v1:table:task', JSON.stringify(rows)),
          adapter: async () => new WebStorageAdapter(kv),
        };
      },
    ],
    [
      'SQLite v1 → v2（node:sqlite）',
      async () => {
        const d = new NodeSqliteDriver();
        await migrate(d, MIGRATIONS.slice(0, 1));
        return {
          seed: async (rows) => {
            for (const r of rows)
              await d.run(
                `INSERT INTO "task" ("id","updated_at","deleted","body_md","status","type_id","type_data","completion_mode","sort","created_at") VALUES (?,?,0,?,?,?,?,?,?,?)`,
                [r.id, r.updated_at, r.body_md, r.status, r.type_id, JSON.stringify(r.type_data), r.completion_mode, r.sort, r.created_at],
              );
          },
          adapter: async () => new SqlAdapter(d),
        };
      },
    ],
    [
      'SQLite v1 → v2（Turso）',
      async () => {
        const d = await TursoNodeDriver.open();
        await migrate(d, MIGRATIONS.slice(0, 1));
        return {
          seed: async (rows) => {
            for (const r of rows)
              await d.run(
                `INSERT INTO "task" ("id","updated_at","deleted","body_md","status","type_id","type_data","completion_mode","sort","created_at") VALUES (?,?,0,?,?,?,?,?,?,?)`,
                [r.id, r.updated_at, r.body_md, r.status, r.type_id, JSON.stringify(r.type_data), r.completion_mode, r.sort, r.created_at],
              );
          },
          adapter: async () => new SqlAdapter(d),
        };
      },
    ],
  ];

  it.each(adapters)('%s：打开时迁移、落盘、重开不再迁移，卡片照旧显示', async (_n, make) => {
    const env = await make();
    await env.seed(old);
    const s1 = await Store.open(await env.adapter(), { deviceId: 'd1', now: () => now });
    await s1.flush();
    expect(s1.libraryItems().map((i) => i.name).sort()).toEqual(['三体', '沙丘 2', '繁花']);
    const m1 = s1.get('task', 'm1')!;
    expect(m1.library_item_id).toBeTruthy();
    expect(s1.taskData(m1)).toMatchObject({ title: '沙丘 2', poster: 'https://x/p.jpg', year: 2024, episode: 'S1E1' });
    expect(s1.get('task', 'n1')!.library_item_id).toBeNull();
    expect(s1.tasksOfItem(m1.library_item_id!).map((t) => t.id).sort()).toEqual(['m1', 'm2']);
    const s2 = await Store.open(await env.adapter(), { deviceId: 'd1', now: () => now });
    expect(s2.libraryItems()).toHaveLength(3);
    expect(s2.migrateToLibrary()).toBe(0);
    expect(s2.get('task', 'm2')!.library_item_id).toBe(m1.library_item_id);
  });
});

describe('Store 资料库操作', () => {
  async function open() {
    return Store.open(new MemoryAdapter(), { deviceId: 'd', now: () => now });
  }

  it('新建任务时 type_data 写了片名：自动挂到库（同名复用），任务只留任务字段', async () => {
    const s = await open();
    const a = s.createTask({ type_id: T.movie, type_data: { title: '沙丘 2', year: 2024, episode: '第 1 集' } });
    const b = s.createTask({ type_id: T.movie, type_data: { title: '沙丘2' } });
    expect(a.library_item_id).toBeTruthy();
    expect(b.library_item_id).toBe(a.library_item_id);
    expect(a.type_data).toEqual({ episode: '第 1 集' });
    expect(s.libraryItems(T.movie)).toHaveLength(1);
  });

  it('改资料：所有用到它的任务一起变；删资料：任务把资料抄回去，照样显示', async () => {
    const s = await open();
    const item = s.createLibraryItem(T.book, { name: '三体', fields: { author: '刘慈欣' } });
    const t1 = s.createTask({ type_id: T.book, library_item_id: item.id, type_data: { pages: 10 } });
    const t2 = s.createTask({ type_id: T.book, library_item_id: item.id });
    s.updateLibraryItem(item.id, { name: '三体 I' });
    expect(s.taskData(s.get('task', t1.id)!).title).toBe('三体 I');
    expect(s.taskData(s.get('task', t2.id)!).title).toBe('三体 I');
    s.deleteLibraryItem(item.id);
    expect(s.libraryItems(T.book)).toEqual([]);
    const after = s.get('task', t1.id)!;
    expect(after.library_item_id).toBeNull();
    expect(s.taskData(after)).toMatchObject({ title: '三体 I', author: '刘慈欣', pages: 10 });
  });

  it('改类型：资料抄回 type_data，再按新类型挂资料', async () => {
    const s = await open();
    const t = s.createTask({ type_id: T.movie, type_data: { title: '沙丘 2', year: 2024 } });
    const plain = s.changeTaskType(t.id, null);
    expect(plain.library_item_id).toBeNull();
    expect(plain.type_data).toMatchObject({ title: '沙丘 2', year: 2024 });
    const back = s.changeTaskType(t.id, T.movie);
    expect(back.library_item_id).toBe(t.library_item_id);
  });

  it('libraryEntries：最近用到在前，带用到次数；人物库就是人物列表', async () => {
    const s = await open();
    const a = s.createLibraryItem(T.game, { name: '哈迪斯 2', fields: { platform: 'Switch' } });
    const b = s.createLibraryItem(T.game, { name: '星露谷物语' });
    s.createTask({ type_id: T.game, library_item_id: b.id, created_at: '2026-10-16T00:00:00Z' });
    const entries = s.libraryEntries(T.game);
    const sorted = searchLibrary(entries, '');
    expect(sorted.map((e) => e.name)).toEqual(['星露谷物语', '哈迪斯 2']);
    expect(entries.find((e) => e.id === a.id)).toMatchObject({ subtitle: 'Switch', uses: 0 });
    const mom = s.insert('person', { name: '妈妈', avatar_asset_id: null, relation: '家人', birthday: null, note_md: '' });
    s.createTask({ type_id: T.person, type_data: { person: mom.id } });
    expect(s.libraryEntries(T.person)).toEqual([expect.objectContaining({ kind: 'person', id: mom.id, name: '妈妈', subtitle: '家人', uses: 1 })]);
    expect(s.libraryEntries('nope')).toEqual([]);
  });

  it('内置类型旧定义（老的内置版本戳）打开时换成新定义；用户改过的保留', async () => {
    const ad = new MemoryAdapter();
    const oldMovie = { ...BUILTIN_TASK_TYPES.find((t) => t.id === T.movie)!, updated_at: '0000000000000-0000-builtin', fields: [{ key: 'title', label: '片名', kind: 'text' as const, primary: true }] };
    const userBook = { ...BUILTIN_TASK_TYPES.find((t) => t.id === T.book)!, updated_at: '1760000000000-0000-dev', hidden: true, fields: BUILTIN_TASK_TYPES.find((t) => t.id === T.book)!.fields.map(({ scope: _s, ...f }) => f) };
    await ad.applyChanges([
      { table: 'task_type', row: oldMovie },
      { table: 'task_type', row: userBook },
    ]);
    const s = await Store.open(ad, { deviceId: 'd', now: () => now });
    expect(s.get('task_type', T.movie)!.fields.length).toBeGreaterThan(1);
    const book = s.get('task_type', T.book)!;
    expect(book.hidden).toBe(true);
    expect(book.fields.find((f) => f.key === 'pages')!.scope).toBe('task');
  });

  it('⌘K 搜索能搜到资料，也能按资料里的片名找到任务', async () => {
    const s = await open();
    seedDemo(s);
    const hits = search(
      { tasks: s.list('task'), types: s.list('task_type'), people: s.list('person'), groups: s.list('group'), taskPeople: s.list('task_person'), items: s.list('library_item') },
      '星际',
    );
    expect(hits.some((h) => h.kind === 'item' && h.title === '星际穿越')).toBe(true);
    expect(hits.filter((h) => h.kind === 'task').length).toBe(2);
  });

  it('演示数据：每个库都有几条，重看的片有两件任务', async () => {
    const s = await open();
    seedDemo(s);
    for (const t of BUILTIN_TASK_TYPES.slice(1)) expect(s.libraryEntries(t.id).length, t.name).toBeGreaterThanOrEqual(3);
    const inter = s.libraryItems(T.movie).find((i) => i.name === '星际穿越')!;
    expect(s.tasksOfItem(inter.id)).toHaveLength(2);
    // 演示里的影视任务都挂在库上
    expect(s.tasks().filter((t) => t.type_id === T.movie).every((t) => t.library_item_id)).toBe(true);
  });
});
