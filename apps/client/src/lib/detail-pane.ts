/**
 * 三列布局右列的纯逻辑（Rei 2026-10-23）：宽度的上下限、↑ ↓ 换选中的任务。好测，组件在 components/task/DetailPane.tsx。
 */

/** 宽屏：侧边栏 + 列表 + 详情三列常驻；比这窄是中等宽度（侧边栏收成图标栏，没选中时不占右列）。 */
export const WIDE_MIN = 1100;
/** 侧边栏收成图标栏时的宽度（styles/app.css 的 --rail-w 一致）。 */
export const RAIL_W = 64;
export const SIDEBAR_W = 248;
/** 列表至少留这么宽。 */
export const LIST_MIN = 360;
export const DETAIL_W_MIN = 320;
export const DETAIL_W_MAX = 720;
export const DETAIL_W_DEFAULT = 400;
export const DETAIL_W_KEY = 'mindough:detail_w';

/** 把右列宽度收进 [最小, 最大]：最大还要给列表留出 LIST_MIN。 */
export function clampDetailWidth(w: number, viewport: number): number {
  const side = viewport >= WIDE_MIN ? SIDEBAR_W : RAIL_W;
  const max = Math.max(DETAIL_W_MIN, Math.min(DETAIL_W_MAX, viewport - side - LIST_MIN));
  if (!Number.isFinite(w)) return Math.min(DETAIL_W_DEFAULT, max);
  return Math.round(Math.min(max, Math.max(DETAIL_W_MIN, w)));
}

/** 本机记的宽度（读不出来用默认）。 */
export function loadDetailWidth(saved: string | null, viewport: number): number {
  const n = saved === null ? NaN : Number(saved);
  return clampDetailWidth(Number.isFinite(n) && n > 0 ? n : DETAIL_W_DEFAULT, viewport);
}

/**
 * ↑ ↓ 换选中的任务：ids 是列表里的显示顺序。没选中（或选中的不在列表里）时 ↓ 选第一件、↑ 选最后一件；
 * 到头了不动（返回 null）。
 */
export function nextTaskId(ids: readonly string[], current: string | null, dir: 1 | -1): string | null {
  if (!ids.length) return null;
  const i = current ? ids.indexOf(current) : -1;
  if (i < 0) return (dir === 1 ? ids[0] : ids[ids.length - 1]) ?? null;
  return ids[i + dir] ?? null;
}
