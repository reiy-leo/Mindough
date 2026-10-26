/** 类型（统一的分类，Rei 2026-10-26）：迁移合并同名、引用改写、不显示、不能删、同步兼容旧客户端。 */
import { describe, expect, it } from 'vitest';
import { Store } from '../src/store';
import { MemoryAdapter } from '../src/storage/memory';
import { SqlAdapter, migrate } from '../src/storage/sql';
import { MIGRATIONS } from '../src/storage/schema';
import { BUILTIN_CATEGORY_IDS } from '../src/seed/builtin-checkin-categories';
import { CategoryDeleteError, fillCategory, normCategoryName, planCategoryMerges, resolveCategoryId } from '../src/categories';
import type { Category, CheckInCategory, Group } from '../src/types';
import { mkTask } from './helpers';
import { NodeSqliteDriver, TursoNodeDriver } from './sql-drivers';

const OLD = '0000000000005-0000-old';
const cat = (id: string, name: string, extra: Partial<Category> = {}): Category =>
  fillCategory({ id, updated_at: OLD, deleted: false, name, color: '#123456', ...extra });
const oldProjectCat = (id: string, name: string, color = '#0a84ff') => ({ id, updated_at: OLD, deleted: false, name, color }) as unknown as Category;
const group = (id: string, category_id: string | null): Group => ({ id, updated_at: OLD, deleted: false, name: id, icon: '📁', start_at: null, end_at: null, category_id, default_type_id: null });
/** 旧客户端写的任务：只有 checkin_category_id，没有 category_id。 */
const oldTask = (id: string, checkin: string | null) => {
  const { category_id: _c, ...t } = { ...mkTask(id), checkin_category_id: checkin, updated_at: OLD };
  return t as never;
};

describe('纯逻辑', () => {
  it('名字去首尾空格、不分大小写', () => {
    expect(normCategoryName('  Work ')).toBe(normCategoryName('work'));
    expect(normCategoryName('个人  护理')).toBe('个人 护理');
  });

  it('同名并成一个：内置优先，补图标和颜色，都不显示才不显示', () => {
    const merges = planCategoryMerges([
      cat('b', '运动', { builtin: true, icon: 'dumbbell', color: '#ff9f0a', sort: 6 }),
      cat('p1', ' 运动 ', { icon: '', sort: 1000, hidden: false }),
      cat('x', 'Work', { icon: '', color: '#8e8e93', hidden: true, sort: 1000 }),
      cat('y', 'work ', { icon: 'briefcase', color: '#00ff00', hidden: true, sort: 1001 }),
      cat('z', '独一个'),
    ]);
    expect(merges).toHaveLength(2);
    const sport = merges.find((m) => m.survivor.id === 'b')!;
    expect(sport.losers.map((l) => l.id)).toEqual(['p1']);
    expect(sport.survivorChanged).toBe(false);
    const work = merges.find((m) => m.survivor.id === 'x')!;
    expect(work.survivor.icon).toBe('briefcase');
    expect(work.survivor.color).toBe('#00ff00');
    expect(work.survivor.hidden).toBe(true);
  });

  it('merged_into 顺着找到底，成环不死循环', () => {
    const rows = new Map([
      ['a', cat('a', 'A', { merged_into: 'b', deleted: true })],
      ['b', cat('b', 'B', { merged_into: 'c', deleted: true })],
      ['c', cat('c', 'C')],
      ['x', cat('x', 'X', { merged_into: 'y' })],
      ['y', cat('y', 'Y', { merged_into: 'x' })],
    ]);
    expect(resolveCategoryId((id) => rows.get(id), 'a')).toBe('c');
    expect(['x', 'y']).toContain(resolveCategoryId((id) => rows.get(id), 'x'));
    expect(resolveCategoryId((id) => rows.get(id), null)).toBeNull();
  });
});

