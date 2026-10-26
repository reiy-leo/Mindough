/**
 * 任务日期怎么显示（Rei 2026-10-26「设置-任务：支持自定义日期显示格式，相对时间、年月日、年月日+时区、自动等」）。
 * 设置 → 任务 →「日期显示」选一种，只记在本机。任务相关的日期文字都走这里：列表行、详情日期、提醒时间、
 * 倒数日卡片、任务链步骤、项目时间轴和看板卡片。分组标题、日期选择器、农历小字、日记月历不走这里。
 *
 * - auto（默认）：和以前一样。列表行：今天 / 明天 / 昨天 / 后天 / 前天，再远写「10月15日 周四」；
 *   详情：前后两天内同上，再远写日期，不是今年带年份。
 * - relative：一律相对：「3 天后」「2 个月前」「明天」。
 * - ymd：年月日，按界面语言的本地格式（2026年10月26日 / Oct 26, 2026 / 26.10.2026）；带时间的跟着写时间。
 * - ymd-tz：年月日后带时区（GMT+8），带时间的也带。
 */
import { diffDays, formatDate, parseDateKey, relativeDayZh, toDateKey } from './dates';
import type { DateKey } from './types';
import { getLocale, intlLocale, tr, type Locale } from './i18n';

export const DATE_DISPLAYS = ['auto', 'relative', 'ymd', 'ymd-tz'] as const;
export type DateDisplay = (typeof DATE_DISPLAYS)[number];
export const isDateDisplay = (v: unknown): v is DateDisplay => typeof v === 'string' && (DATE_DISPLAYS as readonly string[]).includes(v);

export interface TaskDateOpts {
  mode: DateDisplay;
  /** 「今天」是哪天（任务时区的今天）。 */
  today: DateKey;
  /** 时刻 HH:MM（可选）。 */
  time?: string | null;
  /** 显示时区用的 IANA 时区（ymd-tz）；不给就用设备时区。 */
  timeZone?: string | null;
  /** 只影响 auto：列表行的说法（前后两天内相对，再远写日期不带年），默认是详情的说法。 */
  compact?: boolean;
  locale?: Locale;
}

function deviceZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** 某一天在某时区的偏移：「GMT+8」「GMT-4」「GMT+5:30」「GMT+0」。按那天中午算，夏令时也对。 */
export function zoneOffsetLabel(date: DateKey, timeZone?: string | null, time?: string | null): string {
  const tz = timeZone || deviceZone();
  const { y, m, d } = parseDateKey(date);
  const [hh, mm] = time && /^\d{1,2}:\d{2}$/.test(time) ? time.split(':').map(Number) : [12, 0];
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(new Date(Date.UTC(y, m - 1, d, hh!, mm!))).find((p) => p.type === 'timeZoneName');
    const v = part?.value ?? 'GMT';
    return v === 'GMT' || v === 'UTC' ? 'GMT+0' : v; // 不同 ICU 版本对 UTC 写「GMT」或「GMT+0」，统一成 GMT+0
  } catch {
    return 'GMT+0';
  }
}

/** HH:MM 按语言写：中文 24 小时「09:30」，其他语言按习惯（英文「9:30 AM」）。 */
export function formatClock(hhmm: string, locale: Locale = getLocale()): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  return new Intl.DateTimeFormat(intlLocale(locale), { hour: locale === 'zh' ? '2-digit' : 'numeric', minute: '2-digit', ...(locale === 'zh' ? { hourCycle: 'h23' as const } : {}) }).format(new Date(2000, 0, 1, Number(m[1]), Number(m[2])));
}

/** 年月日（本地格式，不带星期）。 */
export function formatYmd(date: DateKey, locale: Locale = getLocale()): string {
  const { y, m, d } = parseDateKey(date);
  return new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
}

const rtf = (locale: Locale) => new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: 'auto' });

/** 相对天数：今天 / 明天 / 3 天后 / 2 个月前 / 1 年后。 */
export function relativeDays(n: number, locale: Locale = getLocale()): string {
  const abs = Math.abs(n);
  const unit: Intl.RelativeTimeFormatUnit = abs < 30 ? 'day' : abs < 365 ? 'month' : 'year';
  const v = unit === 'day' ? n : unit === 'month' ? Math.round(n / 30.44) || Math.sign(n) : Math.round(n / 365.25) || Math.sign(n);
  if (locale === 'zh') {
    if (unit === 'day') {
      if (n === 0) return '今天'; // i18n-ignore 中文分支
      if (n === 1) return '明天'; // i18n-ignore 中文分支
      if (n === -1) return '昨天'; // i18n-ignore 中文分支
      if (n === 2) return '后天'; // i18n-ignore 中文分支
      if (n === -2) return '前天'; // i18n-ignore 中文分支
    }
    const word = unit === 'day' ? '天' : unit === 'month' ? '个月' : '年'; // i18n-ignore 中文分支
    return `${Math.abs(v)} ${word}${v > 0 ? '后' : '前'}`; // i18n-ignore 中文分支
  }
  return rtf(locale).format(v, unit);
}

