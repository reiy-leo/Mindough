/**
 * 多类型与多资料（Rei 2026-10-28，docs/MULTI-TYPE.md）：
 * - 任务 ↔ 类型 多对多：task_category 表（一行一对）。
 * - 任务 ↔ 资料 多对多：task_item 表，资料来自哪个库都行，和类型无关（Rei：「类型是类型，资料库是资料库，是平级的」）。
 * - 人物还是 task_person（本来就是多对多，旧客户端也认）；界面上并进「资料」，算人物库的资料。
 *
 * 行 id 由这一对算出（同 related.ts 的 taskLinkId），两台设备各自挂上同一对得到同一行，按 LWW 合并；
 * 去掉 = 打墓碑，再挂上 = 同一行翻回来。
 *
 * 旧客户端（alpha.8 及以前）只认 task 上的单值 category_id / library_item_id / type_id。新客户端双写：
 * 单值 = 第一个（排序最前的）类型 / 资料 / 资料所在的库，同时写 task.refs_mirror = 单值的签名。
 * 旧客户端的 SQLite 只存认识的列，推上来的任务行没有 refs_mirror（或签名对不上）——这就认出是旧客户端写的，
 * 它的单值要是不在多值里，就补进去当第一个（只加不删，见 legacyRefPlan）。
 */
import type { Hlc, Task } from './types';

/** FNV-1a 32 位（同 related.ts）。 */
function fnv(s: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function pairId(kind: string, a: string, b: string): string {
  const key = `${kind}\u0000${a}\u0000${b}`;
  const hex = [fnv(key), fnv(key, 0x01234567), fnv(key, 0x89abcdef), fnv(key, 0x2468ace0)].map((n) => n.toString(16).padStart(8, '0')).join('');
  return `00000000-${hex.slice(0, 4)}-7${hex.slice(5, 8)}-8${hex.slice(9, 12)}-${hex.slice(12, 24)}`;
}

/** 任务挂类型那一行的 id。 */
export const taskCategoryId = (taskId: string, categoryId: string) => pairId('task_category', taskId, categoryId);
/** 任务挂资料那一行的 id。 */
export const taskItemId = (taskId: string, itemId: string) => pairId('task_item', taskId, itemId);

/** 单值的签名：新客户端写任务时记下，拉到签名对不上的任务就是旧客户端改的。 */
export function refsMirrorOf(t: Pick<Task, 'category_id' | 'library_item_id'>): string {
  return `${t.category_id ?? ''}|${t.library_item_id ?? ''}`;
}

/** 这行任务是不是新客户端写的（单值和签名对得上）。 */
export function isMirrored(t: Pick<Task, 'category_id' | 'library_item_id' | 'refs_mirror'>): boolean {
  return typeof t.refs_mirror === 'string' && t.refs_mirror === refsMirrorOf(t);
}

/** 关联行的公共形状（task_category / task_item）。 */
export interface RefLink {
  id: string;
  updated_at: Hlc;
  deleted: boolean;
  task_id: string;
  sort: number;
}

/** 按 sort、再按 id 排（各端一样）。 */
export function sortLinks<T extends RefLink>(links: readonly T[]): T[] {
  return [...links].sort((a, b) => a.sort - b.sort || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * 旧客户端写的单值要不要补进多值：
 * - 单值是空的：不动（分不清是旧客户端真清掉了，还是它根本没看到新加的）。
 * - 单值已经在生效的关联里：不动。
 * - 有这一对的墓碑、而且墓碑比这行任务新：不动（新客户端后来去掉的，旧客户端这行是旧的）。
 * - 其余：补一行，排在最前，updated_at 用任务这行的（各设备各补一遍结果一样）。
 * 只加不删，所以不会丢。返回要写的关联（还没设 sort 以外的字段的部分由调用方补）。
 */
export function legacyRefPlan(
  task: Pick<Task, 'id' | 'updated_at'>,
  value: string | null,
  resolve: (id: string) => string,
  links: readonly (RefLink & { ref: string })[],
  existing: (RefLink & { ref: string }) | undefined,
): { sort: number } | null {
  if (!value) return null;
  const target = resolve(value);
  if (links.some((l) => !l.deleted && resolve(l.ref) === target)) return null;
  if (existing && existing.updated_at >= task.updated_at) return null;
  const live = links.filter((l) => !l.deleted);
  const min = live.reduce((m, l) => Math.min(m, l.sort), Infinity);
  return { sort: Number.isFinite(min) ? min - 1 : 0 };
}

/**
 * 列表元信息里的类型 / 资料摘要（Rei 2026-10-28：多个时要克制，如「游戏 · 生灵重塑 +2」）：
 * 第一个类型、第一条资料各占一格，其余合成「+N」。
 */
export function refsSummary(categories: readonly string[], items: readonly string[]): { parts: string[]; more: number } {
  const parts: string[] = [];
  if (categories[0]) parts.push(categories[0]);
  if (items[0]) parts.push(items[0]);
  const more = Math.max(0, categories.length - 1) + Math.max(0, items.length - 1);
  return { parts, more };
}