describe('打开旧数据时合并（localStorage / 内存）', () => {
  async function legacy() {
    const adapter = new MemoryAdapter();
    // 旧的打卡分类：内置「运动」被改成了「健身」，另有一个自己加的「Reading」
    const sport: CheckInCategory = { id: BUILTIN_CATEGORY_IDS.sport, updated_at: '0000000000003-0000-a', deleted: false, name: '健身', icon: 'dumbbell', color: '#ff9f0a', builtin: true, hidden: false, sort: 6 };
    const reading: CheckInCategory = { id: 'ck-read', updated_at: OLD, deleted: false, name: 'Reading', icon: 'book', color: '#34c759', builtin: false, hidden: true, sort: 28 };
    await adapter.applyRemoteChanges([
      { table: 'checkin_category', row: sport },
      { table: 'checkin_category', row: reading },
      // 旧项目分类：和打卡分类同名的「工作」「 健身 」「reading」，和一个只有项目用的「家」
      { table: 'category', row: oldProjectCat('pc-work', '工作') },
      { table: 'category', row: oldProjectCat('pc-fit', ' 健身 ', '#00aa00') },
      { table: 'category', row: oldProjectCat('pc-read', 'reading') },
      { table: 'category', row: oldProjectCat('pc-home', '家') },
      { table: 'group', row: group('g-work', 'pc-work') },
      { table: 'group', row: group('g-fit', 'pc-fit') },
      { table: 'group', row: group('g-home', 'pc-home') },
      { table: 'task', row: oldTask('t-run', BUILTIN_CATEGORY_IDS.sport) },
      { table: 'task', row: oldTask('t-read', 'ck-read') },
      { table: 'task', row: oldTask('t-none', null) },
    ]);
    return adapter;
  }

  it('同名并成一个、引用改写、保留图标颜色，数量对', async () => {
    const s = await Store.open(await legacy(), { deviceId: 'dev1' });
    // 27 内置 + Reading + 家（工作、健身、reading 并掉了）
    expect(s.categories(true)).toHaveLength(29);
    expect(s.categories(true).filter((c) => normCategoryName(c.name) === '工作')).toHaveLength(1);
    // 项目改指留下的
    expect(s.get('group', 'g-work')!.category_id).toBe(BUILTIN_CATEGORY_IDS.work);
    expect(s.get('group', 'g-fit')!.category_id).toBe(BUILTIN_CATEGORY_IDS.sport);
    expect(s.get('group', 'g-home')!.category_id).toBe('pc-home');
    // 任务：旧 checkin_category_id 读成 category_id
    expect(s.categoryOf(s.get('task', 't-run'))?.name).toBe('健身');
    expect(s.get('task', 't-read')!.category_id).toBe('ck-read');
    expect(s.get('task', 't-none')!.category_id).toBeNull();
    // 被并的打墓碑、记 merged_into；旧 id 照样能找到留下的
    expect(s.raw('category', 'pc-work')).toMatchObject({ deleted: true, merged_into: BUILTIN_CATEGORY_IDS.work });
    expect(s.category('pc-read')?.id).toBe('ck-read');
    // Reading 本来不显示，但同名的项目分类在用：合并后显示
    expect(s.category('ck-read')?.hidden).toBe(false);
    // 项目分类缺图标：显示时用默认；内置的图标还在
    expect(s.category('pc-home')?.icon).toBe('');
    expect(s.category(BUILTIN_CATEGORY_IDS.sport)?.icon).toBe('dumbbell');
  });

  it('再开一次不再写（幂等），两台设备各迁一遍结果一样', async () => {
    const a = await legacy();
    const s1 = await Store.open(a, { deviceId: 'dev1' });
    await s1.flush();
    const outbox = (await a.pendingOutbox()).length;
    const again = await Store.open(a, { deviceId: 'dev1' });
    await again.flush();
    expect((await a.pendingOutbox()).length).toBe(outbox);
    const s2 = await Store.open(await legacy(), { deviceId: 'dev2' });
    const shape = (s: Store) => s.categories(true).map((c) => `${c.id}:${c.name}:${c.icon}:${c.color}:${c.hidden}`);
    expect(shape(s2)).toEqual(shape(again));
    expect(s2.list('group').map((g) => g.category_id).sort()).toEqual(again.list('group').map((g) => g.category_id).sort());
  });
});

