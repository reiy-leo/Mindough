/**
 * 项目页（单个项目的任务页）的视图和排序（Rei 2026-10-26：「每个项目的视图支持列表、看板、时间轴，排序支持创建时间、修改时间、开始时间、到期时间，正序、倒序」；
 * 同日「关系图完全去掉」「添加另外一个视图：任务链」）。这里只放纯逻辑，界面在 pages/Groups.tsx 和 components/project/*。
 *
 * 字段对应：
 * - 开始时间：scheduled_date（界面上的「日期」，要做的那天；日期段的开始日）。
 * - 到期时间：倒数日用 target_date（目标日）；其他任务用结束日 end_date（Rei 2026-10-26 日期段），单日任务没有结束日就用 scheduled_date。
 * - 创建时间：created_at；修改时间：updated_at（HLC，前 13 位是毫秒时间，可按字符串比较）。
 * 没有这个日期的任务不论正序倒序都排最后。
 */
import { addDays, diffDays, startOfWeek, TASK_STATUSES, type DateKey, type Task, type TaskStatus } from '@mindough/core';

export type ProjectView = 'list' | 'board' | 'timeline' | 'chain';
export const PROJECT_VIEWS: readonly ProjectView[] = ['list', 'board', 'timeline', 'chain'];

/** default = 原来的顺序（任务的 sort 字段，再按创建时间），也是没选过时的默认。 */
export type SortField = 'default' | 'created' | 'updated' | 'start' | 'due';
export const SORT_FIELDS: readonly SortField[] = ['default', 'created', 'updated', 'start', 'due'];
export type SortDir = 'asc' | 'desc';

export type TimelineScale = 'day' | 'week' | 'month';
export const TIMELINE_SCALES: readonly TimelineScale[] = ['day', 'week', 'month'];

export interface ProjectViewPrefs {
  view: ProjectView;
  sort: SortField;
  dir: SortDir;
  scale: TimelineScale;
}

export const DEFAULT_PREFS: ProjectViewPrefs = { view: 'list', sort: 'default', dir: 'asc', scale: 'week' };

/**
 * 本机设置里存的值读出来先过一遍：认不出的回落默认。
 * 以前的「关系图」（graph，Rei 2026-10-26 删掉）和「卡片」（cards）都回落成列表。
 */
export function normalizePrefs(v: unknown): ProjectViewPrefs {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<Record<keyof ProjectViewPrefs, unknown>>;
  return {
    view: PROJECT_VIEWS.includes(o.view as ProjectView) ? (o.view as ProjectView) : DEFAULT_PREFS.view,
    sort: SORT_FIELDS.includes(o.sort as SortField) ? (o.sort as SortField) : DEFAULT_PREFS.sort,
    dir: o.dir === 'desc' ? 'desc' : 'asc',
    scale: TIMELINE_SCALES.includes(o.scale as TimelineScale) ? (o.scale as TimelineScale) : DEFAULT_PREFS.scale,
  };
}

type DatedTask = Pick<Task, 'scheduled_date' | 'target_date' | 'completion_mode'> & { end_date?: DateKey | null };

/** 开始时间：scheduled_date。 */
export function taskStart(t: DatedTask): DateKey | null {
  return t.scheduled_date || null;
}

/** 到期时间：倒数日取目标日，日期段取结束日，其他取 scheduled_date。 */
export function taskDue(t: DatedTask): DateKey | null {
  if (t.completion_mode === 'countdown' && t.target_date) return t.target_date;
  if (t.scheduled_date && t.end_date && t.end_date > t.scheduled_date) return t.end_date;
  return t.scheduled_date || null;
}

type SortableTask = Pick<Task, 'id' | 'sort' | 'created_at' | 'updated_at' | 'scheduled_date' | 'target_date' | 'completion_mode'> & { end_date?: DateKey | null };

function keyOf(t: SortableTask, field: Exclude<SortField, 'default'>): string | null {
  switch (field) {
    case 'created':
      return t.created_at || null;
    case 'updated':
      return t.updated_at || null;
    case 'start':
      return taskStart(t);
    case 'due':
      return taskDue(t);
  }
}

/** 原来的顺序：sort 小的在前，一样时先建的在前（和 store.tasks() 一致）。 */
function defaultCompare(a: SortableTask, b: SortableTask): number {
  return a.sort - b.sort || (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0);
}

/**
 * 按字段排序，不改原数组。没有这个值的排最后（正序倒序都是）；值一样时按原来的顺序，结果稳定。
 * default 只看原来的顺序，dir 不起作用。
 */
