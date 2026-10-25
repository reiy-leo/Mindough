import { describe, expect, it } from 'vitest';
import {
  computeStreak,
  nextLunarYearly,
  describeRecurrence,
  formatRecurrence,
  isDueOn,
  occurrences,
  parseRecurrence,
  periodKeyFor,
  periodStart,
  type Recurrence,
} from '../src/recurrence';

describe('RRULE 子集', () => {
  const cases: Recurrence[] = [
    { kind: 'daily' },
    { kind: 'every', days: 3, anchor: '2026-10-01' },
    { kind: 'weekly', weekdays: [1, 3, 5] },
    { kind: 'monthly', day: 31 },
  ];
  it.each(cases)('格式化后能解析回来：%o', (r) => {
    expect(parseRecurrence(formatRecurrence(r))).toEqual(r);
  });

  it('非法规则返回 null', () => {
    expect(parseRecurrence('FREQ=YEARLY')).toBeNull();
    expect(parseRecurrence('FREQ=WEEKLY;BYDAY=')).toBeNull();
    expect(parseRecurrence(null)).toBeNull();
  });

  it('中文描述', () => {
    expect(describeRecurrence({ kind: 'weekly', weekdays: [5, 1, 3] })).toBe('每周一、三、五');
    expect(describeRecurrence({ kind: 'weekly', weekdays: [1, 2, 3, 4, 5] })).toBe('工作日');
    expect(describeRecurrence({ kind: 'every', days: 2, anchor: '2026-01-01' })).toBe('每 2 天');
    expect(describeRecurrence(null)).toBe('只做一次');
  });
});

describe('应打卡日与周期键', () => {
  it('每周几', () => {
    const r: Recurrence = { kind: 'weekly', weekdays: [1, 3] }; // 周一、周三
    expect(isDueOn(r, '2026-10-12')).toBe(true);
    expect(isDueOn(r, '2026-10-13')).toBe(false);
    // 周二的打卡算进周一的周期
    expect(periodKeyFor(r, '2026-10-13')).toBe('2026-10-12');
  });

  it('每月几号，小月取月末', () => {
    const r: Recurrence = { kind: 'monthly', day: 31 };
    expect(isDueOn(r, '2026-02-28')).toBe(true);
    expect(isDueOn(r, '2026-03-31')).toBe(true);
    expect(isDueOn(r, '2026-03-30')).toBe(false);
    expect(periodStart(r, '2026-03-15')).toBe('2026-02-28');
  });

  it('每 N 天，起点之前没有周期', () => {
    const r: Recurrence = { kind: 'every', days: 3, anchor: '2026-10-01' };
    expect(occurrences(r, '2026-09-29', '2026-10-08')).toEqual(['2026-10-01', '2026-10-04', '2026-10-07']);
    expect(periodStart(r, '2026-10-06')).toBe('2026-10-04');
    expect(periodStart(r, '2026-09-30')).toBeNull();
  });

  it('不重复的任务周期键为 once', () => {
    expect(periodKeyFor(null, '2026-10-15')).toBe('once');
  });
});

