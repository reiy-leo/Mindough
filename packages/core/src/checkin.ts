/**
 * 打卡进度：一律由 check_in 事件折叠得出，不存进度字段。
 * 多端合并时两台设备各点一次 +1，就是两条事件，不会丢。
 */
import { diffDays, toDateKey } from './dates';
import { ONCE_PERIOD, isDueOn, parseRecurrence, periodKeyFor, computeStreak, type Streak } from './recurrence';
import type { CheckIn, CompletionMode, DateKey, Task } from './types';

export interface Progress {
  mode: CompletionMode;
  /** 计时：已用毫秒；计量：累计数量；点一下：0/1；倒数日：剩余天数（过期为负）。 */
  value: number;
  target: number | null;
  /** 0..1 达成比例（倒数日：到期为 1，否则 0）。 */
  ratio: number;
  met: boolean;
  /** 计时是否正在走。 */
  running: boolean;
  paused: boolean;
  /** 计时当前段的开始时间（毫秒）。 */
  runningSince: number | null;
}

export type ProgressTask = Pick<Task, 'completion_mode' | 'target_value' | 'target_date' | 'recurrence'>;

function byTime(a: CheckIn, b: CheckIn): number {
  return a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export interface TimerFold {
  elapsed: number;
  running: boolean;
  paused: boolean;
  stopped: boolean;
  runningSince: number | null;
}

/** 计时状态机：start → (pause ↔ resume)* → stop；add 直接补时长（毫秒）。 */
export function foldTimer(events: readonly CheckIn[], nowMs: number): TimerFold {
  let elapsed = 0;
  let since: number | null = null;
  let paused = false;
  let stopped = false;
  for (const e of [...events].filter((x) => !x.deleted).sort(byTime)) {
    const t = Date.parse(e.at);
    switch (e.kind) {
      case 'start':
        if (since === null) {
          since = t;
          paused = false;
          stopped = false;
        }
        break;
      case 'pause':
        if (since !== null) {
          elapsed += Math.max(0, t - since);
          since = null;
          paused = true;
        }
        break;
      case 'resume':
        if (since === null && paused) {
          since = t;
          paused = false;
        }
        break;
      case 'stop':
        if (since !== null) elapsed += Math.max(0, t - since);
        since = null;
        paused = false;
        stopped = true;
        break;
      case 'add':
        elapsed += e.amount;
        break;
    }
  }
  const running = since !== null;
  if (running) elapsed += Math.max(0, nowMs - since!);
  return { elapsed, running, paused, stopped, runningSince: since };
}

export function sumAmounts(events: readonly CheckIn[]): number {
  return events.filter((e) => !e.deleted && e.kind === 'add').reduce((s, e) => s + e.amount, 0);
}

/** 某任务某周期的进度。events 只传该任务该周期的事件。 */
export function computeProgress(task: ProgressTask, events: readonly CheckIn[], now: Date): Progress {
  const base = { mode: task.completion_mode, running: false, paused: false, runningSince: null };
  switch (task.completion_mode) {
    case 'once': {
      const n = sumAmounts(events);
      return { ...base, value: n > 0 ? 1 : 0, target: 1, ratio: n > 0 ? 1 : 0, met: n > 0 };
    }
    case 'count': {
      const n = sumAmounts(events);
      const target = task.target_value && task.target_value > 0 ? task.target_value : 1;
      return { ...base, value: n, target, ratio: Math.min(1, Math.max(0, n / target)), met: n >= target };
    }
    case 'timer': {
      const f = foldTimer(events, now.getTime());
      const target = task.target_value && task.target_value > 0 ? task.target_value : null;
      const ratio = target ? Math.min(1, f.elapsed / target) : f.stopped && f.elapsed > 0 ? 1 : f.elapsed > 0 ? 0.5 : 0;
      const met = target ? f.stopped && f.elapsed >= target : f.stopped && f.elapsed > 0;
      return {
        ...base,
        value: f.elapsed,
        target,
        ratio,
        met,
        running: f.running,
        paused: f.paused,
        runningSince: f.runningSince,
      };
    }
    case 'countdown': {
      const today = toDateKey(now);
      const remaining = task.target_date ? diffDays(today, task.target_date) : 0;
      const manual = events.some((e) => !e.deleted && (e.kind === 'stop' || e.kind === 'add'));
      const met = manual || (task.target_date !== null && remaining <= 0);
      return { ...base, value: remaining, target: null, ratio: met ? 1 : 0, met };
    }
  }
}

/** 按周期键分组事件。 */
export function groupByPeriod(events: readonly CheckIn[]): Map<string, CheckIn[]> {
  const m = new Map<string, CheckIn[]>();
  for (const e of events) {
    if (e.deleted) continue;
    const list = m.get(e.period_key);
    if (list) list.push(e);
    else m.set(e.period_key, [e]);
  }
  return m;
}

/** 任务在 date 所在周期的进度。 */
export function progressOn(task: ProgressTask, allEvents: readonly CheckIn[], date: DateKey, now: Date): Progress {
  const key = periodKeyFor(parseRecurrence(task.recurrence), date);
  return computeProgress(task, allEvents.filter((e) => !e.deleted && e.period_key === key), now);
}

/** 达标的周期集合。 */
export function metPeriods(task: ProgressTask, allEvents: readonly CheckIn[], now: Date): Set<string> {
  const out = new Set<string>();
  for (const [k, evs] of groupByPeriod(allEvents)) if (computeProgress(task, evs, now).met) out.add(k);
  return out;
}

export type StreakTask = ProgressTask & Pick<Task, 'created_at'>;

export function taskStreak(task: StreakTask, events: readonly CheckIn[], now: Date): Streak | null {
  const r = parseRecurrence(task.recurrence);
  if (!r) return null;
  const since = toDateKey(new Date(task.created_at));
  return computeStreak(r, metPeriods(task, events, now), toDateKey(now), since);
}

/** 打卡类任务（重复或非“点一下”）今天是否要打卡。 */
export function isCheckInTask(task: Pick<Task, 'completion_mode' | 'recurrence'>): boolean {
  return task.recurrence !== null || task.completion_mode !== 'once';
}

export function dueToday(task: Pick<Task, 'recurrence' | 'deleted' | 'status' | 'created_at'>, date: DateKey): boolean {
  if (task.deleted || task.status === '取消') return false;
  const r = parseRecurrence(task.recurrence);
  if (!r) return false;
  if (toDateKey(new Date(task.created_at)) > date) return false;
  return isDueOn(r, date);
}

export function periodKeyForTask(task: Pick<Task, 'recurrence'>, date: DateKey): string {
  return periodKeyFor(parseRecurrence(task.recurrence), date);
}

export { ONCE_PERIOD };

/** 毫秒 → “1 小时 05 分” / “12 分 30 秒”。 */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} 小时 ${String(m).padStart(2, '0')} 分`;
  if (m > 0) return `${m} 分 ${String(s).padStart(2, '0')} 秒`;
  return `${s} 秒`;
}
