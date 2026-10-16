/**
 * Store：内存快照 + 领域操作。读是同步的（UI 直接读），写先改内存、通知订阅者，
 * 再异步落到 StorageAdapter（并进 outbox）。UI 永不等待存储或网络。
 */
import { HlcClock } from './hlc';
import { uuidv7 } from './uuid';
import { toDateKey } from './dates';
import { backlogTasks } from './backlog';
import { assertCanAddEdge, deriveAll, findCycleEdges, unlockedSuccessors, type DerivedStatus, type Edge } from './dag';
import { computeProgress, periodKeyForTask, type Progress } from './checkin';
import { LinkedByDependencyError, SelfLinkError, canonicalPair, hasDependencyBetween, prefId, relatedIdsOf, taskLinkId, visibleLinks } from './related';
import { BUILTIN_TASK_TYPES, BUILTIN_TYPE_IDS, BUILTIN_TYPES_REVISION, PLAIN_TYPE_ID, isBuiltinStamp, withNewBuiltinFields } from './seed/builtin-types';
import {
  entryOfItem,
  entryOfPerson,
  findSameName,
  hasLibrary,
  isPersonLibrary,
  itemData,
  mergedData,
  planLibraryMigration,
  planFieldMigration,
  splitTypeData,
  taskFieldsOf,
  type LibraryEntry,
} from './library';
import { mergeCycleSurvivors, planItemMerge, planPersonMerge, resolveMerged, duplicateGroups, type DuplicateGroup, type MergeChoices } from './merge';
import { BUILTIN_CHECKIN_CATEGORIES, pickFrequentCategories } from './seed/builtin-checkin-categories';
import { TABLES, isFinished, normalizeStatus, type BaseRow, type CheckInKind, type FieldValue, type LibraryItem, type NewRow, type Person, type TableMap, type TableName, type Task, type TaskPerson, type TaskStatus } from './types';
import type { Change, StorageAdapter } from './storage/adapter';

import { dataLabel, tr } from './i18n';
export interface StoreOptions {
  deviceId?: string;
  now?: () => Date;
  onError?: (err: unknown) => void;
}

export interface CompleteResult {
  task: Task;
  /** 因本次完成而解锁（被阻塞 → 可开始）的后续任务。 */
  unlocked: Task[];
}

export interface CheckInResult {
  progress: Progress;
  /** 非重复的打卡任务达标后会自动完成，并可能解锁后续。 */
  completed: CompleteResult | null;
}

type Tables = { [K in TableName]: Map<string, TableMap[K]> };

/** 同步合并后绕成环的前后关系：不生效（不阻塞、不进图的排布），界面提示用户去掉其一。 */
export interface ConflictEdge extends Edge {
  /** 这一对的依赖行 id（可能不止一行：两台设备各连了一次）。 */
  ids: string[];
}

/**
 * 一次合并的撤销记录（合并后提示里的「撤销」用）：合并前的目标、来源，和改指过的任务 / 人物关联。
 */
export type MergeUndo =
  | { kind: 'item'; target: LibraryItem; sources: LibraryItem[]; tasks: Array<{ id: string; library_item_id: string | null }> }
  | {
      kind: 'person';
      target: Person;
      sources: Person[];
      /** 改过的人物关联（合并前的样子：person_id、deleted）。 */
      links: TaskPerson[];
      /** type_data 里写着人物的任务（合并前的 type_data）。 */
      tasks: Array<{ id: string; type_data: Record<string, FieldValue> }>;
    };

export interface MergeResult {
  /** 留下的那条（合并后的样子）。 */
  targetId: string;
  /** 并进去了几条。 */
  merged: number;
  /** 改指了几件任务。 */
  movedTasks: number;
  undo: MergeUndo;
}

/** 资料合并的错误（界面直接显示 message）。 */
export class MergeError extends Error {
  override name = 'MergeError';
}

export type NewTaskInput = Partial<Omit<Task, 'id' | 'updated_at' | 'deleted'>> & { id?: string };

/** 用户点过「不是同一个」的重复组（pref，值是组签名数组）。 */
export const NOT_DUPLICATES_PREF = 'library.not_duplicates';

/** 同一行写了多次只留最后一次。 */
function dedupeRows(rows: Array<{ table: TableName; row: BaseRow }>) {
  const m = new Map<string, { table: TableName; row: BaseRow }>();
  for (const r of rows) m.set(`${r.table}:${r.row.id}`, r);
  return [...m.values()];
}

export class Store {
  private tables: Tables;
  private listeners = new Set<() => void>();
  private pending: Promise<void> = Promise.resolve();
  private _version = 0;
  private batchBuffer: Change[] | null = null;
  private derivedCache: { version: number; value: Map<string, DerivedStatus> } | null = null;
  private relatedCache: { version: number; value: Map<string, string[]> } | null = null;
  private edgeCache: { version: number; accepted: Edge[]; conflicts: ConflictEdge[] } | null = null;
  private localWriteListeners = new Set<(changes: readonly Change[]) => void>();
  readonly clock: HlcClock;
  readonly now: () => Date;

  private constructor(
    readonly adapter: StorageAdapter,
    readonly deviceId: string,
    private readonly opts: StoreOptions,
  ) {
    this.now = opts.now ?? (() => new Date());
    this.clock = new HlcClock(deviceId, () => this.now().getTime());
    this.tables = Object.fromEntries(TABLES.map((t) => [t, new Map()])) as unknown as Tables;
  }

  /** 打开存储：读入全部数据，补齐内置类型。 */
  static async open(adapter: StorageAdapter, opts: StoreOptions = {}): Promise<Store> {
    let deviceId = opts.deviceId ?? (await adapter.getMeta('device_id'));
    if (!deviceId) {
      deviceId = uuidv7().slice(-12);
      await adapter.setMeta('device_id', deviceId);
    }
    const store = new Store(adapter, deviceId, opts);
    const snap = await adapter.loadAll();
    for (const t of TABLES) {
      const map = store.tables[t] as Map<string, BaseRow>;
      for (const row of snap[t] as BaseRow[]) {
        // M0 旧任务没有 checkin_category_id：只在内存补 null，不改写（无语义变化，不必同步）
        if (t === 'task' && (row as Task).checkin_category_id === undefined) (row as Task).checkin_category_id = null;
        // 资料库之前的任务没有 library_item_id：同上，只在内存补 null
        if (t === 'task' && (row as Task).library_item_id === undefined) (row as Task).library_item_id = null;
        // v4 之前没有 remind_time：同上
        if (t === 'task' && (row as Task).remind_time === undefined) (row as Task).remind_time = null;
        // v5 之前没有 merged_into：同上
        if ((t === 'library_item' || t === 'person') && (row as LibraryItem).merged_into === undefined) (row as LibraryItem).merged_into = null;
        map.set(row.id, row);
        // 本地时钟不落后于已存数据
        if (row.updated_at && /^\d{13}-/.test(row.updated_at)) store.clock.receive(row.updated_at);
      }
    }
    store.ensureBuiltinTypes();
    store.ensureBuiltinCheckInCategories();
    store.migrateLegacyStatuses();
    store.migrateToLibrary();
    store.migrateFieldKinds();
    store.migratePersonTypeTasks();
    store.settleMerges();
    await store.flush();
    return store;
  }

