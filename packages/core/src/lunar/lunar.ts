/**
 * 中国农历（Rei 2026-10-17）：公历 ⇄ 农历、节气、传统节日、日期格子下的小字。全部本地查表（data.ts，1900–2100），不联网。
 * 范围外（1900-01-31 之前、农历 2100 年之后）一律返回 null，界面不显示农历。
 */
import { addDays, diffDays, parseDateKey } from '../dates';
import type { DateKey } from '../types';
import { LUNAR_EPOCH, LUNAR_FIRST_YEAR, LUNAR_INFO, LUNAR_LAST_YEAR, SOLAR_TERMS, TERM_BASE } from './data';
import { LUNAR_FESTIVALS, NEW_YEARS_EVE, SOLAR_TERM_NAMES, lunarDayName, lunarFullName, lunarMonthName } from './names';

export interface LunarDate {
  /** 农历年（跟正月初一所在的公历年同号）。 */
  year: number;
  /** 1–12。 */
  month: number;
  /** 1–30。 */
  day: number;
  /** 是不是闰月。 */
  leap: boolean;
}

export interface LunarMonth {
  month: number;
  leap: boolean;
  /** 29 或 30。 */
  days: number;
}

const info = (year: number): number | null => (year >= LUNAR_FIRST_YEAR && year <= LUNAR_LAST_YEAR ? (LUNAR_INFO[year - LUNAR_FIRST_YEAR] ?? null) : null);

/** 那年闰几月（0 = 没闰月）；范围外 0。 */
export function leapMonthOf(year: number): number {
  return (info(year) ?? 0) & 0xf;
}

/** 那年的月份（含闰月，按先后排）；范围外 null。 */
export function lunarYearMonths(year: number): LunarMonth[] | null {
  const v = info(year);
  if (v === null) return null;
  const leap = v & 0xf;
  const out: LunarMonth[] = [];
  for (let m = 1; m <= 12; m++) {
    out.push({ month: m, leap: false, days: v & (0x10000 >> m) ? 30 : 29 });
    if (m === leap) out.push({ month: m, leap: true, days: v & 0x10000 ? 30 : 29 });
  }
  return out;
}

/** 某个农历月有几天；那年没有这个（闰）月返回 null。 */
export function lunarMonthDays(year: number, month: number, leap = false): number | null {
  return lunarYearMonths(year)?.find((m) => m.month === month && m.leap === leap)?.days ?? null;
}

// 每个农历年正月初一离 LUNAR_EPOCH 几天（启动时算一遍，201 个数）
const YEAR_START: number[] = [];
{
  let acc = 0;
  for (let y = LUNAR_FIRST_YEAR; y <= LUNAR_LAST_YEAR + 1; y++) {
    YEAR_START.push(acc);
    if (y <= LUNAR_LAST_YEAR) for (const m of lunarYearMonths(y)!) acc += m.days;
  }
}

/** 公历 → 农历；范围外 null。 */
export function solarToLunar(key: DateKey): LunarDate | null {
  const off = diffDays(LUNAR_EPOCH, key);
  if (off < 0 || off >= YEAR_START[YEAR_START.length - 1]!) return null;
  // 二分找年
  let lo = 0;
  let hi = YEAR_START.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (YEAR_START[mid]! <= off) lo = mid;
    else hi = mid - 1;
  }
  const year = LUNAR_FIRST_YEAR + lo;
  let rest = off - YEAR_START[lo]!;
  for (const m of lunarYearMonths(year)!) {
    if (rest < m.days) return { year, month: m.month, day: rest + 1, leap: m.leap };
    rest -= m.days;
  }
  return null;
}

/** 农历 → 公历；这天不存在（没这个闰月、小月三十、范围外）返回 null。 */
export function lunarToSolar(l: LunarDate): DateKey | null {
  const months = lunarYearMonths(l.year);
  if (!months || l.day < 1) return null;
  let off = YEAR_START[l.year - LUNAR_FIRST_YEAR]!;
  for (const m of months) {
    if (m.month === l.month && m.leap === l.leap) return l.day <= m.days ? addDays(LUNAR_EPOCH, off + l.day - 1) : null;
    off += m.days;
  }
  return null;
}

