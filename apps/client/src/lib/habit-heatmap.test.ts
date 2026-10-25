import { describe, expect, it } from 'vitest';
import { fitHeatmap, isHeatmapOpen, toggleHeatmapOpen } from './habit-heatmap';

describe('打卡卡片活动图开关', () => {
  it('默认收起，切一下展开，再切收起', () => {
    expect(isHeatmapOpen([], 'a')).toBe(false);
    expect(isHeatmapOpen(undefined, 'a')).toBe(false);
    const one = toggleHeatmapOpen([], 'a');
    expect(one).toEqual(['a']);
    expect(isHeatmapOpen(one, 'a')).toBe(true);
    expect(toggleHeatmapOpen(one, 'a')).toEqual([]);
  });
  it('每张卡片分开记，不改原数组', () => {
    const before = ['a'];
    const after = toggleHeatmapOpen(before, 'b');
    expect(after).toEqual(['a', 'b']);
    expect(before).toEqual(['a']);
    expect(toggleHeatmapOpen(after, 'a')).toEqual(['b']);
  });
  it('坏数据当成都收起', () => {
    expect(isHeatmapOpen('x' as unknown as string[], 'x')).toBe(false);
    expect(toggleHeatmapOpen(null as unknown as string[], 'a')).toEqual(['a']);
  });
});

describe('活动图按宽度放几周', () => {
  it('放下整数周，格子刚好填满宽度', () => {
    const { weeks, cell } = fitHeatmap(358, { minCell: 10, gap: 2 });
    expect(weeks).toBe(30);
    expect(weeks * cell + (weeks - 1) * 2).toBeCloseTo(358, 0);
  });
  it('窄宽度至少 1 周，宽度 0 也不出错', () => {
    expect(fitHeatmap(5).weeks).toBe(1);
    expect(fitHeatmap(0)).toEqual({ weeks: 1, cell: 10 });
  });
  it('宽屏最多一年，格子封顶', () => {
    const r = fitHeatmap(2000, { minCell: 10, gap: 2 });
    expect(r.weeks).toBe(53);
    expect(r.cell).toBe(16);
  });
  it('格子不小于最小值', () => {
    for (const w of [100, 333, 517, 640, 799]) {
      const r = fitHeatmap(w, { minCell: 10, gap: 2 });
      expect(r.cell).toBeGreaterThanOrEqual(10);
      expect(r.weeks * r.cell + (r.weeks - 1) * 2).toBeLessThanOrEqual(w + 0.01);
    }
  });
});
