import { describe, expect, it } from 'vitest';
import { boardColumns, normalizePrefs, sortTasks, taskDue, taskSpan, taskStart, timelineLayout } from './project-view';

type T = Parameters<typeof sortTasks>[0][number] & { status: '待办' | '进行中' | '完成' | '关闭' };
let n = 0;
const t = (o: Partial<T> = {}): T => ({
  id: `t${++n}`,
  sort: n,
  created_at: `2026-10-0${n % 9 || 1}T00:00:00Z`,
  updated_at: `000001${n}-0000-dev`,
  scheduled_date: null,
  target_date: null,
  completion_mode: 'once',
  status: '待办',
  ...o,
});

describe('项目页视图设置 normalizePrefs', () => {
  it('没存过：列表、默认顺序、周', () => {
    expect(normalizePrefs(undefined)).toEqual({ view: 'list', sort: 'default', dir: 'asc', scale: 'week' });
  });
  it('以前的关系图、卡片回落成列表；认不出的字段回落默认', () => {
    expect(normalizePrefs({ view: 'graph' }).view).toBe('list');
    expect(normalizePrefs({ view: 'cards' }).view).toBe('list');
    expect(normalizePrefs({ view: 'chain', sort: 'due', dir: 'desc', scale: 'month' })).toEqual({ view: 'chain', sort: 'due', dir: 'desc', scale: 'month' });
    expect(normalizePrefs({ sort: 'x', dir: 'up', scale: 'year' })).toEqual({ view: 'list', sort: 'default', dir: 'asc', scale: 'week' });
  });
});

describe('开始 / 到期字段', () => {
  it('开始 = scheduled_date；到期：倒数日取目标日，其他取 scheduled_date', () => {
    const a = t({ scheduled_date: '2026-10-20' });
    expect(taskStart(a)).toBe('2026-10-20');
    expect(taskDue(a)).toBe('2026-10-20');
    const c = t({ completion_mode: 'countdown', scheduled_date: '2026-10-01', target_date: '2026-12-01' });
    expect(taskStart(c)).toBe('2026-10-01');
    expect(taskDue(c)).toBe('2026-12-01');
    expect(taskDue(t({ completion_mode: 'countdown', target_date: '2026-12-01' }))).toBe('2026-12-01');
    expect(taskStart(t({ completion_mode: 'countdown', target_date: '2026-12-01' }))).toBeNull();
  });
});

describe('日期段（Rei 2026-10-26）', () => {
  it('到期取结束日；开始还是 scheduled_date；倒数日仍取目标日', () => {
    const a = t({ scheduled_date: '2026-10-26', end_date: '2026-10-30' });
    expect(taskStart(a)).toBe('2026-10-26');
    expect(taskDue(a)).toBe('2026-10-30');
    expect(taskDue(t({ scheduled_date: '2026-10-26', end_date: '2026-10-26' }))).toBe('2026-10-26');
    expect(taskDue(t({ completion_mode: 'countdown', scheduled_date: '2026-10-26', end_date: '2026-10-30', target_date: '2026-12-01' }))).toBe('2026-12-01');
  });
  it('排序：开始按 scheduled_date，到期按结束日（没有就 scheduled_date）', () => {
    const long = t({ scheduled_date: '2026-10-20', end_date: '2026-11-10' });
    const mid = t({ scheduled_date: '2026-10-25' });
    const short = t({ scheduled_date: '2026-10-22', end_date: '2026-10-24' });
    expect(sortTasks([long, mid, short], 'start', 'asc').map((x) => x.id)).toEqual([long.id, short.id, mid.id]);
    expect(sortTasks([long, mid, short], 'due', 'asc').map((x) => x.id)).toEqual([short.id, mid.id, long.id]);
  });
  it('时间轴：开始 → 结束画一条', () => {
    expect(taskSpan(t({ scheduled_date: '2026-10-26', end_date: '2026-10-30' }))).toEqual({ start: '2026-10-26', end: '2026-10-30' });
    const lay = timelineLayout([t({ id: 'r', scheduled_date: '2026-10-26', end_date: '2026-10-30' })], '2026-10-26', 'day', { weekStartsOn: 1 });
    expect(lay.bars[0]!.width).toBe(5 * 44);
  });
});

