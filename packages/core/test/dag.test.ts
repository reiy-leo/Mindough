import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../src/i18n';
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
  taskChain,
  chainStepWhen,
  chainWhenLabel,
  taskPlannedDate,
  type ChainWhenTask,
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

describe('任务链 taskChain', () => {
  it('一条直线：上游的上游、下游的下游都取到，按层排，当前任务在中间', () => {
    const c = taskChain('c', [e('a', 'b'), e('b', 'c'), e('c', 'd'), e('d', 'f')]);
    expect(c.layers).toEqual([['a'], ['b'], ['c'], ['d'], ['f']]);
    expect(c.currentLayer).toBe(2);
    expect(c.ancestors).toEqual(['a', 'b']);
    expect(c.descendants).toEqual(['d', 'f']);
    expect(c.ids).toEqual(['a', 'b', 'c', 'd', 'f']);
  });

  it('只有一层前后时，结果就是直接的前后任务', () => {
    const c = taskChain('b', [e('a', 'b'), e('b', 'c'), e('x', 'y')]);
    expect(c.ids).toEqual(['a', 'b', 'c']);
    expect(c.edges).toEqual([e('a', 'b'), e('b', 'c')]);
  });

  it('分叉：上游分出去、和当前任务无关的兄弟不算；下游分叉同层并排', () => {
    const c = taskChain('b', [e('a', 'b'), e('a', 'sib'), e('b', 'c1'), e('b', 'c2'), e('c1', 'd')]);
    expect(c.ids).not.toContain('sib');
    expect(c.layers).toEqual([['a'], ['b'], ['c1', 'c2'], ['d']]);
  });

  it('汇合：几件都做完才能开始的，全部上游都在', () => {
    const c = taskChain('m', [e('p1', 'm'), e('p2', 'm'), e('q', 'p2'), e('m', 'z')]);
    expect(new Set(c.ancestors)).toEqual(new Set(['p1', 'p2', 'q']));
    // p1 没有前置排第 0 层；p2 在 q 之后排第 1 层；m 排在最晚的那条之后
    expect(c.layers).toEqual([['p1', 'q'], ['p2'], ['m'], ['z']]);
    expect(c.currentLayer).toBe(2);
  });

  it('菱形：分出去再合回来，汇合点只出现一次、排在两条路之后', () => {
    const c = taskChain('a', [e('a', 'b'), e('a', 'c'), e('b', 'd'), e('c', 'x'), e('x', 'd')]);
    expect(c.layers).toEqual([['a'], ['b', 'c'], ['x'], ['d']]);
    expect(c.ids.filter((n) => n === 'd')).toHaveLength(1);
    expect(c.currentLayer).toBe(0);
  });

  it('孤立任务：只有自己一层', () => {
    const c = taskChain('solo', [e('a', 'b')]);
    expect(c.layers).toEqual([['solo']]);
    expect(c.ids).toEqual(['solo']);
    expect(c.currentLayer).toBe(0);
    expect(c.edges).toEqual([]);
  });

  it('已删除的边不走；已删除的任务不经过', () => {
    const deps = [
      { pred_id: 'a', succ_id: 'b', deleted: true },
      { pred_id: 'b', succ_id: 'c' },
      { pred_id: 'c', succ_id: 'gone' },
      { pred_id: 'gone', succ_id: 'after' },
    ];
    const tasks = ['a', 'b', 'c', 'after'].map((id) => mkTask(id)).concat(mkTask('gone', { deleted: true }));
    const c = taskChain('c', deps, tasks);
    expect(c.ids).toEqual(['b', 'c']);
    expect(taskChain('gone', deps, tasks).ids).toEqual([]);
  });

  it('重复的边只算一次；有环也不会卡住', () => {
    expect(taskChain('b', [e('a', 'b'), e('a', 'b')]).edges).toHaveLength(1);
    const c = taskChain('a', [e('a', 'b'), e('b', 'a')]);
    expect(new Set(c.ids)).toEqual(new Set(['a', 'b']));
  });
});

