/**
 * 打卡页卡片的活动图开关（Rei 2026-10-25「check-ins 中的任务活动图，不要显示在列表中，而是左上角一个圆点，toggle 全宽显示活动图」）。
 * 每张卡片左上角一个圆点，点一下在卡片下面展开整行宽的活动图，再点收起。展开了哪几张记在本机设置 habitHeatmapOpen，不同步。
 */

/** 这张卡片展开了没有。 */
export function isHeatmapOpen(open: readonly string[] | undefined, id: string): boolean {
  return Array.isArray(open) && open.includes(id);
}

/** 切换一张卡片，返回新列表（不改原数组）。 */
export function toggleHeatmapOpen(open: readonly string[] | undefined, id: string): string[] {
  const list = Array.isArray(open) ? open : [];
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

/**
 * 整行宽度能放几周：格子最小 minCell，间隔 gap；放下整数周后把剩下的宽度平分给每格，正好填满。
 * 至少 1 周，最多 maxWeeks 周（默认 53，一年）；放满一年后格子不再变大太多，cellMax 封顶，多出的宽度留在左边。
 */
export function fitHeatmap(
  width: number,
  { minCell = 10, gap = 2, maxWeeks = 53, cellMax = 16 }: { minCell?: number; gap?: number; maxWeeks?: number; cellMax?: number } = {},
): { weeks: number; cell: number } {
  if (!Number.isFinite(width) || width <= 0) return { weeks: 1, cell: minCell };
  const weeks = Math.max(1, Math.min(maxWeeks, Math.floor((width + gap) / (minCell + gap))));
  const cell = Math.min(cellMax, Math.max(minCell, (width - (weeks - 1) * gap) / weeks));
  return { weeks, cell: Math.floor(cell * 100) / 100 };
}
