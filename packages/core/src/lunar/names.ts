/**
 * 农历的名字：月名、日名、节气、传统节日。农历本身是中文概念，日期格子里的小字中英文界面都照中文显示（同 Apple 日历）；
 * 英文界面另有 lunarMonthLabel / lunarDayLabel 的英文说法（选择器、重复规则里用）。
 * 这个文件在 i18n 漏翻检查的白名单里（i18n.test.ts SKIP）。
 */
import { getLocale } from '../i18n';

export const LUNAR_MONTH_NAMES = ['正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '冬月', '腊月'] as const;
const DAY_TENS = ['初', '十', '廿', '三'] as const;
const DAY_UNITS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'] as const;

/** 节气（公历顺序，0 = 小寒 … 23 = 冬至）。 */
export const SOLAR_TERM_NAMES = ['小寒', '大寒', '立春', '雨水', '惊蛰', '春分', '清明', '谷雨', '立夏', '小满', '芒种', '夏至', '小暑', '大暑', '立秋', '处暑', '白露', '秋分', '寒露', '霜降', '立冬', '小雪', '大雪', '冬至'] as const;

/** 传统节日（农历月-日，不算闰月）。除夕另算（腊月最后一天）。 */
export const LUNAR_FESTIVALS: Readonly<Record<string, string>> = {
  '1-1': '春节',
  '1-15': '元宵节',
  '2-2': '龙抬头',
  '5-5': '端午节',
  '7-7': '七夕节',
  '7-15': '中元节',
  '8-15': '中秋节',
  '9-9': '重阳节',
  '12-8': '腊八节',
  '12-23': '小年',
};
export const NEW_YEARS_EVE = '除夕';

/** 「初一」「十五」「廿三」「三十」。 */
export function lunarDayName(day: number): string {
  if (day === 10) return '初十';
  if (day === 20) return '二十';
  if (day === 30) return '三十';
  return `${DAY_TENS[Math.floor(day / 10)]}${DAY_UNITS[(day - 1) % 10]}`;
}

/** 「九月」「闰六月」「腊月」。 */
export function lunarMonthName(month: number, leap = false): string {
  return `${leap ? '闰' : ''}${LUNAR_MONTH_NAMES[month - 1] ?? ''}`;
}

/** 选择器 / 重复规则里的月份：中文「闰六月」，英文「Leap Month 6」。 */
export function lunarMonthLabel(month: number, leap = false): string {
  if (getLocale() !== 'zh') return `${leap ? 'Leap ' : ''}Month ${month}`;
  return lunarMonthName(month, leap);
}

/** 选择器 / 重复规则里的日子：中文「初一」，英文「Day 1」。 */
export function lunarDayLabel(day: number): string {
  return getLocale() !== 'zh' ? `Day ${day}` : lunarDayName(day);
}

/** 格子提示用的全称（中英文都是中文）：「农历九月初一」。 */
export function lunarFullName(month: number, day: number, leap = false): string {
  return `农历${lunarMonthName(month, leap)}${lunarDayName(day)}`;
}

/** 「农历九月初一」/「Lunar Month 9, Day 1」。 */
export function lunarDateLabel(month: number, day: number, leap = false): string {
  if (getLocale() !== 'zh') return `Lunar ${lunarMonthLabel(month, leap)}, Day ${day}`;
  return `农历${lunarMonthName(month, leap)}${lunarDayName(day)}`;
}

/** 「丙午年」（天干地支）。 */
const STEMS = '甲乙丙丁戊己庚辛壬癸';
const BRANCHES = '子丑寅卯辰巳午未申酉戌亥';
export function ganzhiYear(year: number): string {
  const i = (((year - 4) % 60) + 60) % 60;
  return `${STEMS[i % 10]}${BRANCHES[i % 12]}年`;
}

/** 年份：中文「2026 丙午」，英文「2026」。 */
export function lunarYearLabel(year: number): string {
  if (getLocale() !== 'zh') return String(year);
  return `${year} ${ganzhiYear(year).slice(0, 2)}`;
}
