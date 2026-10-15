/**
 * GitHub 式活动热力图数据。一列 = 一周（默认周一开始），一格 = 一天。
 * 档位：0 = 没打卡（或当天无需打卡）、1 = <50%、2 = <100%、3 = 达标。
 */
import { addDays, diffDays, monthShort, parseDateKey, startOfWeek } from './dates';
import type { DateKey } from './types';

export type HeatLevel = 0 | 1 | 2 | 3;

export interface HeatCell {
  date: DateKey;
  /** null = 当天无需打卡。 */
  ratio: number | null;
  level: HeatLevel;
  /** 每月 1 号那一格：月份数字（1..12），其余为 null。 */
  monthStart: number | null;
  /** 晚于 end 的格子（最后一列补位）。 */
  future: boolean;
}

export interface HeatmapData {
  /** columns[c][r]：第 c 周第 r 天（r=0 为一周第一天）。 */
  columns: HeatCell[][];
  /** 每月第一次出现在哪一列，用于顶部月份标签。 */
  monthLabels: Array<{ column: number; month: number; label: string }>;
  start: DateKey;
  end: DateKey;
}

export function levelFor(ratio: number | null): HeatLevel {
  if (ratio === null || ratio <= 0) return 0;
  if (ratio < 0.5) return 1;
  if (ratio < 1) return 2;
  return 3;
}

export interface HeatmapOptions {
  end: DateKey;
  /** 显示多少周；默认 53（一年）。 */
  weeks?: number;
  weekStartsOn?: 0 | 1;
  ratioFor: (date: DateKey) => number | null;
}

export function buildHeatmap({ end, weeks = 53, weekStartsOn = 1, ratioFor }: HeatmapOptions): HeatmapData {
  const lastWeekStart = startOfWeek(end, weekStartsOn);
  const start = addDays(lastWeekStart, -(weeks - 1) * 7);
  const columns: HeatCell[][] = [];
  const monthLabels: HeatmapData['monthLabels'] = [];
  let lastMonth = -1;
  for (let c = 0; c < weeks; c++) {
    const col: HeatCell[] = [];
    for (let r = 0; r < 7; r++) {
      const date = addDays(start, c * 7 + r);
      const future = diffDays(end, date) > 0;
      const ratio = future ? null : ratioFor(date);
      const { m, d } = parseDateKey(date);
      col.push({ date, ratio, level: future ? 0 : levelFor(ratio), monthStart: d === 1 ? m : null, future });
    }
    const firstMonth = parseDateKey(col[0]!.date).m;
    if (firstMonth !== lastMonth) {
      monthLabels.push({ column: c, month: firstMonth, label: monthShort(firstMonth) });
      lastMonth = firstMonth;
    }
    columns.push(col);
  }
  // 第一列若只露出月末几天，标签会和下一个月挤在一起，去掉
  if (monthLabels.length > 1 && monthLabels[1]!.column - monthLabels[0]!.column < 2) monthLabels.shift();
  return { columns, monthLabels, start, end };
}

export type MonthMarker = 'number' | 'dot' | 'none';

/** 格子足够大（≥ 14px）显示月份数字，否则显示小圆点。 */
export function autoMonthMarker(cellSizePx: number): MonthMarker {
  return cellSizePx >= 14 ? 'number' : 'dot';
}
