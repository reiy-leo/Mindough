/**
 * 内置打卡分类：给周期性（重复）任务用。Rei 2026-10-15 定的顺序：
 * 记录、整理、游戏、玩乐、健康、运动、护肤、清洁、学习、读书。
 *
 * - id 固定（UUIDv7 格式、时间戳 0，第四段 8001 与内置类型区分），各设备一致，同步时自然合并。
 * - 用户可改名、隐藏、新增；内置行 updated_at 最小，用户修改总会胜出。
 * - 以后要加分类：在 SEED 末尾追加一行并给一个没用过的 n（id 由 n 决定，永不复用 / 改号）；
 *   显示顺序由数组位置决定，想插在中间直接放到对应位置即可，id 不受影响。
 */
import type { CheckInCategory } from '../types';

const cid = (n: number) => `00000000-0000-7000-8001-${String(n).padStart(12, '0')}`;

/** [n, key, 名称, lucide 图标, 颜色] */
const SEED = [
  [1, 'record', '记录', 'notebook-pen', '#5e8bff'],
  [2, 'tidy', '整理', 'archive', '#a2845e'],
  [3, 'game', '游戏', 'gamepad-2', '#7d5fff'],
  [4, 'fun', '玩乐', 'party-popper', '#ff6b9a'],
  [5, 'health', '健康', 'heart-pulse', '#ff453a'],
  [6, 'sport', '运动', 'dumbbell', '#ff9f0a'],
  [7, 'skincare', '护肤', 'sparkles', '#e88ad4'],
  [8, 'clean', '清洁', 'spray-can', '#32ade6'],
  [9, 'study', '学习', 'graduation-cap', '#30b0c7'],
  [10, 'reading', '读书', 'book-open', '#34c759'],
] as const;

type SeedKey = (typeof SEED)[number][1];

export const BUILTIN_CHECKIN_CATEGORY_IDS = Object.fromEntries(SEED.map(([n, key]) => [key, cid(n)])) as Record<SeedKey, string>;

export const BUILTIN_CHECKIN_CATEGORIES: CheckInCategory[] = SEED.map(([n, , name, icon, color], i) => ({
  id: cid(n),
  updated_at: '0000000000000-0000-builtin',
  deleted: false,
  name,
  icon,
  color,
  builtin: true,
  hidden: false,
  sort: i + 1,
}));
