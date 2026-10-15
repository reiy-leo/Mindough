/**
 * 待安排（Rei 2026-10-16：「加一个待安排」）：还没定哪天做、也没放进今天的事。
 *
 * - 内容：没结束（待办 / 进行中）、只做一次（不是定期打卡）、没有日期（scheduled_date 空；倒数日的目标日也算日期）、
 *   今天的「我的一天」里没有的任务。在不在组里都算（界面上带组名）。
 * - 我的一天里昨天没做完的：照旧在我的一天的「昨天没做完」里可以一键带回今天；不带回的，因为它没有日期、今天也不在清单里，自然落进待安排。
 * - 排序：手动顺序（task.sort，拖动改它）在前，一样时按创建时间。
 *
 * 同时改了 M0 的决定 8（Rei 2026-10-16）：新建的任务不再因为「没日期、没组」就自动进我的一天；
 * 只有从「我的一天」页新建的才放进今天，其余默认进待安排。见 shouldJoinMyDay。
 */
import type { DateKey, MyDayEntry, Task } from './types';
import { isFinished } from './types';

export function isBacklogTask(task: Task, inTodayIds: ReadonlySet<string>): boolean {
  if (task.deleted || isFinished(task.status)) return false;
  if (task.recurrence) return false;
  if (task.scheduled_date) return false;
  if (task.completion_mode === 'countdown' && task.target_date) return false;
  return !inTodayIds.has(task.id);
}

export function backlogTasks(tasks: readonly Task[], entries: readonly MyDayEntry[], today: DateKey): Task[] {
  const inToday = new Set(entries.filter((e) => !e.deleted && e.date === today).map((e) => e.task_id));
  return tasks
    .filter((t) => isBacklogTask(t, inToday))
    .sort((a, b) => a.sort - b.sort || (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
}

/** 新建的任务要不要放进今天的我的一天：只看是不是从「我的一天」新建的（定期打卡和定了别的日子的不放）。 */
export function shouldJoinMyDay(opts: { fromMyDay: boolean; recurring: boolean; date: DateKey | null; today: DateKey }): boolean {
  if (!opts.fromMyDay || opts.recurring) return false;
  return !opts.date || opts.date === opts.today;
}
