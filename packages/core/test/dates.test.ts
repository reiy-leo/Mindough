import { describe, expect, it } from 'vitest';
import { addDays, dateRange, diffDays, formatDateZh, mondayIndex, relativeDayZh, startOfWeek, toDateKey, weekday } from '../src/dates';
import { local } from './helpers';

describe('dates', () => {
  it('按本机时区取日期键', () => {
    expect(toDateKey(local(2026, 10, 15, 23, 59))).toBe('2026-10-15');
    expect(toDateKey(local(2026, 1, 5, 0, 1))).toBe('2026-01-05');
  });

  it('加减天数跨月跨年', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
    expect(diffDays('2026-10-01', '2026-10-15')).toBe(14);
    expect(diffDays('2026-10-15', '2026-10-01')).toBe(-14);
  });

  it('星期与周起点', () => {
    expect(weekday('2026-10-15')).toBe(4); // 周四
    expect(mondayIndex('2026-10-18')).toBe(6); // 周日
    expect(startOfWeek('2026-10-15')).toBe('2026-10-12');
    expect(startOfWeek('2026-10-15', 0)).toBe('2026-10-11');
  });

  it('区间与中文格式', () => {
    expect(dateRange('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
    expect(formatDateZh('2026-10-15')).toBe('10月15日 周四');
    expect(relativeDayZh('2026-10-16', '2026-10-15')).toBe('明天');
    expect(relativeDayZh('2026-10-14', '2026-10-15')).toBe('昨天');
    expect(relativeDayZh('2026-10-20', '2026-10-15')).toBe('10月20日 周二');
  });
});
