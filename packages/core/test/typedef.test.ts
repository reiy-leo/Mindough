import { describe, expect, it } from 'vitest';
import { Store } from '../src/store';
import { MemoryAdapter } from '../src/storage/memory';
import { SyncEngine } from '../src/sync/engine';
import { MemoryRemote } from '../src/sync/memory-remote';
import { BUILTIN_TASK_TYPES, BUILTIN_TYPE_IDS as T, BUILTIN_TYPES_REVISION } from '../src/seed/builtin-types';
import { itemFieldsOf, taskFieldsOf, linkChips, isPickableType, isArchivedType, search } from '../src/index';
import { applyImport, exportArchive, planImport } from '../src/archive';
import {
  addField,
  isEditableType,
  liveFields,
  moveField,
  newFieldKey,
  orderTypes,
  removeField,
  reorderFields,
  shownFields,
  updateField,
} from '../src/typedef';
import type { FieldDef } from '../src/types';
import { local } from './helpers';

async function open(adapter = new MemoryAdapter(), deviceId = 'dev1', t0 = local(2026, 10, 16, 10).getTime()) {
  let t = t0;
  const store = await Store.open(adapter, { deviceId, now: () => new Date(t) });
  return { store, adapter, advance: (ms: number) => (t += ms), now: () => t };
}

const base: FieldDef[] = [
  { key: 'name', label: '名字', kind: 'text', primary: true },
  { key: 'image', label: '图片', kind: 'image', media: true },
  { key: 'a', label: '作者', kind: 'text' },
  { key: 'b', label: '页数', kind: 'number', unit: '页' },
];

