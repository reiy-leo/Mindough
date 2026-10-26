// 任务日期的显示方式（Rei 2026-10-26「设置-任务：支持自定义日期显示格式，相对时间、年月日、年月日+时区、自动等」）：
// 四种方式 × 中英 × 当年 / 跨年 × 有没有时刻。
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../src/i18n';
import { describeCompletion, friendlyDate } from '../src/describe';
import { relativeDayZh } from '../src/dates';
import { chainWhenLabel } from '../src/dag';
import { DATE_DISPLAYS, formatTaskDate, formatTaskInstant, formatTaskTime, isDateDisplay, relativeDays, zoneOffsetLabel } from '../src/date-display';

const T = '2026-10-26'; // 周一
const SH = 'Asia/Shanghai';
const NY = 'America/New_York';

afterEach(() => setLocale('zh'));

describe('formatTaskDate', () => {
  it('四种方式都认得，别的不认', () => {
    expect([...DATE_DISPLAYS]).toEqual(['auto', 'relative', 'ymd', 'ymd-tz']);
    expect(isDateDisplay('ymd-tz')).toBe(true);
    expect(isDateDisplay('long')).toBe(false);
  });

  it('自动 = 以前的说法（详情 friendlyDate，列表行 relativeDayZh）', () => {
    setLocale('zh');
    for (const d of ['2026-10-26', '2026-10-27', '2026-10-24', '2026-10-29', '2026-12-01', '2027-03-01', '2025-12-30']) {
      expect(formatTaskDate(d, { mode: 'auto', today: T })).toBe(friendlyDate(d, T));
      expect(formatTaskDate(d, { mode: 'auto', today: T, compact: true })).toBe(relativeDayZh(d, T));
    }
    expect(formatTaskDate('2026-10-27', { mode: 'auto', today: T })).toBe('明天');
    expect(formatTaskDate('2026-12-01', { mode: 'auto', today: T })).toBe('12月1日 周二');
    expect(formatTaskDate('2027-03-01', { mode: 'auto', today: T })).toBe('2027年3月1日 周一');
    expect(formatTaskDate('2027-03-01', { mode: 'auto', today: T, compact: true })).toBe('3月1日 周一');
    expect(formatTaskDate('2026-10-27', { mode: 'auto', today: T, time: '09:30' })).toBe('明天 09:30');
    setLocale('en');
    expect(formatTaskDate('2026-10-27', { mode: 'auto', today: T })).toBe('Tomorrow');
    expect(formatTaskDate('2026-12-01', { mode: 'auto', today: T })).toBe('Tue, Dec 1');
    expect(formatTaskDate('2027-03-01', { mode: 'auto', today: T })).toBe('Mon, Mar 1, 2027');
    expect(formatTaskDate('2026-12-01', { mode: 'auto', today: T, time: '14:00' })).toBe('Tue, Dec 1 2:00 PM');
  });

  it('相对时间：一律相对', () => {
    setLocale('zh');
    expect(formatTaskDate(T, { mode: 'relative', today: T })).toBe('今天');
    expect(formatTaskDate('2026-10-27', { mode: 'relative', today: T })).toBe('明天');
    expect(formatTaskDate('2026-10-29', { mode: 'relative', today: T })).toBe('3 天后');
    expect(formatTaskDate('2026-10-20', { mode: 'relative', today: T })).toBe('6 天前');
    expect(formatTaskDate('2026-12-26', { mode: 'relative', today: T })).toBe('2 个月后'); // 当年
    expect(formatTaskDate('2026-08-20', { mode: 'relative', today: T })).toBe('2 个月前');
    expect(formatTaskDate('2027-03-01', { mode: 'relative', today: T })).toBe('4 个月后'); // 跨年
    expect(formatTaskDate('2028-01-01', { mode: 'relative', today: T })).toBe('1 年后');
    expect(formatTaskDate('2026-10-29', { mode: 'relative', today: T, time: '09:30' })).toBe('3 天后 09:30');
    setLocale('en');
    expect(formatTaskDate(T, { mode: 'relative', today: T })).toBe('Today');
    expect(formatTaskDate('2026-10-29', { mode: 'relative', today: T })).toBe('In 3 days');
    expect(formatTaskDate('2026-08-20', { mode: 'relative', today: T })).toBe('2 months ago');
    expect(formatTaskDate('2027-03-01', { mode: 'relative', today: T })).toBe('In 4 months');
    expect(formatTaskDate('2028-06-01', { mode: 'relative', today: T })).toBe('In 2 years');
    expect(formatTaskDate('2026-10-29', { mode: 'relative', today: T, time: '14:00' })).toBe('In 3 days 2:00 PM');
  });

  it('年月日：按语言的本地格式，当年也写年份；带时刻跟着写', () => {
    setLocale('zh');
    expect(formatTaskDate(T, { mode: 'ymd', today: T })).toBe('2026年10月26日');
    expect(formatTaskDate('2027-03-01', { mode: 'ymd', today: T })).toBe('2027年3月1日');
    expect(formatTaskDate(T, { mode: 'ymd', today: T, time: '09:05' })).toBe('2026年10月26日 09:05');
    setLocale('en');
    expect(formatTaskDate(T, { mode: 'ymd', today: T })).toBe('Oct 26, 2026');
    expect(formatTaskDate('2027-03-01', { mode: 'ymd', today: T })).toBe('Mar 1, 2027');
    expect(formatTaskDate(T, { mode: 'ymd', today: T, time: '21:00' })).toBe('Oct 26, 2026 9:00 PM');
  });

  it('年月日+时区：后面带 GMT 偏移，按那天算（夏令时）', () => {
    setLocale('zh');
    expect(formatTaskDate(T, { mode: 'ymd-tz', today: T, timeZone: SH })).toBe('2026年10月26日 GMT+8');
    expect(formatTaskDate('2027-03-01', { mode: 'ymd-tz', today: T, timeZone: SH, time: '09:30' })).toBe('2027年3月1日 09:30 GMT+8');
    setLocale('en');
    expect(formatTaskDate('2026-07-01', { mode: 'ymd-tz', today: T, timeZone: NY })).toBe('Jul 1, 2026 GMT-4');
    expect(formatTaskDate('2027-01-15', { mode: 'ymd-tz', today: T, timeZone: NY, time: '08:00' })).toBe('Jan 15, 2027 8:00 AM GMT-5');
    expect(zoneOffsetLabel(T, 'Asia/Kolkata')).toBe('GMT+5:30');
    expect(zoneOffsetLabel(T, 'UTC')).toBe('GMT+0');
  });

  it('别的语言用 Intl 的说法', () => {
    expect(relativeDays(3, 'de')).toBe('in 3 Tagen');
    expect(formatTaskDate(T, { mode: 'ymd', today: T, locale: 'de' })).toBe('26.10.2026');
    expect(formatTaskDate(T, { mode: 'ymd', today: T, locale: 'ja' })).toBe('2026/10/26');
  });
});

