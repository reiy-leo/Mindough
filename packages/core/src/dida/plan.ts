/**
 * 滴答清单导入：planDida 出预览（每个清单几件、完成 / 未完成 / 关闭、已经导入过几件）→ 选项（导哪些状态、清单进哪个组）
 * → applyDida 一批写入（进 outbox）→ 回执可 undoDida 整批撤销。
 *
 * 幂等：任务 id 由滴答清单的 taskId 算出（stableId），再导一次同一个文件，已经在的跳过；撤销或删掉后再导会重新建。
 * 组：清单 → 组，同名（normalizeName）复用，没有就新建（id 也由名字算，两台设备各导一次是同一个组）；
 * 收集箱默认不放进组（进「待安排」）。文件夹 → 新建的组的分类（不建多层文件夹）。
 * 子任务（parentId）→ 前后关系：子任务做完才能开始父任务（父任务详情里「先做完这些」）。
 */
import type { Store } from '../store';
import { tr } from '../i18n';
import { normalizeName } from '../library';
import { stableId } from '../archive/text';
import { LEGACY_CATEGORY_SORT } from '../categories';
import type { BaseRow, Category, Dependency, Group, TableName, Task, TaskStatus } from '../types';
import type { DidaIssue, DidaRow, DidaStatus } from './parse';
import { didaBody, didaInstant, didaLocal, didaRecurrence, didaRemindTime, isValidTimeZone } from './map';

export type DidaTarget = { kind: 'new' } | { kind: 'group'; id: string } | { kind: 'none' };

export interface DidaList {
  /** 清单名（原样；空 = 没写清单）。 */
  name: string;
  folder: string | null;
  total: number;
  open: number;
  done: number;
  closed: number;
  /** 这次导入里已经在库里的（上次导过的）件数。 */
  already: number;
  /** 同名的已有组。 */
  existingGroupId: string | null;
  isInbox: boolean;
  /** 默认去向：收集箱 / 没写清单 → 不放进组；有同名组 → 并入；否则新建。 */
  defaultTarget: DidaTarget;
}

export interface DidaPlan {
  rows: DidaRow[];
  lists: DidaList[];
  counts: { total: number; open: number; done: number; closed: number; notes: number; subtasks: number; already: number };
  issues: DidaIssue[];
}

export interface DidaOptions {
  include: Record<DidaStatus, boolean>;
  /** 清单名 → 去向；没写的用 defaultTarget。 */
  targets?: Readonly<Record<string, DidaTarget>>;
  /** 那一行没写时区（或写错）时用的时区；默认本机。 */
  timeZone?: string;
}

const INBOX = new Set(['inbox', '收集箱', '收件箱']); // i18n-ignore 滴答清单收集箱的名字

export const didaTaskId = (row: Pick<DidaRow, 'taskId' | 'list' | 'title' | 'created' | 'line'>): string =>
  stableId(row.taskId ? `dida-task\u0000${row.taskId}` : `dida-task\u0000${row.list}\u0000${row.title}\u0000${row.created ?? row.line}`);
const groupIdOf = (name: string) => stableId(`dida-group\u0000${normalizeName(name)}`);
const categoryIdOf = (name: string) => stableId(`dida-category\u0000${normalizeName(name)}`);
const depIdOf = (pred: string, succ: string) => stableId(`dida-dep\u0000${pred}\u0000${succ}`);

