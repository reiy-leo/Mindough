import { describe, expect, it } from 'vitest';
import { isFinished, normalizeStatus } from '../src/types';
import {
  CycleError,
  DuplicateEdgeError,
  SelfLoopError,
  assertCanAddEdge,
  deriveAll,
  deriveStatus,
  findCycleEdges,
  topoSort,
  unlockedSuccessors,
  wouldCreateCycle,
  type Edge,
} from '../src/dag';
import { mkTask } from './helpers';

const e = (pred_id: string, succ_id: string): Edge => ({ pred_id, succ_id });

describe('环检测', () => {
  const edges = [e('a', 'b'), e('b', 'c'), e('a', 'd')];

  it('无环的边可以加', () => {
    expect(wouldCreateCycle(edges, 'c', 'd')).toBeNull();
    expect(() => assertCanAddEdge(edges, 'd', 'c')).not.toThrow();
  });

  it('成环时返回环路径', () => {
    expect(wouldCreateCycle(edges, 'c', 'a')).toEqual(['a', 'b', 'c', 'a']);
    expect(() => assertCanAddEdge(edges, 'c', 'a')).toThrow(CycleError);
  });

  it('自环与重复边被拒绝', () => {
    expect(() => assertCanAddEdge(edges, 'a', 'a')).toThrow(SelfLoopError);
    expect(() => assertCanAddEdge(edges, 'a', 'b')).toThrow(DuplicateEdgeError);
  });

  it('合并后找出后到的成环边（冲突）', () => {
    expect(findCycleEdges([e('a', 'b'), e('b', 'c'), e('c', 'a'), e('c', 'd')])).toEqual([e('c', 'a')]);
  });

  it('拓扑排序；有环抛错', () => {
    const order = topoSort(['c', 'b', 'a', 'd'], edges);
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'));
    expect(() => topoSort(['a', 'b'], [e('a', 'b'), e('b', 'a')])).toThrow(CycleError);
  });
});

describe('派生状态', () => {
  it('前置都完成 → 可开始，否则被阻塞并列出缺哪些', () => {
    const tasks = [mkTask('a', { status: '完成' }), mkTask('b'), mkTask('c')];
    const edges = [e('a', 'c'), e('b', 'c')];
    const byId = new Map(tasks.map((t) => [t.id, t]));
    expect(deriveStatus(tasks[2]!, byId, edges)).toEqual({ state: '被阻塞', missing: ['b'] });
    expect(deriveStatus(tasks[1]!, byId, edges)).toEqual({ state: '可开始', missing: [] });
    expect(deriveStatus(tasks[0]!, byId, edges).state).toBe('完成');
  });

  it('关闭或已删除的前置不再阻塞；关闭有自己的派生状态', () => {
    const tasks = [mkTask('a', { status: '关闭' }), mkTask('x', { deleted: true }), mkTask('c')];
    const all = deriveAll(tasks, [e('a', 'c'), e('x', 'c')]);
    expect(all.get('c')?.state).toBe('可开始');
    expect(all.has('x')).toBe(false);
    expect(all.get('a')?.state).toBe('关闭');
  });

  it('完成后解锁的后续', () => {
    const tasks = [mkTask('a'), mkTask('b'), mkTask('c'), mkTask('d')];
    // a → c，b → c，a → d
    const edges = [e('a', 'c'), e('b', 'c'), e('a', 'd')];
    expect(unlockedSuccessors('a', tasks, edges)).toEqual(['d']);
    const afterB = tasks.map((t) => (t.id === 'b' ? { ...t, status: '完成' as const } : t));
    expect(unlockedSuccessors('a', afterB, edges).sort()).toEqual(['c', 'd']);
  });
});

describe('状态工具', () => {
  it('isFinished：完成和关闭都算结束；normalizeStatus 把旧的“取消”映射为“关闭”', () => {
    expect(isFinished('完成')).toBe(true);
    expect(isFinished('关闭')).toBe(true);
    expect(isFinished('进行中')).toBe(false);
    expect(normalizeStatus('取消')).toBe('关闭');
    expect(normalizeStatus('进行中')).toBe('进行中');
    expect(normalizeStatus('乱写')).toBe('待办');
  });
});
