/** 本地日期工具。DateKey = YYYY-MM-DD；日期运算一律在 UTC 午夜上做，避免时区与夏令时偏差。 */
import type { DateKey } from './types';
import { getLocale, tr } from './i18n';

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

/** 星期的短名（0=周日）：中文「日 一 二…」，英文「Sun Mon…」。 */
export function weekdayShort(dow: number): string {
  if (getLocale() === 'en') return new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 0, 4 + dow)));
  return WEEKDAY_LABEL[dow]!;
}

/**
 * 星期（0=周日）的三种宽度：narrow 中文「一」/ 英文「M」（星期选择钮）；short「周一」/「Mon」；long「星期一」/「Monday」（读屏）。
 */
export function weekdayLabel(dow: number, width: 'narrow' | 'short' | 'long'): string {
  if (getLocale() === 'en') return new Intl.DateTimeFormat('en-US', { weekday: width, timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 0, 4 + dow)));
  const c = WEEKDAY_LABEL[dow]!;
  return width === 'narrow' ? c : width === 'short' ? `周${c}` : `星期${c}`; // i18n-ignore 中文分支
}

/** 兼容旧代码：中文星期短名表（新代码用 weekdayShort）。 */
export const WEEKDAY_LABEL = ['日', '一', '二', '三', '四', '五', '六'] as const; // i18n-ignore 中文分支用

/**
 * 日期（按当前语言）：中文「10月15日 周四」，英文「Thu, Oct 15」；year 时带年份（「2027年3月1日 周一」/「Mon, Mar 1, 2027」）。
 */
export function formatDate(key: DateKey, opts: { weekday?: boolean; year?: boolean } = {}): string {
  const { y, m, d } = parseDateKey(key);
  const withWeekday = opts.weekday ?? true;
  if (getLocale() === 'en') {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', ...(withWeekday ? { weekday: 'short' } : {}), ...(opts.year ? { year: 'numeric' } : {}) }).format(new Date(Date.UTC(y, m - 1, d)));
  }
  const base = `${opts.year ? `${y}年` : ''}${m}月${d}日`; // i18n-ignore 中文分支
  return withWeekday ? `${base} 周${WEEKDAY_LABEL[weekday(key)]}` : base; // i18n-ignore 中文分支
}

/** 旧名字（按当前语言，不只是中文）。 */
export function formatDateZh(key: DateKey, withWeekday = true): string {
  return formatDate(key, { weekday: withWeekday });
}

/** 相对日期：今天 / 明天 / 昨天 / 后天 / 前天，否则日期（按当前语言；旧名字保留）。 */
export function relativeDayZh(key: DateKey, today: DateKey): string {
  const n = diffDays(today, key);
  if (n === 0) return tr('今天');
  if (n === 1) return tr('明天');
  if (n === -1) return tr('昨天');
  if (n === 2) return tr('后天');
  if (n === -2) return tr('前天');
  return formatDate(key);
}

/** 月份短名（1–12）：中文「3月」，英文「Mar」。 */
export function monthShort(m: number): string {
  if (getLocale() === 'en') return new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, m - 1, 1)));
  return `${m}月`; // i18n-ignore 中文分支
}
