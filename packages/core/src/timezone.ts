/**
 * 任务时区（Rei 2026-10-25：「日期可以选择时区，时区默认是当前时区，时区默认只显示常用的一些时区，点击显示更多显示完整时区列表」）。
 *
 * - task.time_zone：IANA 名（如 'America/New_York'），可空。空 = 跟着设备当前时区（浮动）；老任务都是空。
 *   用户在日期面板里主动选了时区就存具体的名字（哪怕和设备时区一样），只有从来没选过才是空。
 * - 日期（scheduled_date / target_date）和提醒时间（remind_time）都按任务时区的墙上时间解释：
 *   提醒响的时刻 = 任务时区那天那个钟点换算成的绝对时刻（reminders.ts）；「今天」「过期」按任务时区的今天算（taskToday）。
 * - 偏移一律按「那天」算（夏令时）：offsetMinutesOn(tz, date) 取那天当地正午的偏移。
 */
import { toDateKey } from './dates';
import type { DateKey, Task } from './types';
import { getLocale, tr } from './i18n';
import { CITY_ZH } from './timezone-names';

/** 时刻 ms 在时区 tz（不传 = 设备）的日期键。 */
export function dateKeyInZone(ms: number, tz?: string): DateKey {
  if (!tz) return toDateKey(new Date(ms));
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(new Date(ms))) if (x.type !== 'literal') p[x.type] = x.value;
  return `${p.year}-${p.month}-${p.day}`;
}

/** 设备当前时区（取不到时 'UTC'）。 */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** 这个名字是不是这台设备认识的 IANA 时区。 */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** 规范化存进库里的值：认识的 IANA 名照存，其他（空串、乱写）→ null（= 跟着设备）。 */
export function normalizeTimeZone(tz: unknown): string | null {
  return isValidTimeZone(tz) ? tz.trim() : null;
}

/** 常用时区（Rei 2026-10-25 定的这批；列表顶上先放设备时区和最近用过的）。 */
export const COMMON_TIME_ZONES: readonly string[] = [
  'UTC',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Asia/Seoul',
  'America/Los_Angeles',
  'America/New_York',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Australia/Sydney',
];

/** 常用列表：设备时区 → 最近用过的 → 固定的那批，去重、去掉不认识的。 */
export function commonTimeZones(device: string, recent: readonly string[] = []): string[] {
  const out: string[] = [];
  for (const tz of [device, ...recent, ...COMMON_TIME_ZONES]) if (isValidTimeZone(tz) && !out.includes(tz)) out.push(tz);
  return out;
}

/** 完整列表：Intl.supportedValuesOf('timeZone')（没有这个 API 时退回常用那批），带上 UTC，按名字排。 */
export function allTimeZones(): string[] {
  let list: string[] = [];
  try {
    const f = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    if (f) list = f('timeZone');
  } catch {
    /* 老环境 */
  }
  if (!list.length) list = [...COMMON_TIME_ZONES];
  if (!list.includes('UTC')) list = ['UTC', ...list];
  return [...new Set(list)].sort((a, b) => (a === 'UTC' ? -1 : b === 'UTC' ? 1 : a.localeCompare(b)));
}

/** 时区在时刻 ms 相对 UTC 的偏移（分钟，东正西负）。 */
export function offsetMinutesAt(ms: number, tz: string): number {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p: Record<string, number> = {};
  for (const x of f.formatToParts(new Date(ms))) if (x.type !== 'literal') p[x.type] = Number(x.value);
  const wall = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
  return Math.round((wall - Math.floor(ms / 1000) * 1000) / 60_000);
}

/** 那天（当地正午）的偏移，分钟。夏令时按那天算：纽约 1 月 −300、7 月 −240。 */
export function offsetMinutesOn(tz: string, date: DateKey): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  // 正午附近不会碰上夏令时切换（切换都在凌晨）；先按 UTC 正午取偏移，再修正一次
  const guess = Date.UTC(y, m - 1, d, 12, 0);
  const o = offsetMinutesAt(guess, tz);
  return offsetMinutesAt(guess - o * 60_000, tz);
}

