/** 依赖图（前导图 PDM）：DAG、环检测、派生状态、解锁后续。 */
import { isFinished, type Dependency, type Task } from './types';

import { tr } from './i18n';
export interface Edge {
  pred_id: string;
  succ_id: string;
}

export type DerivedState = '完成' | '关闭' | '可开始' | '被阻塞';

export interface DerivedStatus {
  state: DerivedState;
  /** 还没完成的前置任务 id（仅被阻塞时非空）。 */
  missing: string[];
}

export class CycleError extends Error {
  constructor(readonly path: string[]) {
    super(tr('不能这样连：会绕成一个圈'));
    this.name = 'CycleError';
  }
}

export class SelfLoopError extends Error {
  constructor() {
    super(tr('一件任务不能排在自己前面'));
    this.name = 'SelfLoopError';
  }
}

export class DuplicateEdgeError extends Error {
  constructor() {
    super(tr('这两件任务已经连上了'));
    this.name = 'DuplicateEdgeError';
  }
}

/** 只取未删除的边。 */
export function liveEdges(deps: readonly Dependency[]): Edge[] {
  return deps.filter((d) => !d.deleted).map((d) => ({ pred_id: d.pred_id, succ_id: d.succ_id }));
}

function adjacency(edges: readonly Edge[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const list = adj.get(e.pred_id);
    if (list) list.push(e.succ_id);
    else adj.set(e.pred_id, [e.succ_id]);
  }
  return adj;
}

/** 从 from 出发沿后续方向能否到达 to；能则返回路径。 */
export function findPath(edges: readonly Edge[], from: string, to: string): string[] | null {
  const adj = adjacency(edges);
  const stack: Array<{ node: string; path: string[] }> = [{ node: from, path: [from] }];
  const seen = new Set<string>();
  while (stack.length) {
    const { node, path } = stack.pop()!;
    if (node === to) return path;
    if (seen.has(node)) continue;
    seen.add(node);
    for (const next of adj.get(node) ?? []) if (!seen.has(next)) stack.push({ node: next, path: [...path, next] });
  }
  return null;
}

/**
 * 加 pred → succ 前检查：若 succ 已能到达 pred，再加就成环。
 * 返回成环路径（succ … pred → succ），无环返回 null。
 */
export function wouldCreateCycle(edges: readonly Edge[], pred: string, succ: string): string[] | null {
  if (pred === succ) return [pred, succ];
  const path = findPath(edges, succ, pred);
  return path ? [...path, succ] : null;
}

/** 校验一条新边，不合法时抛错（环 / 自环 / 重复）。 */
export function assertCanAddEdge(edges: readonly Edge[], pred: string, succ: string): void {
  if (pred === succ) throw new SelfLoopError();
  if (edges.some((e) => e.pred_id === pred && e.succ_id === succ)) throw new DuplicateEdgeError();
  const cycle = wouldCreateCycle(edges, pred, succ);
  if (cycle) throw new CycleError(cycle);
}

/** 整张图是否有环（同步合并后两端都要重跑）；返回构成环的边。 */
export function findCycleEdges(edges: readonly Edge[]): Edge[] {
  // 依次加入，后到的成环边记为冲突。
  const accepted: Edge[] = [];
  const conflicts: Edge[] = [];
  for (const e of edges) {
    if (e.pred_id === e.succ_id || wouldCreateCycle(accepted, e.pred_id, e.succ_id)) conflicts.push(e);
    else accepted.push(e);
  }
  return conflicts;
}

/** 拓扑排序（Kahn）；有环时抛 CycleError。 */
export function topoSort(nodeIds: readonly string[], edges: readonly Edge[]): string[] {
  const indeg = new Map<string, number>(nodeIds.map((id) => [id, 0]));
  for (const e of edges) if (indeg.has(e.succ_id) && indeg.has(e.pred_id)) indeg.set(e.succ_id, indeg.get(e.succ_id)! + 1);
  const adj = adjacency(edges);
  const queue = nodeIds.filter((id) => indeg.get(id) === 0);
  const out: string[] = [];
  while (queue.length) {
    const n = queue.shift()!;
    out.push(n);
    for (const s of adj.get(n) ?? []) {
      if (!indeg.has(s)) continue;
      const d = indeg.get(s)! - 1;
      indeg.set(s, d);
      if (d === 0) queue.push(s);
    }
  }
  if (out.length !== nodeIds.length) throw new CycleError(nodeIds.filter((id) => !out.includes(id)));
  return out;
}

export function predecessorsOf(edges: readonly Edge[], id: string): string[] {
  return edges.filter((e) => e.succ_id === id).map((e) => e.pred_id);
}

export function successorsOf(edges: readonly Edge[], id: string): string[] {
  return edges.filter((e) => e.pred_id === id).map((e) => e.succ_id);
}

type TaskLike = Pick<Task, 'id' | 'status' | 'deleted'>;

/** 前置任务“满足”：已结束（完成或关闭）或已删除。关闭的前置同样解锁后续。 */
function satisfied(t: TaskLike | undefined): boolean {
  return !t || t.deleted || isFinished(t.status);
}

/** 派生状态：所有前置都完成 → 可开始；否则 → 被阻塞（列出还差哪些）。 */
export function deriveStatus(task: TaskLike, tasksById: ReadonlyMap<string, TaskLike>, edges: readonly Edge[]): DerivedStatus {
  if (task.status === '完成') return { state: '完成', missing: [] };
  if (task.status === '关闭') return { state: '关闭', missing: [] };
  const missing = predecessorsOf(edges, task.id).filter((p) => !satisfied(tasksById.get(p)));
  return missing.length ? { state: '被阻塞', missing } : { state: '可开始', missing: [] };
}

export function deriveAll(tasks: readonly TaskLike[], edges: readonly Edge[]): Map<string, DerivedStatus> {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const out = new Map<string, DerivedStatus>();
  for (const t of tasks) if (!t.deleted) out.set(t.id, deriveStatus(t, byId, edges));
  return out;
}

/**
 * completedId 结束（完成或关闭）后新解锁的后续：之前被阻塞、之后可开始。
 * tasks 传入结束“之前”的快照。
 */
export function unlockedSuccessors(completedId: string, tasks: readonly TaskLike[], edges: readonly Edge[]): string[] {
  const before = new Map(tasks.map((t) => [t.id, t]));
  const after = new Map(before);
  const done = before.get(completedId);
  if (done) after.set(completedId, { ...done, status: '完成' });
  return successorsOf(edges, completedId).filter((s) => {
    const t = before.get(s);
    if (!t || t.deleted) return false;
    return deriveStatus(t, before, edges).state === '被阻塞' && deriveStatus(t, after, edges).state === '可开始';
  });
}
