import { describe, expect, it } from 'vitest';
import { canRemind, dateKeyIn, dueReminders, normalizeRemindTime, pruneFired, reminderBody, upcomingReminders, wallTimeToEpoch, SNOOZE_MS } from '../src/reminders';
import { formatRecurrence } from '../src/recurrence';
import { ci, mkTask } from './helpers';

const SH = 'Asia/Shanghai';
const NY = 'America/New_York';
const H = 3_600_000;
const at = (iso: string) => new Date(iso);

describe('提醒时间', () => {
  it('写法宽松，存成 HH:MM', () => {
    expect(normalizeRemindTime('9:05')).toBe('09:05');
    expect(normalizeRemindTime('21：30')).toBe('21:30');
    expect(normalizeRemindTime('0700')).toBe('07:00');
    expect(normalizeRemindTime('24:00')).toBeNull();
    expect(normalizeRemindTime('早上')).toBeNull();
    expect(normalizeRemindTime(null)).toBeNull();
  });

  it('墙上时间 → 时刻：上海没有夏令时', () => {
    expect(new Date(wallTimeToEpoch('2026-10-16', '09:00', SH)).toISOString()).toBe('2026-10-16T01:00:00.000Z');
  });

  it('纽约：夏令时前后偏移不同；跳过的 02:30 顺延到 03:30；重复的 01:30 取第一次', () => {
    expect(new Date(wallTimeToEpoch('2026-01-10', '09:00', NY)).toISOString()).toBe('2026-01-10T14:00:00.000Z');
    expect(new Date(wallTimeToEpoch('2026-07-10', '09:00', NY)).toISOString()).toBe('2026-07-10T13:00:00.000Z');
    expect(new Date(wallTimeToEpoch('2026-03-08', '02:30', NY)).toISOString()).toBe('2026-03-08T07:30:00.000Z');
    expect(new Date(wallTimeToEpoch('2026-11-01', '01:30', NY)).toISOString()).toBe('2026-11-01T05:30:00.000Z');
  });

  it('日期键按时区', () => {
    const ms = Date.parse('2026-10-15T17:00:00Z');
    expect(dateKeyIn(ms, SH)).toBe('2026-10-16');
    expect(dateKeyIn(ms, NY)).toBe('2026-10-15');
  });
});

