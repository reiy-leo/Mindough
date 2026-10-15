/**
 * 重复规则：RRULE 的一个子集，入库为字符串（task.recurrence）。
 *   每天        FREQ=DAILY
 *   每 N 天     FREQ=DAILY;INTERVAL=N;DTSTART=YYYYMMDD
 *   每周几      FREQ=WEEKLY;BYDAY=MO,WE,FR
 *   每月几号    FREQ=MONTHLY;BYMONTHDAY=15   （小月自动取月末）
 * 周期：每次“应打卡日”开启一个周期，持续到下一次应打卡日前一天；周期键 = 该应打卡日的日期键。
 */
import { addDays, daysInMonth, diffDays, parseDateKey, weekday } from './dates';
import type { DateKey } from './types';

export type Recurrence =
  | { kind: 'daily' }
  | { kind: 'every'; days: number; anchor: DateKey }
  | { kind: 'weekly'; weekdays: number[] }
  | { kind: 'monthly'; day: number };

export const ONCE_PERIOD = 'once';

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

const compact = (k: DateKey) => k.replace(/-/g, '');
const expand = (s: string): DateKey => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;

export function formatRecurrence(r: Recurrence): string {
  switch (r.kind) {
    case 'daily':
      return 'FREQ=DAILY';
    case 'every':
      return `FREQ=DAILY;INTERVAL=${r.days};DTSTART=${compact(r.anchor)}`;
    case 'weekly':
      return `FREQ=WEEKLY;BYDAY=${[...r.weekdays].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => BYDAY[d]).join(',')}`;
    case 'monthly':
      return `FREQ=MONTHLY;BYMONTHDAY=${r.day}`;
  }
}

export function parseRecurrence(rule: string | null | undefined): Recurrence | null {
  if (!rule) return null;
  const parts = new Map<string, string>();
  for (const seg of rule.replace(/^RRULE:/i, '').split(';')) {
    const [k, v] = seg.split('=');
    if (k && v) parts.set(k.toUpperCase(), v.toUpperCase());
  }
  const freq = parts.get('FREQ');
  if (freq === 'DAILY') {
    const interval = Number(parts.get('INTERVAL') ?? '1');
    const start = parts.get('DTSTART');
    if (interval > 1) {
      if (!start || !/^\d{8}/.test(start)) return null;
      return { kind: 'every', days: interval, anchor: expand(start) };
    }
    return { kind: 'daily' };
  }
  if (freq === 'WEEKLY') {
    const days = (parts.get('BYDAY') ?? '')
      .split(',')
      .map((d) => BYDAY.indexOf(d as (typeof BYDAY)[number]))
      .filter((d) => d >= 0);
    return days.length ? { kind: 'weekly', weekdays: [...new Set(days)] } : null;
  }
  if (freq === 'MONTHLY') {
    const day = Number(parts.get('BYMONTHDAY'));
    return day >= 1 && day <= 31 ? { kind: 'monthly', day } : null;
  }
  return null;
}

export function describeRecurrence(r: Recurrence | null): string {
  if (!r) return '不重复';
  switch (r.kind) {
    case 'daily':
      return '每天';
    case 'every':
      return `每 ${r.days} 天`;
    case 'weekly': {
      const names = ['日', '一', '二', '三', '四', '五', '六'];
      const sorted = [...r.weekdays].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
      if (sorted.length === 7) return '每天';
      if (sorted.join() === '1,2,3,4,5') return '工作日';
      return `每周${sorted.map((d) => names[d]).join('、')}`;
    }
    case 'monthly':
      return `每月 ${r.day} 号`;
  }
}

/** date 是否是应打卡日。 */
export function isDueOn(r: Recurrence, date: DateKey): boolean {
  switch (r.kind) {
    case 'daily':
      return true;
    case 'every': {
      const n = diffDays(r.anchor, date);
      return n >= 0 && n % r.days === 0;
    }
    case 'weekly':
      return r.weekdays.includes(weekday(date));
    case 'monthly': {
      const { y, m, d } = parseDateKey(date);
      return d === Math.min(r.day, daysInMonth(y, m));
    }
  }
}

/** 不晚于 date 的最近一次应打卡日；在规则起点之前返回 null。 */
export function periodStart(r: Recurrence, date: DateKey): DateKey | null {
  if (r.kind === 'every') {
    const n = diffDays(r.anchor, date);
    if (n < 0) return null;
    return addDays(r.anchor, n - (n % r.days));
  }
  for (let i = 0; i < 32; i++) {
    const k = addDays(date, -i);
    if (isDueOn(r, k)) return k;
  }
  return null;
}

/** 周期键：重复任务为周期起始日，不重复任务恒为 "once"。 */
export function periodKeyFor(r: Recurrence | null, date: DateKey): string {
  if (!r) return ONCE_PERIOD;
  return periodStart(r, date) ?? date;
}

/** [from, to] 内所有应打卡日。 */
export function occurrences(r: Recurrence, from: DateKey, to: DateKey): DateKey[] {
  const out: DateKey[] = [];
  for (let k = from; k <= to; k = addDays(k, 1)) if (isDueOn(r, k)) out.push(k);
  return out;
}

export interface Streak {
  /** 当前连续达标的周期数（当前周期未完成不算断）。 */
  current: number;
  /** 历史最长。 */
  best: number;
  /** 当前周期是否已达标。 */
  todayMet: boolean;
}

/**
 * 连续天数：从 since（通常是任务创建日）到 today 的所有周期里，按时间倒序数连续达标的周期。
 * 当前周期还没过完，没达标不算断。
 */
export function computeStreak(r: Recurrence, met: ReadonlySet<string>, today: DateKey, since: DateKey): Streak {
  const occ = occurrences(r, since, today);
  // since 落在某周期中间时，那个周期只在已达标时计入（没法要求用户补上创建前的日子）
  const first = periodStart(r, since);
  if (first && first < since && met.has(first)) occ.unshift(first);
  const current = periodStart(r, today);
  const todayMet = current ? met.has(current) : false;
  let cur = 0;
  let counting = true;
  let best = 0;
  let run = 0;
  for (let i = occ.length - 1; i >= 0; i--) {
    const k = occ[i]!;
    const ok = met.has(k);
    if (counting) {
      if (ok) cur++;
      else if (k !== current) counting = false;
    }
  }
  for (const k of occ) {
    if (met.has(k)) {
      run++;
      best = Math.max(best, run);
    } else if (k !== current) run = 0;
  }
  return { current: cur, best, todayMet };
}
