import { describe, expect, it } from 'vitest';
import { autoMonthMarker, buildHeatmap, levelFor } from '../src/heatmap';
import { mondayIndex } from '../src/dates';

describe('热力图', () => {
  it('四档：0、<50%、<100%、达标', () => {
    expect(levelFor(null)).toBe(0);
    expect(levelFor(0)).toBe(0);
    expect(levelFor(0.3)).toBe(1);
    expect(levelFor(0.5)).toBe(2);
    expect(levelFor(0.99)).toBe(2);
    expect(levelFor(1)).toBe(3);
    expect(levelFor(1.4)).toBe(3);
  });

  const data = buildHeatmap({ end: '2026-10-15', weeks: 53, ratioFor: (d) => (d.endsWith('5') ? 1 : 0.2) });

  it('53 列 × 7 行，周一开始，最后一列包含今天', () => {
    expect(data.columns).toHaveLength(53);
    expect(data.columns.every((c) => c.length === 7)).toBe(true);
    expect(mondayIndex(data.start)).toBe(0);
    const last = data.columns.at(-1)!;
    expect(last.some((c) => c.date === '2026-10-15')).toBe(true);
    // 10-15 是周四：之后的周五~周日是未来格
    expect(last.filter((c) => c.future).map((c) => c.date)).toEqual(['2026-10-16', '2026-10-17', '2026-10-18']);
    expect(last.find((c) => c.date === '2026-10-15')!.level).toBe(3);
  });

  it('每月 1 号标月份数字；月份标签去掉挤在一起的第一个', () => {
    const firsts = data.columns.flat().filter((c) => c.monthStart !== null);
    expect(firsts.every((c) => c.date.endsWith('-01'))).toBe(true);
    expect(firsts.find((c) => c.date === '2026-03-01')?.monthStart).toBe(3);
    const cols = data.monthLabels.map((m) => m.column);
    for (let i = 1; i < cols.length; i++) expect(cols[i]! - cols[i - 1]!).toBeGreaterThanOrEqual(2);
    expect(data.monthLabels.at(-1)?.label).toBe('10月');
  });

  it('格子够大显示数字，小格子显示圆点', () => {
    expect(autoMonthMarker(16)).toBe('number');
    expect(autoMonthMarker(10)).toBe('dot');
  });
});
