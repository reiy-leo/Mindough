import { describe, expect, it } from 'vitest';
import { MemoryAdapter, Store, formatRecurrence } from '@mindough/core';
import { buildWidgetSnapshot } from './widget-snapshot';

describe('小组件快照', () => {
  it('我的一天 + 今天要打卡（不重复列出已在我的一天里的）', async () => {
    const now = new Date(2026, 9, 16, 9);
    const store = await Store.open(new MemoryAdapter(), { now: () => now });
    const a = store.createTask({ body_md: '买菜' });
    store.addToMyDay(a.id, '2026-10-16');
    const water = store.createTask({ body_md: '喝水', recurrence: formatRecurrence({ kind: 'daily' }), created_at: new Date(2026, 9, 1).toISOString() });
    const s = buildWidgetSnapshot(store, now);
    expect(s.date).toBe('2026-10-16');
    expect(s.myDay).toEqual([{ id: a.id, title: '买菜', done: false }]);
    expect(s.checkIns.map((c) => c.id)).toEqual([water.id]);
  });
});
