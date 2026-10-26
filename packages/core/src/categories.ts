/**
 * 类型（统一的分类，Rei 2026-10-26）：原来的打卡分类（checkin_category）和项目分类（category）合成一套，
 * 存在 category 表里，任务（task.category_id）和项目（group.category_id）都能挂一个。界面上叫「类型」，
 * 原来任务上的「类型」（task_type）界面上改叫「资料库」，代码里还叫 task_type / type_id。
 *
 * 规则：能加、能改名 / 颜色 / 图标、能「不显示」（hidden，选择器里不出现，挂着的照常显示），不能删。
 *
 * 合并（schema v11 + Store 打开时）：
 * - 打卡分类按原 id 拷进 category（内置 27 个 id 不变，各设备一样）；项目分类本来就在 category 里，id 不变。
 * - 名字一样（去首尾空格、不分大小写）的并成一个：留下的那个按 survivorOrder 挑（内置优先，再按 sort、id），
 *   缺的图标 / 颜色从被并的那个补；被并的打墓碑并记 merged_into，任务和项目上指着它的改指留下的。
 * - 挑法只看行本身，两台设备各并一遍结果一样。
 *
 * 同步兼容（旧客户端还在写老形状）：
 * - 拉到 checkin_category 行：按同一个 id 映射成 category 行（categoryFromCheckin）。
 * - 拉到缺新列的 category 行：图标、不显示、顺序从本机那行补（fillCategory）。
 * - 拉到没有 category_id 的任务：用 checkin_category_id。本机写任务时把 category_id 抄进 checkin_category_id，旧客户端也看得到。
 */
import { tr } from './i18n';
import type { Category, CheckInCategory } from './types';

export const DEFAULT_CATEGORY_ICON = 'tag';
export const DEFAULT_CATEGORY_COLOR = '#8e8e93';
/** 老项目分类没有顺序：排在内置 27 个后面。 */
export const LEGACY_CATEGORY_SORT = 1000;

/** 比名字用：去首尾空格、合并中间空白、不分大小写。 */
export function normCategoryName(name: string): string {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** 补齐一行 category 的新列：先用本机已有那行的值，再用默认值。不改 id / updated_at / deleted。 */
export function fillCategory(row: Partial<Category> & { id: string }, cur?: Partial<Category>): Category {
  const r = row as Category;
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
  return {
    ...r,
    name: str(r.name) ?? str(cur?.name) ?? '',
    color: str(r.color) || str(cur?.color) || DEFAULT_CATEGORY_COLOR,
    icon: str(r.icon) ?? str(cur?.icon) ?? '',
    builtin: typeof r.builtin === 'boolean' ? r.builtin : cur?.builtin === true,
    hidden: typeof r.hidden === 'boolean' ? r.hidden : cur?.hidden === true,
    sort: typeof r.sort === 'number' && Number.isFinite(r.sort) ? r.sort : typeof cur?.sort === 'number' ? cur.sort : LEGACY_CATEGORY_SORT,
    merged_into: r.merged_into === undefined ? (cur?.merged_into ?? null) : r.merged_into,
  };
}

/** 旧的打卡分类行 → 同 id 的 category 行（时间戳不变，各设备映射结果一样）。 */
export function categoryFromCheckin(c: CheckInCategory): Category {
  return fillCategory({
    id: c.id,
    updated_at: c.updated_at,
    deleted: c.deleted,
    name: c.name,
    color: c.color,
    icon: c.icon,
    builtin: c.builtin === true,
    hidden: c.hidden === true,
    sort: c.sort,
    merged_into: null,
  });
}

/** 显示用的图标：没有就用默认的 tag。 */
export const categoryIcon = (c: Pick<Category, 'icon'>) => c.icon || DEFAULT_CATEGORY_ICON;

/** 顺着 merged_into 找到留下的那个 id（防环，最多走 32 步）。没合并过就是自己；找不到行返回原 id。 */
export function resolveCategoryId(get: (id: string) => Category | undefined, id: string | null | undefined): string | null {
  if (!id) return null;
  let cur = id;
  const seen = new Set<string>();
  for (let i = 0; i < 32; i++) {
    const row = get(cur);
    const next = row?.merged_into;
    if (!next || seen.has(next)) return cur;
    seen.add(cur);
    cur = next;
  }
  return cur;
}

/** 同名的几个里谁留下：内置优先，再按 sort 小的、id 小的。只看行本身，各设备一致。 */
export function survivorOrder(a: Category, b: Category): number {
  if (a.builtin !== b.builtin) return a.builtin ? -1 : 1;
  if (a.sort !== b.sort) return a.sort - b.sort;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export interface CategoryMerge {
  /** 留下的（已补好图标 / 颜色 / 不显示）。 */
  survivor: Category;
  /** 并进去的（还没打墓碑的原样）。 */
  losers: Category[];
  /** 留下那行有没有改动（补了图标 / 颜色、取消了不显示）。 */
  survivorChanged: boolean;
}

/**
 * 找出同名要合并的组（只看没删的）。纯函数。
 * - 图标：留下的没有就用被并的第一个有的；颜色：留下的是默认灰就用被并的。
 * - 不显示：几个都不显示才不显示（有一个在用就别藏起来）。
 */
export function planCategoryMerges(rows: readonly Category[]): CategoryMerge[] {
  const groups = new Map<string, Category[]>();
  for (const r of rows) {
    if (r.deleted || r.merged_into) continue;
    const key = normCategoryName(r.name);
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }
  const out: CategoryMerge[] = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort(survivorOrder);
    const head = sorted[0]!;
    const losers = sorted.slice(1);
    const icon = head.icon || losers.find((l) => l.icon)?.icon || '';
    const color = head.color && head.color !== DEFAULT_CATEGORY_COLOR ? head.color : losers.find((l) => l.color && l.color !== DEFAULT_CATEGORY_COLOR)?.color || head.color || DEFAULT_CATEGORY_COLOR;
    const hidden = sorted.every((x) => x.hidden);
    const survivor = { ...head, icon, color, hidden };
    out.push({ survivor, losers, survivorChanged: icon !== head.icon || color !== head.color || hidden !== head.hidden });
  }
  return out;
}

/** 名字是不是已经被别的（没删、没并掉的）类型占了。 */
export function categoryNameTaken(rows: readonly Category[], name: string, exceptId?: string): Category | undefined {
  const key = normCategoryName(name);
  if (!key) return undefined;
  return rows.find((r) => !r.deleted && !r.merged_into && r.id !== exceptId && normCategoryName(r.name) === key);
}

/** 按显示顺序排：sort，再按名字、id。 */
export function sortCategories<T extends Pick<Category, 'sort' | 'name' | 'id'>>(rows: T[]): T[] {
  return rows.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'zh') || (a.id < b.id ? -1 : 1));
}

/** 类型不能删（Rei 2026-10-26：「可以添加、不显示、修改、不能删除」）。 */
export class CategoryDeleteError extends Error {
  constructor() {
    super(tr('类型不能删，可以设成不显示'));
    this.name = 'CategoryDeleteError';
  }
}
