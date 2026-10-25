/**
 * 提醒：算出接下来要响的提醒（纯函数，不碰定时器 / 通知 API；排程与发通知在客户端 lib/reminders.ts）。
 *
 * 四种：
 *   due        只做一次、有日期的任务：那天 remind_time 提醒「今天要做」
 *   countdown  倒数日：目标日那天 remind_time 提醒「就是今天」
 *   checkin    定期打卡：每个要打卡的日子 remind_time 提醒（这个周期已经达标就不提醒）
 *   timer      正在计时、有目标时长：到点提醒（不用设 remind_time，总会提醒）
 *   journal    每天写日记（Rei 2026-10-17：晚上 9 点，不论是不是已经写了）：不属于任务，taskId 是空串，见 journalReminders
 * 已完成 / 已关闭 / 删除的任务不提醒。remind_time 是任务时区（task.time_zone，空 = 本机或传入的 timeZone）的墙上时间「HH:MM」，
 * 响的时刻换算成绝对时间（Rei 2026-10-25 任务时区）；
 * 夏令时跳过的时刻（如纽约 3 月 02:30）顺延到跳过后的同一刻，重复的时刻取第一次。
 *
 * id 稳定：同一次提醒（任务 + 种类 + 那天 / 那段计时）每次算出来的 id 一样，客户端用它去重、记「已响过」、稍后再提醒。
 */
import { addDays, toDateKey } from './dates';
import { foldTimer, formatDuration, periodKeyForTask, progressOn } from './checkin';
import { isDueOn, parseRecurrence } from './recurrence';
import { isFinished, type CheckIn, type DateKey, type Task } from './types';
import { tr } from './i18n';
import { normalizeTimeZone } from './timezone';

export type ReminderKind = 'due' | 'countdown' | 'checkin' | 'timer' | 'journal';

export interface Reminder {
  id: string;
  taskId: string;
  kind: ReminderKind;
  /** 什么时候响（毫秒时间戳）。稍后再提醒过的是稍后的时间。 */
  at: number;
  /** 那天（due / countdown / checkin）；计时是开始那天。 */
  date: DateKey;
  /** 稍后再提醒过。 */
  snoozed: boolean;
}