describe('SQLite 迁移 v11', () => {
  for (const [name, make] of [
    ['node:sqlite', async () => new NodeSqliteDriver()],
    ['Turso', async () => TursoNodeDriver.open()],
  ] as const) {
    it(`${name}：打卡分类拷进 category、任务的分类抄到 category_id，打开后同名合并`, async () => {
      const d = await make();
      expect(await migrate(d, MIGRATIONS.filter((m) => m.version <= 10))).toBe(10);
      await d.run(`INSERT INTO "checkin_category" ("id","updated_at","deleted","name","icon","color","builtin","hidden","sort") VALUES (?,?,0,'运动','dumbbell','#ff9f0a',1,0,6)`, [BUILTIN_CATEGORY_IDS.sport, OLD]);
      await d.run(`INSERT INTO "category" ("id","updated_at","deleted","name","color") VALUES ('01900000-0000-7000-8000-00000000a5b1',?,0,'运动','#00aa00'), ('pc-home',?,0,'家','#ff0000')`, [OLD, OLD]);
      await d.run(`INSERT INTO "group" ("id","updated_at","deleted","name","icon","category_id") VALUES ('g1',?,0,'健身计划','📁','01900000-0000-7000-8000-00000000a5b1')`, [OLD]);
      await d.run(`INSERT INTO "task" ("id","updated_at","deleted","body_md","status","type_data","completion_mode","checkin_category_id","sort","created_at") VALUES ('t1',?,0,'跑步','待办','{}','once',?,1,'2026-01-01T00:00:00.000Z')`, [OLD, BUILTIN_CATEGORY_IDS.sport]);
      const ad = new SqlAdapter(d);
      const s = await Store.open(ad, { deviceId: 'dev1' });
      expect(s.get('task', 't1')!.category_id).toBe(BUILTIN_CATEGORY_IDS.sport);
      expect(s.get('group', 'g1')!.category_id).toBe(BUILTIN_CATEGORY_IDS.sport);
      expect(s.category('01900000-0000-7000-8000-00000000a5b1')?.id).toBe(BUILTIN_CATEGORY_IDS.sport);
      expect(s.category('pc-home')).toMatchObject({ icon: '', hidden: false, builtin: false, merged_into: null });
      expect(s.categories(true)).toHaveLength(28);
      await s.flush();
      // 重开读回的一样
      const again = await Store.open(new SqlAdapter(d), { deviceId: 'dev1' });
      expect(again.categories(true).map((c) => c.id)).toEqual(s.categories(true).map((c) => c.id));
      expect(again.raw('category', '01900000-0000-7000-8000-00000000a5b1')).toMatchObject({ deleted: true, merged_into: BUILTIN_CATEGORY_IDS.sport });
    });
  }
});

