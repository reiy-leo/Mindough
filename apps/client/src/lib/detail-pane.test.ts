import { describe, expect, it } from 'vitest';
import { clampDetailWidth, DETAIL_W_DEFAULT, DETAIL_W_MAX, DETAIL_W_MIN, loadDetailWidth, nextTaskId } from './detail-pane';
import { hashWithTask, parseHash, taskInHash } from './router';

describe('三列布局：选中的任务写在 hash 上', () => {
  it('读 ?task=', () => {
    expect(taskInHash('#/agenda?task=t1')).toBe('t1');
    expect(taskInHash('#/groups/g1?task=t2')).toBe('t2');
    expect(taskInHash('#/agenda')).toBeNull();
    expect(taskInHash('')).toBeNull();
    expect(taskInHash('#/agenda?task=')).toBeNull();
  });
  it('换上 / 去掉，路径和别的参数不变', () => {
    expect(hashWithTask('#/agenda', 't1')).toBe('#/agenda?task=t1');
    expect(hashWithTask('#/agenda?task=t1', 't2')).toBe('#/agenda?task=t2');
    expect(hashWithTask('#/agenda?task=t1', null)).toBe('#/agenda');
    expect(hashWithTask('#/library/movie/i1?x=1&task=t1', null)).toBe('#/library/movie/i1?x=1');
    expect(hashWithTask('', 't1')).toBe('#/myday?task=t1');
  });
  it('?task= 不影响路由', () => {
    expect(parseHash('#/agenda?task=t1')).toEqual({ page: 'agenda' });
    expect(parseHash('#/groups/g1?task=t1')).toEqual({ page: 'group', id: 'g1' });
    expect(parseHash('#/library/movie/i1?task=t1')).toEqual({ page: 'libitem', typeId: 'movie', id: 'i1' });
    expect(parseHash('#/journal/2026-10-23?task=t1')).toEqual({ page: 'journal', date: '2026-10-23' });
  });
});

describe('右列宽度', () => {
  it('收进最小 / 最大，最大还要给列表留地方', () => {
    expect(clampDetailWidth(100, 1440)).toBe(DETAIL_W_MIN);
    expect(clampDetailWidth(5000, 1920)).toBe(DETAIL_W_MAX);
    // 1200 宽：1200 - 248 侧边栏 - 360 列表 = 592
    expect(clampDetailWidth(5000, 1200)).toBe(592);
    // 中等宽度用图标栏：960 - 64 - 360 = 536
    expect(clampDetailWidth(5000, 960)).toBe(536);
    // 太窄时至少还是最小值
    expect(clampDetailWidth(5000, 700)).toBe(DETAIL_W_MIN);
  });
  it('本机记的读不出来用默认', () => {
    expect(loadDetailWidth(null, 1440)).toBe(DETAIL_W_DEFAULT);
    expect(loadDetailWidth('abc', 1440)).toBe(DETAIL_W_DEFAULT);
    expect(loadDetailWidth('520', 1440)).toBe(520);
    expect(loadDetailWidth('900', 1200)).toBe(592);
  });
});

describe('↑ ↓ 换选中的任务', () => {
  const ids = ['a', 'b', 'c'];
  it('没选中：↓ 第一件、↑ 最后一件', () => {
    expect(nextTaskId(ids, null, 1)).toBe('a');
    expect(nextTaskId(ids, null, -1)).toBe('c');
    expect(nextTaskId(ids, 'x', 1)).toBe('a');
  });
  it('上一件 / 下一件，到头不动', () => {
    expect(nextTaskId(ids, 'a', 1)).toBe('b');
    expect(nextTaskId(ids, 'b', -1)).toBe('a');
    expect(nextTaskId(ids, 'c', 1)).toBeNull();
    expect(nextTaskId(ids, 'a', -1)).toBeNull();
    expect(nextTaskId([], null, 1)).toBeNull();
  });
});
