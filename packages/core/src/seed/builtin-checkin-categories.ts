/**
 * 内置类型（原内置打卡分类，2026-10-26 起和项目分类合成一套「类型」，见 categories.ts），共 27 个。Rei 2026-10-15 定的顺序：
 * 记录、整理、游戏、玩乐、健康、运动、护肤、清洁、学习、读书、饮食、作息、冥想、服药、理财、
 * 工作、写作、语言、乐器、创作、社交、宠物、植物、采购、个人护理、维护、观影。
 *
 * - id 固定（UUIDv7 格式、时间戳 0，第四段 8001 与内置类型区分），各设备一致，同步时自然合并。
 * - 用户可改名、隐藏、新增；内置行 updated_at 最小，用户修改总会胜出。
 * - 以后要加分类：在 SEED 末尾追加一行并给一个没用过的 n（id 由 n 决定，永不复用 / 改号）；
 *   显示顺序由数组位置决定，想插在中间直接放到对应位置即可，id 不受影响。
 */
import type { Category } from '../types';

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
  [11, 'diet', '饮食', 'utensils', '#ff7a45'], // 喝水、做饭
  [12, 'sleep', '作息', 'alarm-clock', '#5856d6'], // 早睡早起
  [13, 'meditation', '冥想', 'flower-2', '#af52de'],
  [14, 'medicine', '服药', 'pill', '#ff3b6b'], // 补剂
  [15, 'finance', '理财', 'wallet', '#c69c2b'], // 记账、还款
  [16, 'work', '工作', 'briefcase', '#636e7b'], // 周报、复盘
  [17, 'writing', '写作', 'pen-line', '#3a7bd5'],
  [18, 'language', '语言', 'languages', '#0fa3b1'],
  [19, 'instrument', '乐器', 'guitar', '#d4813d'],
  [20, 'create', '创作', 'palette', '#e0569b'], // 画画、摄影
  [21, 'social', '社交', 'users', '#ff8a5c'], // 联系家人朋友
  [22, 'pet', '宠物', 'paw-print', '#b07d4f'],
  [23, 'plant', '植物', 'sprout', '#4caf50'], // 浇水
  [24, 'shopping', '采购', 'shopping-cart', '#f5a623'], // 补日用品
  [25, 'personal-care', '个人护理', 'scissors', '#9c6ade'], // 剪发、剪指甲
  [26, 'maintenance', '维护', 'wrench', '#7a8a99'], // 备份、换滤芯、保养
  [27, 'watch', '观影', 'tv', '#e5484d'], // 追剧
] as const;

type SeedKey = (typeof SEED)[number][1];

export const BUILTIN_CATEGORY_IDS = Object.fromEntries(SEED.map(([n, key]) => [key, cid(n)])) as Record<SeedKey, string>;
/** 旧名字（打卡分类时代），同一份 id。 */
export const BUILTIN_CHECKIN_CATEGORY_IDS = BUILTIN_CATEGORY_IDS;

export const BUILTIN_CATEGORIES: Category[] = SEED.map(([n, , name, icon, color], i) => ({
  id: cid(n),
  updated_at: '0000000000000-0000-builtin',
  deleted: false,
  name,
  icon,
  color,
  builtin: true,
  hidden: false,
  sort: i + 1,
  merged_into: null,
}));
/** 旧名字（打卡分类时代）。 */
export const BUILTIN_CHECKIN_CATEGORIES = BUILTIN_CATEGORIES;

/**
 * 内置类型的默认大类（docs/CATEGORY-EDITOR.md 方案 C，Rei 2026-10-28 按默认）。组 id 见 category-prefs.ts 的 CATEGORY_GROUPS。
 * 用户改过的存同步偏好 category.groups，不改这里。
 */
const GROUP_OF: Record<SeedKey, 'body' | 'life' | 'study' | 'hobby' | 'people'> = {
  health: 'body', sport: 'body', sleep: 'body', meditation: 'body', medicine: 'body', skincare: 'body', 'personal-care': 'body', diet: 'body',
  tidy: 'life', clean: 'life', shopping: 'life', maintenance: 'life', plant: 'life', pet: 'life', finance: 'life',
  study: 'study', reading: 'study', writing: 'study', language: 'study', work: 'study', record: 'study',
  game: 'hobby', fun: 'hobby', watch: 'hobby', instrument: 'hobby', create: 'hobby',
  social: 'people',
};
/** 内置类型 id → 默认大类。 */
export const BUILTIN_CATEGORY_GROUPS: Record<string, 'body' | 'life' | 'study' | 'hobby' | 'people'> = Object.fromEntries(
  SEED.map(([n, key]) => [cid(n), GROUP_OF[key]]),
);

/** 还没用过几个分类时，「常用」先放这几个（按日常最常见的打卡）。 */
export const DEFAULT_FREQUENT_CHECKIN_CATEGORY_KEYS: readonly SeedKey[] = ['health', 'sport', 'study', 'reading', 'diet', 'sleep'];

/**
 * 「常用」分类：先按用到它的重复任务件数（多的在前，件数一样按最近一次用到），再用默认几个补齐到 n 个。
 * 只返回 visible 里的（隐藏的不算常用）。纯函数，界面经 Store.frequentCheckInCategories 调用。
 */
export function pickFrequentCategories<C extends { id: string }>(
  visible: readonly C[],
  usage: readonly { categoryId: string | null; at: string }[],
  n = 6,
): C[] {
  const byId = new Map(visible.map((c) => [c.id, c]));
  const stat = new Map<string, { count: number; last: string }>();
  for (const u of usage) {
    if (!u.categoryId || !byId.has(u.categoryId)) continue;
    const s = stat.get(u.categoryId) ?? { count: 0, last: '' };
    s.count++;
    if (u.at > s.last) s.last = u.at;
    stat.set(u.categoryId, s);
  }
  const used = [...stat.entries()]
    .sort((a, b) => b[1].count - a[1].count || (a[1].last < b[1].last ? 1 : a[1].last > b[1].last ? -1 : 0))
    .map(([id]) => byId.get(id)!);
  const out = used.slice(0, n);
  for (const key of DEFAULT_FREQUENT_CHECKIN_CATEGORY_KEYS) {
    if (out.length >= n) break;
    const c = byId.get(BUILTIN_CATEGORY_IDS[key]);
    if (c && !out.includes(c)) out.push(c);
  }
  for (const c of visible) {
    if (out.length >= n) break;
    if (!out.includes(c)) out.push(c);
  }
  return out;
}
