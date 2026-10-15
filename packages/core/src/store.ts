/**
 * Store：内存快照 + 领域操作。读是同步的（UI 直接读），写先改内存、通知订阅者，
 * 再异步落到 StorageAdapter（并进 outbox）。UI 永不等待存储或网络。
 */
import { HlcClock } from './hlc';
import { uuidv7 } from './uuid';
import { toDateKey } from './dates';
import { assertCanAddEdge, deriveAll, liveEdges, unlockedSuccessors, type DerivedStatus, type Edge } from './dag';
import { computeProgress, periodKeyForTask, type Progress } from './checkin';
import { BUILTIN_TASK_TYPES, PLAIN_TYPE_ID } from './seed/builtin-types';
import { TABLES, isFinished, normalizeStatus, type BaseRow, type CheckInKind, type NewRow, type TableMap, type TableName, type Task, type TaskStatus } from './types';
import type { Change, StorageAdapter } from './storage/adapter';

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

export type NewTaskInput = Partial<Omit<Task, 'id' | 'updated_at' | 'deleted'>> & { id?: string };

export class Store {
  private tables: Tables;
  private listeners = new Set<() => void>();
  private pending: Promise<void> = Promise.resolve();
  private _version = 0;
  private batchBuffer: Change[] | null = null;
  private derivedCache: { version: number; value: Map<string, DerivedStatus> } | null = null;
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
        map.set(row.id, row);
        // 本地时钟不落后于已存数据
        if (row.updated_at && /^\d{13}-/.test(row.updated_at)) store.clock.receive(row.updated_at);
      }
    }
    store.ensureBuiltinTypes();
    store.migrateLegacyStatuses();
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

  get<K extends TableName>(table: K, id: string | null | undefined): TableMap[K] | undefined {
    if (!id) return undefined;
    const r = this.tables[table].get(id);
    return r && !r.deleted ? r : undefined;
  }

  tasks(): Task[] {
    return this.list('task').sort((a, b) => a.sort - b.sort || (a.created_at < b.created_at ? -1 : 1));
  }

  edges(): Edge[] {
    return liveEdges(this.list('dependency'));
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
    this.pending = this.pending
      .then(() => this.adapter.applyChanges(stamped))
      .catch((err) => this.opts.onError?.(err));
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
    if (!cur) throw new Error(`找不到记录：${table}/${id}`);
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

  private ensureBuiltinTypes() {
    const missing = BUILTIN_TASK_TYPES.filter((t) => !this.tables.task_type.has(t.id));
    if (!missing.length) return;
    for (const t of missing) this.tables.task_type.set(t.id, t);
    this._version++;
    this.pending = this.pending.then(() => this.adapter.applyChanges(missing.map((row) => ({ table: 'task_type', row }))));
  }

  // ───────────── 任务 ─────────────

  createTask(input: NewTaskInput = {}): Task {
    const now = this.now();
    const type = this.get('task_type', input.type_id ?? null);
    const group = this.get('group', input.group_id ?? null);
    const typeId = input.type_id !== undefined ? input.type_id : (group?.default_type_id ?? null);
    const resolvedType = type ?? this.get('task_type', typeId);
    const maxSort = this.list('task').reduce((m, t) => Math.max(m, t.sort), 0);
    return this.insert('task', {
      body_md: input.body_md ?? resolvedType?.body_template ?? '',
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
      done_at: input.done_at ?? null,
      sort: input.sort ?? maxSort + 1,
      created_at: input.created_at ?? now.toISOString(),
      ...(input.id ? { id: input.id } : {}),
    });
  }

  updateTask(id: string, patch: Partial<Omit<Task, 'id' | 'updated_at'>>): Task {
    return this.update('task', id, patch);
  }

  /** 删除任务：任务与它的依赖边、我的一天条目、人物关联一起打墓碑。 */
  deleteTask(id: string): void {
    const rows: Array<{ table: TableName; row: BaseRow }> = [];
    const t = this.tables.task.get(id);
    if (!t || t.deleted) return;
    rows.push({ table: 'task', row: { ...t, deleted: true } });
    for (const d of this.list('dependency'))
      if (d.pred_id === id || d.succ_id === id) rows.push({ table: 'dependency', row: { ...d, deleted: true } });
    for (const m of this.list('my_day')) if (m.task_id === id) rows.push({ table: 'my_day', row: { ...m, deleted: true } });
    for (const p of this.list('task_person')) if (p.task_id === id) rows.push({ table: 'task_person', row: { ...p, deleted: true } });
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

  // ───────────── 打卡 ─────────────

  /**
   * 记一条打卡事件。周期键按任务的重复规则从 date 算出。
   * 非重复任务达标后自动标“完成”（并解锁后续）；重复任务只记录周期进度。
   */
  checkIn(taskId: string, kind: CheckInKind, amount = 0, date: string = toDateKey(this.now())): CheckInResult {
    const task = this.get('task', taskId);
    if (!task) throw new Error('任务不存在');
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
    if (this.list('task_person').some((x) => x.task_id === taskId && x.person_id === personId)) return;
    this.insert('task_person', { task_id: taskId, person_id: personId });
  }

  unlinkPerson(taskId: string, personId: string): void {
    for (const x of this.list('task_person')) if (x.task_id === taskId && x.person_id === personId) this.remove('task_person', x.id);
  }

  peopleOf(taskId: string): TableMap['person'][] {
    const ids = new Set(this.list('task_person').filter((x) => x.task_id === taskId).map((x) => x.person_id));
    // “人物”类型的人物字段也算关联
    const task = this.get('task', taskId);
    const type = this.get('task_type', task?.type_id);
    for (const f of type?.fields ?? []) {
      const v = task?.type_data[f.key];
      if (f.kind === 'person' && typeof v === 'string') ids.add(v);
    }
    return [...ids].map((id) => this.get('person', id)).filter((p): p is TableMap['person'] => !!p);
  }

  tasksOfPerson(personId: string): Task[] {
    return this.tasks().filter((t) => this.peopleOf(t.id).some((p) => p.id === personId));
  }

  // ───────────── 类型 ─────────────

  /** 复制一个类型（内置类型也可复制后修改）。 */
  duplicateType(typeId: string, name?: string): TableMap['task_type'] {
    const src = this.get('task_type', typeId);
    if (!src) throw new Error('类型不存在');
    const { id: _id, updated_at: _u, deleted: _d, ...rest } = src;
    return this.insert('task_type', { ...rest, name: name ?? `${src.name} 副本`, builtin: false, sort: this.list('task_type').length });
  }
}