  // ───────────── 读取 ─────────────

  get version(): number {
    return this._version;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** 未删除的行。 */
  list<K extends TableName>(table: K): TableMap[K][] {
    const out: TableMap[K][] = [];
    for (const r of this.tables[table].values()) if (!r.deleted) out.push(r);
    return out;
  }

  /** 含墓碑的全部行（同步 / 调试用）。 */
  listAll<K extends TableName>(table: K): TableMap[K][] {
    return [...this.tables[table].values()];
  }

  /** 含墓碑的一行（同步推送用）。 */
  raw<K extends TableName>(table: K, id: string): TableMap[K] | undefined {
    return this.tables[table]?.get(id);
  }

  get<K extends TableName>(table: K, id: string | null | undefined): TableMap[K] | undefined {
    if (!id) return undefined;
    const r = this.tables[table].get(id);
    return r && !r.deleted ? r : undefined;
  }

  tasks(): Task[] {
    return this.list('task').sort((a, b) => a.sort - b.sort || (a.created_at < b.created_at ? -1 : 1));
  }

  /**
   * 生效的前后关系（去重、无环）。依赖行按 updated_at（HLC，含设备 id，各端顺序一致）依次加入，
   * 同一对只算一次；加入后会成环的记为冲突（conflictEdges），不生效。本机加边时已过环检测，
   * 只有两台设备各加一条、合并后才会出现冲突。按版本缓存。
   */
  edges(): Edge[] {
    return this.edgeState().accepted;
  }

  /** 同步合并后成环、暂不生效的前后关系（“后到的那条”）。 */
  conflictEdges(): ConflictEdge[] {
    return this.edgeState().conflicts;
  }

  private edgeState() {
    if (this.edgeCache?.version === this._version) return this.edgeCache;
    const deps = this.list('dependency').sort((a, b) => (a.updated_at < b.updated_at ? -1 : a.updated_at > b.updated_at ? 1 : a.id < b.id ? -1 : 1));
    const byPair = new Map<string, { edge: Edge; ids: string[] }>();
    for (const d of deps) {
      const key = `${d.pred_id}>${d.succ_id}`;
      const cur = byPair.get(key);
      if (cur) cur.ids.push(d.id);
      else byPair.set(key, { edge: { pred_id: d.pred_id, succ_id: d.succ_id }, ids: [d.id] });
    }
    const ordered = [...byPair.values()];
    const bad = new Set(findCycleEdges(ordered.map((x) => x.edge)));
    const accepted: Edge[] = [];
    const conflicts: ConflictEdge[] = [];
    for (const x of ordered) {
      if (bad.has(x.edge)) conflicts.push({ ...x.edge, ids: x.ids });
      else accepted.push(x.edge);
    }
    this.edgeCache = { version: this._version, accepted, conflicts };
    return this.edgeCache;
  }

  /** 全部任务的派生状态（可开始 / 被阻塞 …），按版本缓存。 */
  derived(): Map<string, DerivedStatus> {
    if (this.derivedCache?.version !== this._version) {
      this.derivedCache = { version: this._version, value: deriveAll(this.list('task'), this.edges()) };
    }
    return this.derivedCache.value;
  }

  checkInsOf(taskId: string): TableMap['check_in'][] {
    return this.list('check_in').filter((c) => c.task_id === taskId);
  }

  progress(taskId: string, date: string = toDateKey(this.now())): Progress | null {
    const task = this.get('task', taskId);
    if (!task) return null;
    const key = periodKeyForTask(task, date);
    return computeProgress(
      task,
      this.checkInsOf(taskId).filter((c) => c.period_key === key),
      this.now(),
    );
  }

  // ───────────── 写入底层 ─────────────

  /** 写一批行：补 updated_at，改内存，通知，再异步落盘。 */
  write(changes: Array<{ table: TableName; row: BaseRow }>): void {
    if (!changes.length) return;
    const stamped: Change[] = changes.map((c) => {
      const row = { ...c.row, updated_at: this.clock.tick() };
      // 资料 / 人物总带着 merged_into（没合并过 = null），和重开后读回的样子一致
      if ((c.table === 'library_item' || c.table === 'person') && (row as LibraryItem).merged_into === undefined) (row as LibraryItem).merged_into = null;
      (this.tables[c.table] as Map<string, BaseRow>).set(row.id, row);
      return { table: c.table, row } as Change;
    });
    if (this.batchBuffer) {
      this.batchBuffer.push(...stamped);
      this._version++;
      return;
    }
    this.commit(stamped);
  }

  /** 把 fn 里的所有写入合并成一次通知 + 一次落盘（导入、演示数据用）。 */
  batch<T>(fn: () => T): T {
    if (this.batchBuffer) return fn();
    this.batchBuffer = [];
    try {
      return fn();
    } finally {
      const buf = this.batchBuffer;
      this.batchBuffer = null;
      if (buf.length) this.commit(buf);
    }
  }

  private commit(stamped: Change[]): void {
    this._version++;
    for (const fn of this.listeners) fn();
    for (const fn of this.localWriteListeners) fn(stamped);
    this.pending = this.pending
      .then(() => this.adapter.applyChanges(stamped))
      .catch((err) => this.opts.onError?.(err));
  }

  /** 本机写入（不含同步拉下来的）之后回调，同步引擎用它安排推送。 */
  onLocalWrite(fn: (changes: readonly Change[]) => void): () => void {
    this.localWriteListeners.add(fn);
    return () => this.localWriteListeners.delete(fn);
  }

  /**
   * 合并从云端拉下来的行：行级 LWW（updated_at 大者胜；HLC 末尾是设备 id，相等即同一次写入，保留已有）。
   * 墓碑也只是一次写入，按同样规则比较。胜出的行改内存、通知订阅者，落盘但不进 outbox。
   * 未知表（更新版本的 app 加的）忽略。返回实际改动的行数。
   */
  applyRemote(changes: readonly Change[]): number {
    const applied: Change[] = [];
    for (const c of changes) {
      const table = this.tables[c.table] as Map<string, BaseRow> | undefined;
      if (!table || !c.row?.id || typeof c.row.updated_at !== 'string') continue;
      const cur = table.get(c.row.id);
      if (/^\d{13}-/.test(c.row.updated_at)) this.clock.receive(c.row.updated_at);
      if (cur && !(c.row.updated_at > cur.updated_at)) continue;
      const row = { ...c.row } as BaseRow;
      if (c.table === 'task') {
        const t = row as Task;
        if (t.checkin_category_id === undefined) t.checkin_category_id = null;
        if (t.library_item_id === undefined) t.library_item_id = null;
        if (t.remind_time === undefined) t.remind_time = null;
      }
      if ((c.table === 'library_item' || c.table === 'person') && (row as LibraryItem).merged_into === undefined) (row as LibraryItem).merged_into = null;
      table.set(row.id, row);
      applied.push({ table: c.table, row } as Change);
    }
    if (!applied.length) return 0;
    this._version++;
    for (const fn of this.listeners) fn();
    this.pending = this.pending
      .then(() => this.adapter.applyRemoteChanges(applied))
      .catch((err) => this.opts.onError?.(err));
    // 拉下来的有合并（来源墓碑）或指向已合并资料的任务：解开成环的合并，把指着旧 id 的改写到目标
    if (applied.some((c) => c.table === 'library_item' || c.table === 'person' || c.table === 'task' || c.table === 'task_person')) this.settleMerges();
    return applied.length;
  }

  /** 等待所有写入落盘。 */
  flush(): Promise<void> {
    return this.pending;
  }

  insert<K extends TableName>(table: K, data: NewRow<TableMap[K]>): TableMap[K] {
    const row = { ...data, id: data.id ?? uuidv7(this.now().getTime()), deleted: false, updated_at: '' } as unknown as TableMap[K];
    this.write([{ table, row }]);
    return this.tables[table].get(row.id)!;
  }

  update<K extends TableName>(table: K, id: string, patch: Partial<Omit<TableMap[K], 'id' | 'updated_at'>>): TableMap[K] {
    const cur = this.tables[table].get(id);
    if (!cur) throw new Error(tr('找不到记录：{table}/{id}', { table, id }));
    this.write([{ table, row: { ...cur, ...patch } as BaseRow }]);
    return this.tables[table].get(id)!;
  }

  /** 墓碑删除。 */
  remove(table: TableName, id: string): void {
    const cur = (this.tables[table] as Map<string, BaseRow>).get(id);
    if (cur && !cur.deleted) this.write([{ table, row: { ...cur, deleted: true } }]);
  }

  /** M0 旧数据里的“取消”→“关闭”（改写一次并进 outbox，其他设备同步后一致）。 */
  private migrateLegacyStatuses() {
    const rows: Array<{ table: TableName; row: BaseRow }> = [];
    for (const t of this.tables.task.values()) {
      const s = normalizeStatus(t.status);
      if (s !== t.status) rows.push({ table: 'task', row: { ...t, status: s } as BaseRow });
    }
    this.write(rows);
  }

  /**
   * 「人物」类型不再能选（Rei 2026-10-16：和任务自带的「人物」重复）。还挂着这个类型的任务改成普通任务：
   * 那个人改用任务的人物关联（确定的 id，两台设备各迁一遍也只有一条），「事由」接到正文末尾。
   */
  private migratePersonTypeTasks() {
    for (const t of [...this.tables.task.values()]) {
      if (t.deleted || t.type_id !== BUILTIN_TYPE_IDS.person) continue;
      const pid = typeof t.type_data?.person === 'string' ? t.type_data.person : null;
      const reason = typeof t.type_data?.reason === 'string' ? t.type_data.reason.trim() : '';
      if (pid && this.get('person', pid) && !this.list('task_person').some((x) => x.task_id === t.id && x.person_id === pid))
        this.insert('task_person', { id: `${t.id}-person-${pid}`, task_id: t.id, person_id: pid });
      const body = reason && !t.body_md.includes(reason) ? `${t.body_md.replace(/\s+$/, '')}\n\n${reason}\n` : t.body_md;
      this.update('task', t.id, { type_id: null, type_data: {}, body_md: body });
    }
  }

  /** 补齐内置打卡分类（固定 id）；以后在种子里追加的新分类，老用户打开时也会补上。 */
  private ensureBuiltinCheckInCategories() {
    const missing = BUILTIN_CHECKIN_CATEGORIES.filter((c) => !this.tables.checkin_category.has(c.id));
    if (!missing.length) return;
    for (const c of missing) this.tables.checkin_category.set(c.id, c);
    this._version++;
    this.pending = this.pending.then(() => this.adapter.applyChanges(missing.map((row) => ({ table: 'checkin_category', row }))));
  }

  /**
   * 补齐内置类型；存着的内置类型若是更早的内置版本（用户没改过，updated_at 仍是内置戳），换成新定义。
   * 用户改过的（真实 HLC）不覆盖，只在内存里补上新定义里各字段的 scope（资料 / 任务），不改写。
   */
  private ensureBuiltinTypes() {
    const missing = BUILTIN_TASK_TYPES.filter((t) => {
      const cur = this.tables.task_type.get(t.id);
      if (!cur) return true;
      if (cur.updated_at < BUILTIN_TYPES_REVISION) return true;
      if (isBuiltinStamp(cur.updated_at)) return false;
      // 用户改过的内置类型：不覆盖，只在内存里补上新定义里各字段的 scope，并补上新定义新增、它还没有的字段
      // （如 r2 的 IMDb / 豆瓣 / 更多链接），插在新定义里前一个字段之后。不改写、不进 outbox。
      if (cur.builtin) cur.fields = withNewBuiltinFields(cur.fields, t.fields);
      for (const f of cur.fields) {
        const def = t.fields.find((x) => x.key === f.key);
        if (def?.scope && f.scope === undefined) f.scope = def.scope;
      }
      return false;
    });
    if (!missing.length) return;
    for (const t of missing) this.tables.task_type.set(t.id, t);
    this._version++;
    this.pending = this.pending.then(() => this.adapter.applyChanges(missing.map((row) => ({ table: 'task_type', row }))));
  }

  /**
   * 资料库迁移：资料直接写在 type_data 里的旧任务 → 资料库条目（按类型 + 规范化名字去重）+ library_item_id。
   * 资料用确定的 id，两台设备各自迁移会得到同一条。见 library.ts 的 planLibraryMigration。
   */
  /** 字段种类改了（文字 → 多选、数字 → 金额）后，把资料里的旧值迁成新形状（见 library.ts 的 planFieldMigration）。 */
  migrateFieldKinds(): number {
    const plan = planFieldMigration(this.list('library_item'), this.list('task_type'));
    if (!plan.length) return 0;
    this.write(plan.map((p) => ({ table: 'library_item' as TableName, row: { ...this.tables.library_item.get(p.id)!, fields: p.fields, note_md: p.note_md } as BaseRow })));
    return plan.length;
  }

  migrateToLibrary(): number {
    const plan = planLibraryMigration(this.list('task'), this.list('task_type'), this.list('library_item'));
    if (!plan.tasks.length) return 0;
    const rows: Array<{ table: TableName; row: BaseRow }> = [];
    // 迁移出的确定 id 已经被合并掉了（别的设备迁移后又合并）：不复活那条墓碑，直接挂到合并后的那条
    const redirect = new Map<string, string>();
    for (const it of plan.items) {
      const old = this.tables.library_item.get(it.id);
      const to = old?.deleted && old.merged_into ? this.resolveItemId(it.id) : undefined;
      if (to) redirect.set(it.id, to);
      else rows.push({ table: 'library_item', row: { ...it, merged_into: null, deleted: false, updated_at: '' } as BaseRow });
    }
    for (const p of plan.tasks) {
      const t = this.tables.task.get(p.id)!;
      rows.push({ table: 'task', row: { ...t, library_item_id: redirect.get(p.library_item_id) ?? p.library_item_id, type_data: p.type_data } as BaseRow });
    }
    this.write(rows);
    return plan.tasks.length;
  }

  // ───────────── 资料库 ─────────────

  /** 任务挂着的资料（未删除）。 */
  itemOf(task: Pick<Task, 'library_item_id'> | null | undefined): LibraryItem | undefined {
    return resolveMerged((id) => this.tables.library_item.get(id), task?.library_item_id ?? null);
  }

  /** 资料 id → 现在该用的那条（合并过就顺着 merged_into 找到留下的；没了 = undefined）。 */
  resolveItemId(id: string | null | undefined): string | undefined {
    return resolveMerged((x) => this.tables.library_item.get(x), id)?.id;
  }

  /** 人物 id → 现在该用的那个人（合并过就顺着 merged_into 找到留下的）。 */
  resolvePersonId(id: string | null | undefined): string | undefined {
    return resolveMerged((x) => this.tables.person.get(x), id)?.id;
  }

  /** 任务显示用的完整字段：资料 + 任务自己的字段。 */
  taskData(task: Task): Record<string, FieldValue> {
    return mergedData(this.get('task_type', task.type_id), task, this.itemOf(task));
  }

  libraryItems(typeId?: string): LibraryItem[] {
    return this.list('library_item').filter((i) => !typeId || i.type_id === typeId);
  }

  /** 用到这条资料的任务（人物库：和这个人有关的任务）。 */
  tasksOfItem(itemId: string): Task[] {
    return this.tasks().filter((t) => t.library_item_id && (t.library_item_id === itemId || this.resolveItemId(t.library_item_id) === itemId));
  }

  /** 一个库的全部条目（人物类型就是人物列表），带“最近用到”和用到次数，给选择框 / 资料库页用。 */
  libraryEntries(typeId: string): LibraryEntry[] {
    const type = this.get('task_type', typeId);
    if (!hasLibrary(type)) return [];
    const ms = (iso: string) => Date.parse(iso) || 0;
    if (isPersonLibrary(type)) {
      const last = new Map<string, number>();
      const uses = new Map<string, number>();
      const key = type.fields.find((f) => f.primary)!.key;
      for (const t of this.list('task')) {
        const ids = new Set(this.list('task_person').filter((x) => x.task_id === t.id).map((x) => this.resolvePersonId(x.person_id) ?? x.person_id));
        const v = t.type_data[key];
        if (typeof v === 'string') ids.add(this.resolvePersonId(v) ?? v);
        for (const id of ids) {
          last.set(id, Math.max(last.get(id) ?? 0, ms(t.created_at)));
          uses.set(id, (uses.get(id) ?? 0) + 1);
        }
      }
      return this.list('person').map((p) => entryOfPerson(typeId, p, last.get(p.id) ?? 0, uses.get(p.id) ?? 0));
    }
    const last = new Map<string, number>();
    const uses = new Map<string, number>();
    for (const t of this.list('task')) {
      const iid = t.library_item_id ? (this.resolveItemId(t.library_item_id) ?? t.library_item_id) : null;
      if (!iid) continue;
      last.set(iid, Math.max(last.get(iid) ?? 0, ms(t.created_at)));
      uses.set(iid, (uses.get(iid) ?? 0) + 1);
    }
    return this.libraryItems(typeId).map((i) => entryOfItem(type, i, Math.max(last.get(i.id) ?? 0, ms(i.created_at)), uses.get(i.id) ?? 0));
  }

  createLibraryItem(typeId: string, data: { name: string; image?: string | null; fields?: Record<string, FieldValue>; note_md?: string }): LibraryItem {
    return this.insert('library_item', {
      type_id: typeId,
      name: data.name.trim(),
      image: data.image ?? null,
      fields: data.fields ?? {},
      note_md: data.note_md ?? '',
      created_at: this.now().toISOString(),
      merged_into: null,
    });
  }

  /** 找同名资料（规范化后），没有就新建。 */
  findOrCreateLibraryItem(typeId: string, data: { name: string; image?: string | null; fields?: Record<string, FieldValue> }): LibraryItem {
    const hit = findSameName(this.libraryEntries(typeId), data.name);
    return (hit && this.get('library_item', hit.id)) || this.createLibraryItem(typeId, data);
  }

  /** 改资料：所有用到它的任务一起变。 */
  updateLibraryItem(id: string, patch: Partial<Pick<LibraryItem, 'name' | 'image' | 'fields' | 'note_md'>>): LibraryItem {
    return this.update('library_item', id, patch);
  }

  /**
   * 删一条资料：用到它的任务不跟着删，把资料抄回各自的 type_data 再解开引用，卡片照样显示。
   */
  deleteLibraryItem(id: string): void {
    const item = this.tables.library_item.get(id);
    if (!item || item.deleted) return;
    const type = this.get('task_type', item.type_id);
    const rows: Array<{ table: TableName; row: BaseRow }> = [{ table: 'library_item', row: { ...item, deleted: true } }];
    for (const t of this.list('task'))
      if (t.library_item_id && this.resolveItemId(t.library_item_id) === id) rows.push({ table: 'task', row: { ...t, library_item_id: null, type_data: { ...itemData(type, item), ...t.type_data } } as BaseRow });
    this.write(rows);
  }

  /** 给任务换一条资料（或解开：null）。 */
  setTaskItem(taskId: string, itemId: string | null): Task {
    return this.updateTask(taskId, { library_item_id: itemId });
  }

  /**
   * 改任务类型（Rei 2026-10-16：「切换类别后就要清空之前类别的状态」）：
   * 原来挂的资料取消（资料本身留在库里），资料字段不抄回、也不在新类型的库里找同名或新建；
   * 只留下新类型也有的任务字段（同 key）。新类型的资料从「未选」开始。
   */
  changeTaskType(taskId: string, typeId: string | null): Task {
    const t = this.get('task', taskId);
    if (!t) throw new Error(tr('任务不存在'));
    const next = typeId === PLAIN_TYPE_ID ? null : typeId;
    if (next === t.type_id) return t;
    const nt = this.get('task_type', next);
    const keep = new Set(taskFieldsOf(nt).map((f) => f.key));
    const data = Object.fromEntries(Object.entries(t.type_data).filter(([k]) => keep.has(k)));
    const body = t.body_md.trim() === '' && nt?.body_template ? { body_md: dataLabel(nt.body_template) } : {};
    return this.updateTask(taskId, { type_id: next, library_item_id: null, type_data: data, ...body });
  }

  /** 任务的 type_data 里写着资料（有主字段名字）却没挂资料：找同名或新建一条挂上，type_data 只留任务字段。 */
  private attachLibrary(t: Task): Task {
    const type = this.get('task_type', t.type_id);
    if (t.library_item_id || !hasLibrary(type) || isPersonLibrary(type)) return t;
    const split = splitTypeData(type, t.type_data);
    if (!split.name) return t;
    const item = this.findOrCreateLibraryItem(type.id, { name: split.name, image: split.image, fields: split.fields });
    return this.updateTask(t.id, { library_item_id: item.id, type_data: split.task });
  }

  // ───────────── 合并 ─────────────

  /**
   * 把几条资料并进一条（Rei M4：「两条其实是同一部片」）。同类型才能合并。
   * 默认目标的非空值优先、空的用来源补；choices 选冲突字段用谁的值；备注拼接（不重复）；
   * 用到来源的任务全部改指目标；来源打墓碑并记 merged_into = 目标。一次写入，返回撤销记录。
   */
  mergeLibraryItems(targetId: string, sourceIds: readonly string[], choices: MergeChoices = {}): MergeResult {
    const target = this.get('library_item', targetId);
    if (!target) throw new MergeError(tr('要留下的那条资料不在了'));
    const ids = [...new Set(sourceIds)].filter((id) => id !== targetId);
    if (!ids.length) throw new MergeError(tr('至少选两条才能合并'));
    const sources = ids.map((id) => {
      const s = this.get('library_item', id);
      if (!s) throw new MergeError(tr('有一条资料已经不在了'));
      if (s.type_id !== target.type_id) throw new MergeError(tr('只有同一类的资料才能合并'));
      return s;
    });
    const plan = planItemMerge(this.get('task_type', target.type_id), target, sources, choices);
    const merging = new Set(ids);
    const rows: Array<{ table: TableName; row: BaseRow }> = [
      { table: 'library_item', row: { ...target, name: plan.name, image: plan.image, fields: plan.fields, note_md: plan.note_md, deleted: false, merged_into: null } as BaseRow },
    ];
    for (const s of sources) rows.push({ table: 'library_item', row: { ...s, deleted: true, merged_into: targetId } as BaseRow });
    const moved: Array<{ id: string; library_item_id: string | null }> = [];
    for (const t of this.list('task')) {
      const r = t.library_item_id ? this.resolveItemId(t.library_item_id) : undefined;
      if (!r || !merging.has(r)) continue;
      moved.push({ id: t.id, library_item_id: t.library_item_id });
      rows.push({ table: 'task', row: { ...t, library_item_id: targetId } as BaseRow });
    }
    this.write(rows);
    return { targetId, merged: sources.length, movedTasks: moved.length, undo: { kind: 'item', target: { ...target }, sources: sources.map((s) => ({ ...s })), tasks: moved } };
  }

  /**
   * 人物合并：同上，人物关联（task_person）改指留下的人；同一件任务已经关联了留下的人，就去掉重复的那条；
   * 任务字段里写着来源的人（旧的人物类型）也改过来。
   */
  mergePeople(targetId: string, sourceIds: readonly string[], choices: MergeChoices = {}): MergeResult {
    const target = this.get('person', targetId);
    if (!target) throw new MergeError(tr('要留下的那个人不在了'));
    const ids = [...new Set(sourceIds)].filter((id) => id !== targetId);
    if (!ids.length) throw new MergeError(tr('至少选两条才能合并'));
    const sources = ids.map((id) => {
      const s = this.get('person', id);
      if (!s) throw new MergeError(tr('有一个人已经不在了'));
      return s;
    });
    const plan = planPersonMerge(target, sources, choices);
    const merging = new Set(ids);
    const rows: Array<{ table: TableName; row: BaseRow }> = [{ table: 'person', row: { ...target, ...plan.patch, deleted: false, merged_into: null } as BaseRow }];
    for (const s of sources) rows.push({ table: 'person', row: { ...s, deleted: true, merged_into: targetId } as BaseRow });
    const { links, tasks, rows: more, movedTasks } = this.repointPeople(merging, targetId);
    rows.push(...more);
    this.write(rows);
    return { targetId, merged: sources.length, movedTasks, undo: { kind: 'person', target: { ...target }, sources: sources.map((s) => ({ ...s })), links, tasks } };
  }

  /** 把指着 from 里那些人的人物关联 / 任务字段改到 to（去重）；返回要写的行和改之前的样子。 */
  private repointPeople(from: ReadonlySet<string>, to: string) {
    const rows: Array<{ table: TableName; row: BaseRow }> = [];
    const links: TaskPerson[] = [];
    const tasks: Array<{ id: string; type_data: Record<string, FieldValue> }> = [];
    const touched = new Set<string>();
    const resolved = (pid: string) => this.resolvePersonId(pid) ?? pid;
    const live = this.list('task_person');
    const hasTarget = new Set(live.filter((x) => x.person_id === to).map((x) => x.task_id));
    for (const x of live) {
      if (x.person_id === to || !(from.has(x.person_id) || from.has(resolved(x.person_id)))) continue;
      links.push({ ...x });
      touched.add(x.task_id);
      if (hasTarget.has(x.task_id)) rows.push({ table: 'task_person', row: { ...x, deleted: true } });
      else {
        hasTarget.add(x.task_id);
        rows.push({ table: 'task_person', row: { ...x, person_id: to } as BaseRow });
      }
    }
    for (const t of this.list('task')) {
      const type = this.get('task_type', t.type_id);
      let td: Record<string, FieldValue> | null = null;
      for (const f of type?.fields ?? []) {
        const v = t.type_data[f.key];
        if (f.kind !== 'person' || typeof v !== 'string' || v === to || !(from.has(v) || from.has(resolved(v)))) continue;
        td ??= { ...t.type_data };
        td[f.key] = to;
      }
      if (td) {
        tasks.push({ id: t.id, type_data: t.type_data });
        touched.add(t.id);
        rows.push({ table: 'task', row: { ...t, type_data: td } as BaseRow });
      }
    }
    return { rows, links, tasks, movedTasks: touched.size };
  }

  /** 撤销一次合并：目标回到合并前，来源翻回来（不再指向目标），改指过、现在还指着目标的任务改回去。 */
  undoMerge(undo: MergeUndo): void {
    const rows: Array<{ table: TableName; row: BaseRow }> = [];
    if (undo.kind === 'item') {
      const cur = this.tables.library_item.get(undo.target.id);
      if (cur) rows.push({ table: 'library_item', row: { ...cur, name: undo.target.name, image: undo.target.image, fields: undo.target.fields, note_md: undo.target.note_md } as BaseRow });
      for (const s of undo.sources) {
        const c = this.tables.library_item.get(s.id);
        if (c) rows.push({ table: 'library_item', row: { ...c, name: s.name, image: s.image, fields: s.fields, note_md: s.note_md, deleted: false, merged_into: null } as BaseRow });
      }
      for (const m of undo.tasks) {
        const t = this.get('task', m.id);
        if (t && t.library_item_id === undo.target.id) rows.push({ table: 'task', row: { ...t, library_item_id: m.library_item_id } as BaseRow });
      }
    } else {
      const cur = this.tables.person.get(undo.target.id);
      const { id: _i, updated_at: _u, deleted: _d, merged_into: _m, ...prev } = undo.target;
      if (cur) rows.push({ table: 'person', row: { ...cur, ...prev } as BaseRow });
      for (const s of undo.sources) {
        const c = this.tables.person.get(s.id);
        if (c) rows.push({ table: 'person', row: { ...c, name: s.name, avatar_asset_id: s.avatar_asset_id, relation: s.relation, birthday: s.birthday, note_md: s.note_md, deleted: false, merged_into: null } as BaseRow });
      }
      for (const l of undo.links) {
        const c = this.tables.task_person.get(l.id);
        if (c) rows.push({ table: 'task_person', row: { ...c, person_id: l.person_id, deleted: l.deleted } as BaseRow });
      }
      for (const m of undo.tasks) {
        const t = this.get('task', m.id);
        if (t) rows.push({ table: 'task', row: { ...t, type_data: m.type_data } as BaseRow });
      }
    }
    this.write(rows);
  }

  /**
   * 合并之后的收尾（打开时、拉下来新行后各跑一次，没事可做就不写）：
   * 1. 两台设备同时把 A 并进 B、B 并进 A：成环的墓碑留 id 最小的那条翻回来（各端一样）；
   * 2. 任务 / 人物关联还指着已经并掉的旧 id（别的设备离线时新建的）：改写到留下的那条。
   */
  settleMerges(): void {
    const rows: Array<{ table: TableName; row: BaseRow }> = [];
    for (const table of ['library_item', 'person'] as const) {
      const map = this.tables[table] as Map<string, LibraryItem | Person>;
      for (const id of mergeCycleSurvivors(map.values(), (x) => map.get(x))) {
        const r = map.get(id)!;
        const row = { ...r, deleted: false, merged_into: null } as unknown as BaseRow;
        map.set(id, row as LibraryItem & Person);
        rows.push({ table, row });
      }
    }
    for (const t of this.tables.task.values()) {
      if (t.deleted || !t.library_item_id) continue;
      const raw = this.tables.library_item.get(t.library_item_id);
      if (!raw?.deleted || !raw.merged_into) continue;
      const to = this.resolveItemId(t.library_item_id);
      if (to && to !== t.library_item_id) rows.push({ table: 'task', row: { ...t, library_item_id: to } as BaseRow });
    }
    // 先写这一批（人物那边可能也要改同一件任务，得在新行上改）
    this.write(dedupeRows(rows));
    rows.length = 0;
    const merged = new Map<string, string>();
    for (const p of this.tables.person.values()) {
      if (!p.deleted || !p.merged_into) continue;
      const to = this.resolvePersonId(p.id);
      if (to) merged.set(p.id, to);
    }
    const byTarget = new Map<string, Set<string>>();
    for (const [, to] of merged) if (!byTarget.has(to)) byTarget.set(to, new Set());
    for (const [from, to] of merged) byTarget.get(to)!.add(from);
    for (const [to, from] of byTarget) this.write(this.repointPeople(from, to).rows);
  }

  /** 资料库里可能重复的几组（同名 / 同一个站点编号），不含点过「不是同一个」的；人物库按名字。 */
  duplicateGroups(typeId: string): DuplicateGroup[] {
    const type = this.get('task_type', typeId);
    if (!hasLibrary(type)) return [];
    const dismissed = new Set(Array.isArray(this.pref(NOT_DUPLICATES_PREF)) ? (this.pref(NOT_DUPLICATES_PREF) as string[]) : []);
    const uses = new Map(this.libraryEntries(typeId).map((e) => [e.id, e.uses]));
    if (isPersonLibrary(type)) return duplicateGroups(null, this.list('person').map((p) => ({ id: p.id, name: p.name })), { uses, dismissed });
    return duplicateGroups(type, this.libraryItems(typeId), { uses, dismissed });
  }

  /** 「不是同一个」：这一组以后不再提示（跟着账户同步）。 */
  dismissDuplicateGroup(key: string): void {
    const cur = this.pref(NOT_DUPLICATES_PREF);
    const list = Array.isArray(cur) ? (cur as string[]) : [];
    if (!list.includes(key)) this.setPref(NOT_DUPLICATES_PREF, [...list, key]);
  }

  // ───────────── 任务 ─────────────

  createTask(input: NewTaskInput = {}): Task {
    const now = this.now();
    const type = this.get('task_type', input.type_id ?? null);
    const group = this.get('group', input.group_id ?? null);
    const typeId = input.type_id !== undefined ? input.type_id : (group?.default_type_id ?? null);
    const resolvedType = type ?? this.get('task_type', typeId);
    const maxSort = this.list('task').reduce((m, t) => Math.max(m, t.sort), 0);
    const created = this.insert('task', {
      body_md: input.body_md ?? dataLabel(resolvedType?.body_template ?? ''),
      status: input.status ?? '待办',
      group_id: input.group_id ?? null,
      scheduled_date: input.scheduled_date ?? null,
      type_id: typeId === PLAIN_TYPE_ID ? null : typeId,
      type_data: input.type_data ?? {},
      completion_mode: input.completion_mode ?? resolvedType?.default_completion_mode ?? 'once',
      target_value: input.target_value ?? null,
      unit: input.unit ?? null,
      target_date: input.target_date ?? null,
      recurrence: input.recurrence ?? null,
      checkin_category_id: input.checkin_category_id ?? null,
      library_item_id: input.library_item_id ?? null,
      remind_time: input.remind_time ?? null,
      done_at: input.done_at ?? null,
      sort: input.sort ?? maxSort + 1,
      created_at: input.created_at ?? now.toISOString(),
      ...(input.id ? { id: input.id } : {}),
    });
    // type_data 里直接写了资料（片名…）：挂到资料库（同名复用）
    return this.attachLibrary(created);
  }

  updateTask(id: string, patch: Partial<Omit<Task, 'id' | 'updated_at'>>): Task {
    return this.update('task', id, patch);
  }

  /** 删除任务：任务与它的依赖边、相关任务、我的一天条目、人物关联一起打墓碑。 */
  deleteTask(id: string): void {
    const rows: Array<{ table: TableName; row: BaseRow }> = [];
    const t = this.tables.task.get(id);
    if (!t || t.deleted) return;
    rows.push({ table: 'task', row: { ...t, deleted: true } });
    for (const d of this.list('dependency'))
      if (d.pred_id === id || d.succ_id === id) rows.push({ table: 'dependency', row: { ...d, deleted: true } });
    for (const m of this.list('my_day')) if (m.task_id === id) rows.push({ table: 'my_day', row: { ...m, deleted: true } });
    for (const p of this.list('task_person')) if (p.task_id === id) rows.push({ table: 'task_person', row: { ...p, deleted: true } });
    for (const l of this.list('task_link')) if (l.a_task_id === id || l.b_task_id === id) rows.push({ table: 'task_link', row: { ...l, deleted: true } });
    this.write(rows);
  }

  setStatus(id: string, status: TaskStatus): CompleteResult {
    const before = this.list('task');
    const edges = this.edges();
    // done_at = 结束时间（完成或关闭都记），重新打开时清空
    const task = this.updateTask(id, { status, done_at: isFinished(status) ? this.now().toISOString() : null });
    const unlocked =
      isFinished(status)
        ? unlockedSuccessors(id, before, edges)
            .map((s) => this.get('task', s))
            .filter((x): x is Task => !!x)
        : [];
    return { task, unlocked };
  }

  completeTask(id: string): CompleteResult {
    return this.setStatus(id, '完成');
  }

  /** 关闭：不做了也算结束，同样解锁后续，但不算成就。 */
  closeTask(id: string): CompleteResult {
    return this.setStatus(id, '关闭');
  }

  /** 重新打开：改回待办。 */
  reopenTask(id: string): Task {
    return this.setStatus(id, '待办').task;
  }

  /** “然后呢？”：新建一个后续任务并连上 FS 依赖。 */
  createSuccessor(predId: string, input: NewTaskInput = {}): Task {
    const pred = this.get('task', predId);
    const t = this.createTask({ group_id: pred?.group_id ?? null, ...input });
    this.addDependency(predId, t.id);
    return t;
  }

  // ───────────── 依赖 ─────────────

  /** 加 FS 依赖；成环 / 自环 / 重复时抛错（CycleError 等），不写入。 */
  addDependency(predId: string, succId: string): TableMap['dependency'] {
    assertCanAddEdge(this.edges(), predId, succId);
    return this.insert('dependency', { pred_id: predId, succ_id: succId, type: 'FS', lag: 0 });
  }

  removeDependency(predId: string, succId: string): void {
    for (const d of this.list('dependency')) if (d.pred_id === predId && d.succ_id === succId) this.remove('dependency', d.id);
  }

  // ───────────── 相关任务（无方向、不阻塞） ─────────────

  /**
   * 把两件任务连成「相关」：自己和自己、已经有前后关系的两件会抛错；已经相关就原样返回（幂等）。
   * 去掉过再连上：同一行（确定 id）的墓碑翻回来。
   */
  linkTasks(x: string, y: string): TableMap['task_link'] {
    if (x === y) throw new SelfLinkError();
    if (!this.get('task', x) || !this.get('task', y)) throw new Error(tr('任务不存在'));
    if (hasDependencyBetween(this.edges(), x, y)) throw new LinkedByDependencyError();
    const id = taskLinkId(x, y);
    const cur = this.tables.task_link.get(id);
    if (cur && !cur.deleted) return cur;
    const [a, b] = canonicalPair(x, y);
    if (cur) return this.update('task_link', id, { deleted: false, created_at: this.now().toISOString() });
    return this.insert('task_link', { id, a_task_id: a, b_task_id: b, note: '', created_at: this.now().toISOString() });
  }

  unlinkTasks(x: string, y: string): void {
    // 确定 id 那行之外，同步进来的旧行（别的写法）也一起去掉
    const key = canonicalPair(x, y).join('|');
    for (const l of this.list('task_link')) if (canonicalPair(l.a_task_id, l.b_task_id).join('|') === key) this.remove('task_link', l.id);
  }

  /** 显示用的相关行：两端都还在、且没有前后关系（前后关系优先）。 */
  taskLinks(): TableMap['task_link'][] {
    return visibleLinks(this.list('task_link'), this.edges()).filter((l) => this.get('task', l.a_task_id) && this.get('task', l.b_task_id));
  }

  /** 和这件任务相关的任务（按连上的先后，去重）。列表里每行都要用，按版本缓存。 */
  relatedTasks(taskId: string): Task[] {
    if (this.relatedCache?.version !== this._version) {
      const links = this.taskLinks();
      const index = new Map<string, string[]>();
      for (const id of new Set(links.flatMap((l) => [l.a_task_id, l.b_task_id]))) index.set(id, [...new Set(relatedIdsOf(links, id))]);
      this.relatedCache = { version: this._version, value: index };
    }
    return (this.relatedCache.value.get(taskId) ?? []).map((id) => this.get('task', id)).filter((t): t is Task => !!t);
  }

  isRelated(x: string, y: string): boolean {
    return this.relatedTasks(x).some((t) => t.id === y);
  }

  // ───────────── 我的一天 ─────────────

  addToMyDay(taskId: string, date: string = toDateKey(this.now())): TableMap['my_day'] {
    const existing = this.list('my_day').find((e) => e.task_id === taskId && e.date === date);
    if (existing) return existing;
    const maxSort = this.list('my_day')
      .filter((e) => e.date === date)
      .reduce((m, e) => Math.max(m, e.sort), 0);
    return this.insert('my_day', { task_id: taskId, date, sort: maxSort + 1, added_at: this.now().toISOString() });
  }

  removeFromMyDay(taskId: string, date: string = toDateKey(this.now())): void {
    for (const e of this.list('my_day')) if (e.task_id === taskId && e.date === date) this.remove('my_day', e.id);
  }

  isInMyDay(taskId: string, date: string = toDateKey(this.now())): boolean {
    return this.list('my_day').some((e) => e.task_id === taskId && e.date === date);
  }

  /** 按给定顺序重排当天清单。 */
  reorderMyDay(date: string, taskIds: string[]): void {
    const entries = this.list('my_day').filter((e) => e.date === date);
    const rows: Array<{ table: TableName; row: BaseRow }> = [];
    taskIds.forEach((tid, i) => {
      const e = entries.find((x) => x.task_id === tid);
      if (e && e.sort !== i + 1) rows.push({ table: 'my_day', row: { ...e, sort: i + 1 } as BaseRow });
    });
    this.write(rows);
  }

  // ───────────── 待安排 ─────────────

  /** 待安排：没结束、只做一次、没日期、今天的我的一天里没有的任务（见 backlog.ts）。 */
  backlog(today: string = toDateKey(this.now())): Task[] {
    return backlogTasks(this.tasks(), this.list('my_day'), today);
  }

  /** 待安排里拖动排序：这几件按新顺序重新占用它们原来的那些 sort 值（不影响别的任务的相对顺序）。 */
  reorderBacklog(taskIds: string[]): void {
    const tasks = taskIds.map((id) => this.get('task', id)).filter((t): t is Task => !!t);
    const slots = tasks.map((t) => t.sort).sort((a, b) => a - b);
    // 有重复的 sort 时拉开一点，保证新顺序严格递增
    for (let i = 1; i < slots.length; i++) if (slots[i]! <= slots[i - 1]!) slots[i] = slots[i - 1]! + 1e-6;
    const rows: Array<{ table: TableName; row: BaseRow }> = [];
    tasks.forEach((t, i) => {
      if (t.sort !== slots[i]) rows.push({ table: 'task', row: { ...t, sort: slots[i]! } as BaseRow });
    });
    this.write(rows);
  }

  // ───────────── 打卡 ─────────────

  /**
   * 记一条打卡事件。周期键按任务的重复规则从 date 算出。
   * 非重复任务达标后自动标“完成”（并解锁后续）；重复任务只记录周期进度。
   */
  checkIn(taskId: string, kind: CheckInKind, amount = 0, date: string = toDateKey(this.now())): CheckInResult {
    const task = this.get('task', taskId);
    if (!task) throw new Error(tr('任务不存在'));
    const period_key = periodKeyForTask(task, date);
    const before = this.progress(taskId, date);
    this.insert('check_in', { task_id: taskId, period_key, kind, amount, at: this.now().toISOString() });
    const progress = this.progress(taskId, date)!;
    let completed: CompleteResult | null = null;
    if (!task.recurrence && progress.met && !before?.met && task.status !== '完成') completed = this.completeTask(taskId);
    else if (!task.recurrence && kind === 'start' && task.status === '待办') this.updateTask(taskId, { status: '进行中' });
    return { progress, completed };
  }

  // ───────────── 人物 ─────────────

  linkPerson(taskId: string, personId: string): void {
    personId = this.resolvePersonId(personId) ?? personId;
    if (this.list('task_person').some((x) => x.task_id === taskId && (this.resolvePersonId(x.person_id) ?? x.person_id) === personId)) return;
    this.insert('task_person', { task_id: taskId, person_id: personId });
  }

  unlinkPerson(taskId: string, personId: string): void {
    for (const x of this.list('task_person')) if (x.task_id === taskId && (x.person_id === personId || this.resolvePersonId(x.person_id) === personId)) this.remove('task_person', x.id);
  }

  peopleOf(taskId: string): TableMap['person'][] {
    const ids = new Set(this.list('task_person').filter((x) => x.task_id === taskId).map((x) => this.resolvePersonId(x.person_id) ?? x.person_id));
    // “人物”类型的人物字段也算关联
    const task = this.get('task', taskId);
    const type = this.get('task_type', task?.type_id);
    for (const f of type?.fields ?? []) {
      const v = task?.type_data[f.key];
      if (f.kind === 'person' && typeof v === 'string') ids.add(this.resolvePersonId(v) ?? v);
    }
    return [...ids].map((id) => this.get('person', id)).filter((p): p is TableMap['person'] => !!p);
  }

  tasksOfPerson(personId: string): Task[] {
    return this.tasks().filter((t) => this.peopleOf(t.id).some((p) => p.id === personId));
  }

  // ───────────── 偏好（同步） ─────────────

  /** 同步的偏好值（没设过是 undefined）。 */
  pref(key: string): FieldValue | undefined {
    const row = this.get('pref', prefId(key));
    return row ? row.value : undefined;
  }

  /** 设偏好（同一个 key 各设备同一行，LWW）；值没变不写。 */
  setPref(key: string, value: FieldValue): void {
    const id = prefId(key);
    const cur = this.get('pref', id);
    if (cur && JSON.stringify(cur.value) === JSON.stringify(value)) return;
    if (this.raw('pref', id)) this.update('pref', id, { value, deleted: false });
    else this.insert('pref', { id, key, value });
  }

  // ───────────── 打卡分类 ─────────────

  /** 打卡分类按显示顺序；默认不含隐藏的。 */
  checkInCategories(includeHidden = false): TableMap['checkin_category'][] {
    return this.list('checkin_category')
      .filter((c) => includeHidden || !c.hidden)
      .sort((a, b) => a.sort - b.sort);
  }

  /** 「常用」打卡分类（选择器第一屏）：按重复任务用到的件数，不够用默认几个补齐。 */
  frequentCheckInCategories(n = 6): TableMap['checkin_category'][] {
    const usage = this.tasks()
      .filter((t) => t.recurrence)
      .map((t) => ({ categoryId: t.checkin_category_id ?? null, at: t.created_at }));
    return pickFrequentCategories(this.checkInCategories(), usage, n);
  }

  /** 打卡分类上移 / 下移一位（含隐藏的一起排）；只改 sort，id 不变。 */
  moveCheckInCategory(id: string, delta: -1 | 1): void {
    const all = this.checkInCategories(true);
    const i = all.findIndex((c) => c.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= all.length) return;
    const order = all.map((c) => c.id);
    [order[i], order[j]] = [order[j]!, order[i]!];
    // 只写顺序真的变了的行（重新编号 1..n）
    const rows = order
      .map((cid, k) => ({ cur: this.get('checkin_category', cid)!, sort: k + 1 }))
      .filter(({ cur, sort }) => cur.sort !== sort)
      .map(({ cur, sort }) => ({ table: 'checkin_category' as const, row: { ...cur, sort } as BaseRow }));
    this.write(rows);
  }

  createCheckInCategory(name: string, icon = 'tag', color = '#8e8e93'): TableMap['checkin_category'] {
    const sort = this.list('checkin_category').reduce((m, c) => Math.max(m, c.sort), 0) + 1;
    return this.insert('checkin_category', { name, icon, color, builtin: false, hidden: false, sort });
  }

  // ───────────── 类型 ─────────────

  /** 复制一个类型（内置类型也可复制后修改）。 */
  duplicateType(typeId: string, name?: string): TableMap['task_type'] {
    const src = this.get('task_type', typeId);
    if (!src) throw new Error(tr('类型不存在'));
    const { id: _id, updated_at: _u, deleted: _d, ...rest } = src;
    return this.insert('task_type', { ...rest, name: name ?? tr('{name} 副本', { name: src.name }), builtin: false, sort: this.list('task_type').length });
  }
}
