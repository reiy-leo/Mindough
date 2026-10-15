/**
 * 我的一天：按本机日期的清单。零点后自动换一天；没做完的不顺延，放进“昨天没做完”。
 */
import { addDays } from './dates';
import { dueToday, progressOn } from './checkin';
import type { DerivedStatus } from './dag';
import { isFinished, type CheckIn, type DateKey, type MyDayEntry, type Task } from './types';

export function entriesFor(entries: readonly MyDayEntry[], date: DateKey): MyDayEntry[] {
  const seen = new Set<string>();
  // 同一 task_id + date 只保留一条（同步时按此合并）
  return entries
    .filter((e) => !e.deleted && e.date === date)
    .sort((a, b) => a.sort - b.sort || (a.added_at < b.added_at ? -1 : 1))
    .filter((e) => (seen.has(e.task_id) ? false : (seen.add(e.task_id), true)));
}

/** 任务在 date 那天是否算“做完”：已结束（完成 / 关闭），或打卡任务当天周期达标。 */
export function isDoneOn(task: Task, checkIns: readonly CheckIn[], date: DateKey, now: Date): boolean {
  if (isFinished(task.status)) return true;
  if (task.recurrence) {
    return progressOn(task, checkIns.filter((c) => c.task_id === task.id), date, now).met;
  }
  return false;
}

export interface MyDayItem {
  entry: MyDayEntry;
  task: Task;
  done: boolean;
}

/** 今天的清单：完成的沉到底部，其余按 sort。 */
export function myDayItems(
  entries: readonly MyDayEntry[],
  tasksById: ReadonlyMap<string, Task>,
  checkIns: readonly CheckIn[],
  date: DateKey,
  now: Date,
): MyDayItem[] {
  const items: MyDayItem[] = [];
  for (const entry of entriesFor(entries, date)) {
    const task = tasksById.get(entry.task_id);
    if (!task || task.deleted) continue;
    items.push({ entry, task, done: isDoneOn(task, checkIns, date, now) });
  }
  return [...items.filter((i) => !i.done), ...items.filter((i) => i.done)];
}

/** 昨天加入但没做完、今天也还没加入的任务。 */
export function yesterdayUnfinished(
  entries: readonly MyDayEntry[],
  tasksById: ReadonlyMap<string, Task>,
  checkIns: readonly CheckIn[],
  today: DateKey,
  now: Date,
): Task[] {
  const yesterday = addDays(today, -1);
  const todayIds = new Set(entriesFor(entries, today).map((e) => e.task_id));
  const out: Task[] = [];
  for (const e of entriesFor(entries, yesterday)) {
    if (todayIds.has(e.task_id)) continue;
    const t = tasksById.get(e.task_id);
    if (!t || t.deleted) continue;
    // 重复任务看的是昨天那个周期；普通任务看现在的状态
    if (t.recurrence ? !isDoneOn(t, checkIns, yesterday, now) : !isFinished(t.status)) out.push(t);
  }
  return out;
}

export type SuggestionReason = '今天到期' | '今天要打卡' | '刚解锁' | '倒数日到了';

export interface Suggestion {
  task: Task;
  reason: SuggestionReason;
}

export interface SuggestionInput {
  tasks: readonly Task[];
  entries: readonly MyDayEntry[];
  checkIns: readonly CheckIn[];
  derived: ReadonlyMap<string, DerivedStatus>;
  /** 最近解锁的任务 id（例如过去 24 小时内前置刚完成的）。 */
  recentlyUnlocked: readonly string[];
  today: DateKey;
  now: Date;
}

/** 建议区：今天到期的、今天要打卡的、刚被解锁可开始的；已在今天清单里的不再建议。 */
export function suggestions({ tasks, entries, checkIns, derived, recentlyUnlocked, today, now }: SuggestionInput): Suggestion[] {
  const inToday = new Set(entriesFor(entries, today).map((e) => e.task_id));
  const out: Suggestion[] = [];
  const seen = new Set<string>();
  const push = (task: Task, reason: SuggestionReason) => {
    if (seen.has(task.id) || inToday.has(task.id)) return;
    seen.add(task.id);
    out.push({ task, reason });
  };
  const live = tasks.filter((t) => !t.deleted && !isFinished(t.status));
  for (const t of live) if (t.scheduled_date && t.scheduled_date <= today && !t.recurrence) push(t, '今天到期');
  for (const t of live) if (t.completion_mode === 'countdown' && t.target_date === today) push(t, '倒数日到了');
  for (const t of live)
    if (dueToday(t, today) && !progressOn(t, checkIns.filter((c) => c.task_id === t.id), today, now).met) push(t, '今天要打卡');
  const byId = new Map(live.map((t) => [t.id, t]));
  for (const id of recentlyUnlocked) {
    const t = byId.get(id);
    if (t && derived.get(id)?.state === '可开始') push(t, '刚解锁');
  }
  return out;
}

/**
 * 最近解锁：可开始的任务里，有前置在 since 之后完成的。
 */
export function recentlyUnlocked(
  tasks: readonly Task[],
  edges: readonly { pred_id: string; succ_id: string }[],
  derived: ReadonlyMap<string, DerivedStatus>,
  sinceIso: string,
): string[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const out = new Set<string>();
  for (const e of edges) {
    const pred = byId.get(e.pred_id);
    if (pred?.status === '完成' && pred.done_at && pred.done_at >= sinceIso && derived.get(e.succ_id)?.state === '可开始') out.add(e.succ_id);
  }
  return [...out];
}