describe('接下来的提醒', () => {
  const now = at('2026-10-16T00:00:00Z'); // 上海 08:00

  it('只做一次：有日期 + 提醒时间才提醒；没日期、没时间的不提醒', () => {
    const tasks = [
      mkTask('a', { scheduled_date: '2026-10-16', remind_time: '09:00' }),
      mkTask('b', { scheduled_date: '2026-10-16' }),
      mkTask('c', { remind_time: '09:00' }),
    ];
    const r = upcomingReminders(tasks, [], { now, timeZone: SH });
    expect(r.map((x) => [x.taskId, x.kind, new Date(x.at).toISOString()])).toEqual([['a', 'due', '2026-10-16T01:00:00.000Z']]);
    expect(canRemind(tasks[2]!)).toBe(false);
    expect(canRemind(tasks[0]!)).toBe(true);
  });

  it('完成 / 关闭 / 删除的不提醒', () => {
    const base = { scheduled_date: '2026-10-16', remind_time: '09:00' };
    const tasks = [mkTask('a', { ...base, status: '完成' }), mkTask('b', { ...base, status: '关闭' }), mkTask('c', { ...base, deleted: true })];
    expect(upcomingReminders(tasks, [], { now, timeZone: SH })).toEqual([]);
  });

  it('倒数日：目标日那天提醒', () => {
    const t = mkTask('exam', { completion_mode: 'countdown', target_date: '2026-10-17', remind_time: '07:30' });
    const [r] = upcomingReminders([t], [], { now, timeZone: SH });
    expect(r).toMatchObject({ kind: 'countdown', date: '2026-10-17' });
    expect(new Date(r!.at).toISOString()).toBe('2026-10-16T23:30:00.000Z');
    expect(canRemind({ ...t, target_date: null })).toBe(false);
  });

  it('定期打卡：每个要打卡的日子提醒；今天已经打过卡的跳过', () => {
    const daily = mkTask('water', { completion_mode: 'once', recurrence: formatRecurrence({ kind: 'daily' }), remind_time: '21:00' });
    const r = upcomingReminders([daily], [], { now, timeZone: SH });
    expect(r.map((x) => x.date)).toEqual(['2026-10-16', '2026-10-17']);
    const done = upcomingReminders([daily], [ci('water', '2026-10-16', 'add', at('2026-10-16T01:00:00Z'), 1)], { now, timeZone: SH });
    expect(done.map((x) => x.date)).toEqual(['2026-10-17']);
  });

  it('每周几：不是那天不提醒；建任务之前的日子不提醒', () => {
    // 2026-10-16 周五，2026-10-17 周六
    const t = mkTask('run', { recurrence: formatRecurrence({ kind: 'weekly', weekdays: [6] }), remind_time: '07:00', created_at: '2026-10-01T00:00:00Z' });
    expect(upcomingReminders([t], [], { now, timeZone: SH }).map((x) => x.date)).toEqual(['2026-10-17']);
    const later = { ...t, created_at: '2026-10-20T00:00:00Z' };
    expect(upcomingReminders([later], [], { now, timeZone: SH })).toEqual([]);
  });

  it('不再打卡（关闭）的重复任务不提醒', () => {
    const t = mkTask('x', { recurrence: formatRecurrence({ kind: 'daily' }), remind_time: '21:00', status: '关闭' });
    expect(upcomingReminders([t], [], { now, timeZone: SH })).toEqual([]);
  });

  it('计时：正在走、有目标，到点提醒；暂停中不提醒；暂停后继续重新算', () => {
    const t = mkTask('fast', { completion_mode: 'timer', target_value: 16 * H });
    const start = at('2026-10-15T20:00:00Z');
    const running = [ci('fast', 'once', 'start', start)];
    const [r] = upcomingReminders([t], running, { now, timeZone: SH });
    expect(r).toMatchObject({ kind: 'timer' });
    expect(new Date(r!.at).toISOString()).toBe('2026-10-16T12:00:00.000Z');

    const paused = [...running, ci('fast', 'once', 'pause', at('2026-10-15T22:00:00Z'))];
    expect(upcomingReminders([t], paused, { now, timeZone: SH })).toEqual([]);

    const resumed = [...paused, ci('fast', 'once', 'resume', at('2026-10-15T23:00:00Z'))];
    const [r2] = upcomingReminders([t], resumed, { now, timeZone: SH });
    expect(new Date(r2!.at).toISOString()).toBe('2026-10-16T13:00:00.000Z');
    expect(r2!.id).not.toBe(r!.id);

    const noTarget = mkTask('free', { completion_mode: 'timer' });
    expect(upcomingReminders([noTarget], [ci('free', 'once', 'start', start)], { now, timeZone: SH })).toEqual([]);
  });

  it('响过的不再算；稍后再提醒按新时间算', () => {
    const t = mkTask('a', { scheduled_date: '2026-10-16', remind_time: '08:05' });
    const [r] = upcomingReminders([t], [], { now, timeZone: SH });
    expect(dueReminders([r!], at('2026-10-16T00:04:00Z'))).toEqual([]);
    expect(dueReminders([r!], at('2026-10-16T00:05:00Z'))).toHaveLength(1);
    const fired = new Set([r!.id]);
    expect(upcomingReminders([t], [], { now, timeZone: SH, fired })).toEqual([]);
    const later = r!.at + SNOOZE_MS;
    const snoozed = upcomingReminders([t], [], { now, timeZone: SH, fired, snoozed: new Map([[r!.id, later]]) });
    expect(snoozed).toEqual([{ ...r!, at: later, snoozed: true }]);
  });

  it('错过一会儿（刚打开 app）还补响；错过太久的不补', () => {
    const t = mkTask('a', { scheduled_date: '2026-10-16', remind_time: '07:50' });
    expect(upcomingReminders([t], [], { now, timeZone: SH })).toHaveLength(1);
    const old = mkTask('b', { scheduled_date: '2026-10-16', remind_time: '07:00' });
    expect(upcomingReminders([old], [], { now, timeZone: SH })).toEqual([]);
  });

  it('同一个任务在不同时区：按那个时区的墙上时间', () => {
    const t = mkTask('a', { scheduled_date: '2026-10-16', remind_time: '09:00' });
    const ny = upcomingReminders([t], [], { now: at('2026-10-16T10:00:00Z'), timeZone: NY });
    expect(new Date(ny[0]!.at).toISOString()).toBe('2026-10-16T13:00:00.000Z');
  });

  it('按时间排好', () => {
    const tasks = [mkTask('late', { scheduled_date: '2026-10-16', remind_time: '20:00' }), mkTask('early', { scheduled_date: '2026-10-16', remind_time: '09:00' })];
    expect(upcomingReminders(tasks, [], { now, timeZone: SH }).map((x) => x.taskId)).toEqual(['early', 'late']);
  });

  it('通知正文；清掉太旧的已响记录', () => {
    expect(reminderBody({ kind: 'due' }, { target_value: null })).toBe('今天要做');
    expect(reminderBody({ kind: 'timer' }, { target_value: 10 * 60_000 })).toContain('计时到了');
    const kept = pruneFired(new Map([['old', Date.parse('2026-10-01T00:00:00Z')], ['new', now.getTime()]]), now);
    expect([...kept.keys()]).toEqual(['new']);
  });
});