describe('连续天数', () => {
  const daily: Recurrence = { kind: 'daily' };

  it('今天还没打卡不算断', () => {
    const met = new Set(['2026-10-12', '2026-10-13', '2026-10-14']);
    expect(computeStreak(daily, met, '2026-10-15', '2026-10-01')).toEqual({ current: 3, best: 3, todayMet: false });
  });

  it('今天打卡了计入；中间断了重新数；记录最长', () => {
    const met = new Set(['2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-14', '2026-10-15']);
    expect(computeStreak(daily, met, '2026-10-15', '2026-10-01')).toEqual({ current: 2, best: 4, todayMet: true });
  });

  it('每周几的连续按周期数', () => {
    const r: Recurrence = { kind: 'weekly', weekdays: [1, 3, 5] };
    // 10-05 周一、10-07 周三、10-09 周五、10-12 周一、10-14 周三；10-15 周四（当前周期是 10-14），10-05 没打卡
    const met = new Set(['2026-10-07', '2026-10-09', '2026-10-12']);
    expect(computeStreak(r, met, '2026-10-15', '2026-10-01').current).toBe(3); // 当前周期 10-14 未完成不算断
    met.add('2026-10-14');
    expect(computeStreak(r, met, '2026-10-15', '2026-10-01').current).toBe(4);
  });

  it('创建前的周期只在达标时计入', () => {
    const r: Recurrence = { kind: 'weekly', weekdays: [1] };
    // 10-14 周三创建；当前周期起点 10-12 早于创建日
    expect(computeStreak(r, new Set(), '2026-10-15', '2026-10-14').current).toBe(0);
    expect(computeStreak(r, new Set(['2026-10-12']), '2026-10-15', '2026-10-14').current).toBe(1);
  });
});

describe('每年农历（RSCALE=CHINESE）', () => {
  it('读写', () => {
    const r: Recurrence = { kind: 'lunarYearly', month: 6, day: 15, leap: true };
    expect(formatRecurrence(r)).toBe('FREQ=YEARLY;RSCALE=CHINESE;BYMONTH=6L;BYMONTHDAY=15');
    expect(parseRecurrence(formatRecurrence(r))).toEqual(r);
    expect(parseRecurrence('FREQ=YEARLY;RSCALE=CHINESE;BYMONTH=8;BYMONTHDAY=15')).toEqual({ kind: 'lunarYearly', month: 8, day: 15, leap: false });
    expect(parseRecurrence('FREQ=YEARLY;RSCALE=CHINESE;BYMONTH=13;BYMONTHDAY=1')).toBeNull();
    expect(parseRecurrence('FREQ=YEARLY;BYMONTH=8;BYMONTHDAY=15')).toBeNull();
    expect(describeRecurrence({ kind: 'lunarYearly', month: 8, day: 15, leap: false })).toBe('每年农历八月十五');
  });
  it('中秋：2025-10-06、2026-09-25', () => {
    const r: Recurrence = { kind: 'lunarYearly', month: 8, day: 15, leap: false };
    expect(occurrences(r, '2025-01-01', '2026-12-31')).toEqual(['2025-10-06', '2026-09-25']);
    expect(periodStart(r, '2026-09-24')).toBe('2025-10-06');
    expect(periodStart(r, '2026-10-17')).toBe('2026-09-25');
    expect(periodKeyFor(r, '2026-02-01')).toBe('2025-10-06');
  });
  it('闰六月十五：2025 在闰月，2026 没闰月按六月', () => {
    const r: Recurrence = { kind: 'lunarYearly', month: 6, day: 15, leap: true };
    expect(occurrences(r, '2025-01-01', '2026-12-31')).toEqual(['2025-08-08', '2026-07-28']);
    expect(isDueOn(r, '2025-07-09')).toBe(false); // 2025 的（非闰）六月十五不算
  });
});

describe('农历界面隐藏时的说法（Rei 2026-10-25）', () => {
  const r: Recurrence = { kind: 'lunarYearly', month: 8, day: 15, leap: false };
  it('不写农历，写下一次的公历', () => {
    expect(describeRecurrence(r, { lunar: false, today: '2026-10-25' })).toBe('每年 · 下次 2027年9月15日');
    expect(describeRecurrence(r, { lunar: false, today: '2026-09-25' })).toBe('每年 · 下次 2026年9月25日');
    expect(describeRecurrence(r, { lunar: false })).toBe('每年');
    expect(describeRecurrence(r, { lunar: true, today: '2026-10-25' })).toBe('每年农历八月十五');
  });
  it('下一次', () => {
    expect(nextLunarYearly(r, '2026-09-26')).toBe('2027-09-15');
    expect(nextLunarYearly(r, '2026-09-25')).toBe('2026-09-25');
  });
});
