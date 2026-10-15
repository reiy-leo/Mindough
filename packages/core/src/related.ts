/**
 * 相关任务（task_link）：两件任务只是有关系，没有先后。
 * 和前后关系（FS 依赖，dag.ts）完全分开：不解锁、不进环检测、不影响「可开始 / 还不能开始」。
 *
 * 去重靠规范顺序（a < b）+ 由这一对算出的确定 id：同一对只会有一行。
 * 两件任务已经有前后关系时，前后关系优先：不让再连「相关」，已有的相关在列表和关系图里先不显示
 * （行不删；以后去掉前后关系，它又会出现）。
 */
import type { Edge } from './dag';
import type { TaskLink } from './types';

export class SelfLinkError extends Error {
  constructor() {
    super('不能和自己相关');
    this.name = 'SelfLinkError';
  }
}

export class LinkedByDependencyError extends Error {
  constructor() {
    super('这两件事已经有前后关系了');
    this.name = 'LinkedByDependencyError';
  }
}

/** 规范顺序：小的在前。 */
export function canonicalPair(x: string, y: string): [string, string] {
  return x < y ? [x, y] : [y, x];
}

/** FNV-1a 32 位。 */
function fnv(s: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * 一对任务的相关行 id：与顺序无关，UUID 形状（版本位 7、时间戳段为 0，和迁移出来的资料同一种写法）。
 * 两台设备各自把同一对连上，得到同一行，同步时按 LWW 合并，不会出现两条。
 */
export function taskLinkId(x: string, y: string): string {
  const [a, b] = canonicalPair(x, y);
  const key = `task_link\u0000${a}\u0000${b}`;
  const hex = [fnv(key), fnv(key, 0x01234567), fnv(key, 0x89abcdef), fnv(key, 0x2468ace0)].map((n) => n.toString(16).padStart(8, '0')).join('');
  return `00000000-${hex.slice(0, 4)}-7${hex.slice(5, 8)}-8${hex.slice(9, 12)}-${hex.slice(12, 24)}`;
}

/** 两件任务之间有没有前后关系（任一方向）。 */
export function hasDependencyBetween(edges: readonly Edge[], x: string, y: string): boolean {
  return edges.some((e) => (e.pred_id === x && e.succ_id === y) || (e.pred_id === y && e.succ_id === x));
}

/** 只取未删除、且两端没有前后关系的相关行（前后关系优先，不重复显示）。 */
export function visibleLinks(links: readonly TaskLink[], edges: readonly Edge[]): TaskLink[] {
  const dep = new Set<string>();
  for (const e of edges) dep.add(canonicalPair(e.pred_id, e.succ_id).join('|'));
  return links.filter((l) => !l.deleted && l.a_task_id !== l.b_task_id && !dep.has(canonicalPair(l.a_task_id, l.b_task_id).join('|')));
}

/** 和 taskId 相关的另一端 id（按连上的先后）。 */
export function relatedIdsOf(links: readonly TaskLink[], taskId: string): string[] {
  return [...links]
    .filter((l) => l.a_task_id === taskId || l.b_task_id === taskId)
    .sort((p, q) => (p.created_at < q.created_at ? -1 : p.created_at > q.created_at ? 1 : 0))
    .map((l) => (l.a_task_id === taskId ? l.b_task_id : l.a_task_id));
}

/** 偏好行的 id：由 key 算出（UUID 形状），各设备同一个 key 得到同一行。 */
export function prefId(key: string): string {
  const k = `pref\u0000${key}`;
  const hex = [fnv(k), fnv(k, 0x01234567), fnv(k, 0x89abcdef), fnv(k, 0x2468ace0)].map((n) => n.toString(16).padStart(8, '0')).join('');
  return `00000000-${hex.slice(0, 4)}-7${hex.slice(5, 8)}-8${hex.slice(9, 12)}-${hex.slice(12, 24)}`;
}