/** 「UTC+8」「UTC−4」「UTC+5:30」「UTC」（减号用 U+2212）。 */
export function formatUtcOffset(minutes: number): string {
  if (minutes === 0) return 'UTC';
  const sign = minutes > 0 ? '+' : '\u2212';
  const a = Math.abs(minutes);
  const h = Math.floor(a / 60);
  const m = a % 60;
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}


/** 城市名：「上海」/「New York」；没收录的用 IANA 最后一段（下划线换空格）。 */
export function timeZoneCity(tz: string): string {
  if (getLocale() === 'zh' && CITY_ZH[tz]) return CITY_ZH[tz]!;
  if (tz === 'UTC') return 'UTC';
  const last = tz.split('/').pop() ?? tz;
  return last.replace(/_/g, ' ');
}

/** 「上海 (UTC+8)」「New York (UTC−4)」，偏移按 date 那天算。UTC 本身只写「UTC」。 */
export function timeZoneLabel(tz: string, date: DateKey): string {
  if (tz === 'UTC') return getLocale() === 'zh' ? tr('协调世界时 (UTC)') : 'UTC';
  return `${timeZoneCity(tz)} (${formatUtcOffset(offsetMinutesOn(tz, date))})`;
}

/** 搜索时区：城市名（中 / 英）、IANA 全名、偏移（「+8」「UTC-4」）都能搜。 */
export function matchTimeZone(tz: string, query: string, date: DateKey): boolean {
  const q = query.trim().toLowerCase().replace(/\u2212/g, '-');
  if (!q) return true;
  const off = formatUtcOffset(offsetMinutesOn(tz, date)).toLowerCase().replace(/\u2212/g, '-');
  const hay = [tz, tz.replace(/_/g, ' '), timeZoneCity(tz), CITY_ZH[tz] ?? '', off, off.replace('utc', '')].join(' ').toLowerCase();
  return hay.includes(q);
}

/** 任务的有效时区：任务存的（认识的）> 设备时区。 */
export function taskTimeZone(task: Pick<Task, 'time_zone'>, device: string = deviceTimeZone()): string {
  return normalizeTimeZone(task.time_zone) ?? device;
}

/**
 * 任务时区的「今天」。没设时区（浮动）就是设备的今天（传了 deviceToday 直接用它，和界面其他地方一致）。
 * 「我的一天」建议、过期都按它判断：纽约的任务在纽约那天过完了才算过期。
 */
export function taskToday(task: Pick<Task, 'time_zone'>, now: Date, deviceToday?: DateKey): DateKey {
  const tz = normalizeTimeZone(task.time_zone);
  if (!tz) return deviceToday ?? dateKeyInZone(now.getTime());
  return dateKeyInZone(now.getTime(), tz);
}

/** 某个时区的今天（快捷按钮「今天 / 明天」按所选时区算）。tz 空 = 设备。 */
export function todayIn(tz: string | null | undefined, now: Date): DateKey {
  const z = normalizeTimeZone(tz);
  return z ? dateKeyInZone(now.getTime(), z) : dateKeyInZone(now.getTime());
}

/** 任务的日期过期了没有（按任务时区的今天）。 */
export function isTaskOverdue(task: Pick<Task, 'time_zone' | 'scheduled_date'>, now: Date, deviceToday?: DateKey): boolean {
  return !!task.scheduled_date && task.scheduled_date < taskToday(task, now, deviceToday);
}

/**
 * 列表 / 详情日期旁的小时区标注：任务时区和设备时区那天的偏移不一样时给「UTC−4」，一样（或没设）给 null。
 * 用偏移比，不用名字比：上海和新加坡偏移一样，不标。
 */
export function timeZoneBadge(task: Pick<Task, 'time_zone'>, date: DateKey | null, device: string = deviceTimeZone()): string | null {
  const tz = normalizeTimeZone(task.time_zone);
  if (!tz || tz === device) return null;
  const d = date ?? dateKeyInZone(Date.now(), tz);
  const o = offsetMinutesOn(tz, d);
  return o === offsetMinutesOn(device, d) ? null : formatUtcOffset(o);
}

/** 最近用过的时区：新的放前面、去重、最多 n 个。 */
export function pushRecentTimeZone(list: readonly string[], tz: string, n = 5): string[] {
  return [tz, ...list.filter((x) => x !== tz)].filter(isValidTimeZone).slice(0, n);
}