describe('字段纯函数', () => {
  it('新字段 key 随机、不重，改名不改 key', () => {
    let i = 0;
    const seq = [0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
    const rand = () => seq[i++ % seq.length]!;
    const fields: FieldDef[] = [...base, { key: 'f00000000', label: 'x', kind: 'text' }];
    expect(newFieldKey(fields, rand)).toBe('fiiiiiiii');
    const r = addField(base, { label: ' 出版社 ', kind: 'text' });
    expect(r.key).toMatch(/^f[0-9a-z]{8}$/);
    expect(r.fields.at(-1)).toEqual({ key: r.key, label: '出版社', kind: 'text' });
    const renamed = updateField(r.fields, r.key, { label: '出版方' });
    expect(renamed.at(-1)!.key).toBe(r.key);
    expect(renamed.at(-1)!.label).toBe('出版方');
  });

  it('单选选项去空去重；改种类时去掉不相干的设置', () => {
    const r = addField(base, { label: '状态', kind: 'select', options: ['想读', ' 在读 ', '', '想读'] });
    expect(r.fields.at(-1)!.options).toEqual(['想读', '在读']);
    const asText = updateField(r.fields, r.key, { kind: 'text' });
    expect(asText.at(-1)!.options).toBeUndefined();
    const site = updateField(r.fields, r.key, { kind: 'site_id' });
    expect(site.at(-1)!.site).toBe('imdb');
  });

  it('主字段、图片字段不能隐藏、删除、改种类或改成任务字段，只能改名', () => {
    const u = updateField(base, 'name', { hidden: true, kind: 'number', scope: 'task', label: '书名' });
    expect(u[0]).toEqual({ key: 'name', label: '书名', kind: 'text', primary: true });
    expect(removeField(base, 'image')).toEqual(base);
    expect(updateField(base, 'a', { label: '  ' })[2]!.label).toBe('作者');
  });

  it('排序：上移下移、按 key 重排；删掉的墓碑放最后', () => {
    const removed = removeField(base, 'a');
    expect(removed.find((f) => f.key === 'a')).toMatchObject({ removed: true });
    expect(liveFields({ fields: removed }).map((f) => f.key)).toEqual(['name', 'image', 'b']);
    expect(moveField(base, 'b', -1).map((f) => f.key)).toEqual(['name', 'image', 'b', 'a']);
    expect(moveField(base, 'name', -1).map((f) => f.key)).toEqual(['name', 'image', 'a', 'b']);
    expect(reorderFields(removed, ['b', 'name']).map((f) => f.key)).toEqual(['b', 'name', 'image', 'a']);
  });

  it('隐藏的字段编辑器里还在，显示时没有；资料 / 任务字段拆分与链接都不含它', () => {
    const fields = updateField([...base, { key: 'l', label: '更多链接', kind: 'links' }, { key: 'p', label: '读到', kind: 'progress', scope: 'task' }], 'l', { hidden: true });
    const hidden = updateField(fields, 'p', { hidden: true });
    expect(liveFields({ fields: hidden })).toHaveLength(6);
    expect(shownFields({ fields: hidden }).map((f) => f.key)).toEqual(['name', 'image', 'a', 'b']);
    expect(itemFieldsOf({ fields: hidden }).map((f) => f.key)).not.toContain('l');
    expect(taskFieldsOf({ fields: hidden })).toEqual([]);
    expect(linkChips(hidden, { l: [{ url: 'https://example.com' }] })).toEqual([]);
    expect(updateField(hidden, 'p', { hidden: false }).at(-1)!.hidden).toBeUndefined();
  });

  it('加回同名同种类的字段：墓碑翻回来，key 不变；种类不同就是新字段', () => {
    const removed = removeField(base, 'a');
    const back = addField(removed, { label: '作者', kind: 'text' });
    expect(back.key).toBe('a');
    expect(back.fields.filter((f) => f.key === 'a')).toEqual([{ key: 'a', label: '作者', kind: 'text' }]);
    const other = addField(removed, { label: '作者', kind: 'multiselect' });
    expect(other.key).not.toBe('a');
  });

  it('类型顺序：偏好里有的按它排，没有的按 sort 接后面', () => {
    const ts = [
      { id: 'x', sort: 1 },
      { id: 'y', sort: 2 },
      { id: 'z', sort: 3 },
    ];
    expect(orderTypes(ts, ['z', 'x']).map((t) => t.id)).toEqual(['z', 'x', 'y']);
    expect(orderTypes(ts, null).map((t) => t.id)).toEqual(['x', 'y', 'z']);
  });

  it('编辑器里不出现普通和人物', () => {
    const ids = BUILTIN_TASK_TYPES.filter(isEditableType).map((t) => t.id);
    expect(ids).not.toContain(T.plain);
    expect(ids).not.toContain(T.person);
    expect(ids).toHaveLength(9);
  });
});

describe('Store 类型编辑', () => {
  it('新建自定义类型：自带名字 + 图片两个固定字段，有资料库，排在最后，能选', async () => {
    const { store } = await open();
    const t = store.createType({ name: ' 播客 ', icon: '🎙️', color: '#ff2d55', layout: 'round' });
    expect(t.name).toBe('播客');
    expect(t.builtin).toBe(false);
    expect(t.fields.map((f) => [f.key, !!f.primary, !!f.media])).toEqual([
      ['name', true, false],
      ['image', false, true],
    ]);
    expect(store.pickableTypes().at(-1)!.id).toBe(t.id);
    expect(store.editableTypes().at(-1)!.id).toBe(t.id);
    const k = store.addTypeField(t.id, { label: '主播', kind: 'text' });
    const ep = store.addTypeField(t.id, { label: '听到哪', kind: 'episode', scope: 'task' });
    const task = store.createTask({ type_id: t.id, type_data: { name: '忽左忽右', [k]: '程衍樑', [ep]: { episode: 3 } } });
    expect(store.itemOf(task)!.fields[k]).toBe('程衍樑');
    expect(task.type_data).toEqual({ [ep]: { episode: 3 } });
  });

  it('改类型的名字、图标、颜色、版式、默认完成方式；没变不写', async () => {
    const { store } = await open();
    const t = store.createType({ name: '播客' });
    const before = store.get('task_type', t.id)!.updated_at;
    store.updateType(t.id, { name: '播客' });
    expect(store.get('task_type', t.id)!.updated_at).toBe(before);
    store.updateType(t.id, { name: '', icon: 'music', layout: 'banner', default_completion_mode: 'timer' });
    const u = store.get('task_type', t.id)!;
    expect(u).toMatchObject({ name: '播客', icon: 'music', layout: 'banner', default_completion_mode: 'timer' });
    expect(store.createTask({ type_id: t.id }).completion_mode).toBe('timer');
  });

  it('删字段：值留在 JSON 里不显示；加回同名字段又能看到', async () => {
    const { store } = await open();
    const book = store.get('task_type', T.book)!;
    const task = store.createTask({ type_id: T.book, type_data: { title: '三体', author: '刘慈欣', pages: 120 } });
    const item = store.itemOf(task)!;
    expect(item.fields.author).toBe('刘慈欣');
    store.setTypeFields(T.book, removeField(book.fields, 'author'));
    store.setTypeFields(T.book, removeField(store.get('task_type', T.book)!.fields, 'pages'));
    const t2 = store.get('task_type', T.book)!;
    expect(itemFieldsOf(t2).map((f) => f.key)).not.toContain('author');
    expect(taskFieldsOf(t2)).toEqual([]);
    // 值一个没动
    expect(store.get('library_item', item.id)!.fields.author).toBe('刘慈欣');
    expect(store.get('task', task.id)!.type_data.pages).toBe(120);
    expect(store.taskData(store.get('task', task.id)!).author).toBe('刘慈欣');
    // 加回来：同一个 key
    expect(store.addTypeField(T.book, { label: '作者', kind: 'text' })).toBe('author');
    expect(itemFieldsOf(store.get('task_type', T.book)).map((f) => f.key)).toContain('author');
    // 影视 r2 去掉的「平台」：加回同名文字字段用回旧 key
    expect(store.addTypeField(T.movie, { label: '平台', kind: 'text' })).toBe('platform');
  });

  it('改类型时隐藏 / 删掉的任务字段的值也留着（同 key）', async () => {
    const { store } = await open();
    const task = store.createTask({ type_id: T.book, type_data: { title: '三体', pages: 50 } });
    store.setTypeFields(T.book, updateField(store.get('task_type', T.book)!.fields, 'pages', { hidden: true }));
    const copy = store.duplicateType(T.book, '书 2');
    store.changeTaskType(task.id, copy.id);
    expect(store.get('task', task.id)!.type_data.pages).toBe(50);
  });

  it('改过的内置类型（真实 HLC）重新打开时不被内置定义覆盖；删掉的字段也不会被补回来', async () => {
    const { store, adapter } = await open();
    store.updateType(T.movie, { name: '电影', color: '#000000' });
    store.setTypeFields(T.movie, removeField(store.get('task_type', T.movie)!.fields, 'douban'));
    await store.flush();
    const stamp = store.get('task_type', T.movie)!.updated_at;
    expect(stamp > BUILTIN_TYPES_REVISION).toBe(true);
    expect(stamp).toMatch(/^\d{13}-[0-9a-f]{4}-dev1$/);
    const { store: again } = await open(adapter);
    const m = again.get('task_type', T.movie)!;
    expect(m).toMatchObject({ name: '电影', color: '#000000', updated_at: stamp });
    expect(m.fields.filter((f) => f.key === 'douban')).toEqual([expect.objectContaining({ removed: true })]);
    expect(shownFields(m).map((f) => f.key)).not.toContain('douban');
    // 没改过的内置类型照样是内置戳
    expect(again.get('task_type', T.book)!.updated_at).toBe(BUILTIN_TYPES_REVISION);
  });

  it('排顺序不改类型行（内置类型不会因此变成「改过」）', async () => {
    const { store } = await open();
    const ids = store.editableTypes().map((t) => t.id);
    store.moveType(T.book, -1);
    const after = store.editableTypes().map((t) => t.id);
    expect(after.indexOf(T.book)).toBe(ids.indexOf(T.book) - 1);
    expect(store.get('task_type', T.book)!.updated_at).toBe(BUILTIN_TYPES_REVISION);
    expect(store.pickableTypes()[0]!.id).toBe(T.plain);
    store.archiveType(T.game);
    expect(store.pickableTypes().every(isPickableType)).toBe(true);
    // 取消归档回到原来的位置
    store.unarchiveType(T.game);
    expect(store.editableTypes().map((t) => t.id)).toEqual(after);
  });

  it('类型不能删（Rei 2026-10-17）：Store 上没有删类型的入口，只有归档', async () => {
    const { store } = await open();
    const api = store as unknown as Record<string, unknown>;
    expect(api.deleteType).toBeUndefined();
    expect(api.canDeleteType).toBeUndefined();
    expect(typeof store.archiveType).toBe('function');
    expect(typeof store.unarchiveType).toBe('function');
    // updateType 不再管归档（归档只走 archiveType）
    const t = store.createType({ name: '播客' });
    store.updateType(t.id, { hidden: true } as never);
    expect(isArchivedType(store.get('task_type', t.id))).toBe(false);
  });

  it('归档：内置和自定义都一样，不在 pickable / ordered / editable 里，在 archivedTypes 里；取消归档回来', async () => {
    const { store } = await open();
    const t = store.createType({ name: '播客' });
    for (const id of [T.game, t.id]) {
      store.archiveType(id);
      expect(isArchivedType(store.get('task_type', id))).toBe(true);
      expect(store.pickableTypes().map((x) => x.id)).not.toContain(id);
      expect(store.orderedTypes().map((x) => x.id)).not.toContain(id);
      expect(store.editableTypes().map((x) => x.id)).not.toContain(id);
    }
    expect(store.archivedTypes().map((x) => x.id)).toEqual([T.game, t.id]);
    // 归档不是删：行还在
    expect(store.get('task_type', t.id)).toMatchObject({ deleted: false, name: '播客' });
    store.unarchiveType(t.id);
    expect(store.pickableTypes().map((x) => x.id)).toContain(t.id);
    expect(store.archivedTypes().map((x) => x.id)).toEqual([T.game]);
    // 普通、人物不能归档
    store.archiveType(T.plain);
    expect(isArchivedType(store.get('task_type', T.plain))).toBe(false);
  });

  it('引用归档类型的任务和资料照常解析：图标、名字、字段、资料、完成方式；能改字段值；搜索里只剩任务', async () => {
    const { store } = await open();
    const t = store.createType({ name: '播客', icon: 'mic', default_completion_mode: 'count' });
    const host = store.addTypeField(t.id, { label: '主播', kind: 'text' });
    const ep = store.addTypeField(t.id, { label: '听到哪', kind: 'episode', scope: 'task' });
    const task = store.createTask({ type_id: t.id, type_data: { name: '忽左忽右', [host]: '程衍樑', [ep]: { episode: 3 } } });
    store.archiveType(t.id);
    const cur = store.get('task', task.id)!;
    expect(cur.type_id).toBe(t.id);
    expect(cur.completion_mode).toBe('count');
    const type = store.get('task_type', cur.type_id)!;
    expect(type).toMatchObject({ name: '播客', icon: 'mic' });
    expect(store.itemOf(cur)!.fields[host]).toBe('程衍樑');
    expect(store.taskData(cur)[ep]).toEqual({ episode: 3 });
    expect(store.libraryEntries(t.id).map((e) => e.name)).toEqual(['忽左忽右']);
    store.updateTask(task.id, { type_data: { ...cur.type_data, [ep]: { episode: 4 } } });
    expect(store.get('task', task.id)!.type_data[ep]).toEqual({ episode: 4 });
    const hits = search({ tasks: store.list('task'), types: store.list('task_type'), people: [], groups: [], taskPeople: [], items: store.list('library_item') }, '忽左忽右');
    expect(hits.map((h) => h.kind)).toEqual(['task']);
  });

  it('组的默认类型归档了：新建任务退回普通，组上存的 id 不动，取消归档后又生效', async () => {
    const { store } = await open();
    const g = store.insert('group', { name: '听', icon: '🎧', start_at: null, end_at: null, category_id: null, default_type_id: T.book });
    store.archiveType(T.book);
    expect(store.effectiveDefaultTypeId(g)).toBeNull();
    expect(store.createTask({ group_id: g.id }).type_id).toBeNull();
    expect(store.get('group', g.id)!.default_type_id).toBe(T.book);
    store.unarchiveType(T.book);
    expect(store.createTask({ group_id: g.id }).type_id).toBe(T.book);
  });

  it('旧数据兼容：hidden=true（以前的「隐藏」）读出来就是归档；导出写 archived，导入认旧文件的 hidden', async () => {
    const adapter = new MemoryAdapter();
    const { store } = await open(adapter);
    const t = store.createType({ name: '播客' });
    store.update('task_type', t.id, { hidden: true }); // 旧版本「隐藏」写下的行
    await store.flush();
    const { store: again } = await open(adapter, 'dev1', local(2026, 10, 17, 10).getTime());
    expect(again.archivedTypes().map((x) => x.id)).toEqual([t.id]);
    expect(again.pickableTypes().map((x) => x.id)).not.toContain(t.id);

    const { files } = exportArchive(again);
    const meta = files.find((f) => f.path === '_meta/types.json')!;
    const rows = JSON.parse(new TextDecoder().decode(meta.data)) as Array<Record<string, unknown>>;
    const row = rows.find((r) => r.id === t.id)!;
    expect(row.archived).toBe(true);
    expect('hidden' in row).toBe(false);
    // 旧导出文件：写的是 hidden
    const old = files.map((f) => (f === meta ? { ...f, data: new TextEncoder().encode(JSON.stringify(rows.map(({ archived, ...r }) => ({ ...r, hidden: archived })))) } : f));
    for (const input of [files, old]) {
      const { store: fresh } = await open(new MemoryAdapter(), 'dev2');
      applyImport(fresh, planImport(fresh, input));
      expect(isArchivedType(fresh.get('task_type', t.id))).toBe(true);
    }
  });

  it('选项改名：资料和任务里存的旧选项一起改', async () => {
    const { store } = await open();
    const task = store.createTask({ type_id: T.game, type_data: { name: '塞尔达', platform: ['Nintendo Switch', 'PC（Steam）'] } });
    const meal = store.createTask({ type_id: T.meal, type_data: { dish: '面', meal: '午餐' } });
    store.renameFieldOption(T.game, 'platform', 'Nintendo Switch', 'Switch 1');
    expect(store.get('task_type', T.game)!.fields.find((f) => f.key === 'platform')!.options).toContain('Switch 1');
    expect(store.itemOf(task)!.fields.platform).toEqual(['Switch 1', 'PC（Steam）']);
    store.renameFieldOption(T.meal, 'meal', '午餐', '中饭');
    expect(store.get('task', meal.id)!.type_data.meal).toBe('中饭');
  });

  it('有值的字段：fieldHasData 为真（界面上就不让改种类 / 归属）', async () => {
    const { store } = await open();
    expect(store.fieldHasData(T.book, 'author')).toBe(false);
    store.createTask({ type_id: T.book, type_data: { title: '三体', author: '刘慈欣' } });
    expect(store.fieldHasData(T.book, 'author')).toBe(true);
  });
});

describe('类型编辑的同步', () => {
  async function device(remote: MemoryRemote, deviceId: string, t0: number) {
    const d = await open(new MemoryAdapter(), deviceId, t0);
    const engine = new SyncEngine(d.store, remote.transport(), { account: 'rei@example.com', now: () => new Date(d.now()), timers: { set: () => 0, clear: () => {} } });
    return { ...d, sync: () => engine.syncNow() };
  }

  it('A 改了内置类型，B 同步后拿到改过的（真实 HLC 胜过内置戳），B 重开也不被覆盖', async () => {
    const remote = new MemoryRemote();
    const t0 = local(2026, 10, 16, 10).getTime();
    const A = await device(remote, 'devA', t0);
    const B = await device(remote, 'devB', t0);
    await A.sync();
    await B.sync();
    A.advance(1000);
    A.store.updateType(T.movie, { name: '片单' });
    A.store.setTypeFields(T.movie, removeField(A.store.get('task_type', T.movie)!.fields, 'imdb'));
    await A.sync();
    await B.sync();
    const m = B.store.get('task_type', T.movie)!;
    expect(m.name).toBe('片单');
    expect(shownFields(m).map((f) => f.key)).not.toContain('imdb');
    await B.store.flush();
    const { store: B2 } = await open(B.adapter, 'devB', t0 + 5000);
    expect(B2.get('task_type', T.movie)!.name).toBe('片单');
  });

  it('两台设备都改同一个类型：后写的整行赢，两边一致；顺序偏好同步', async () => {
    const remote = new MemoryRemote();
    const t0 = local(2026, 10, 16, 10).getTime();
    const A = await device(remote, 'devA', t0);
    const B = await device(remote, 'devB', t0);
    const t = A.store.createType({ name: '播客' });
    await A.sync();
    await B.sync();
    A.advance(1000);
    A.store.updateType(t.id, { color: '#111111' });
    B.advance(2000);
    B.store.updateType(t.id, { color: '#222222' });
    B.store.moveType(t.id, -1);
    await A.sync();
    await B.sync();
    await A.sync();
    expect(A.store.get('task_type', t.id)!.color).toBe('#222222');
    expect(B.store.get('task_type', t.id)!.color).toBe('#222222');
    expect(A.store.editableTypes().map((x) => x.id)).toEqual(B.store.editableTypes().map((x) => x.id));
  });

  it('两端同步归档：后写的赢（A 归档、B 后来取消归档 → 两边都没归档）', async () => {
    const remote = new MemoryRemote();
    const t0 = local(2026, 10, 16, 10).getTime();
    const A = await device(remote, 'devA', t0);
    const B = await device(remote, 'devB', t0);
    const t = A.store.createType({ name: '播客' });
    await A.sync();
    await B.sync();
    A.advance(1000);
    A.store.archiveType(t.id);
    await A.sync();
    await B.sync();
    expect(B.store.archivedTypes().map((x) => x.id)).toEqual([t.id]);
    B.advance(3000);
    B.store.unarchiveType(t.id);
    A.advance(1000);
    A.store.updateType(t.id, { color: '#111111' }); // 比 B 早：整行 LWW，B 的取消归档赢
    await A.sync();
    await B.sync();
    await A.sync();
    for (const s of [A.store, B.store]) {
      expect(isArchivedType(s.get('task_type', t.id))).toBe(false);
      expect(s.pickableTypes().map((x) => x.id)).toContain(t.id);
    }
  });

  it('旧版本删掉的类型（墓碑）还有任务在用：同步后重开，类型找回来、是归档状态，任务照常显示', async () => {
    const remote = new MemoryRemote();
    const t0 = local(2026, 10, 16, 10).getTime();
    const A = await device(remote, 'devA', t0);
    const B = await device(remote, 'devB', t0);
    const t = A.store.createType({ name: '播客' });
    await A.sync();
    await B.sync();
    A.advance(1000);
    A.store.remove('task_type', t.id); // 旧客户端的「删类型」：打墓碑
    B.advance(500);
    B.store.createTask({ type_id: t.id, type_data: { name: '忽左忽右' } });
    await A.sync();
    await B.sync();
    await A.sync();
    expect(A.store.get('task_type', t.id)).toBeUndefined();
    await A.store.flush();
    const { store: A2 } = await open(A.adapter, 'devA', t0 + 5000);
    const back = A2.get('task_type', t.id)!;
    expect(back).toMatchObject({ deleted: false, hidden: true, name: '播客' });
    expect(isArchivedType(back)).toBe(true);
    expect(A2.archivedTypes().map((x) => x.id)).toEqual([t.id]);
    expect(A2.pickableTypes().map((x) => x.id)).not.toContain(t.id);
    expect(A2.libraryEntries(t.id).map((e) => e.name)).toEqual(['忽左忽右']);
  });

  it('没人引用的旧墓碑不复活', async () => {
    const adapter = new MemoryAdapter();
    const { store } = await open(adapter);
    const t = store.createType({ name: '播客' });
    store.remove('task_type', t.id);
    await store.flush();
    const { store: again } = await open(adapter, 'dev1', local(2026, 10, 17, 10).getTime());
    expect(again.get('task_type', t.id)).toBeUndefined();
    expect(again.archivedTypes()).toEqual([]);
  });
});
