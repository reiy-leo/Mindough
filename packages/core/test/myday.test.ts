import { describe, expect, it } from 'vitest';
import { entriesFor, myDayItems, recentlyUnlocked, suggestions, yesterdayUnfinished } from '../src/myday';
import { deriveAll } from '../src/dag';
import { formatRecurrence } from '../src/recurrence';
import type { MyDayEntry } from '../src/types';
import { ci, local, mkTask } from './helpers';

const entry = (task_id: string, date: string, sort: number): MyDayEntry => ({
  id: `${task_id}-${date}`,
  updated_at: '',
  deleted: false,
  task_id,
  date,
  sort,
  added_at: '2026-10-15T00:00:00.000Z',
});

const today = '2026-10-15';
const now = local(2026, 10, 15, 15);

describe('我的一天', () => {
  const tasks = [
    mkTask('a'),
    mkTask('b', { status: '完成' }),
    mkTask('c'),
    mkTask('r', { completion_mode: 'count', target_value: 2, recurrence: formatRecurrence({ kind: 'daily' }) }),
  ];
  const byId = new Map(tasks.map((t) => [t.id, t]));

  it('同一任务同一天只算一条（同步合并）', () => {
    const dup = [entry('a', today, 2), { ...entry('a', today, 1), id: 'dup' }, entry('c', today, 3)];
    expect(entriesFor(dup, today).map((e) => e.id)).toEqual(['dup', 'c-2026-10-15']);
  });

  it('完成的沉到底部', () => {
    const entries = [entry('b', today, 1), entry('a', today, 2), entry('c', today, 3)];
    expect(myDayItems(entries, byId, [], today, now).map((i) => [i.task.id, i.done])).toEqual([
      ['a', false],
      ['c', false],
      ['b', true],
    ]);
  });

  it('零点换天：昨天没做完的放进“昨天没做完”，已带回今天的不重复', () => {
    const entries = [entry('a', '2026-10-14', 1), entry('b', '2026-10-14', 2), entry('c', '2026-10-14', 3), entry('c', today, 1)];
    expect(yesterdayUnfinished(entries, byId, [], today, now).map((t) => t.id)).toEqual(['a']);
  });

  it('重复任务看昨天那个周期有没有达标', () => {
    const entries = [entry('r', '2026-10-14', 1)];
    expect(yesterdayUnfinished(entries, byId, [], today, now).map((t) => t.id)).toEqual(['r']);
    const evs = [ci('r', '2026-10-14', 'add', local(2026, 10, 14), 2)];
    expect(yesterdayUnfinished(entries, byId, evs, today, now)).toEqual([]);
  });

  it('建议：今天到期、今天要打卡、刚解锁；已在清单里的不建议', () => {
    const ts = [
      mkTask('due', { scheduled_date: today }),
      mkTask('over', { scheduled_date: '2026-10-10' }),
      mkTask('later', { scheduled_date: '2026-10-20' }),
      mkTask('habit', { recurrence: formatRecurrence({ kind: 'daily' }) }),
      mkTask('pred', { status: '完成', done_at: '2026-10-15T01:00:00.000Z' }),
      mkTask('succ'),
      mkTask('cd', { completion_mode: 'countdown', target_date: today }),
      mkTask('inday', { scheduled_date: today }),
    ];
    const edges = [{ pred_id: 'pred', succ_id: 'succ' }];
    const derived = deriveAll(ts, edges);
    const unlocked = recentlyUnlocked(ts, edges, derived, '2026-10-14T00:00:00.000Z');
    expect(unlocked).toEqual(['succ']);
    const s = suggestions({ tasks: ts, entries: [entry('inday', today, 1)], checkIns: [], derived, recentlyUnlocked: unlocked, today, now });
    expect(s.map((x) => [x.task.id, x.reason])).toEqual([
      ['due', '今天到期'],
      ['over', '今天到期'],
      ['cd', '倒数日到了'],
      ['habit', '今天要打卡'],
      ['succ', '刚解锁'],
    ]);
  });
});
