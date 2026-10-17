import { describe, expect, it } from 'vitest';
import {
  leapMonthOf,
  lunarCellLabel,
  lunarFestivalOf,
  lunarMonthDays,
  lunarToSolar,
  lunarYearMonths,
  lunarYearlyDate,
  solarTermOf,
  solarToLunar,
} from '../src/lunar/lunar';
import { ganzhiYear, lunarDayName, lunarMonthName } from '../src/lunar/names';
import { addDays } from '../src/dates';

const L = (year: number, month: number, day: number, leap = false) => ({ year, month, day, leap });

describe('公历 ⇄ 农历（对照已知日期）', () => {
  // 来源：国家授时中心 / 香港天文台公布的农历；生成表时已与 lunar-javascript 逐日核对过 1900–2100
  const known: Array<[string, ReturnType<typeof L>]> = [
    ['1900-01-31', L(1900, 1, 1)],
    ['2023-01-22', L(2023, 1, 1)],
    ['2023-03-22', L(2023, 2, 1, true)], // 闰二月
    ['2020-05-23', L(2020, 4, 1, true)], // 闰四月
    ['2024-02-10', L(2024, 1, 1)],
    ['2025-01-29', L(2025, 1, 1)],
    ['2025-07-25', L(2025, 6, 1, true)], // 2025 闰六月初一
    ['2025-08-22', L(2025, 6, 29, true)], // 闰六月是小月
    ['2025-08-23', L(2025, 7, 1)],
    ['2025-10-06', L(2025, 8, 15)], // 中秋
    ['2026-02-16', L(2025, 12, 29)], // 除夕（腊月小）
    ['2026-02-17', L(2026, 1, 1)], // 2026 春节
    ['2026-06-19', L(2026, 5, 5)], // 端午
    ['2026-09-25', L(2026, 8, 15)], // 中秋
    ['2026-10-17', L(2026, 9, 8)],
    ['2027-02-06', L(2027, 1, 1)],
    ['2033-12-22', L(2033, 11, 1, true)], // 「2033 年问题」：闰十一月
    ['2100-12-31', L(2100, 12, 1)],
  ];
  it.each(known)('%s', (solar, lunar) => {
    expect(solarToLunar(solar)).toEqual(lunar);
    expect(lunarToSolar(lunar)).toBe(solar);
  });

  it('范围外返回 null', () => {
    expect(solarToLunar('1900-01-30')).toBeNull();
    expect(solarToLunar('1899-12-31')).toBeNull();
    expect(solarToLunar('2101-12-31')).toBeNull();
    expect(lunarToSolar(L(1899, 1, 1))).toBeNull();
    expect(lunarYearMonths(2101)).toBeNull();
  });

  it('不存在的日子返回 null（没有的闰月、小月三十）', () => {
    expect(lunarToSolar(L(2026, 6, 1, true))).toBeNull();
    expect(lunarToSolar(L(2025, 6, 30, true))).toBeNull();
    expect(lunarToSolar(L(2026, 1, 0))).toBeNull();
  });

  it('闰月与月份表', () => {
    expect(leapMonthOf(2025)).toBe(6);
    expect(leapMonthOf(2026)).toBe(0);
    expect(leapMonthOf(2023)).toBe(2);
    const m2025 = lunarYearMonths(2025)!;
    expect(m2025).toHaveLength(13);
    expect(m2025[6]).toEqual({ month: 6, leap: true, days: 29 });
    expect(lunarYearMonths(2026)).toHaveLength(12);
    expect(lunarMonthDays(2026, 12)).toBe(29);
  });

  it('1900–2100 每天往返一致、连续不跳', () => {
    let k = '1900-01-31';
    let prev = solarToLunar(k)!;
    for (let i = 0; i < 75_000; i++) {
      k = addDays(k, 1);
      const l = solarToLunar(k);
      if (!l) break;
      expect(lunarToSolar(l)).toBe(k);
      if (l.day !== 1) expect(l.day).toBe(prev.day + 1);
      prev = l;
    }
    expect(k >= '2100-12-31').toBe(true);
  });
});

describe('节气与节日', () => {
  it('节气', () => {
    expect(solarTermOf('2026-02-04')).toBe('立春');
    expect(solarTermOf('2026-04-05')).toBe('清明');
    expect(solarTermOf('2026-10-23')).toBe('霜降');
    expect(solarTermOf('2026-12-22')).toBe('冬至');
    expect(solarTermOf('2025-12-21')).toBe('冬至');
    expect(solarTermOf('2026-10-22')).toBeNull();
  });
  it('每年 24 个节气', () => {
    for (const y of [1900, 1950, 2026, 2100]) {
      let n = 0;
      for (let k = `${y}-01-01`; k <= `${y}-12-31`; k = addDays(k, 1)) if (solarTermOf(k)) n++;
      expect(n).toBe(24);
    }
  });
  it('传统节日（除夕看腊月大小，闰月不算）', () => {
    expect(lunarFestivalOf(solarToLunar('2026-02-17')!)).toBe('春节');
    expect(lunarFestivalOf(solarToLunar('2026-02-16')!)).toBe('除夕'); // 腊月廿九
    expect(lunarFestivalOf(solarToLunar('2026-09-25')!)).toBe('中秋节');
    expect(lunarFestivalOf(L(2025, 6, 15, true))).toBeNull();
  });
});

describe('格子小字', () => {
  it('优先级：订阅 > 节日 > 节气 > 初一月名 > 日', () => {
    expect(lunarCellLabel('2026-10-17')).toMatchObject({ text: '初八', kind: 'day' });
    expect(lunarCellLabel('2026-10-10')).toMatchObject({ text: '九月', kind: 'month' });
    expect(lunarCellLabel('2025-07-25')).toMatchObject({ text: '闰六月', kind: 'month' });
    expect(lunarCellLabel('2026-10-23')).toMatchObject({ text: '霜降', kind: 'term' });
    expect(lunarCellLabel('2026-09-25')).toMatchObject({ text: '中秋节', kind: 'festival' });
    expect(lunarCellLabel('2026-09-25', '中秋')).toMatchObject({ text: '中秋', kind: 'subscribed' });
    expect(lunarCellLabel('2026-10-23')!.full).toBe('农历九月十四 · 霜降');
    expect(lunarCellLabel('1800-01-01')).toBeNull();
  });
  it('名字', () => {
    expect([1, 10, 11, 20, 21, 29, 30].map(lunarDayName)).toEqual(['初一', '初十', '十一', '二十', '廿一', '廿九', '三十']);
    expect(lunarMonthName(11)).toBe('冬月');
    expect(lunarMonthName(6, true)).toBe('闰六月');
    expect(ganzhiYear(2026)).toBe('丙午年');
    expect(ganzhiYear(1984)).toBe('甲子年');
  });
});

describe('每年农历 X 月 X 日', () => {
  it('闰月：有同一个闰月就在闰月，没有按非闰同月', () => {
    expect(lunarYearlyDate(2025, 6, 15, true)).toBe(lunarToSolar(L(2025, 6, 15, true)));
    expect(lunarYearlyDate(2026, 6, 15, true)).toBe(lunarToSolar(L(2026, 6, 15)));
    expect(lunarYearlyDate(2025, 6, 15)).toBe(lunarToSolar(L(2025, 6, 15)));
  });
  it('三十碰上小月取廿九', () => {
    expect(lunarYearlyDate(2026, 12, 30)).toBe('2027-02-05'); // 2026 腊月小，除夕 = 廿九
    expect(lunarYearlyDate(2025, 6, 30, true)).toBe('2025-08-22');
  });
});