describe('排序 sortTasks', () => {
  const a = t({ id: 'a', sort: 3, created_at: '2026-10-03T00:00:00Z', updated_at: '0000000100-0000-x', scheduled_date: '2026-10-10' });
  const b = t({ id: 'b', sort: 1, created_at: '2026-10-01T00:00:00Z', updated_at: '0000000300-0000-x', scheduled_date: null });
  const c = t({ id: 'c', sort: 2, created_at: '2026-10-02T00:00:00Z', updated_at: '0000000200-0000-x', scheduled_date: '2026-10-05' });
  const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
  it('默认：sort 字段（原来的顺序），dir 不起作用', () => {
    expect(ids(sortTasks([a, b, c], 'default', 'asc'))).toEqual(['b', 'c', 'a']);
    expect(ids(sortTasks([a, b, c], 'default', 'desc'))).toEqual(['b', 'c', 'a']);
  });
  it('创建 / 修改时间正序倒序', () => {
    expect(ids(sortTasks([a, b, c], 'created', 'asc'))).toEqual(['b', 'c', 'a']);
    expect(ids(sortTasks([a, b, c], 'created', 'desc'))).toEqual(['a', 'c', 'b']);
    expect(ids(sortTasks([a, b, c], 'updated', 'desc'))).toEqual(['b', 'c', 'a']);
  });
  it('没有日期的不论正序倒序都在最后', () => {
    expect(ids(sortTasks([a, b, c], 'start', 'asc'))).toEqual(['c', 'a', 'b']);
    expect(ids(sortTasks([a, b, c], 'start', 'desc'))).toEqual(['a', 'c', 'b']);
    expect(ids(sortTasks([a, b, c], 'due', 'desc'))).toEqual(['a', 'c', 'b']);
  });
  it('不改原数组', () => {
    const arr = [a, b, c];
    sortTasks(arr, 'start', 'asc');
    expect(ids(arr)).toEqual(['a', 'b', 'c']);
  });
});

describe('看板分列 boardColumns', () => {
  it('按状态分四列，列内保持传入顺序', () => {
    const xs = [t({ id: 'x1', status: '完成' }), t({ id: 'x2' }), t({ id: 'x3', status: '进行中' }), t({ id: 'x4' }), t({ id: 'x5', status: '关闭' })];
    const cols = boardColumns(xs);
    expect(cols.map((c) => c.status)).toEqual(['待办', '进行中', '完成', '关闭']);
    expect(cols.map((c) => c.tasks.map((x) => x.id))).toEqual([['x2', 'x4'], ['x3'], ['x1'], ['x5']]);
  });
});

describe('时间轴 timelineLayout', () => {
  it('区间：只有一个日期画一天；倒数日从开始画到目标日；开始晚于到期时对调', () => {
    expect(taskSpan(t({ scheduled_date: '2026-10-20' }))).toEqual({ start: '2026-10-20', end: '2026-10-20' });
    expect(taskSpan(t({ completion_mode: 'countdown', scheduled_date: '2026-10-20', target_date: '2026-10-25' }))).toEqual({ start: '2026-10-20', end: '2026-10-25' });
    expect(taskSpan(t({ completion_mode: 'countdown', scheduled_date: '2026-10-30', target_date: '2026-10-25' }))).toEqual({ start: '2026-10-25', end: '2026-10-30' });
    expect(taskSpan(t())).toBeNull();
  });
  it('周视图：从周一开始，横条位置和宽度按天算；没日期的进 undated；有今天线', () => {
    const x = t({ id: 'x', scheduled_date: '2026-10-28' });
    const y = t({ id: 'y', completion_mode: 'countdown', scheduled_date: '2026-10-27', target_date: '2026-10-30' });
    const z = t({ id: 'z' });
    const l = timelineLayout([x, y, z], '2026-10-26', 'week', { weekStartsOn: 1 });
    // 今天 10-26 周一，往前一周 10-19 周一
    expect(l.from).toBe('2026-10-19');
    expect(l.dayWidth).toBe(18);
    expect(l.bars.map((b) => [b.id, b.left, b.width, b.row])).toEqual([
      ['x', 9 * 18, 18, 0],
      ['y', 8 * 18, 4 * 18, 1],
    ]);
    expect(l.undated).toEqual(['z']);
    expect(l.todayLeft).toBe(7 * 18 + 9);
    expect(l.days).toBeGreaterThanOrEqual(42);
    expect(l.ticks.every((tk) => new Date(`${tk.date}T00:00:00Z`).getUTCDay() === 1)).toBe(true);
  });
  it('月视图对齐到月初、月底；日视图每天一格', () => {
    const l = timelineLayout([t({ scheduled_date: '2026-12-15' })], '2026-10-26', 'month');
    expect(l.from).toBe('2026-10-01');
    expect(l.to.endsWith('-31') || l.to.endsWith('-30') || l.to.endsWith('-28') || l.to.endsWith('-29')).toBe(true);
    expect(l.ticks.every((tk) => tk.date.endsWith('-01'))).toBe(true);
    const d = timelineLayout([], '2026-10-26', 'day', { weekStartsOn: 1 });
    expect(d.ticks).toHaveLength(d.days);
    expect(d.bars).toEqual([]);
  });
});
