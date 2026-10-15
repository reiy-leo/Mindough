import { describe, expect, it } from 'vitest';
import { Store } from '../src/store';
import { MemoryAdapter } from '../src/storage/memory';
import { shouldJoinMyDay } from '../src/backlog';
import { local } from './helpers';

const open = async () => Store.open(new MemoryAdapter(), { deviceId: 'a', now: () => local(2026, 10, 16, 9) });

describe('待安排', () => {
  it('没结束、只做一次、没日期、不在今天的我的一天；组里的也算', async () => {
    const s = await open();
    const g = s.insert('group', { name: '搬家', icon: '📦', start_at: null, end_at: null, category_id: null, default_type_id: null });
    const a = s.createTask({ body_md: 'a' });
    const inGroup = s.createTask({ body_md: '组里', group_id: g.id });
    const dated = s.createTask({ body_md: '有日期', scheduled_date: '2026-10-20' });
    const countdown = s.createTask({ body_md: '倒数日', completion_mode: 'countdown', target_date: '2026-12-01' });
    const habit = s.createTask({ body_md: '打卡', recurrence: 'FREQ=DAILY' });
    const done = s.createTask({ body_md: '完成了', status: '完成' });
    const closed = s.createTask({ body_md: '关了', status: '关闭' });
    const today = s.createTask({ body_md: '今天的' });
    s.addToMyDay(today.id, '2026-10-16');
    const ids = s.backlog('2026-10-16').map((t) => t.id);
    expect(ids).toEqual([a.id, inGroup.id]);
    for (const t of [dated, countdown, habit, done, closed, today]) expect(ids).not.toContain(t.id);
  });
  it('昨天在我的一天里没做完、今天没带回的，落回待安排', async () => {
    const s = await open();
    const t = s.createTask({ body_md: '昨天的' });
    s.addToMyDay(t.id, '2026-10-15');
    expect(s.backlog('2026-10-15').map((x) => x.id)).not.toContain(t.id);
    expect(s.backlog('2026-10-16').map((x) => x.id)).toContain(t.id);
  });
  it('拖动排序只在这几件之间换位置', async () => {
    const s = await open();
    const [a, b, c] = ['a', 'b', 'c'].map((x) => s.createTask({ body_md: x }));
    s.reorderBacklog([c!.id, a!.id, b!.id]);
    expect(s.backlog().map((t) => t.body_md)).toEqual(['c', 'a', 'b']);
  });
  it('新的默认：只有从我的一天新建的才进今天（M0 决定 8 改了）', () => {
    const today = '2026-10-16';
    expect(shouldJoinMyDay({ fromMyDay: false, recurring: false, date: null, today })).toBe(false);
    expect(shouldJoinMyDay({ fromMyDay: true, recurring: false, date: null, today })).toBe(true);
    expect(shouldJoinMyDay({ fromMyDay: true, recurring: false, date: today, today })).toBe(true);
    expect(shouldJoinMyDay({ fromMyDay: true, recurring: false, date: '2026-10-20', today })).toBe(false);
    expect(shouldJoinMyDay({ fromMyDay: true, recurring: true, date: null, today })).toBe(false);
  });
});
