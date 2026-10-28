/**
 * Store：内存快照 + 领域操作。读是同步的（UI 直接读），写先改内存、通知订阅者，
 * 再异步落到 StorageAdapter（并进 outbox）。UI 永不等待存储或网络。
 */
import { HlcClock } from './hlc';
import { uuidv7 } from './uuid';
import { toDateKey } from './dates';
import { normalizeRange } from './date-range';
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
  LIBRARY_SIDEBAR_PREF,
  GROUP_SIDEBAR_PREF,
  sidebarLibraryIds,
  withSidebarLibrary,
  isPersonLibrary,
  isArchivedType,
  isPickableType,
  itemData,
  mergedData,
  planLibraryMigration,
  planFieldMigration,
  splitTypeData,
  allTaskFieldsOf,
  type LibraryEntry,
} from './library';
import { LEGACY_BUILTIN_FIELDS, addField, cleanOptions, isEditableType, orderTypes, updateField, type NewFieldInput } from './typedef';
import { BUILTIN_CATEGORIES } from './seed/builtin-checkin-categories';
import { CATEGORY_FREQUENT_PREF, CATEGORY_GROUP_PREF, categoryGroupOf, categoryGroupOverrides, categoryLastUsed, categoryStateOf, frequentCategoryIds, orderPickerCategories, withCategoryGroup, withCategoryState, type CategoryGroup, type CategoryState } from './category-prefs';
import { CategoryDeleteError, categoryFromCheckin, categoryNameTaken, fillCategory, planCategoryMerges, resolveCategoryId, sortCategories, DEFAULT_CATEGORY_COLOR, DEFAULT_CATEGORY_ICON } from './categories';
import { isMirrored, legacyRefPlan, refsMirrorOf, sortLinks, taskCategoryId, taskItemId } from './task-refs';
import { mergeCycleSurvivors, planItemMerge, planPersonMerge, resolveMerged, duplicateGroups, type DuplicateGroup, type MergeChoices } from './merge';
import { TABLES, isFinished, normalizeStatus, type BaseRow, type Category, type CheckInCategory, type DateKey, type CheckInKind, type FieldDef, type FieldValue, type LibraryItem, type NewRow, type Person, type TableMap, type TableName, type Task, type TaskCategory, type TaskItem, type TaskPerson, type TaskStatus } from './types';
import type { Change, StorageAdapter } from './storage/adapter';

import { dataLabel, tr } from './i18n';
import { parseHlc } from './hlc';
import { FutureJournalError, JOURNAL_PREFS, canWriteJournal, conflictSummary, isDateKey, isJournalConflict, journalEntryId, journalToday, mergeJournalConflict, normalizeDayStart, type MoodId } from './journal';
import type { Attachment, AttachmentOwnerType, JournalEntry } from './types';
import { renamedFileName, safeFileName, sortAttachments } from './attachments';
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
  /** 这次记下的事件（撤销用 store.undoCheckIn(event.id)）。 */
  event: TableMap['check_in'];
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