export function sortTasks<T extends SortableTask>(tasks: readonly T[], field: SortField, dir: SortDir): T[] {
  const out = [...tasks];
  if (field === 'default') return out.sort(defaultCompare);
  const sign = dir === 'desc' ? -1 : 1;
  return out.sort((a, b) => {
    const ka = keyOf(a, field);
    const kb = keyOf(b, field);
    if (ka && !kb) return -1;
    if (!ka && kb) return 1;
    if (ka && kb && ka !== kb) return (ka < kb ? -1 : 1) * sign;
    return defaultCompare(a, b);
  });
}

/** 看板分列：按任务状态（待办 / 进行中 / 完成 / 关闭），列内保持传入顺序（已按当前排序排好）。 */
export function boardColumns<T extends Pick<Task, 'status'>>(tasks: readonly T[]): { status: TaskStatus; tasks: T[] }[] {
  const cols = TASK_STATUSES.map((status) => ({ status, tasks: [] as T[] }));
  for (const t of tasks) (cols.find((c) => c.status === t.status) ?? cols[0]!).tasks.push(t);
  return cols;
}

/** 每天多宽（px）。 */
export const DAY_WIDTH: Record<TimelineScale, number> = { day: 44, week: 18, month: 5 };

export interface TimelineBar {
  id: string;
  start: DateKey;
  end: DateKey;
  /** 离时间轴左边多少 px。 */
  left: number;
  width: number;
  row: number;
}

export interface TimelineTick {
  date: DateKey;
  left: number;
  /** 这一格是不是新的一个月（画粗一点的线、写月份）。 */
  monthStart: boolean;
}

export interface TimelineLayout {
  from: DateKey;
  to: DateKey;
  days: number;
  dayWidth: number;
  width: number;
  bars: TimelineBar[];
  /** 没有日期的任务，放「未定时间」。 */
  undated: string[];
  ticks: TimelineTick[];
  /** 今天线离左边多少 px（今天那一格的中间）。 */
  todayLeft: number;
}

/** 一件任务在时间轴上从哪天到哪天：开始 → 到期；只有一个就画一天；开始晚于到期时两头对调。 */
export function taskSpan(t: DatedTask): { start: DateKey; end: DateKey } | null {
  const s = taskStart(t);
  const e = taskDue(t);
  if (!s && !e) return null;
  const a = s ?? e!;
  const b = e ?? s!;
  return a <= b ? { start: a, end: b } : { start: b, end: a };
}

function monthStartOf(d: DateKey): DateKey {
  return `${d.slice(0, 8)}01`;
}

function nextMonthStart(d: DateKey): DateKey {
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7));
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

/**
 * 时间轴排布：每件有日期的任务一行（按传入顺序），横条从开始到到期（含两头）。
 * 范围：最早的开始和今天里更早的那个往前一周，最晚的到期和今天里更晚的那个往后两周；
 * 周视图对齐到周首，月视图对齐到月初 / 下月初；至少铺满 minDays 天，窄屏也能横向滚。
 */
export function timelineLayout<T extends Pick<Task, 'id'> & DatedTask>(tasks: readonly T[], today: DateKey, scale: TimelineScale, opts: { weekStartsOn?: 0 | 1; minDays?: number } = {}): TimelineLayout {
  const dated: { id: string; start: DateKey; end: DateKey }[] = [];
  const undated: string[] = [];
  for (const t of tasks) {
    const sp = taskSpan(t);
    if (sp) dated.push({ id: t.id, ...sp });
    else undated.push(t.id);
  }
  let min = today;
  let max = today;
  for (const d of dated) {
    if (d.start < min) min = d.start;
    if (d.end > max) max = d.end;
  }
  let from = addDays(min, -7);
  let to = addDays(max, 14);
  if (scale === 'month') {
    from = monthStartOf(from);
    to = addDays(nextMonthStart(to), -1);
  } else {
    from = startOfWeek(from, opts.weekStartsOn ?? 1);
  }
  const minDays = opts.minDays ?? (scale === 'day' ? 21 : scale === 'week' ? 42 : 120);
  if (diffDays(from, to) + 1 < minDays) to = addDays(from, minDays - 1);
  if (scale === 'month') to = addDays(nextMonthStart(to), -1);
  const days = diffDays(from, to) + 1;
  const dw = DAY_WIDTH[scale];
  const bars: TimelineBar[] = dated.map((d, row) => ({
    id: d.id,
    start: d.start,
    end: d.end,
    left: diffDays(from, d.start) * dw,
    width: (diffDays(d.start, d.end) + 1) * dw,
    row,
  }));
  const ticks: TimelineTick[] = [];
  const weekStart = opts.weekStartsOn ?? 1;
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    const monthStart = date.endsWith('-01');
    const show = scale === 'day' ? true : scale === 'week' ? startOfWeek(date, weekStart) === date : monthStart;
    if (show) ticks.push({ date, left: i * dw, monthStart });
  }
  return { from, to, days, dayWidth: dw, width: days * dw, bars, undated, ticks, todayLeft: diffDays(from, today) * dw + dw / 2 };
}
