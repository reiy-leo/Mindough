/** 本地日期工具。DateKey = YYYY-MM-DD；日期运算一律在 UTC 午夜上做，避免时区与夏令时偏差。 */
import type { DateKey } from './types';

const pad = (n: number) => String(n).padStart(2, '0');

/** 按本机时区取日期键。 */
export function toDateKey(d: Date): DateKey {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayKey(now: Date = new Date()): DateKey {
  return toDateKey(now);
}

export function parseDateKey(key: DateKey): { y: number; m: number; d: number } {
  const [y, m, d] = key.split('-').map(Number);
  return { y: y!, m: m!, d: d! };
}

function toUtc(key: DateKey): number {
  const { y, m, d } = parseDateKey(key);
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms: number): DateKey {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

const DAY = 86_400_000;

export function addDays(key: DateKey, n: number): DateKey {
  return fromUtc(toUtc(key) + n * DAY);
}

/** b - a 的天数。 */
export function diffDays(a: DateKey, b: DateKey): number {
  return Math.round((toUtc(b) - toUtc(a)) / DAY);
}

/** 星期：0=周日 … 6=周六。 */
export function weekday(key: DateKey): number {
  return new Date(toUtc(key)).getUTCDay();
}

/** 周一为一周起点的偏移：0=周一 … 6=周日。 */
export function mondayIndex(key: DateKey): number {
  return (weekday(key) + 6) % 7;
}

export function startOfWeek(key: DateKey, weekStartsOn: 0 | 1 = 1): DateKey {
  const offset = weekStartsOn === 1 ? mondayIndex(key) : weekday(key);
  return addDays(key, -offset);
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function compareDateKey(a: DateKey, b: DateKey): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 包含两端的日期区间。 */
export function dateRange(from: DateKey, to: DateKey): DateKey[] {
  const out: DateKey[] = [];
  for (let k = from; k <= to; k = addDays(k, 1)) out.push(k);
  return out;
}

export const WEEKDAY_LABEL = ['日', '一', '二', '三', '四', '五', '六'] as const;

/** 中文日期：10月15日 周四。 */
export function formatDateZh(key: DateKey, withWeekday = true): string {
  const { m, d } = parseDateKey(key);
  return withWeekday ? `${m}月${d}日 周${WEEKDAY_LABEL[weekday(key)]}` : `${m}月${d}日`;
}

/** 相对日期：今天 / 明天 / 昨天 / 否则中文日期。 */
export function relativeDayZh(key: DateKey, today: DateKey): string {
  const n = diffDays(today, key);
  if (n === 0) return '今天';
  if (n === 1) return '明天';
  if (n === -1) return '昨天';
  if (n === 2) return '后天';
  if (n === -2) return '前天';
  return formatDateZh(key);
}