describe('任务链每一步的相对时间（chainStepWhen / chainWhenLabel）', () => {
  const T = '2026-10-23';
  const local = (ts: string) => ts.slice(0, 10);
  const mk = (id: string, extra: Partial<ChainWhenTask> = {}): ChainWhenTask => ({ id, status: '待办', scheduled_date: null, target_date: null, completion_mode: 'once', done_at: null, ...extra });
  const label = (tasks: ChainWhenTask[], myDay?: Map<string, string[]>) => chainWhenLabel(chainStepWhen(tasks, T, { toLocalDate: local, ...(myDay ? { myDay } : {}) }), T);
  afterEach(() => setLocale('zh'));

  it('计划日期：倒数日用目标日 > 日期 > 最晚的我的一天', () => {
    expect(taskPlannedDate(mk('a', { completion_mode: 'countdown', target_date: '2026-11-01', scheduled_date: '2026-10-25' }))).toBe('2026-11-01');
    expect(taskPlannedDate(mk('a', { target_date: '2026-11-01', scheduled_date: '2026-10-25' }))).toBe('2026-10-25');
    expect(taskPlannedDate(mk('a'), ['2026-10-20', '2026-10-22', '2026-10-21'])).toBe('2026-10-22');
    expect(taskPlannedDate(mk('a'))).toBeNull();
  });

  it('都结束了：用最晚的完成时间', () => {
    expect(chainStepWhen([mk('a', { status: '完成', done_at: '2026-10-20T10:00:00Z' }), mk('b', { status: '关闭', done_at: '2026-10-22T10:00:00Z' })], T, { toLocalDate: local })).toEqual({ kind: 'done', date: '2026-10-22', days: 1 });
    expect(label([mk('a', { status: '完成', done_at: '2026-10-23T01:00:00Z' })])).toEqual({ text: '今天完成', tone: 'done' });
    expect(label([mk('a', { status: '完成', done_at: '2026-10-22T01:00:00Z' })]).text).toBe('昨天完成');
    expect(label([mk('a', { status: '完成', done_at: '2026-10-20T01:00:00Z' })]).text).toBe('3 天前完成');
    expect(label([mk('a', { status: '完成', done_at: '2026-09-23T01:00:00Z' })]).text).toBe('30 天前完成');
    expect(label([mk('a', { status: '完成', done_at: '2026-09-01T01:00:00Z' })]).text).toBe('9月1日完成');
    expect(label([mk('a', { status: '完成', done_at: '2025-12-01T01:00:00Z' })]).text).toBe('2025年12月1日完成');
    expect(label([mk('a', { status: '关闭' })])).toEqual({ text: '已完成', tone: 'done' });
  });

  it('没结束：只看没结束的几件，取最早的计划日期', () => {
    const step = [mk('a', { status: '完成', done_at: '2026-10-01T00:00:00Z', scheduled_date: '2026-10-01' }), mk('b', { scheduled_date: '2026-10-28' }), mk('c', { scheduled_date: '2026-10-25' }), mk('d')];
    expect(chainStepWhen(step, T)).toEqual({ kind: 'planned', date: '2026-10-25', days: 2 });
    expect(label([mk('a', { scheduled_date: T })])).toEqual({ text: '今天', tone: 'today' });
    expect(label([mk('a', { scheduled_date: '2026-10-24' })])).toEqual({ text: '明天', tone: 'upcoming' });
    expect(label([mk('a', { scheduled_date: '2026-10-28' })])).toEqual({ text: '5 天后', tone: 'upcoming' });
    expect(label([mk('a', { scheduled_date: '2026-11-30' })])).toEqual({ text: '11月30日', tone: 'upcoming' });
    expect(label([mk('a', { scheduled_date: '2026-10-21' })])).toEqual({ text: '已过 2 天', tone: 'overdue' });
    expect(label([mk('a', { scheduled_date: '2026-10-22' })])).toEqual({ text: '已过 1 天', tone: 'overdue' });
    expect(label([mk('a', { scheduled_date: '2026-08-01' })])).toEqual({ text: '8月1日', tone: 'overdue' });
    expect(label([mk('a', { scheduled_date: '2027-01-05' })]).text).toBe('2027年1月5日');
    expect(label([mk('a')], new Map([['a', ['2026-10-23']]]))).toEqual({ text: '今天', tone: 'today' });
  });

  it('都没日期：未定时间；删掉的不算', () => {
    expect(label([mk('a'), mk('b')])).toEqual({ text: '未定时间', tone: 'none' });
    expect(label([mk('a'), mk('b', { scheduled_date: T, deleted: true })]).text).toBe('未定时间');
    expect(chainStepWhen([], T)).toEqual({ kind: 'none' });
  });

  it('英文', () => {
    setLocale('en');
    expect(label([mk('a', { status: '完成', done_at: '2026-10-23T01:00:00Z' })]).text).toBe('Done Today');
    expect(label([mk('a', { status: '完成', done_at: '2026-10-22T01:00:00Z' })]).text).toBe('Done Yesterday');
    expect(label([mk('a', { status: '完成', done_at: '2026-10-20T01:00:00Z' })]).text).toBe('Done 3 Days Ago');
    expect(label([mk('a', { status: '完成', done_at: '2026-09-01T01:00:00Z' })]).text).toBe('Done Sep 1');
    expect(label([mk('a', { scheduled_date: T })]).text).toBe('Today');
    expect(label([mk('a', { scheduled_date: '2026-10-24' })]).text).toBe('Tomorrow');
    expect(label([mk('a', { scheduled_date: '2026-10-28' })]).text).toBe('In 5 Days');
    expect(label([mk('a', { scheduled_date: '2026-10-22' })]).text).toBe('1 Day Overdue');
    expect(label([mk('a', { scheduled_date: '2026-11-30' })]).text).toBe('Nov 30');
    expect(label([mk('a')]).text).toBe('No Date');
  });
});