function normalizeRangeFields(start: DateKey | null, end: DateKey | null): { scheduled_date: DateKey | null; end_date: DateKey | null } {
  const r = normalizeRange(start, end);
  return { scheduled_date: r.start, end_date: r.end };
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

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
        // v11 之前没有 category_id（类型）：用旧的打卡分类，只在内存补（SQLite 端迁移已抄过）
        if (t === 'task' && (row as Task).category_id === undefined) (row as Task).category_id = (row as Task).checkin_category_id ?? null;
        // v11 之前的项目分类没有图标、顺序…：只在内存补默认
        if (t === 'category') Object.assign(row, fillCategory(row as Category));
        // 资料库之前的任务没有 library_item_id：同上，只在内存补 null
        if (t === 'task' && (row as Task).library_item_id === undefined) (row as Task).library_item_id = null;
        // v4 之前没有 remind_time：同上
        if (t === 'task' && (row as Task).remind_time === undefined) (row as Task).remind_time = null;
        // v8 之前没有 time_zone（空 = 跟着设备）：同上
        if (t === 'task' && (row as Task).time_zone === undefined) (row as Task).time_zone = null;
        // v10 之前没有 end_date（空 = 单日）：同上
        if (t === 'task' && (row as Task).end_date === undefined) (row as Task).end_date = null;
        // v12 之前没有 refs_mirror（多类型与多资料）：同上；null = 当成旧客户端写的，打开时把单值补进多值
        if (t === 'task' && (row as Task).refs_mirror === undefined) (row as Task).refs_mirror = null;
        // v9 之前没有 count_config（空 = 步长 1）：同上
        if (t === 'task' && !isPlainObject((row as Task).count_config)) (row as Task).count_config = {};
        // v5 之前没有 merged_into：同上
        if ((t === 'library_item' || t === 'person') && (row as LibraryItem).merged_into === undefined) (row as LibraryItem).merged_into = null;
        map.set(row.id, row);
        // 本地时钟不落后于已存数据
        if (row.updated_at && /^\d{13}-/.test(row.updated_at)) store.clock.receive(row.updated_at);
      }
    }
    store.ensureBuiltinTypes();
    store.adoptCheckinCategories();
    store.ensureBuiltinCategories();
    store.migrateLegacyStatuses();
    store.migrateToLibrary();
    store.migrateFieldKinds();
    store.migratePersonTypeTasks();
    store.reviveReferencedTypes();
    store.settleMerges();
    store.settleCategories();
    store.backfillRefs();
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
    const stampOne = (c: { table: TableName; row: BaseRow }): Change => {
      const row = { ...c.row, updated_at: this.clock.tick() };
      // 类型：旧客户端只认 checkin_category_id，写任务时抄一份过去
      if (c.table === 'task' && (row as Task).category_id !== undefined) (row as Task).checkin_category_id = (row as Task).category_id;
      // 多类型与多资料：任务行总带着单值的签名（见 task-refs.ts）
      if (c.table === 'task') (row as Task).refs_mirror = refsMirrorOf(row as Task);
      // 资料 / 人物总带着 merged_into（没合并过 = null），和重开后读回的样子一致
      if ((c.table === 'library_item' || c.table === 'person') && (row as LibraryItem).merged_into === undefined) (row as LibraryItem).merged_into = null;
      (this.tables[c.table] as Map<string, BaseRow>).set(row.id, row);
      return { table: c.table, row } as Change;
    };
    let stamped: Change[] = changes.map(stampOne);
    // 单值和多值对齐（双写）：写了单值的补进多值，多值变了的把第一个抄回单值
    const extra = this.syncRefs(stamped);
    if (extra.length) stamped = dedupeRows([...stamped, ...extra.map(stampOne)]) as Change[];
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
    /** 日记同步保护：拉下来的一版没看到本机那版，合好的新一版（作为本机写入）。 */
    const journalMerges: JournalEntry[] = [];
    for (const c of changes) {
      const table = this.tables[c.table] as Map<string, BaseRow> | undefined;
      if (!table || !c.row?.id || typeof c.row.updated_at !== 'string') continue;
      const cur = table.get(c.row.id);
      if (/^\d{13}-/.test(c.row.updated_at)) this.clock.receive(c.row.updated_at);
      if (c.table === 'checkin_category') {
        // 旧客户端写来的打卡分类：表照存，同时按同一个 id 映射进 category（见 categories.ts）
        const mapped = this.mapRemoteCheckinCategory(c.row as CheckInCategory);
        if (mapped) applied.push({ table: 'category', row: mapped } as Change);
      }
      if (cur && !(c.row.updated_at > cur.updated_at)) continue;
      const row = { ...c.row } as BaseRow;
      // 旧客户端写来的项目分类没有新列：从本机那行补，别把图标、不显示、顺序冲掉
      if (c.table === 'category') Object.assign(row, fillCategory(row as Category, cur as Category | undefined));
      if (c.table === 'journal_entry') {
        const j = row as JournalEntry;
        if (j.mood === undefined) j.mood = null;
        if (j.base_at === undefined) j.base_at = null;
        if (typeof j.body_md !== 'string') j.body_md = '';
        if (cur && isJournalConflict(cur as JournalEntry, j)) {
          const merged = mergeJournalConflict(j.body_md, (cur as JournalEntry).body_md, conflictSummary(cur.updated_at));
          if (merged !== null) journalMerges.push({ ...j, body_md: merged, base_at: j.updated_at });
        }
      }
      if (c.table === 'task') {
        const t = row as Task;
        if (t.checkin_category_id === undefined) t.checkin_category_id = null;
        // 旧客户端写来的任务没有 category_id：用它的打卡分类
        if (t.category_id === undefined) t.category_id = t.checkin_category_id;
        if (t.library_item_id === undefined) t.library_item_id = null;
        if (t.remind_time === undefined) t.remind_time = null;
        if (t.time_zone === undefined) t.time_zone = null;
        if (t.refs_mirror === undefined) t.refs_mirror = null;
        if (!isPlainObject(t.count_config)) t.count_config = {};
      }
      if (c.table === 'attachment') {
        const a = row as Attachment;
        for (const k of ['r2_key', 'thumb_key', 'width', 'height'] as const) if (a[k] === undefined) a[k] = null;
        if (typeof a.file_name !== 'string') a.file_name = 'file';
        if (typeof a.mime !== 'string') a.mime = 'application/octet-stream';
        if (typeof a.size !== 'number') a.size = 0;
      }
      if ((c.table === 'library_item' || c.table === 'person') && (row as LibraryItem).merged_into === undefined) (row as LibraryItem).merged_into = null;
      table.set(row.id, row);
      applied.push({ table: c.table, row } as Change);
    }
    if (!applied.length) return 0;
    // 旧客户端改了单值（任务行没有签名或对不上）：补进多值，只加不删；同样不进 outbox（各设备各补一遍结果一样）
    const legacy: Change[] = [];
    for (const c of applied) if (c.table === 'task' && !c.row.deleted) legacy.push(...this.legacyLinks(c.row as Task));
    applied.push(...legacy);
    this._version++;
    for (const fn of this.listeners) fn();
    this.pending = this.pending
      .then(() => this.adapter.applyRemoteChanges(applied))
      .catch((err) => this.opts.onError?.(err));
    // 拉下来的有合并（来源墓碑）或指向已合并资料的任务：解开成环的合并，把指着旧 id 的改写到目标
    if (applied.some((c) => c.table === 'library_item' || c.table === 'person' || c.table === 'task' || c.table === 'task_person')) this.settleMerges();
    // 类型：拉下来的有同名的就并、指着被并掉的改指留下的
    if (applied.some((c) => c.table === 'category' || c.table === 'task' || c.table === 'group')) this.settleCategories();
    // 日记：赢家内容 + 末尾折叠块收着本机那版，作为一次新的本机写入推上去（另一台看到的 base_at 就是赢家，不会再合）
    if (journalMerges.length) this.write(journalMerges.map((row) => ({ table: 'journal_entry' as const, row })));
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
    if (table === 'category' || table === 'checkin_category') throw new CategoryDeleteError();
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

  /** 补齐内置类型（固定 id）；以后在种子里追加的新类型，老用户打开时也会补上。 */
  private ensureBuiltinCategories() {
    const missing = BUILTIN_CATEGORIES.filter((c) => !this.tables.category.has(c.id));
    if (!missing.length) return;
    for (const c of missing) this.tables.category.set(c.id, { ...c });
    this._version++;
    this.pending = this.pending.then(() => this.adapter.applyChanges(missing.map((row) => ({ table: 'category', row }))));
  }

  /**
   * 打卡分类按原 id 拷进 category（v11 合并的不看名字那半；SQLite 端迁移已经拷过，这里管 localStorage / 内存
   * 和迁移之后才拉到的旧行）。保留原时间戳，落盘不进 outbox（各设备各拷一遍结果一样）。
   */
  private adoptCheckinCategories() {
    const rows: Category[] = [];
    for (const c of this.tables.checkin_category.values()) {
      const mapped = this.mapRemoteCheckinCategory(c);
      if (mapped) rows.push(mapped);
    }
    if (!rows.length) return;
    this._version++;
    this.pending = this.pending.then(() => this.adapter.applyRemoteChanges(rows.map((row) => ({ table: 'category' as const, row }))));
  }

  /**
   * 一行旧打卡分类 → 要写进 category 的行；category 里已经有一样新或更新的就返回 undefined。
   * 已经并进别的类型的，保持墓碑和 merged_into（旧客户端改了名也不复活）。改的是内存，调用方负责落盘。
   */
  private mapRemoteCheckinCategory(c: CheckInCategory): Category | undefined {
    if (!c?.id || typeof c.updated_at !== 'string') return undefined;
    const cur = this.tables.category.get(c.id);
    if (cur && !(c.updated_at > cur.updated_at)) return undefined;
    const row = categoryFromCheckin(c);
    if (cur?.merged_into) Object.assign(row, { deleted: true, merged_into: cur.merged_into });
    this.tables.category.set(row.id, row);
    return row;
  }

  /**
   * 类型的同名合并和引用改写（Store 打开、拉到类型 / 任务 / 项目之后都跑一遍）：
   * 同名（去首尾空格、不分大小写）的并成一个，被并的打墓碑记 merged_into；任务和项目上指着被并掉的改指留下的。
   * 挑谁留下只看行本身（categories.ts survivorOrder），两台设备各跑一遍结果一样。只写真变了的行。
   */
  settleCategories(): void {
    const rows: Array<{ table: TableName; row: BaseRow }> = [];
    for (const m of planCategoryMerges([...this.tables.category.values()])) {
      if (m.survivorChanged) rows.push({ table: 'category', row: m.survivor });
      for (const l of m.losers) rows.push({ table: 'category', row: { ...l, deleted: true, merged_into: m.survivor.id } as BaseRow });
    }
    this.write(rows);
    const resolve = (id: string | null) => resolveCategoryId((x) => this.tables.category.get(x), id);
    const refs: Array<{ table: TableName; row: BaseRow }> = [];
    for (const t of this.tables.task.values()) {
      if (t.deleted || !t.category_id) continue;
      const to = resolve(t.category_id);
      if (to !== t.category_id) refs.push({ table: 'task', row: { ...t, category_id: to } as BaseRow });
    }
    for (const g of this.tables.group.values()) {
      if (g.deleted || !g.category_id) continue;
      const to = resolve(g.category_id);
      if (to !== g.category_id) refs.push({ table: 'group', row: { ...g, category_id: to } as BaseRow });
    }
    this.write(refs);
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
    const ids = new Set<string>();
    for (const l of this.list('task_item')) if ((this.resolveItemId(l.item_id) ?? l.item_id) === itemId) ids.add(l.task_id);
    return this.tasks().filter((t) => ids.has(t.id) || (t.library_item_id && (t.library_item_id === itemId || this.resolveItemId(t.library_item_id) === itemId)));
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
      // 一件任务能挂几条资料（Rei 2026-10-28）：每条都算用到
      const iids = new Set(this.itemIdsOfTask(t));
      for (const iid of iids) {
        last.set(iid, Math.max(last.get(iid) ?? 0, ms(t.created_at)));
        uses.set(iid, (uses.get(iid) ?? 0) + 1);
      }
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
    const linked = new Set<string>();
    for (const l of this.list('task_item'))
      if ((this.resolveItemId(l.item_id) ?? l.item_id) === id) {
        linked.add(l.task_id);
        rows.push({ table: 'task_item', row: { ...l, deleted: true } });
      }
    for (const t of this.list('task')) {
      if (!(t.library_item_id && this.resolveItemId(t.library_item_id) === id) && !linked.has(t.id)) continue;
      // 只剩这一条资料时把资料抄回任务，卡片照样显示；还有别的资料就只解开这条
      const others = this.itemIdsOfTask(t).filter((x) => x !== id);
      rows.push({ table: 'task', row: (others.length ? { ...t, library_item_id: null } : { ...t, library_item_id: null, type_data: { ...itemData(type, item), ...t.type_data } }) as BaseRow });
    }
    this.write(rows);
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

  // ───────────── 多类型与多资料（Rei 2026-10-28，task-refs.ts / docs/MULTI-TYPE.md） ─────────────

  private refIndexCache: { version: number; cats: Map<string, TaskCategory[]>; items: Map<string, TaskItem[]> } | null = null;

  /** 每件任务生效的关联行（按 sort），按版本缓存。 */
  private refIndex() {
    if (this.refIndexCache?.version === this._version) return this.refIndexCache;
    const cats = new Map<string, TaskCategory[]>();
    const items = new Map<string, TaskItem[]>();
    for (const r of this.tables.task_category.values()) if (!r.deleted) (cats.get(r.task_id) ?? cats.set(r.task_id, []).get(r.task_id)!).push(r);
    for (const r of this.tables.task_item.values()) if (!r.deleted) (items.get(r.task_id) ?? items.set(r.task_id, []).get(r.task_id)!).push(r);
    for (const [k, v] of cats) cats.set(k, sortLinks(v));
    for (const [k, v] of items) items.set(k, sortLinks(v));
    this.refIndexCache = { version: this._version, cats, items };
    return this.refIndexCache;
  }

  private resolveCat = (id: string | null | undefined): string | null => resolveCategoryId((x) => this.tables.category.get(x), id ?? null);

  /** 任务挂的类型 id（顺着合并找到留下的、去重，按顺序）。没有关联行时退回单值（还没补过的旧数据）。 */
  categoryIdsOfTask(task: Pick<Task, 'id' | 'category_id'> | string): string[] {
    const t = typeof task === 'string' ? this.get('task', task) : task;
    if (!t) return [];
    const links = this.refIndex().cats.get(t.id);
    const raw = links?.length ? links.map((l) => l.category_id) : t.category_id ? [t.category_id] : [];
    const out: string[] = [];
    for (const id of raw) {
      const r = this.resolveCat(id);
      if (r && !out.includes(r) && this.get('category', r)) out.push(r);
    }
    return out;
  }

  /** 任务挂的类型（按顺序）。 */
  categoriesOfTask(task: Pick<Task, 'id' | 'category_id'> | string): Category[] {
    return this.categoryIdsOfTask(task).map((id) => this.get('category', id)!);
  }

  /** 任务挂的资料 id（顺着合并找到留下的、去重、只要还在的，按顺序）。没有关联行时退回单值。不含人物。 */
  itemIdsOfTask(task: Pick<Task, 'id' | 'library_item_id'> | string): string[] {
    const t = typeof task === 'string' ? this.get('task', task) : task;
    if (!t) return [];
    const links = this.refIndex().items.get(t.id);
    const raw = links?.length ? links.map((l) => l.item_id) : t.library_item_id ? [t.library_item_id] : [];
    const out: string[] = [];
    for (const id of raw) {
      const r = this.resolveItemId(id);
      if (r && !out.includes(r)) out.push(r);
    }
    return out;
  }

  /** 任务挂的资料（按顺序，不含人物）。 */
  itemsOfTask(task: Pick<Task, 'id' | 'library_item_id'> | string): LibraryItem[] {
    return this.itemIdsOfTask(task).map((id) => this.get('library_item', id)!);
  }

  /** 和这件任务有关的人（人物库的资料）：人物关联，去重、顺着合并。 */
  personIdsOfTask(taskId: string): string[] {
    return [...new Set(this.list('task_person').filter((x) => x.task_id === taskId).map((x) => this.resolvePersonId(x.person_id) ?? x.person_id))].filter((id) => !!this.get('person', id));
  }

  /** 挂了这个类型的任务（顺着合并算）。 */
  tasksOfCategory(categoryId: string): Task[] {
    const target = this.resolveCat(categoryId);
    return this.tasks().filter((t) => !!target && this.categoryIdsOfTask(t).includes(target));
  }

  /** 改任务的类型（整组，按给的顺序；第一个写进单值）。 */
  setTaskCategories(taskId: string, ids: readonly string[]): void {
    const want = [...new Set(ids.map((id) => this.resolveCat(id)).filter((x): x is string => !!x))];
    const now = this.now().toISOString();
    const rows: Array<{ table: TableName; row: BaseRow }> = [];
    for (const l of this.list('task_category')) {
      if (l.task_id !== taskId) continue;
      const r = this.resolveCat(l.category_id);
      const k = r ? want.indexOf(r) : -1;
      // 合并掉的那个还挂着、留下的也在列表里：去掉旧行，下面按留下的 id 建
      if (k < 0 || l.category_id !== r) rows.push({ table: 'task_category', row: { ...l, deleted: true } });
    }
    want.forEach((cid, k) => {
      const id = taskCategoryId(taskId, cid);
      const cur = this.tables.task_category.get(id);
      if (cur && !cur.deleted && cur.sort === k) return;
      rows.push({ table: 'task_category', row: { ...(cur ?? { created_at: now }), id, task_id: taskId, category_id: cid, sort: k, deleted: false, updated_at: '' } as unknown as BaseRow });
    });
    this.write(dedupeRows(rows));
  }

  addTaskCategory(taskId: string, categoryId: string): void {
    const cur = this.categoryIdsOfTask(taskId);
    const r = this.resolveCat(categoryId);
    if (r && !cur.includes(r)) this.setTaskCategories(taskId, [...cur, r]);
  }

  removeTaskCategory(taskId: string, categoryId: string): void {
    const r = this.resolveCat(categoryId);
    this.setTaskCategories(taskId, this.categoryIdsOfTask(taskId).filter((x) => x !== r));
  }

  /** 改任务的资料（整组，按给的顺序；第一条写进单值，它的库写进 type_id）。去掉的只解开关联，资料留在库里。 */
  setTaskItems(taskId: string, ids: readonly string[]): void {
    const want = [...new Set(ids.map((id) => this.resolveItemId(id)).filter((x): x is string => !!x))];
    const now = this.now().toISOString();
    const rows: Array<{ table: TableName; row: BaseRow }> = [];
    for (const l of this.list('task_item')) {
      if (l.task_id !== taskId) continue;
      const r = this.resolveItemId(l.item_id);
      const k = r ? want.indexOf(r) : -1;
      if (k < 0 || l.item_id !== r) rows.push({ table: 'task_item', row: { ...l, deleted: true } });
    }
    want.forEach((iid, k) => {
      const id = taskItemId(taskId, iid);
      const cur = this.tables.task_item.get(id);
      if (cur && !cur.deleted && cur.sort === k) return;
      rows.push({ table: 'task_item', row: { ...(cur ?? { created_at: now }), id, task_id: taskId, item_id: iid, sort: k, deleted: false, updated_at: '' } as unknown as BaseRow });
    });
    const t = this.get('task', taskId);
    // 单值里的那条也要去掉（它可能还没补进多值）：不然下面对齐时又会被补回来
    if (t && t.library_item_id && !want.includes(this.resolveItemId(t.library_item_id) ?? t.library_item_id)) rows.push({ table: 'task', row: { ...t, library_item_id: null } as BaseRow });
    this.write(dedupeRows(rows));
  }

  addTaskItem(taskId: string, itemId: string): void {
    const cur = this.itemIdsOfTask(taskId);
    const r = this.resolveItemId(itemId);
    if (r && !cur.includes(r)) this.setTaskItems(taskId, [...cur, r]);
  }

  removeTaskItem(taskId: string, itemId: string): void {
    const r = this.resolveItemId(itemId) ?? itemId;
    this.setTaskItems(taskId, this.itemIdsOfTask(taskId).filter((x) => x !== r));
  }

  /**
   * write() 里调用：这批写入之后，把单值和多值对齐。
   * - 这批里写了任务行、单值不在多值里（导入、旧代码路径直接写了 category_id / library_item_id）：补一行关联，排第一。
   * - 多值的第一个和单值不一样：把第一个抄回单值（library_item_id 的库也写进 type_id）。
   * 返回要再写的行（调用方打时间戳）。
   */
  private syncRefs(stamped: readonly Change[]): Array<{ table: TableName; row: BaseRow }> {
    const touched = new Set<string>();
    const wroteTask = new Set<string>();
    for (const c of stamped) {
      if (c.table === 'task') {
        touched.add(c.row.id);
        wroteTask.add(c.row.id);
      } else if (c.table === 'task_category' || c.table === 'task_item') touched.add((c.row as TaskCategory).task_id);
    }
    if (!touched.size) return [];
    const out: Array<{ table: TableName; row: BaseRow }> = [];
    const now = this.now().toISOString();
    for (const id of touched) {
      const t = this.tables.task.get(id);
      if (!t || t.deleted) continue;
      const idx = this.refIndexFresh(id);
      let cats = idx.cats;
      let items = idx.items;
      if (wroteTask.has(id)) {
        const rc = this.resolveCat(t.category_id);
        if (rc && !cats.some((l) => this.resolveCat(l.category_id) === rc)) {
          const lid = taskCategoryId(id, rc);
          const row = { ...(this.tables.task_category.get(lid) ?? { created_at: now }), id: lid, task_id: id, category_id: rc, sort: (cats[0]?.sort ?? 1) - 1, deleted: false, updated_at: '' } as TaskCategory;
          out.push({ table: 'task_category', row });
          cats = [row, ...cats];
        }
        const ri = this.resolveItemId(t.library_item_id);
        if (ri && !items.some((l) => this.resolveItemId(l.item_id) === ri)) {
          const lid = taskItemId(id, ri);
          const row = { ...(this.tables.task_item.get(lid) ?? { created_at: now }), id: lid, task_id: id, item_id: ri, sort: (items[0]?.sort ?? 1) - 1, deleted: false, updated_at: '' } as TaskItem;
          out.push({ table: 'task_item', row });
          items = [row, ...items];
        }
      }
      const firstCat = cats.map((l) => this.resolveCat(l.category_id)).find((x): x is string => !!x && !!this.get('category', x)) ?? null;
      const firstItemId = items.map((l) => this.resolveItemId(l.item_id)).find((x): x is string => !!x) ?? null;
      const firstItem = this.get('library_item', firstItemId);
      const next: Task = { ...t, category_id: firstCat, library_item_id: firstItemId };
      // 资料所在的库 = 任务的「主库」（版式、任务字段、旧客户端的显示）；一条资料都没有时 type_id 不动（老任务只选了库没选资料）
      if (firstItem) next.type_id = firstItem.type_id;
      if (next.category_id !== t.category_id || next.library_item_id !== t.library_item_id || next.type_id !== t.type_id || t.refs_mirror !== refsMirrorOf(next)) out.push({ table: 'task', row: next as BaseRow });
    }
    return out;
  }

  /** 一件任务现在生效的关联（不走版本缓存：write 里表刚改过）。 */
  private refIndexFresh(taskId: string): { cats: TaskCategory[]; items: TaskItem[] } {
    const cats: TaskCategory[] = [];
    const items: TaskItem[] = [];
    for (const r of this.tables.task_category.values()) if (!r.deleted && r.task_id === taskId) cats.push(r);
    for (const r of this.tables.task_item.values()) if (!r.deleted && r.task_id === taskId) items.push(r);
    return { cats: sortLinks(cats), items: sortLinks(items) };
  }

  /**
   * 旧客户端写的任务（没有签名或对不上）：单值不在多值里就补一行关联（task-refs.ts legacyRefPlan，只加不删）。
   * 改的是内存，返回要落盘的行（不进 outbox；updated_at 用任务行的，各设备各补一遍结果一样）。
   */
  private legacyLinks(t: Task): Change[] {
    if (t.deleted || isMirrored(t)) return [];
    const out: Change[] = [];
    const allCats = [...this.tables.task_category.values()].filter((l) => l.task_id === t.id).map((l) => ({ ...l, ref: l.category_id }));
    const allItems = [...this.tables.task_item.values()].filter((l) => l.task_id === t.id).map((l) => ({ ...l, ref: l.item_id }));
    const rc = this.resolveCat(t.category_id);
    if (rc) {
      const lid = taskCategoryId(t.id, rc);
      const plan = legacyRefPlan(t, rc, (x) => this.resolveCat(x) ?? x, allCats, allCats.find((l) => l.id === lid));
      if (plan) {
        const row: TaskCategory = { id: lid, updated_at: t.updated_at, deleted: false, task_id: t.id, category_id: rc, sort: plan.sort, created_at: t.created_at };
        this.tables.task_category.set(lid, row);
        out.push({ table: 'task_category', row });
      }
    }
    const ri = t.library_item_id ? (this.resolveItemId(t.library_item_id) ?? t.library_item_id) : null;
    if (ri) {
      const lid = taskItemId(t.id, ri);
      const plan = legacyRefPlan(t, ri, (x) => this.resolveItemId(x) ?? x, allItems, allItems.find((l) => l.id === lid));
      if (plan) {
        const row: TaskItem = { id: lid, updated_at: t.updated_at, deleted: false, task_id: t.id, item_id: ri, sort: plan.sort, created_at: t.created_at };
        this.tables.task_item.set(lid, row);
        out.push({ table: 'task_item', row });
      }
    }
    return out;
  }

  /** 打开时：老数据（v12 之前、旧客户端写的）的单值搬进多值表。不进 outbox。 */
  private backfillRefs() {
    const rows: Change[] = [];
    for (const t of this.tables.task.values()) rows.push(...this.legacyLinks(t));
    if (!rows.length) return;
    this._version++;
    this.pending = this.pending.then(() => this.adapter.applyRemoteChanges(rows));
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
    // 组的默认类型归档了：不生效，退回普通
    const typeId = input.type_id !== undefined ? input.type_id : this.effectiveDefaultTypeId(group);
    const resolvedType = type ?? this.get('task_type', typeId);
    const maxSort = this.list('task').reduce((m, t) => Math.max(m, t.sort), 0);
    const created = this.insert('task', {
      body_md: input.body_md ?? dataLabel(resolvedType?.body_template ?? ''),
      status: input.status ?? '待办',
      group_id: input.group_id ?? null,
      ...normalizeRangeFields(input.scheduled_date ?? null, input.end_date ?? null),
      type_id: typeId === PLAIN_TYPE_ID ? null : typeId,
      type_data: input.type_data ?? {},
      completion_mode: input.completion_mode ?? resolvedType?.default_completion_mode ?? 'once',
      target_value: input.target_value ?? null,
      unit: input.unit ?? null,
      count_config: input.count_config ?? {},
      target_date: input.target_date ?? null,
      recurrence: input.recurrence ?? null,
      category_id: input.category_id ?? input.checkin_category_id ?? null,
      checkin_category_id: input.category_id ?? input.checkin_category_id ?? null,
      library_item_id: input.library_item_id ?? null,
      remind_time: input.remind_time ?? null,
      time_zone: input.time_zone ?? null,
      refs_mirror: null,
      done_at: input.done_at ?? null,
      sort: input.sort ?? maxSort + 1,
      created_at: input.created_at ?? now.toISOString(),
      ...(input.id ? { id: input.id } : {}),
    });
    // type_data 里直接写了资料（片名…）：挂到资料库（同名复用）
    return this.attachLibrary(created);
  }

  updateTask(id: string, patch: Partial<Omit<Task, 'id' | 'updated_at'>>): Task {
    // 改了开始或结束：结束日只能晚于开始日，否则回到单日（date-range.ts normalizeRange）
    if ('scheduled_date' in patch || 'end_date' in patch) {
      const cur = this.tables.task.get(id);
      const start = 'scheduled_date' in patch ? (patch.scheduled_date ?? null) : (cur?.scheduled_date ?? null);
      const end = 'end_date' in patch ? (patch.end_date ?? null) : (cur?.end_date ?? null);
      patch = { ...patch, ...normalizeRangeFields(start, end) };
    }
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
    for (const x of this.list('task_category')) if (x.task_id === id) rows.push({ table: 'task_category', row: { ...x, deleted: true } });
    for (const x of this.list('task_item')) if (x.task_id === id) rows.push({ table: 'task_item', row: { ...x, deleted: true } });
    for (const l of this.list('task_link')) if (l.a_task_id === id || l.b_task_id === id) rows.push({ table: 'task_link', row: { ...l, deleted: true } });
    for (const a of this.list('attachment')) if (a.owner_type === 'task' && a.owner_id === id) rows.push({ table: 'attachment', row: { ...a, deleted: true } });
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
    const event = this.insert('check_in', { task_id: taskId, period_key, kind, amount, at: this.now().toISOString() });
    const progress = this.progress(taskId, date)!;
    let completed: CompleteResult | null = null;
    if (!task.recurrence && progress.met && !before?.met && task.status !== '完成') completed = this.completeTask(taskId);
    else if (!task.recurrence && kind === 'start' && task.status === '待办') this.updateTask(taskId, { status: '进行中' });
    return { progress, completed, event };
  }

  /**
   * 计数里最后一次加量（这个周期、没撤销过的 add 事件）；没有是 undefined。
   * 「撤销上一次」用它。
   */
  lastCountAdd(taskId: string, date: string = toDateKey(this.now())): TableMap['check_in'] | undefined {
    const task = this.get('task', taskId);
    if (!task) return undefined;
    const key = periodKeyForTask(task, date);
    let last: TableMap['check_in'] | undefined;
    for (const e of this.list('check_in')) {
      if (e.task_id !== taskId || e.period_key !== key || e.kind !== 'add') continue;
      if (!last || e.at > last.at || (e.at === last.at && e.id > last.id)) last = e;
    }
    return last;
  }

  /**
   * 撤销一条打卡事件（打墓碑，同步到别的设备也撤销）。
   * 只做一次的任务：因为这条才完成的，撤销后不再达标就改回待办。返回撤销后的进度。
   */
  undoCheckIn(eventId: string): Progress | null {
    const e = this.get('check_in', eventId);
    if (!e) return null;
    const task = this.get('task', e.task_id);
    this.remove('check_in', eventId);
    if (!task) return null;
    const all = this.list('check_in').filter((x) => x.task_id === task.id && x.period_key === e.period_key);
    const progress = computeProgress(task, all, this.now());
    if (!task.recurrence && task.status === '完成' && !progress.met) this.reopenTask(task.id);
    return progress;
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

  // ───────────── 日记 ─────────────

  /** 「一天从几点开始」（同步的偏好，默认 5 点）。 */
  journalDayStart(): number {
    return normalizeDayStart(this.pref(JOURNAL_PREFS.dayStart));
  }

  /** 「今天的日记」是哪天（按「一天从几点开始」）。 */
  journalToday(now: Date = this.now()): string {
    return journalToday(now, this.journalDayStart());
  }

  /** 那天的日记（没写过 / 删了是 undefined）。 */
  journalOf(date: string): JournalEntry | undefined {
    return isDateKey(date) ? this.get('journal_entry', journalEntryId(date)) : undefined;
  }

  /**
   * 写那天的日记（正文和 / 或心情）。没有就建（同一天总是同一行，删过的墓碑翻回来）；将来的日子抛 FutureJournalError。
   * 什么都没变不写；新的一天正文空、没心情也不建。base_at：上一版是别的设备写的就记它，自己写的沿用它的 base_at。
   */
  setJournal(date: string, patch: { body_md?: string; mood?: MoodId | string | null }): JournalEntry | undefined {
    if (!isDateKey(date)) throw new Error(tr('没有这一天'));
    if (!canWriteJournal(date, this.journalToday())) throw new FutureJournalError();
    const id = journalEntryId(date);
    const cur = this.tables.journal_entry.get(id);
    const alive = cur && !cur.deleted ? cur : undefined;
    const body = patch.body_md ?? alive?.body_md ?? '';
    const mood = patch.mood !== undefined ? patch.mood : (alive?.mood ?? null);
    if (alive && alive.body_md === body && alive.mood === mood) return alive;
    if (!alive && !body.trim() && !mood) return undefined;
    const base = this.journalBaseOf(id);
    const row: JournalEntry = {
      id,
      updated_at: '',
      deleted: false,
      date,
      body_md: body,
      mood,
      base_at: base ?? null,
      created_at: alive?.created_at ?? this.now().toISOString(),
    };
    this.write([{ table: 'journal_entry', row }]);
    return this.tables.journal_entry.get(id);
  }

  /** 确保那天有一行日记（加附件时用：附件挂在日记 id 上，导出要靠这一行认出日期）。将来的日子抛 FutureJournalError。 */
  ensureJournal(date: string): JournalEntry {
    if (!isDateKey(date)) throw new Error(tr('没有这一天'));
    const cur = this.journalOf(date);
    if (cur) return cur;
    if (!canWriteJournal(date, this.journalToday())) throw new FutureJournalError();
    const id = journalEntryId(date);
    const row: JournalEntry = { id, updated_at: '', deleted: false, date, body_md: '', mood: null, base_at: this.journalBaseOf(id), created_at: this.now().toISOString() };
    this.write([{ table: 'journal_entry', row }]);
    return this.tables.journal_entry.get(id)!;
  }

  /** 改这一行日记时该记的 base_at：上一版是别的设备写的就是它，自己写的沿用它的 base_at，没有就是 null。 */
  journalBaseOf(id: string): string | null {
    const cur = this.tables.journal_entry.get(id);
    if (!cur) return null;
    return parseHlc(cur.updated_at).deviceId === this.deviceId ? (cur.base_at ?? null) : cur.updated_at;
  }

  /** 删掉那天的日记（墓碑），连同挂在上面的附件。 */
  deleteJournal(date: string): void {
    if (!isDateKey(date)) return;
    const id = journalEntryId(date);
    const rows: Array<{ table: TableName; row: BaseRow }> = [];
    const cur = this.tables.journal_entry.get(id);
    if (cur && !cur.deleted) rows.push({ table: 'journal_entry', row: { ...cur, deleted: true } });
    for (const a of this.list('attachment')) if (a.owner_type === 'journal' && a.owner_id === id) rows.push({ table: 'attachment', row: { ...a, deleted: true } });
    if (rows.length) this.write(rows);
  }

  // ───────────── 附件 ─────────────

  /** 挂在这件任务 / 这篇日记上的附件（按添加时间）。日记的 owner_id 是 journalEntryId(date)。 */
  attachmentsOf(ownerType: AttachmentOwnerType, ownerId: string): Attachment[] {
    return sortAttachments(this.list('attachment').filter((a) => a.owner_type === ownerType && a.owner_id === ownerId));
  }

  /** 加一个附件（文件还没传上去时 r2_key / thumb_key 为 null，传好后用 setAttachmentFile 填上）。 */
  addAttachment(input: {
    owner_type: AttachmentOwnerType;
    owner_id: string;
    file_name: string;
    mime: string;
    size: number;
    width?: number | null;
    height?: number | null;
    r2_key?: string | null;
    thumb_key?: string | null;
    id?: string;
  }): Attachment {
    return this.insert('attachment', {
      ...(input.id ? { id: input.id } : {}),
      owner_type: input.owner_type,
      owner_id: input.owner_id,
      file_name: safeFileName(input.file_name),
      mime: input.mime || 'application/octet-stream',
      size: Math.max(0, Math.round(input.size)),
      r2_key: input.r2_key ?? null,
      thumb_key: input.thumb_key ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
      created_at: this.now().toISOString(),
    });
  }

  /** 上传好了：记下 R2 的 key（附件已删就不动）。 */
  setAttachmentFile(id: string, keys: { r2_key: string; thumb_key?: string | null }): Attachment | undefined {
    const cur = this.get('attachment', id);
    if (!cur) return undefined;
    // thumb_key 不传 = 不动；传 null = 去掉缩略图（云端缩略图清掉了、本机又生成不出来，网格退回用原图）
    return this.update('attachment', id, { r2_key: keys.r2_key, thumb_key: keys.thumb_key === undefined ? cur.thumb_key : keys.thumb_key });
  }

  /** 改名（没写扩展名时补回原来的）；空名字不改，返回 undefined。 */
  renameAttachment(id: string, name: string): Attachment | undefined {
    const cur = this.get('attachment', id);
    if (!cur) return undefined;
    const next = renamedFileName(cur.file_name, name);
    if (!next) return undefined;
    if (next === cur.file_name) return cur;
    return this.update('attachment', id, { file_name: next });
  }

  /** 删附件（墓碑；提示里的「撤销」用 restoreAttachment）。 */
  removeAttachment(id: string): void {
    this.remove('attachment', id);
  }

  /** 撤销删除。 */
  restoreAttachment(id: string): Attachment | undefined {
    const cur = this.raw('attachment', id);
    if (!cur) return undefined;
    if (!cur.deleted) return cur;
    this.write([{ table: 'attachment', row: { ...cur, deleted: false } }]);
    return this.get('attachment', id);
  }

  // ───────────── 类型（统一的分类，见 categories.ts） ─────────────

  /** 类型按显示顺序；默认不含「不显示」的。并掉的（墓碑）不在里面。 */
  categories(includeHidden = false): Category[] {
    return sortCategories(this.list('category').filter((c) => !c.merged_into && (includeHidden || !c.hidden)));
  }

  /** 一个类型（顺着合并找到留下的那个；不显示的也返回，挂着的照常显示）。 */
  category(id: string | null | undefined): Category | undefined {
    const rid = resolveCategoryId((x) => this.tables.category.get(x), id);
    return this.get('category', rid);
  }

  /** 任务挂的类型。 */
  categoryOf(task: Pick<Task, 'category_id'> | null | undefined): Category | undefined {
    return this.category(task?.category_id);
  }

  /**
   * 选择器第一屏（方案 C，Rei 2026-10-28）：常用的全放上，不足 n 个时按 pickerCategories 的顺序（最近用过的在前）补齐。
   * 不显示的不在里面。
   */
  frequentCategories(n = 6): Category[] {
    const all = this.pickerCategories();
    const pinned = this.frequentCategoryIds().filter((id) => all.some((c) => c.id === id)).length;
    return all.slice(0, Math.max(n, pinned));
  }

  /** 选择器里全部能选的类型，按顺序：常用的在前，其余按最近用过，没用过的按默认组（category-prefs.ts orderPickerCategories）。 */
  pickerCategories(): Category[] {
    return orderPickerCategories(this.categories(), this.frequentCategoryIds(), this.categoryLastUsed(), this.categoryGroupOverrides());
  }

  /** 每个类型最近一次用到的时间（任务创建、打卡记录里最晚的；顺着合并算到留下的那个）。 */
  categoryLastUsed(): Map<string, string> {
    return categoryLastUsed(
      this.list('task').map((t) => ({ id: t.id, categories: this.categoryIdsOfTask(t), created_at: t.created_at })),
      this.list('check_in'),
    );
  }

  /** 标成「常用」的类型 id（同步偏好 category.frequent，按设成常用的先后）。 */
  frequentCategoryIds(): string[] {
    return frequentCategoryIds(this.pref(CATEGORY_FREQUENT_PREF));
  }

  /** 常用 / 普通 / 不显示。 */
  categoryState(id: string): CategoryState {
    const c = this.category(id);
    return c ? categoryStateOf(c, this.frequentCategoryIds()) : 'normal';
  }

  /** 改档：常用（显示 + 进常用列表）、普通（显示、出常用列表）、不显示（hidden = true、出常用列表）。返回改之前的档（撤销用）。 */
  setCategoryState(id: string, state: CategoryState): CategoryState {
    const prev = this.categoryState(id);
    const c = this.get('category', id);
    if (!c) return prev;
    const hidden = state === 'hidden';
    if (c.hidden !== hidden) this.update('category', id, { hidden });
    const ids = this.frequentCategoryIds();
    const next = withCategoryState(ids, id, state);
    if (next.join() !== ids.join()) this.setPref(CATEGORY_FREQUENT_PREF, next);
    return prev;
  }

  /** 自己改过的大类。 */
  categoryGroupOverrides(): Map<string, CategoryGroup> {
    return categoryGroupOverrides(this.pref(CATEGORY_GROUP_PREF));
  }

  /** 类型在哪个大类（内置的默认见 seed，自定义的默认「其他」）。 */
  categoryGroup(id: string): CategoryGroup {
    return categoryGroupOf(id, this.categoryGroupOverrides());
  }

  /** 换大类（同步偏好 category.groups）。 */
  setCategoryGroup(id: string, group: CategoryGroup): void {
    this.setPref(CATEGORY_GROUP_PREF, withCategoryGroup(this.pref(CATEGORY_GROUP_PREF), id, group));
  }

  /** 类型上移 / 下移一位（含不显示的一起排）；只改 sort，id 不变。 */
  moveCategory(id: string, delta: -1 | 1): void {
    const all = this.categories(true);
    const i = all.findIndex((c) => c.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= all.length) return;
    const order = all.map((c) => c.id);
    [order[i], order[j]] = [order[j]!, order[i]!];
    this.reorderCategories(order);
  }

  /** 按给的顺序重新编号 1..n（拖动排序用）；只写顺序真变了的行。 */
  reorderCategories(order: readonly string[]): void {
    const rows = order
      .map((cid, k) => ({ cur: this.get('category', cid), sort: k + 1 }))
      .filter((x): x is { cur: Category; sort: number } => !!x.cur && x.cur.sort !== x.sort)
      .map(({ cur, sort }) => ({ table: 'category' as const, row: { ...cur, sort } as BaseRow }));
    this.write(rows);
  }

  /** 名字被别的类型占了没有（改名 / 新建前查，同名不让建第二个）。 */
  categoryNameTaken(name: string, exceptId?: string): Category | undefined {
    return categoryNameTaken(this.list('category'), name, exceptId);
  }

  /** 新建类型；同名的已经有了就用那个（不显示的会重新显示）。 */
  createCategory(name: string, icon = DEFAULT_CATEGORY_ICON, color = DEFAULT_CATEGORY_COLOR): Category {
    const n = name.trim();
    const taken = this.categoryNameTaken(n);
    if (taken) return taken.hidden ? this.update('category', taken.id, { hidden: false }) : taken;
    const sort = this.list('category').reduce((m, c) => Math.max(m, c.sort), 0) + 1;
    return this.insert('category', { name: n, icon, color, builtin: false, hidden: false, sort, merged_into: null });
  }

  /** 改名 / 颜色 / 图标 / 不显示。改成别的类型已经用的名字时不改名，返回 false。 */
  updateCategory(id: string, patch: Partial<Pick<Category, 'name' | 'icon' | 'color' | 'hidden'>>): boolean {
    const cur = this.get('category', id);
    if (!cur) return false;
    const next = { ...patch };
    if (next.name !== undefined) {
      next.name = next.name.trim();
      if (!next.name || this.categoryNameTaken(next.name, id)) return false;
    }
    this.update('category', id, next);
    return true;
  }

  /** @deprecated 旧名字，等同 categories()。 */
  checkInCategories(includeHidden = false): Category[] {
    return this.categories(includeHidden);
  }

  /** @deprecated 旧名字，等同 createCategory()。 */
  createCheckInCategory(name: string, icon = DEFAULT_CATEGORY_ICON, color = DEFAULT_CATEGORY_COLOR): Category {
    return this.createCategory(name, icon, color);
  }

  // ───────────── 类型（M4 类型编辑器，纯逻辑见 typedef.ts） ─────────────

  /** 全部类型（含归档的）按顺序（同步的偏好 type_order，没排过的按 sort 接后面）。只给排序 / 写顺序偏好用。 */
  private allOrderedTypes(): TableMap['task_type'][] {
    const order = this.pref(TYPE_ORDER_PREF);
    return orderTypes(this.list('task_type'), Array.isArray(order) ? (order as unknown[]).filter((x): x is string => typeof x === 'string') : null);
  }

  /** 类型按选择器里的顺序，不含归档的（资料库标签条等用）。 */
  orderedTypes(): TableMap['task_type'][] {
    return this.allOrderedTypes().filter((t) => !isArchivedType(t));
  }

  /** 新建 / 改类型 / 组默认类型时能选的类型（不含归档的、人物），按顺序。 */
  pickableTypes(): TableMap['task_type'][] {
    return this.orderedTypes().filter(isPickableType);
  }

  /** 类型编辑器主列表里的类型（不含归档的、普通、人物），按顺序。 */
  editableTypes(): TableMap['task_type'][] {
    return this.orderedTypes().filter(isEditableType);
  }

  /** 归档了的类型（类型编辑器底部「已归档 N 个」，可取消归档），按顺序。不含普通、人物。 */
  archivedTypes(): TableMap['task_type'][] {
    return this.allOrderedTypes().filter((t) => isArchivedType(t) && isEditableType(t));
  }

  /**
   * 组的默认类型里真正生效的那个。归档的类型照样生效（Rei 2026-10-17：「组的类型被归档后不退回」——
   * 归档只是不让后续任务在选择器里选到它）：在组里新建任务仍用它，组页副标题照常显示。
   * 只有类型行不在了（以前版本删掉、没被找回的墓碑）才退回普通。
   */
  effectiveDefaultTypeId(group: Pick<TableMap['group'], 'default_type_id'> | null | undefined): string | null {
    return this.get('task_type', group?.default_type_id ?? null)?.id ?? null;
  }

  /** 用到这个类型的任务、资料各几条（未删除的）。 */
  typeUsage(typeId: string): { tasks: number; items: number } {
    let tasks = 0;
    let items = 0;
    for (const t of this.tables.task.values()) if (!t.deleted && t.type_id === typeId) tasks++;
    for (const i of this.tables.library_item.values()) if (!i.deleted && i.type_id === typeId) items++;
    return { tasks, items };
  }

  /** 新建自定义类型：自带「名字」主字段和「图片」字段（固定，不能删），排在最后。 */
  createType(input: Partial<Pick<TableMap['task_type'], 'name' | 'icon' | 'color' | 'layout' | 'default_completion_mode' | 'body_template'>> = {}): TableMap['task_type'] {
    const sort = this.list('task_type').reduce((m, t) => Math.max(m, t.sort), 0) + 1;
    const t = this.insert('task_type', {
      name: input.name?.trim() || tr('新资料库'),
      icon: input.icon ?? 'star',
      color: input.color ?? '#5e5ce6',
      layout: input.layout ?? 'icon_name',
      fields: [
        { key: 'name', label: tr('名字'), kind: 'text', primary: true },
        { key: 'image', label: tr('图片'), kind: 'image', media: true },
      ],
      body_template: input.body_template ?? '',
      builtin: false,
      hidden: false,
      default_completion_mode: input.default_completion_mode ?? 'once',
      sort,
    });
    const order = this.allOrderedTypes().map((x) => x.id);
    this.setPref(TYPE_ORDER_PREF, order);
    return t;
  }

  /**
   * 改类型的名字、图标、颜色、版式、默认完成方式、正文模板（归档用 archiveType / unarchiveType）。
   * 内置类型改过之后 updated_at 是真实 HLC，以后内置升级不再整体替换它（只补新字段，见 ensureBuiltinTypes）。
   */
  updateType(id: string, patch: Partial<Pick<TableMap['task_type'], 'name' | 'icon' | 'color' | 'layout' | 'default_completion_mode' | 'body_template'>>): TableMap['task_type'] {
    const cur = this.get('task_type', id);
    if (!cur) throw new Error(tr('资料库不存在'));
    // 归档只走 archiveType / unarchiveType；旧调用方传来的 hidden 忽略
    const { hidden: _hidden, ...p } = patch as typeof patch & { hidden?: unknown };
    if (p.name !== undefined && !p.name.trim()) delete p.name;
    else if (p.name !== undefined) p.name = p.name.trim();
    const changed = (Object.keys(p) as Array<keyof typeof p>).some((k) => JSON.stringify(cur[k]) !== JSON.stringify(p[k]));
    return changed ? this.update('task_type', id, p) : cur;
  }

  /** 换一个类型的整张字段表（字段纯函数见 typedef.ts：addField / updateField / removeField / reorderFields）。 */
  setTypeFields(id: string, fields: FieldDef[]): TableMap['task_type'] {
    const cur = this.get('task_type', id);
    if (!cur) throw new Error(tr('资料库不存在'));
    if (JSON.stringify(cur.fields) === JSON.stringify(fields)) return cur;
    return this.update('task_type', id, { fields });
  }

  /** 加字段（同名同种类的删掉的字段会翻回来，旧值又能看到），返回 key。 */
  addTypeField(id: string, input: NewFieldInput): string {
    const cur = this.get('task_type', id);
    if (!cur) throw new Error(tr('资料库不存在'));
    const legacy = LEGACY_BUILTIN_FIELDS[id];
    const r = addField(cur.fields, input, legacy ? { legacy } : {});
    this.setTypeFields(id, r.fields);
    return r.key;
  }

  /** 这个字段在资料或任务里有没有值（有值时不让改种类、改资料 / 任务归属，免得旧值对不上）。 */
  fieldHasData(typeId: string, key: string): boolean {
    const has = (v: FieldValue | undefined) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);
    for (const i of this.tables.library_item.values()) if (!i.deleted && i.type_id === typeId && has(i.fields[key])) return true;
    for (const t of this.tables.task.values()) if (!t.deleted && t.type_id === typeId && has(t.type_data[key])) return true;
    return false;
  }

  /**
   * 单选 / 多选的选项改名：字段定义和所有资料、任务里存的旧选项一起改（值存的是选项文字）。
   */
  renameFieldOption(typeId: string, key: string, from: string, to: string): void {
    const type = this.get('task_type', typeId);
    const def = type?.fields.find((f) => f.key === key);
    const next = to.trim();
    if (!type || !def?.options || !next || from === next || !def.options.includes(from)) return;
    const fields = updateField(type.fields, key, { options: def.options.map((o) => (o === from ? next : o)) });
    const swap = (v: FieldValue | undefined): FieldValue | undefined => {
      if (v === from) return next;
      if (Array.isArray(v) && (v as unknown[]).includes(from)) return cleanOptions((v as string[]).map((x) => (x === from ? next : x)));
      return undefined;
    };
    const rows: Array<{ table: TableName; row: BaseRow }> = [{ table: 'task_type', row: { ...type, fields } as BaseRow }];
    for (const i of this.list('library_item')) {
      const v = i.type_id === typeId ? swap(i.fields[key]) : undefined;
      if (v !== undefined) rows.push({ table: 'library_item', row: { ...i, fields: { ...i.fields, [key]: v } } as BaseRow });
    }
    for (const t of this.list('task')) {
      const v = t.type_id === typeId ? swap(t.type_data[key]) : undefined;
      if (v !== undefined) rows.push({ table: 'task', row: { ...t, type_data: { ...t.type_data, [key]: v } } as BaseRow });
    }
    this.write(rows);
  }

  /** 选择器里的顺序：按给定 id 顺序存进同步偏好 type_order（不改类型行）。 */
  reorderTypes(ids: readonly string[]): void {
    const all = this.allOrderedTypes().map((t) => t.id);
    const picked = ids.filter((id) => all.includes(id));
    const rest = all.filter((id) => !picked.includes(id));
    // 没列到的（普通、人物…）保持原来的相对位置：普通在最前，其余接在后面
    const head = rest.filter((id) => id === PLAIN_TYPE_ID);
    this.setPref(TYPE_ORDER_PREF, [...head, ...picked, ...rest.filter((id) => id !== PLAIN_TYPE_ID)]);
  }

  /** 放进侧边栏的资料库：按资料库顺序，不含归档的、没有资料库的（见 library.ts LIBRARY_SIDEBAR_PREF）。 */
  sidebarLibraries(): TableMap['task_type'][] {
    const ids = sidebarLibraryIds(this.pref(LIBRARY_SIDEBAR_PREF));
    return this.orderedTypes().filter((t) => hasLibrary(t) && ids.includes(t.id));
  }

  /** 这个资料库在不在侧边栏（归档的也照偏好回答，侧边栏里只是不显示）。 */
  isLibraryInSidebar(id: string): boolean {
    return sidebarLibraryIds(this.pref(LIBRARY_SIDEBAR_PREF)).includes(id);
  }

  /** 在侧边栏显示 / 取消在侧边栏显示（同步偏好，LWW）。 */
  setLibraryInSidebar(id: string, on: boolean): void {
    const ids = sidebarLibraryIds(this.pref(LIBRARY_SIDEBAR_PREF));
    if (ids.includes(id) === on) return;
    this.setPref(LIBRARY_SIDEBAR_PREF, withSidebarLibrary(ids, id, on));
  }

  /** 放进侧边栏的项目：顺序跟项目页一样，删掉的不出现（见 library.ts GROUP_SIDEBAR_PREF）。 */
  sidebarGroups(): TableMap['group'][] {
    const ids = sidebarLibraryIds(this.pref(GROUP_SIDEBAR_PREF));
    return this.list('group').filter((g) => ids.includes(g.id));
  }

  /** 这个项目在不在侧边栏。 */
  isGroupInSidebar(id: string): boolean {
    return sidebarLibraryIds(this.pref(GROUP_SIDEBAR_PREF)).includes(id);
  }

  /** 项目「在侧边栏显示 / 取消在侧边栏显示」（同步偏好，LWW）。 */
  setGroupInSidebar(id: string, on: boolean): void {
    const ids = sidebarLibraryIds(this.pref(GROUP_SIDEBAR_PREF));
    if (ids.includes(id) === on) return;
    this.setPref(GROUP_SIDEBAR_PREF, withSidebarLibrary(ids, id, on));
  }

  /** 编辑器列表里上移 / 下移一位。 */
  moveType(id: string, delta: -1 | 1): void {
    const ids = this.editableTypes().map((t) => t.id);
    const i = ids.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    this.reorderTypes(ids);
  }

  /**
   * 归档类型（Rei 2026-10-17：类型创建后只能改和归档，不支持删除；内置、自定义一样）。
   * 归档后不出现在选择器（新建 / 改类型 / 组默认类型）、资料库标签条、类型编辑器主列表；引用它的任务和资料照常显示、能编辑字段值，
   * ⌘K 照常搜得到它的资料，以它为默认类型的组照常用它（Rei 2026-10-17 纠正）。存在 hidden 列（整行 LWW 同步）。
   */
  archiveType(id: string): TableMap['task_type'] | undefined {
    const t = this.get('task_type', id);
    if (!t || !isEditableType(t) || t.hidden) return t;
    return this.update('task_type', id, { hidden: true });
  }

  /** 取消归档：回到原来的顺序位置（顺序偏好里一直留着它）。 */
  unarchiveType(id: string): TableMap['task_type'] | undefined {
    const t = this.get('task_type', id);
    if (!t || !t.hidden) return t;
    return this.update('task_type', id, { hidden: false });
  }

  /**
   * 删掉的类型还有任务或资料在用：把它找回来、归档着，任务和资料照常显示。
   * 现在类型不能删了（Rei 2026-10-17），这里兜的是以前版本留下的类型墓碑，和还没升级的旧客户端同步过来的删除。
   * 每次打开都跑；无事可做是空操作。两台设备各找回一次，内容一样，LWW 后一致。
   */
  private reviveReferencedTypes() {
    const used = new Set<string>();
    for (const t of this.tables.task.values()) if (!t.deleted && t.type_id) used.add(t.type_id);
    for (const i of this.tables.library_item.values()) if (!i.deleted) used.add(i.type_id);
    const rows: Array<{ table: TableName; row: BaseRow }> = [];
    for (const id of used) {
      const t = this.tables.task_type.get(id);
      if (t?.deleted) rows.push({ table: 'task_type', row: { ...t, deleted: false, hidden: true } as BaseRow });
    }
    this.write(rows);
  }

  /** 复制一个类型（内置类型也可复制后修改）。 */
  duplicateType(typeId: string, name?: string): TableMap['task_type'] {
    const src = this.get('task_type', typeId);
    if (!src) throw new Error(tr('资料库不存在'));
    const { id: _id, updated_at: _u, deleted: _d, ...rest } = src;
    return this.insert('task_type', { ...rest, name: name ?? tr('{name} 副本', { name: src.name }), builtin: false, sort: this.list('task_type').length });
  }
}

/** 类型顺序的同步偏好 key。 */
export const TYPE_ORDER_PREF = 'type_order';