/**
 * 「每年农历 X 月 X 日」落在农历 year 年的哪天（重复规则用）：
 * - 闰月：那年有同一个闰月就在闰月，没有就按非闰的同一个月；
 * - 三十：那个月是小月（29 天）就取月末（廿九）。
 */
export function lunarYearlyDate(year: number, month: number, day: number, leap = false): DateKey | null {
  const useLeap = leap && leapMonthOf(year) === month;
  const days = lunarMonthDays(year, month, useLeap);
  if (days === null) return null;
  return lunarToSolar({ year, month, day: Math.min(day, days), leap: useLeap });
}

/** 公历 y 年第 i 个节气（0 = 小寒 … 23 = 冬至）的日期；范围外 null。 */
export function solarTermDate(year: number, i: number): DateKey | null {
  const s = year >= LUNAR_FIRST_YEAR && year <= LUNAR_LAST_YEAR ? SOLAR_TERMS[year - LUNAR_FIRST_YEAR] : undefined;
  if (!s || i < 0 || i > 23) return null;
  const nibble = parseInt(s[i >> 1]!, 16);
  const extra = i % 2 === 0 ? nibble >> 2 : nibble & 3;
  const day = TERM_BASE[i]! + extra;
  return `${year}-${String((i >> 1) + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** 这天是哪个节气（不是返回 null）。 */
export function solarTermOf(key: DateKey): string | null {
  const { y, m, d } = parseDateKey(key);
  for (const i of [(m - 1) * 2, (m - 1) * 2 + 1]) {
    const k = solarTermDate(y, i);
    if (k && parseDateKey(k).d === d) return SOLAR_TERM_NAMES[i]!;
  }
  return null;
}

/** 传统节日（春节、元宵、端午、七夕、中秋、重阳、腊八、小年、除夕…；闰月不算）。 */
export function lunarFestivalOf(l: LunarDate): string | null {
  if (l.leap) return null;
  if (l.month === 12 && l.day === lunarMonthDays(l.year, 12)) return NEW_YEARS_EVE;
  return LUNAR_FESTIVALS[`${l.month}-${l.day}`] ?? null;
}

export type LunarLabelKind = 'subscribed' | 'festival' | 'term' | 'month' | 'day';

export interface LunarLabel {
  text: string;
  kind: LunarLabelKind;
  /** 完整说法（读屏 / 提示）：「农历九月初一 · 霜降」。 */
  full: string;
}

/**
 * 日期格子下的小字。优先级：订阅到的节日名 > 传统节日 > 节气 > 初一显示月份（「九月」「闰六月」）> 日子（「十五」）。
 * subscribed 是订阅日历这天的事件名（已挑好的一个，见 calendar-sub.ts pickCellEvent）。
 */
export function lunarCellLabel(key: DateKey, subscribed?: string | null): LunarLabel | null {
  const l = solarToLunar(key);
  if (!l && !subscribed) return null;
  const base = l ? lunarFullName(l.month, l.day, l.leap) : '';
  const festival = l ? lunarFestivalOf(l) : null;
  const term = solarTermOf(key);
  const extras = [subscribed, festival, term].filter((x, i, a): x is string => !!x && a.indexOf(x) === i);
  const full = [base, ...extras].filter(Boolean).join(' · ');
  if (subscribed) return { text: subscribed, kind: 'subscribed', full };
  if (!l) return null;
  if (festival) return { text: festival, kind: 'festival', full };
  if (term) return { text: term, kind: 'term', full };
  if (l.day === 1) return { text: lunarMonthName(l.month, l.leap), kind: 'month', full };
  return { text: lunarDayName(l.day), kind: 'day', full };
}