/**
 * 任务的一个日期（可带时刻）按设置的显示方式写出来。
 */
export function formatTaskDate(date: DateKey, opts: TaskDateOpts): string {
  const locale = opts.locale ?? getLocale();
  const time = opts.time && /^\d{1,2}:\d{2}$/.test(opts.time) ? opts.time : null;
  const clock = time ? formatClock(time, locale) : '';
  const join = (a: string, b: string) => (b ? `${a} ${b}` : a);
  switch (opts.mode) {
    case 'relative': {
      // Intl 给的是句中写法（today / in 3 days），单独成一个标签时首字母大写
      const rel = relativeDays(diffDays(opts.today, date), locale);
      return join(locale === 'zh' ? rel : rel.charAt(0).toLocaleUpperCase(intlLocale(locale)) + rel.slice(1), clock);
    }
    case 'ymd':
      return join(formatYmd(date, locale), clock);
    case 'ymd-tz':
      return `${join(formatYmd(date, locale), clock)} ${zoneOffsetLabel(date, opts.timeZone, time)}`;
    default: {
      // 自动：和以前一样（列表行 relativeDayZh；详情 friendlyDate）
      const near = Math.abs(diffDays(opts.today, date)) <= 2;
      const text = opts.compact || near || parseDateKey(date).y === parseDateKey(opts.today).y ? relativeDayZh(date, opts.today) : formatDate(date, { year: true });
      return join(text, clock);
    }
  }
}

/** 只有时刻（提醒时间）：ymd-tz 时后面带时区，其他方式只写时刻。date 用来算那天的偏移（夏令时）。 */
export function formatTaskTime(hhmm: string, opts: { mode: DateDisplay; date?: DateKey | null; timeZone?: string | null; locale?: Locale }): string {
  const clock = formatClock(hhmm, opts.locale ?? getLocale());
  if (opts.mode !== 'ymd-tz') return clock;
  return `${clock} ${zoneOffsetLabel(opts.date ?? toDateKey(new Date()), opts.timeZone, hhmm)}`;
}

/**
 * 一个时间点（创建 / 修改时间这类）：auto 和以前「已同步 · …」一样（刚刚 / N 分钟前 / N 小时前 / 昨天 HH:mm / M月D日 HH:mm）；
 * relative 一律相对（刚刚 / 5 分钟前 / 3 天前）；ymd 年月日 + 时刻；ymd-tz 再带时区。
 */
export function formatTaskInstant(at: Date, opts: { mode: DateDisplay; now: Date; timeZone?: string | null; locale?: Locale }): string {
  const locale = opts.locale ?? getLocale();
  const tz = opts.timeZone || deviceZone();
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(at).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const date = `${parts.year}-${parts.month}-${parts.day}` as DateKey;
  const hm = `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}`;
  const nowParts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(opts.now).map((p) => [p.type, p.value])) as Record<string, string>;
  const today = `${nowParts.year}-${nowParts.month}-${nowParts.day}` as DateKey;
  const diff = opts.now.getTime() - at.getTime();
  const days = diffDays(date, today);
  if (opts.mode === 'ymd' || opts.mode === 'ymd-tz') return formatTaskDate(date, { mode: opts.mode, today, time: hm, timeZone: tz, locale });
  if (opts.mode === 'relative' || (opts.mode === 'auto' && days === 0)) {
    const abs = Math.abs(diff);
    if (abs < 60_000) return locale === 'zh' ? '刚刚' : rtf(locale).format(0, 'second'); // i18n-ignore 中文分支
    if (abs < 3600_000) {
      const n = Math.round(diff / 60_000);
      return locale === 'zh' ? `${Math.abs(n)} 分钟${n > 0 ? '前' : '后'}` : rtf(locale).format(-n, 'minute'); // i18n-ignore 中文分支
    }
    if (abs < 86_400_000 || days === 0) {
      const n = Math.round(diff / 3600_000);
      return locale === 'zh' ? `${Math.abs(n)} 小时${n > 0 ? '前' : '后'}` : rtf(locale).format(-n, 'hour'); // i18n-ignore 中文分支
    }
    if (opts.mode === 'relative') return relativeDays(-days, locale);
  }
  // auto：昨天 14:05；更早 10月3日 14:05（不是今年带年份）
  const clock = formatClock(hm, locale);
  if (days === 1) return `${relativeDays(-1, locale)} ${clock}`;
  return tr('{date} {hm}', { date: formatDate(date, { weekday: false, year: date.slice(0, 4) !== today.slice(0, 4) }), hm: clock });
}