export interface ReminderOptions {
  /** 从什么时候开始算（通常是现在）。 */
  now: Date;
  /** 往后看多久（毫秒），默认 48 小时。 */
  horizonMs?: number;
  /** 错过多久以内还补响（app 刚打开时），默认 15 分钟。 */
  graceMs?: number;
  /** IANA 时区；不传用本机时区。 */
  timeZone?: string;
  /** 已经响过的 id（不再算进来，除非稍后再提醒）。 */
  fired?: ReadonlySet<string>;
  /** 稍后再提醒：id → 新的时间（毫秒）。 */
  snoozed?: ReadonlyMap<string, number>;
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** 「9:5」「09:05」「0905」→「09:05」；不像时间返回 null。 */
export function normalizeRemindTime(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = /^\s*(\d{1,2})\s*[:：.]?\s*(\d{2})\s*$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** 某时区某时刻的墙上时间各部分。 */
function wallParts(ms: number, timeZone: string) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p: Record<string, number> = {};
  for (const x of f.formatToParts(new Date(ms))) if (x.type !== 'literal') p[x.type] = Number(x.value);
  return p as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** 时区相对 UTC 的偏移（毫秒），在时刻 ms。 */
function offsetAt(ms: number, timeZone: string): number {
  const p = wallParts(ms, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

/** 那天那个墙上时间是哪一刻。跳过的时刻顺延，重复的取第一次。 */
export function wallTimeToEpoch(date: DateKey, hhmm: string, timeZone?: string): number {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const [h, mi] = hhmm.split(':').map(Number) as [number, number];
  if (!timeZone) {
    // 本机时区：Date 构造函数自己处理夏令时（跳过的时刻顺延）
    return new Date(y, mo - 1, d, h, mi).getTime();
  }
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  // 两个候选偏移：这刻前后 1 天的偏移（夏令时切换最多差几小时）
  const o1 = offsetAt(guess - 86_400_000, timeZone);
  const o2 = offsetAt(guess + 86_400_000, timeZone);
  const cands = [...new Set([o1, o2])].map((o) => guess - o).filter((t) => {
    const p = wallParts(t, timeZone);
    return p.hour === h && p.minute === mi && p.day === d;
  });
  if (cands.length) return Math.min(...cands);
  // 跳过的时刻：按切换前的偏移算，正好落到切换后的同一刻（纽约 02:30 → 03:30 EDT）
  return guess - o1;
}

/** 那个时区的日期键。 */
export function dateKeyIn(ms: number, timeZone?: string): DateKey {
  if (!timeZone) return toDateKey(new Date(ms));
  const p = wallParts(ms, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

const reminderId = (taskId: string, kind: ReminderKind, key: string) => `${taskId}:${kind}:${key}`;

/**
 * 接下来要响的提醒，按时间排好。范围：[now - grace, now + horizon]。
 * 已经响过（fired）的不算，除非稍后再提醒（snoozed，按新时间算）。
 */
export function upcomingReminders(tasks: readonly Task[], checkIns: readonly CheckIn[], opts: ReminderOptions): Reminder[] {
  const nowMs = opts.now.getTime();
  const from = nowMs - (opts.graceMs ?? 15 * 60_000);
  const to = nowMs + (opts.horizonMs ?? 48 * 3_600_000);
  const fired = opts.fired ?? new Set<string>();
  const snoozed = opts.snoozed ?? new Map<string, number>();
  const out: Reminder[] = [];
  const byTask = new Map<string, CheckIn[]>();
  for (const c of checkIns) if (!c.deleted) (byTask.get(c.task_id) ?? byTask.set(c.task_id, []).get(c.task_id)!).push(c);

  const push = (r: Omit<Reminder, 'snoozed'>) => {
    const s = snoozed.get(r.id);
    if (s !== undefined) {
      if (s >= from && s <= to) out.push({ ...r, at: s, snoozed: true });
      return;
    }
    if (fired.has(r.id)) return;
    if (r.at >= from && r.at <= to) out.push({ ...r, snoozed: false });
  };

  for (const t of tasks) {
    if (t.deleted || isFinished(t.status)) continue;
    // 任务自己的时区（空 = 本机 / 传入的 timeZone）：那天、那个钟点都按它算
    const tz = normalizeTimeZone(t.time_zone) ?? opts.timeZone;
    const firstDay = dateKeyIn(from, tz);
    const lastDay = dateKeyIn(to, tz);
    const events = byTask.get(t.id) ?? [];
    const time = normalizeRemindTime(t.remind_time);
    const rec = parseRecurrence(t.recurrence);

    // 计时到点：正在走、有目标、还没到
    if (t.completion_mode === 'timer' && t.target_value && t.target_value > 0) {
      const today = dateKeyIn(nowMs, tz);
      const periodEvents = rec ? events.filter((e) => e.period_key === periodKeyForTask(t, today)) : events;
      const f = foldTimer(periodEvents, nowMs);
      if (f.running && f.runningSince !== null) {
        const at = nowMs + (t.target_value - f.elapsed);
        // 同一段计时（同一个开始时刻）id 不变；暂停再继续是新的一段，重新算
        push({ id: reminderId(t.id, 'timer', String(f.runningSince)), taskId: t.id, kind: 'timer', at, date: dateKeyIn(f.runningSince, tz) });
      }
    }

    if (!time) continue;

    if (rec) {
      const created = dateKeyIn(Date.parse(t.created_at), tz);
      for (let day = firstDay; day <= lastDay; day = addDays(day, 1)) {
        if (day < created || !isDueOn(rec, day)) continue;
        // 这个周期已经达标（今天已经打过卡）就不提醒
        if (progressOn(t, events, day, opts.now).met) continue;
        push({ id: reminderId(t.id, 'checkin', day), taskId: t.id, kind: 'checkin', at: wallTimeToEpoch(day, time, tz), date: day });
      }
      continue;
    }

    const day = t.completion_mode === 'countdown' ? t.target_date : t.scheduled_date;
    if (!day || day < firstDay || day > lastDay) continue;
    const kind: ReminderKind = t.completion_mode === 'countdown' ? 'countdown' : 'due';
    push({ id: reminderId(t.id, kind, day), taskId: t.id, kind, at: wallTimeToEpoch(day, time, tz), date: day });
  }
  return out.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
}

/**
 * 日记提醒：每天 time（「HH:MM」）响一次，写没写都响（Rei 2026-10-17）。范围、已响过、稍后再提醒同 upcomingReminders。
 * id = journal:journal:{那天}，taskId 为空串。
 */
export function journalReminders(time: string | null | undefined, opts: ReminderOptions): Reminder[] {
  const hhmm = normalizeRemindTime(time);
  if (!hhmm) return [];
  const nowMs = opts.now.getTime();
  const from = nowMs - (opts.graceMs ?? 15 * 60_000);
  const to = nowMs + (opts.horizonMs ?? 48 * 3_600_000);
  const tz = opts.timeZone;
  const fired = opts.fired ?? new Set<string>();
  const snoozed = opts.snoozed ?? new Map<string, number>();
  const out: Reminder[] = [];
  for (let day = dateKeyIn(from, tz); day <= dateKeyIn(to, tz); day = addDays(day, 1)) {
    const id = reminderId('journal', 'journal', day);
    const s = snoozed.get(id);
    if (s !== undefined) {
      if (s >= from && s <= to) out.push({ id, taskId: '', kind: 'journal', at: s, date: day, snoozed: true });
      continue;
    }
    if (fired.has(id)) continue;
    const at = wallTimeToEpoch(day, hhmm, tz);
    if (at >= from && at <= to) out.push({ id, taskId: '', kind: 'journal', at, date: day, snoozed: false });
  }
  return out;
}

/** 已到点（at ≤ now）的提醒。 */
export function dueReminders(list: readonly Reminder[], now: Date): Reminder[] {
  return list.filter((r) => r.at <= now.getTime());
}

/** 通知正文（标题用任务标题，客户端自己取）。 */
export function reminderBody(r: Pick<Reminder, 'kind'>, task: Pick<Task, 'target_value'>): string {
  switch (r.kind) {
    case 'due':
      return tr('今天要做');
    case 'countdown':
      return tr('就是今天');
    case 'checkin':
      return tr('该打卡了');
    case 'timer':
      return tr('计时到了：{duration}', { duration: formatDuration(task.target_value ?? 0) });
    case 'journal':
      return tr('今天过得怎么样？写几句吧');
  }
}

/** 稍后再提醒：默认 10 分钟。 */
export const SNOOZE_MS = 10 * 60_000;

/** 只留最近的「已响过」：太旧的（两天前）清掉，免得越存越多。 */
export function pruneFired(fired: ReadonlyMap<string, number>, now: Date, keepMs = 3 * 86_400_000): Map<string, number> {
  const out = new Map<string, number>();
  for (const [k, at] of fired) if (now.getTime() - at < keepMs) out.set(k, at);
  return out;
}

/** 这件任务能不能设提醒时间（只做一次的要有日期；倒数日要有目标日；定期打卡都行）。 */
export function canRemind(t: Pick<Task, 'recurrence' | 'completion_mode' | 'scheduled_date' | 'target_date'>): boolean {
  if (t.recurrence) return true;
  if (t.completion_mode === 'countdown') return !!t.target_date;
  return !!t.scheduled_date;
}

export { HHMM as REMIND_TIME_PATTERN };
