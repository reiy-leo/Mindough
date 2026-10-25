import { afterEach, describe, expect, it } from 'vitest';
import {
  countdownPhrase,
  currencyName,
  currencyOf,
  dataLabel,
  describeRecurrence,
  formatDate,
  formatEpisode,
  formatMoney,
  libraryCopy,
  BUILTIN_TASK_TYPES,
  localeFromSystem,
  relativeDayZh,
  setLocale,
  appName,
  APP_NAME_EN,
  tr,
  trc,
  TASK_STATUS_LABEL,
  weekdayLabel,
} from '../src';

afterEach(() => setLocale('zh'));

describe('i18n（core）', () => {
  it('app 名字：中文念头团，英文 Mindough（Rei 2026-10-24）', () => {
    expect(appName()).toBe('念头团');
    setLocale('en');
    expect(appName()).toBe('Mindough');
    expect(APP_NAME_EN).toBe('Mindough');
  });

  it('中文原样、英文按词典；没有的 key 退回中文', () => {
    expect(tr('还有 {n} 天', { n: 3 })).toBe('还有 3 天');
    setLocale('en');
    expect(tr('还有 {n} 天', { n: 1 })).toBe('1 day to go');
    expect(tr('还有 {n} 天', { n: 3 })).toBe('3 days to go');
    expect(tr('词典里没有的话')).toBe('词典里没有的话');
  });

  it('日期、星期、重复按语言', () => {
    expect(formatDate('2026-10-16')).toBe('10月16日 周五');
    expect(weekdayLabel(1, 'short')).toBe('周一');
    setLocale('en');
    expect(formatDate('2026-10-16')).toBe('Fri, Oct 16');
    expect(formatDate('2027-03-01', { year: true })).toBe('Mon, Mar 1, 2027');
    expect(relativeDayZh('2026-10-17', '2026-10-16')).toBe('Tomorrow');
    expect(weekdayLabel(1, 'narrow')).toBe('M');
    expect(describeRecurrence({ kind: 'monthly', day: 2 })).toBe('Monthly on the 2nd');
    expect(describeRecurrence({ kind: 'weekly', weekdays: [1, 3, 5] })).toBe('Weekly on Mon, Wed, Fri');
    expect(countdownPhrase('2026-10-15', '2026-10-16')).toBe('1 day ago');
  });

  it('季集、资料库条数、状态、币种', () => {
    setLocale('en');
    expect(formatEpisode({ season: 2, episode: 3 })).toBe('Season 2, Episode 3');
    const movie = BUILTIN_TASK_TYPES.find((t) => t.name === '影视')!;
    expect(libraryCopy(movie).count(1)).toBe('1 title');
    expect(libraryCopy(movie).count(7)).toBe('7 titles');
    expect(TASK_STATUS_LABEL['完成']).toBe('Completed');
    expect(trc('状态', '关闭')).toBe('Closed');
    expect(currencyName(currencyOf('USD')!)).toBe('US Dollar');
    expect(formatMoney({ amount: 12.5, currency: 'USD' })).toBe('$12.50');
  });

  it('内置数据显示时翻译，存的不变', () => {
    expect(dataLabel('健康')).toBe('健康');
    setLocale('en');
    expect(dataLabel('健康')).toBe('Health');
    expect(dataLabel('PC（Steam）')).toBe('PC (Steam)');
    expect(dataLabel('用户自己起的名字')).toBe('用户自己起的名字');
  });

  it('跟随系统：中文系 → 中文，其余英文', () => {
    expect(localeFromSystem(['zh-TW'])).toBe('zh');
    expect(localeFromSystem(['ja-JP', 'en-US'])).toBe('en');
    expect(localeFromSystem(['fr-FR'])).toBe('en');
  });
});
