import { describe, expect, it } from 'vitest';
import { buildRatioIndex, computeProgress, foldTimer, formatDuration, metPeriods, progressOn, taskStreak, dueToday } from '../src/checkin';
import { formatRecurrence } from '../src/recurrence';
import { ci, local, mkTask } from './helpers';

const H = 3600_000;

describe('计时：由事件折叠', () => {
  const t0 = local(2026, 10, 15, 8);
  const at = (h: number) => new Date(t0.getTime() + h * H);

  it('开始 → 暂停 → 继续 → 结束', () => {
    const evs = [ci('t', 'once', 'start', at(0)), ci('t', 'once', 'pause', at(2)), ci('t', 'once', 'resume', at(3)), ci('t', 'once', 'stop', at(5))];
    expect(foldTimer(evs, at(10).getTime())).toMatchObject({ elapsed: 4 * H, running: false, stopped: true });
  });

  it('正在计时：已用时间算到现在', () => {
    const f = foldTimer([ci('t', 'once', 'start', at(0))], at(1.5).getTime());
    expect(f).toMatchObject({ elapsed: 1.5 * H, running: true, runningSince: t0.getTime() });
  });

  it('暂停中不走时；事件乱序到达也一样', () => {
    const evs = [ci('t', 'once', 'pause', at(1)), ci('t', 'once', 'start', at(0))];
    expect(foldTimer(evs, at(9).getTime())).toMatchObject({ elapsed: 1 * H, running: false, paused: true });
  });

  it('目标时长：结束时满足才算完成', () => {
    const task = mkTask('t', { completion_mode: 'timer', target_value: 16 * H });
    const short = [ci('t', 'once', 'start', at(0)), ci('t', 'once', 'stop', at(10))];
    const p = computeProgress(task, short, at(11));
    expect(p.met).toBe(false);
    expect(p.ratio).toBeCloseTo(10 / 16);
    const running = computeProgress(task, [ci('t', 'once', 'start', at(0))], at(17));
    expect(running.met).toBe(false); // 到点但还没点“结束”
    expect(running.ratio).toBe(1);
    const ok = computeProgress(task, [...short.slice(0, 1), ci('t', 'once', 'stop', at(16.5))], at(17));
    expect(ok.met).toBe(true);
  });

  it('删除（墓碑）的事件不计', () => {
    const e = ci('t', 'once', 'start', at(0));
    e.deleted = true;
    expect(foldTimer([e], at(3).getTime()).elapsed).toBe(0);
  });
});

describe('计量 / 点一下 / 倒数日', () => {
  const now = local(2026, 10, 15, 12);

  it('计量：两台设备各 +1 都算上', () => {
    const task = mkTask('w', { completion_mode: 'count', target_value: 8 });
    const evs = [ci('w', 'p', 'add', now, 3), ci('w', 'p', 'add', now, 1), ci('w', 'p', 'add', now, 1)];
    expect(computeProgress(task, evs, now)).toMatchObject({ value: 5, target: 8, met: false });
    expect(computeProgress(task, [...evs, ci('w', 'p', 'add', now, 3)], now).met).toBe(true);
  });

  it('点一下', () => {
    const task = mkTask('o');
    expect(computeProgress(task, [], now).met).toBe(false);
    expect(computeProgress(task, [ci('o', 'once', 'add', now, 1)], now).met).toBe(true);
  });

  it('倒数日：剩余天数、过期为负、到那天自动完成', () => {
    const task = mkTask('c', { completion_mode: 'countdown', target_date: '2026-10-20' });
    expect(computeProgress(task, [], now)).toMatchObject({ value: 5, met: false });
    expect(computeProgress(task, [], local(2026, 10, 20, 0, 5)).met).toBe(true);
    expect(computeProgress(task, [], local(2026, 10, 25)).value).toBe(-5);
    expect(computeProgress(task, [ci('c', 'once', 'stop', now)], now).met).toBe(true);
  });
});

