/**
 * 重复规则：RRULE 的一个子集，入库为字符串（task.recurrence）。
 *   每天        FREQ=DAILY
 *   每 N 天     FREQ=DAILY;INTERVAL=N;DTSTART=YYYYMMDD
 *   每周几      FREQ=WEEKLY;BYDAY=MO,WE,FR
 *   每月几号    FREQ=MONTHLY;BYMONTHDAY=15   （小月自动取月末）
 *   每年农历    FREQ=YEARLY;RSCALE=CHINESE;BYMONTH=8;BYMONTHDAY=15   （RFC 7529；闰月写 6L）
 *               闰月：那年有同一个闰月就在闰月，没有就按非闰的同一个月；三十碰上小月取廿九（lunarYearlyDate）
 * 周期：每次“应打卡日”开启一个周期，持续到下一次应打卡日前一天；周期键 = 该应打卡日的日期键。
 */
import { addDays, daysInMonth, diffDays, formatDate, parseDateKey, weekday, weekdayShort } from './dates';
import type { DateKey } from './types';
import { lunarDateLabel } from './lunar/names';
import { lunarYearlyDate, solarToLunar } from './lunar/lunar';

import { tr } from './i18n';
export type Recurrence =
  | { kind: 'daily' }
  | { kind: 'every'; days: number; anchor: DateKey }
  | { kind: 'weekly'; weekdays: number[] }
  | { kind: 'monthly'; day: number }
  /** 每年农历 month 月 day 日（leap = 闰月）。 */
  | { kind: 'lunarYearly'; month: number; day: number; leap: boolean };

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
    case 'lunarYearly':
      return `FREQ=YEARLY;RSCALE=CHINESE;BYMONTH=${r.month}${r.leap ? 'L' : ''};BYMONTHDAY=${r.day}`;
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
  if (freq === 'YEARLY' && parts.get('RSCALE') === 'CHINESE') {
    const bm = /^(\d{1,2})(L?)$/.exec(parts.get('BYMONTH') ?? '');
    const day = Number(parts.get('BYMONTHDAY'));
    if (!bm) return null;
    const month = Number(bm[1]);
    return month >= 1 && month <= 12 && day >= 1 && day <= 30 ? { kind: 'lunarYearly', month, day, leap: bm[2] === 'L' } : null;
  }
  return null;
}

/** 农历 year 年这条规则落在哪天（不是农历规则 / 范围外 null）。 */
function lunarOccurrence(r: Extract<Recurrence, { kind: 'lunarYearly' }>, year: number): DateKey | null {
  return lunarYearlyDate(year, r.month, r.day, r.leap);
}

/** 每年农历规则从 today（含）起的下一次落在哪天（公历）；范围外 null。 */
export function nextLunarYearly(r: Extract<Recurrence, { kind: 'lunarYearly' }>, today: DateKey): DateKey | null {
  const y = solarToLunar(today)?.year;
  if (!y) return null;
  for (const yy of [y, y + 1]) {
    const d = lunarOccurrence(r, yy);
    if (d && d >= today) return d;
  }
  return null;
}

/**
 * 重复规则的说法。opts.lunar = false（农历界面隐藏：没开「中国农历」或不是中文界面，Rei 2026-10-25）时，
 * 每年农历的规则不写农历，改写下一次的公历日期「每年 · 下次 2027年9月15日」（规则本身照旧按农历算）；没给 today 就只写「每年」。
 */
export function describeRecurrence(r: Recurrence | null, opts: { lunar?: boolean; today?: DateKey } = {}): string {
  if (!r) return tr('只做一次');
  switch (r.kind) {
    case 'daily':
      return tr('每天');
    case 'every':
      return tr('每 {days} 天', { days: r.days });
    case 'weekly': {
      const sorted = [...r.weekdays].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
      if (sorted.length === 7) return tr('每天');
      if (sorted.join() === '1,2,3,4,5') return tr('工作日');
      return tr('每周{join}', { join: sorted.map((d) => weekdayShort(d)).join(tr('、')) });
    }
    case 'monthly':
      return tr('每月 {day} 号', { day: r.day });
    case 'lunarYearly': {
      if (opts.lunar !== false) return tr('每年{date}', { date: lunarDateLabel(r.month, r.day, r.leap) });
      const next = opts.today ? nextLunarYearly(r, opts.today) : null;
      return next ? tr('每年 · 下次 {date}', { date: formatDate(next, { weekday: false, year: true }) }) : tr('每年');
    }
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
    case 'lunarYearly': {
      const l = solarToLunar(date);
      return !!l && lunarOccurrence(r, l.year) === date;
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
  if (r.kind === 'lunarYearly') {
    const l = solarToLunar(date);
    if (!l) return null;
    const cur = lunarOccurrence(r, l.year);
    if (cur && cur <= date) return cur;
    return lunarOccurrence(r, l.year - 1);
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