describe('规则', () => {
  it('不显示：选择器里没有，挂着的照常能读到', async () => {
    const s = await Store.open(new MemoryAdapter(), { deviceId: 'a' });
    const c = s.createCategory('旅行', 'plane', '#ff0000');
    const t = s.createTask({ category_id: c.id });
    expect(s.updateCategory(c.id, { hidden: true })).toBe(true);
    expect(s.categories().some((x) => x.id === c.id)).toBe(false);
    expect(s.frequentCategories().some((x) => x.id === c.id)).toBe(false);
    expect(s.categoryOf(s.get('task', t.id))?.name).toBe('旅行');
    // 再建同名：不新建，把它重新显示
    expect(s.createCategory(' 旅行 ').id).toBe(c.id);
    expect(s.category(c.id)?.hidden).toBe(false);
  });

  it('不能删；改名不能撞名', async () => {
    const s = await Store.open(new MemoryAdapter(), { deviceId: 'a' });
    const c = s.createCategory('旅行');
    expect(() => s.remove('category', c.id)).toThrow(CategoryDeleteError);
    expect(() => s.remove('checkin_category', BUILTIN_CATEGORY_IDS.sport)).toThrow(CategoryDeleteError);
    expect(s.category(c.id)).toBeTruthy();
    expect(s.updateCategory(c.id, { name: '运动' })).toBe(false);
    expect(s.updateCategory(c.id, { name: '  ' })).toBe(false);
    expect(s.updateCategory(c.id, { name: '出门', icon: 'plane', color: '#00ff00' })).toBe(true);
    expect(s.category(c.id)).toMatchObject({ name: '出门', icon: 'plane', color: '#00ff00' });
  });

  it('任何任务都能挂，常用按任务和项目件数排', async () => {
    const s = await Store.open(new MemoryAdapter(), { deviceId: 'a' });
    const c = s.createCategory('装修');
    s.createTask({ category_id: c.id, target_date: '2026-12-01', completion_mode: 'countdown' });
    s.createTask({ category_id: c.id });
    expect(s.frequentCategories(6)[0]!.id).toBe(c.id);
  });
});

describe('同步兼容旧客户端', () => {
  it('拉到旧的打卡分类行：映射进 category；拉到缺新列的项目分类：不冲掉本机图标', async () => {
    const s = await Store.open(new MemoryAdapter(), { deviceId: 'a' });
    const home = s.createCategory('家', 'house', '#ff0000');
    s.updateCategory(home.id, { hidden: true });
    const later = '9999999999990-0000-old';
    s.applyRemote([
      // 旧客户端改了内置「运动」的名字
      { table: 'checkin_category', row: { id: BUILTIN_CATEGORY_IDS.sport, updated_at: later, deleted: false, name: '健身', icon: 'dumbbell', color: '#ff9f0a', builtin: true, hidden: false, sort: 6 } },
      // 旧客户端改了项目分类的颜色（只有 name、color）
      { table: 'category', row: { id: home.id, updated_at: later, deleted: false, name: '家', color: '#0000ff' } as never },
    ]);
    expect(s.category(BUILTIN_CATEGORY_IDS.sport)?.name).toBe('健身');
    expect(s.category(home.id)).toMatchObject({ color: '#0000ff', icon: 'house', hidden: true });
  });

  it('拉到旧客户端的任务（没有 category_id）：用 checkin_category_id；指着被并掉的会改指留下的', async () => {
    const s = await Store.open(new MemoryAdapter(), { deviceId: 'a' });
    const later = '9999999999990-0000-old';
    s.applyRemote([
      // 旧客户端新建了一个和内置同名的打卡分类，并挂到任务上
      { table: 'checkin_category', row: { id: 'old-sport', updated_at: later, deleted: false, name: '运动 ', icon: 'bike', color: '#000000', builtin: false, hidden: false, sort: 30 } },
      { table: 'task', row: { ...(oldTask('t-old', 'old-sport') as object), updated_at: later } as never },
      // 旧客户端新建的项目分类，挂到项目上
      { table: 'category', row: { id: 'old-pc', updated_at: later, deleted: false, name: '露营', color: '#00aa00' } as never },
      { table: 'group', row: { ...group('g-old', 'old-pc'), updated_at: later } },
    ]);
    expect(s.get('task', 't-old')!.category_id).toBe(BUILTIN_CATEGORY_IDS.sport);
    expect(s.raw('category', 'old-sport')).toMatchObject({ deleted: true, merged_into: BUILTIN_CATEGORY_IDS.sport });
    expect(s.categoryOf(s.get('task', 't-old'))?.name).toBe('运动');
    expect(s.category(s.get('group', 'g-old')!.category_id)).toMatchObject({ name: '露营', icon: '', hidden: false });
    // 之后旧客户端再改那个被并掉的打卡分类：不复活
    s.applyRemote([{ table: 'checkin_category', row: { id: 'old-sport', updated_at: '9999999999995-0000-old', deleted: false, name: '骑车', icon: 'bike', color: '#000000', builtin: false, hidden: false, sort: 30 } }]);
    expect(s.raw('category', 'old-sport')).toMatchObject({ deleted: true, merged_into: BUILTIN_CATEGORY_IDS.sport });
    expect(s.categories(true).some((c) => c.name === '骑车')).toBe(false);
  });

  it('本机写任务：category_id 抄进 checkin_category_id，推上去的行旧客户端也认得', async () => {
    const s = await Store.open(new MemoryAdapter(), { deviceId: 'a' });
    const t = s.createTask();
    s.updateTask(t.id, { category_id: BUILTIN_CATEGORY_IDS.health });
    expect(s.raw('task', t.id)).toMatchObject({ category_id: BUILTIN_CATEGORY_IDS.health, checkin_category_id: BUILTIN_CATEGORY_IDS.health });
  });
});