describe('提醒时刻、时间点、倒数日、任务链', () => {
  it('formatTaskTime：只有年月日+时区带时区', () => {
    setLocale('zh');
    expect(formatTaskTime('21:00', { mode: 'auto' })).toBe('21:00');
    expect(formatTaskTime('21:00', { mode: 'ymd' })).toBe('21:00');
    expect(formatTaskTime('21:00', { mode: 'ymd-tz', date: T, timeZone: SH })).toBe('21:00 GMT+8');
    setLocale('en');
    expect(formatTaskTime('21:00', { mode: 'relative' })).toBe('9:00 PM');
    expect(formatTaskTime('21:00', { mode: 'ymd-tz', date: '2026-07-01', timeZone: NY })).toBe('9:00 PM GMT-4');
  });

  it('formatTaskInstant：创建 / 修改时间', () => {
    const now = new Date('2026-10-26T09:00:00Z'); // 上海 17:00
    setLocale('zh');
    expect(formatTaskInstant(new Date('2026-10-26T08:59:30Z'), { mode: 'auto', now, timeZone: SH })).toBe('刚刚');
    expect(formatTaskInstant(new Date('2026-10-26T08:40:00Z'), { mode: 'relative', now, timeZone: SH })).toBe('20 分钟前');
    expect(formatTaskInstant(new Date('2026-10-26T03:00:00Z'), { mode: 'auto', now, timeZone: SH })).toBe('6 小时前');
    expect(formatTaskInstant(new Date('2026-10-25T03:00:00Z'), { mode: 'auto', now, timeZone: SH })).toBe('昨天 11:00');
    expect(formatTaskInstant(new Date('2026-10-20T03:00:00Z'), { mode: 'relative', now, timeZone: SH })).toBe('6 天前');
    expect(formatTaskInstant(new Date('2025-10-20T03:00:00Z'), { mode: 'auto', now, timeZone: SH })).toBe('2025年10月20日 11:00');
    expect(formatTaskInstant(new Date('2026-10-20T03:00:00Z'), { mode: 'ymd', now, timeZone: SH })).toBe('2026年10月20日 11:00');
    expect(formatTaskInstant(new Date('2026-10-20T03:00:00Z'), { mode: 'ymd-tz', now, timeZone: SH })).toBe('2026年10月20日 11:00 GMT+8');
    setLocale('en');
    expect(formatTaskInstant(new Date('2026-10-26T08:40:00Z'), { mode: 'relative', now, timeZone: SH })).toBe('20 minutes ago');
    expect(formatTaskInstant(new Date('2026-10-20T03:00:00Z'), { mode: 'ymd', now, timeZone: SH })).toBe('Oct 20, 2026 11:00 AM');
  });

  it('倒数日的完成方式摘要跟着走，自动不变', () => {
    setLocale('zh');
    const task = { completion_mode: 'countdown' as const, target_value: null, unit: null, target_date: '2026-12-20' };
    expect(describeCompletion(task, T)).toBe('倒数日 · 12月20日 周日');
    expect(describeCompletion(task, T, 'ymd')).toBe('倒数日 · 2026年12月20日');
    expect(describeCompletion(task, T, 'relative')).toBe('倒数日 · 2 个月后');
  });

  it('任务链步骤：自动不变，其他方式按设置写', () => {
    setLocale('zh');
    const planned = { kind: 'planned' as const, date: '2026-12-01', days: 36 };
    expect(chainWhenLabel(planned, T).text).toBe('12月1日');
    expect(chainWhenLabel(planned, T, 'relative')).toEqual({ text: '1 个月后', tone: 'upcoming' });
    expect(chainWhenLabel(planned, T, 'ymd').text).toBe('2026年12月1日');
    expect(chainWhenLabel({ kind: 'planned', date: '2026-10-24', days: -2 }, T, 'relative')).toEqual({ text: '前天', tone: 'overdue' });
    expect(chainWhenLabel({ kind: 'done', date: '2026-10-20', days: 6 }, T, 'ymd').text).toBe('2026年10月20日完成');
    expect(chainWhenLabel({ kind: 'none' }, T, 'ymd').text).toBe('未定时间');
  });
});