/** 新建分类的颜色（按名字挑一个，同名同色）。 */
const PALETTE = ['#0a84ff', '#34c759', '#ff9f0a', '#af52de', '#ff375f', '#5ac8fa', '#ffd60a', '#bf5af2', '#64d2ff', '#30d158'];
const colorOf = (name: string) => PALETTE[[...normalizeName(name)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % PALETTE.length]!;

export function planDida(store: Store, rows: readonly DidaRow[], issues: readonly DidaIssue[] = []): DidaPlan {
  const groupsByName = new Map(store.list('group').map((g) => [normalizeName(g.name), g.id]));
  const lists = new Map<string, DidaList>();
  const counts = { total: 0, open: 0, done: 0, closed: 0, notes: 0, subtasks: 0, already: 0 };
  for (const r of rows) {
    let l = lists.get(r.list);
    if (!l) {
      const isInbox = !r.list || INBOX.has(normalizeName(r.list));
      const existing = r.list ? (groupsByName.get(normalizeName(r.list)) ?? null) : null;
      l = { name: r.list, folder: r.folder || null, total: 0, open: 0, done: 0, closed: 0, already: 0, existingGroupId: existing, isInbox, defaultTarget: isInbox ? { kind: 'none' } : existing ? { kind: 'group', id: existing } : { kind: 'new' } };
      lists.set(r.list, l);
    }
    if (!l.folder && r.folder) l.folder = r.folder;
    l.total++;
    l[r.status]++;
    counts.total++;
    counts[r.status]++;
    if (r.kind === 'NOTE') counts.notes++;
    if (r.parentId) counts.subtasks++;
    if (store.get('task', didaTaskId(r))) {
      l.already++;
      counts.already++;
    }
  }
  return { rows: [...rows], lists: [...lists.values()], counts, issues: [...issues] };
}

export const targetOf = (plan: DidaPlan, opts: DidaOptions, list: string): DidaTarget => opts.targets?.[list] ?? plan.lists.find((l) => l.name === list)?.defaultTarget ?? { kind: 'none' };

export interface DidaPreview {
  create: number;
  already: number;
  filtered: number;
  /** 会新建的组名。 */
  newGroups: string[];
}

export function previewDida(store: Store, plan: DidaPlan, opts: DidaOptions): DidaPreview {
  let create = 0;
  let already = 0;
  let filtered = 0;
  const used = new Set<string>();
  for (const r of plan.rows) {
    if (!opts.include[r.status]) filtered++;
    else if (store.get('task', didaTaskId(r))) already++;
    else {
      create++;
      used.add(r.list);
    }
  }
  const newGroups = plan.lists.filter((l) => used.has(l.name) && targetOf(plan, opts, l.name).kind === 'new' && !store.get('group', groupIdOf(l.name))).map((l) => l.name);
  return { create, already, filtered, newGroups };
}

export interface DidaReceipt {
  /** 写之前的样子（null = 原来没有）：撤销时写回去。 */
  before: Array<{ table: TableName; id: string; row: BaseRow | null }>;
  created: number;
  skipped: { already: number; filtered: Record<DidaStatus, number> };
  groups: number;
  /** 写的时候发现的（父任务没导入、会绕成圈…）。 */
  issues: DidaIssue[];
}

const STATUS: Record<DidaStatus, TaskStatus> = { open: '待办', done: '完成', closed: '关闭' };

export function applyDida(store: Store, plan: DidaPlan, opts: DidaOptions): DidaReceipt {
  const now = store.now();
  const fallbackTz = isValidTimeZone(opts.timeZone) ? opts.timeZone : Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const rows = new Map<string, { table: TableName; row: BaseRow }>();
  const before: DidaReceipt['before'] = [];
  const issues: DidaIssue[] = [];
  const put = (table: TableName, row: BaseRow) => {
    const key = `${table}:${row.id}`;
    if (!rows.has(key)) {
      const cur = store.raw(table, row.id);
      before.push({ table, id: row.id, row: cur ? { ...cur } : null });
    }
    rows.set(key, { table, row: { ...row, updated_at: '', deleted: false } });
  };
  const fresh = <T extends object>(r: T) => ({ ...r, updated_at: '', deleted: false }) as unknown as BaseRow;

  const filtered: Record<DidaStatus, number> = { open: 0, done: 0, closed: 0 };
  let already = 0;
  const todo: DidaRow[] = [];
  for (const r of plan.rows) {
    if (!opts.include[r.status]) filtered[r.status]++;
    else if (store.get('task', didaTaskId(r))) already++;
    else todo.push(r);
  }

  // 组与分类
  const groupOfList = new Map<string, string | null>();
  const catsByName = new Map(store.categories(true).map((c) => [normalizeName(c.name), c.id]));
  let groups = 0;
  const categoryFor = (folder: string | null): string | null => {
    if (!folder) return null;
    const hit = catsByName.get(normalizeName(folder));
    if (hit) return hit;
    const id = categoryIdOf(folder);
    put('category', fresh<Omit<Category, 'updated_at' | 'deleted'>>({ id, name: folder, color: colorOf(folder), icon: '', builtin: false, hidden: false, sort: LEGACY_CATEGORY_SORT, merged_into: null }));
    catsByName.set(normalizeName(folder), id);
    return id;
  };
  const groupFor = (list: string): string | null => {
    if (groupOfList.has(list)) return groupOfList.get(list)!;
    const t = targetOf(plan, opts, list);
    let id: string | null = null;
    if (t.kind === 'group' && store.get('group', t.id)) id = t.id;
    else if (t.kind === 'new' || t.kind === 'group') {
      id = groupIdOf(list || tr('滴答清单'));
      if (!store.get('group', id)) {
        const info = plan.lists.find((l) => l.name === list);
        put('group', fresh<Omit<Group, 'updated_at' | 'deleted'>>({ id, name: list || tr('滴答清单'), icon: '📁', start_at: null, end_at: null, category_id: categoryFor(info?.folder ?? null), default_type_id: null }));
        groups++;
      }
    }
    groupOfList.set(list, id);
    return id;
  };

  // 任务：按清单出现的顺序，清单里按滴答清单的 Order
  const listRank = new Map(plan.lists.map((l, i) => [l.name, i]));
  const ordered = [...todo].sort((a, b) => listRank.get(a.list)! - listRank.get(b.list)! || (a.order ?? 0) - (b.order ?? 0) || a.line - b.line);
  let sort = store.list('task').reduce((m, t) => Math.max(m, t.sort), 0);
  const imported = new Map<string, string>(); // 滴答清单 taskId → 我们的 id
  for (const r of ordered) {
    const tz = isValidTimeZone(r.timezone) ? r.timezone : fallbackTz;
    const start = didaLocal(r.start, tz);
    const due = didaLocal(r.due, tz);
    const when = start ?? due;
    const recurrence = r.status === 'open' ? didaRecurrence(r.repeat, when?.date ?? null) : null;
    const repeatNote = r.repeat && !recurrence ? r.repeat.replace(/^RRULE\s*:\s*/i, '') : null;
    const id = didaTaskId(r);
    const created = didaInstant(r.created) ?? now.toISOString();
    const finished = r.status !== 'open';
    const row = fresh<Omit<Task, 'updated_at' | 'deleted'>>({
      id,
      body_md: didaBody(r, { due: start && due && due.date !== start.date ? due.date : null, repeatNote }),
      status: STATUS[r.status],
      group_id: groupFor(r.list),
      scheduled_date: recurrence ? null : (when?.date ?? null),
      // 滴答清单的截止日先照旧写进正文，不变成日期段（全天任务的截止是不是「不含当天」没核对过）
      end_date: null,
      type_id: null,
      type_data: {},
      completion_mode: 'once',
      target_value: null,
      unit: null,
      target_date: null,
      recurrence,
      category_id: null,
      checkin_category_id: null,
      library_item_id: null,
      remind_time: didaRemindTime(r.reminder, when, r.allDay || !when?.minutes),
      time_zone: null,
      count_config: {},
      done_at: finished ? (didaInstant(r.completed) ?? created) : null,
      sort: ++sort,
      created_at: created,
    });
    put('task', row);
    if (r.taskId) imported.set(r.taskId, id);
  }

  // 子任务 → 前后关系（子任务 → 父任务），过环检测
  let edges = store.edges().map((e) => ({ ...e }));
  for (const r of ordered) {
    if (!r.parentId) continue;
    const child = imported.get(r.taskId ?? '') ?? didaTaskId(r);
    const parentRow = plan.rows.find((x) => x.taskId === r.parentId);
    const parent = imported.get(r.parentId) ?? (parentRow ? didaTaskId(parentRow) : stableId(`dida-task\u0000${r.parentId}`));
    if (!rows.has(`task:${parent}`) && !store.get('task', parent)) {
      issues.push({ line: r.line, title: r.title, message: tr('父任务没导入，没连上'), level: 'warning' });
      continue;
    }
    if (edges.some((e) => e.pred_id === child && e.succ_id === parent)) continue;
    if (reaches(edges, parent, child)) {
      issues.push({ line: r.line, title: r.title, message: tr('有一条前后关系会绕成圈，没连上'), level: 'warning' });
      continue;
    }
    edges.push({ pred_id: child, succ_id: parent });
    put('dependency', fresh<Omit<Dependency, 'updated_at' | 'deleted'>>({ id: depIdOf(child, parent), pred_id: child, succ_id: parent, type: 'FS', lag: 0 }));
  }

  store.batch(() => {
    store.write([...rows.values()]);
    store.settleCategories();
  });
  return { before, created: ordered.length, skipped: { already, filtered }, groups, issues };
}

function reaches(edges: ReadonlyArray<{ pred_id: string; succ_id: string }>, from: string, to: string): boolean {
  if (from === to) return true;
  const next = new Map<string, string[]>();
  for (const e of edges) next.set(e.pred_id, [...(next.get(e.pred_id) ?? []), e.succ_id]);
  const seen = new Set([from]);
  const stack = [from];
  while (stack.length) {
    for (const n of next.get(stack.pop()!) ?? []) {
      if (n === to) return true;
      if (!seen.has(n)) {
        seen.add(n);
        stack.push(n);
      }
    }
  }
  return false;
}

/** 整批撤销：写过的每一行回到导入前（原来没有的打墓碑）。一批写入、进 outbox。 */
export function undoDida(store: Store, receipt: DidaReceipt): number {
  const out: Array<{ table: TableName; row: BaseRow }> = [];
  for (const b of receipt.before) {
    const cur = store.raw(b.table, b.id);
    if (b.row) out.push({ table: b.table, row: { ...b.row } });
    else if (cur && !cur.deleted) out.push({ table: b.table, row: { ...cur, deleted: true } });
  }
  store.batch(() => store.write(out));
  return out.length;
}