describe('导出导入', () => {
  it('导出写 category 和 categories.json；导回另一台，任务和项目的类型都在', async () => {
    const { exportArchive, planImport, applyImport } = await import('../src/archive');
    const src = await Store.open(new MemoryAdapter(), { deviceId: 'a' });
    const c = src.createCategory('装修', 'hammer', '#aa5500');
    const t = src.createTask({ body_md: '买瓷砖', category_id: c.id });
    src.insert('group', { name: '新家', icon: '🏠', start_at: null, end_at: null, category_id: c.id, default_type_id: null });
    const { files } = exportArchive(src);
    expect(files.some((f) => f.path.endsWith('_meta/checkin-categories.json'))).toBe(false);
    const dst = await Store.open(new MemoryAdapter(), { deviceId: 'b' });
    applyImport(dst, planImport(dst, files));
    expect(dst.categoryOf(dst.get('task', t.id))).toMatchObject({ name: '装修', icon: 'hammer', color: '#aa5500' });
    expect(dst.category(dst.list('group').find((g) => g.name === '新家')!.category_id)?.name).toBe('装修');
  });

  it('旧文件（checkin-categories.json + 任务写 checkin_category）也能导进来，同名并成一个', async () => {
    const { exportArchive, planImport, applyImport } = await import('../src/archive');
    const src = await Store.open(new MemoryAdapter(), { deviceId: 'a' });
    const t = src.createTask({ body_md: '跑步', category_id: BUILTIN_CATEGORY_IDS.sport });
    const { files } = exportArchive(src);
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    // 改成旧格式：任务 front matter 写 checkin_category；打卡分类单独一个文件，项目分类里有个同名的「运动」
    const legacy = files.map((f) => {
      const text = typeof f.data === 'string' ? f.data : dec.decode(f.data);
      if (f.path.endsWith('_meta/categories.json'))
        return { ...f, data: enc.encode(JSON.stringify([{ id: '01900000-0000-7000-8000-00000000a5b1', name: '运动', color: '#00aa00' }])) };
      if (text.includes('category: ')) return { ...f, data: enc.encode(text.replace(/^category: /m, 'checkin_category: ')) };
      return f;
    });
    legacy.push({ path: '_meta/checkin-categories.json', data: enc.encode(JSON.stringify([{ id: '01900000-0000-7000-8000-00000000c5e1', name: '游泳', icon: 'waves', color: '#0000ff', builtin: false, hidden: false, sort: 30 }])) } as never);
    const dst = await Store.open(new MemoryAdapter(), { deviceId: 'b' });
    applyImport(dst, planImport(dst, legacy));
    expect(dst.get('task', t.id)!.category_id).toBe(BUILTIN_CATEGORY_IDS.sport);
    expect(dst.category('01900000-0000-7000-8000-00000000c5e1')).toMatchObject({ name: '游泳', icon: 'waves' });
    expect(dst.category('01900000-0000-7000-8000-00000000a5b1')?.id).toBe(BUILTIN_CATEGORY_IDS.sport);
  });
});