describe('重复任务的周期与连续天数', () => {
  const task = mkTask('r', {
    completion_mode: 'count',
    target_value: 2,
    recurrence: formatRecurrence({ kind: 'daily' }),
    created_at: local(2026, 10, 10, 8).toISOString(),
  });
  const evs = [
    ci('r', '2026-10-12', 'add', local(2026, 10, 12), 2),
    ci('r', '2026-10-13', 'add', local(2026, 10, 13), 1),
    ci('r', '2026-10-13', 'add', local(2026, 10, 13, 20), 1),
    ci('r', '2026-10-14', 'add', local(2026, 10, 14), 3),
    ci('r', '2026-10-15', 'add', local(2026, 10, 15), 1),
  ];
  const now = local(2026, 10, 15, 18);

  it('按周期算进度', () => {
    expect(progressOn(task, evs, '2026-10-15', now)).toMatchObject({ value: 1, met: false });
    expect(progressOn(task, evs, '2026-10-13', now).met).toBe(true);
  });

  it('达标周期与连续天数', () => {
    expect([...metPeriods(task, evs, now)].sort()).toEqual(['2026-10-12', '2026-10-13', '2026-10-14']);
    expect(taskStreak(task, evs, now)).toEqual({ current: 3, best: 3, todayMet: false });
  });

  it('今天要不要打卡', () => {
    expect(dueToday(task, '2026-10-15')).toBe(true);
    expect(dueToday(task, '2026-10-09')).toBe(false); // 创建之前
    expect(dueToday({ ...task, status: '关闭' }, '2026-10-15')).toBe(false);
    expect(dueToday({ ...task, status: '完成' }, '2026-10-15')).toBe(false);
    expect(dueToday(mkTask('x'), '2026-10-15')).toBe(false);
  });

  it('时长格式', () => {
    expect(formatDuration(16 * H + 5 * 60_000)).toBe('16 小时 05 分');
    expect(formatDuration(90_000)).toBe('1 分 30 秒');
    expect(formatDuration(-1)).toBe('0 秒');
  });
});

describe('热力图比例索引', () => {
  const now = local(2026, 10, 15, 20);
  const water = mkTask('w', { completion_mode: 'count', target_value: 4, recurrence: formatRecurrence({ kind: 'daily' }), created_at: local(2026, 10, 10).toISOString() });
  const run = mkTask('r', { completion_mode: 'once', recurrence: formatRecurrence({ kind: 'weekly', weekdays: [1] }), created_at: local(2026, 10, 1).toISOString() });
  const plain = mkTask('p');
  const evs = [ci('w', '2026-10-12', 'add', local(2026, 10, 12), 4), ci('w', '2026-10-13', 'add', local(2026, 10, 13), 1), ci('r', '2026-10-12', 'add', local(2026, 10, 12), 1)];
  const idx = buildRatioIndex([water, run, plain], evs, now);

  it('单个任务：应打卡日给比例，其余为 null', () => {
    expect(idx.taskRatio('w', '2026-10-13')).toBe(0.25);
    expect(idx.taskRatio('w', '2026-10-09')).toBeNull(); // 创建之前
    expect(idx.taskRatio('r', '2026-10-13')).toBeNull(); // 周二不是应打卡日
    expect(idx.taskRatio('p', '2026-10-13')).toBeNull();
  });

  it('当天总比例 = 各任务比例（封顶 1）之和 / 应打卡数', () => {
    expect(idx.dayRatio('2026-10-12')).toBe(1);
    expect(idx.dayRatio('2026-10-13')).toBe(0.25);
    expect(idx.dayRatio('2026-10-05')).toBe(0); // 只有周一跑步要打卡，没打
    expect(idx.dayRatio('2026-09-01')).toBeNull();
  });

  it('关闭的重复任务：关闭那天起不再应打卡，之前的历史保留，关闭本身不算达成', () => {
    const closed = { ...water, status: '关闭' as const, done_at: local(2026, 10, 13, 9).toISOString() };
    const i2 = buildRatioIndex([closed], evs, now);
    expect(i2.taskRatio('w', '2026-10-12')).toBe(1);
    expect(i2.taskRatio('w', '2026-10-13')).toBeNull();
    expect(i2.dayRatio('2026-10-14')).toBeNull();
  });
});
