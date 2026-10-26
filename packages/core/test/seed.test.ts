import { describe, expect, it } from 'vitest';
import { Store } from '../src/store';
import { MemoryAdapter } from '../src/storage/memory';
import { seedDemo } from '../src/seed/demo';
import { BUILTIN_TASK_TYPES } from '../src/seed/builtin-types';
import { BUILTIN_CHECKIN_CATEGORIES, BUILTIN_CHECKIN_CATEGORY_IDS, pickFrequentCategories } from '../src/seed/builtin-checkin-categories';
import { findCycleEdges } from '../src/dag';
import { taskStreak } from '../src/checkin';
import { local } from './helpers';

describe('内置类型', () => {
  it('普通 + 10 种，名称与 PLAN 一致，字段 key 不重复', () => {
    expect(BUILTIN_TASK_TYPES.map((t) => t.name)).toEqual(['普通', '影视', '游戏', '书籍', '项目', '课程', '旅行', '购物', '餐厅', '饮食', '人物']);
    for (const t of BUILTIN_TASK_TYPES) {
      expect(new Set(t.fields.map((f) => f.key)).size).toBe(t.fields.length);
      if (t.name !== '普通') {
        expect(t.fields.filter((f) => f.primary)).toHaveLength(1);
        expect(t.body_template.length).toBeGreaterThan(0);
      }
    }
    expect(BUILTIN_TASK_TYPES[0]).toMatchObject({ layout: 'text', fields: [], body_template: '' });
  });
});

describe('演示数据', () => {
  it('生成完整、依赖无环、打卡有连续天数', async () => {
    const now = local(2026, 10, 15, 15);
    const store = await Store.open(new MemoryAdapter(), { deviceId: 'demo', now: () => now });
    seedDemo(store);
    expect(store.list('group')).toHaveLength(3);
    expect(store.list('person')).toHaveLength(3);
    expect(store.tasks().length).toBeGreaterThan(20);
    expect(findCycleEdges(store.edges())).toEqual([]);
    expect(store.tasks().some((t) => t.status === '关闭')).toBe(true);
    // 演示的重复任务都有打卡分类
    expect(store.tasks().filter((t) => t.recurrence).every((t) => store.categoryOf(t))).toBe(true);
    expect(store.list('my_day').filter((e) => e.date === '2026-10-15')).toHaveLength(5);
    const water = store.tasks().find((t) => t.body_md === '每天喝 8 杯水')!;
    expect(store.progress(water.id)?.value).toBe(3);
    const fast = store.tasks().find((t) => t.body_md === '16 小时轻断食')!;
    expect(store.progress(fast.id)?.running).toBe(true);
    const streak = taskStreak(water, store.checkInsOf(water.id), now);
    expect(streak?.best).toBeGreaterThan(1);
    const blocked = [...store.derived().values()].filter((d) => d.state === '被阻塞');
    expect(blocked.length).toBeGreaterThan(2);
  });
});

describe('常用打卡分类', () => {
  const cats = BUILTIN_CHECKIN_CATEGORIES;
  const id = (k: keyof typeof BUILTIN_CHECKIN_CATEGORY_IDS) => BUILTIN_CHECKIN_CATEGORY_IDS[k];
  it('没用过时是默认 6 个', () => {
    expect(pickFrequentCategories(cats, []).map((c) => c.name)).toEqual(['健康', '运动', '学习', '读书', '饮食', '作息']);
  });
  it('用得多的在前，件数一样按最近，再用默认补齐、不重复', () => {
    const usage = [
      { categoryId: id('plant'), at: '1' },
      { categoryId: id('finance'), at: '2' },
      { categoryId: id('finance'), at: '3' },
      { categoryId: id('sport'), at: '4' },
      { categoryId: null, at: '5' },
    ];
    expect(pickFrequentCategories(cats, usage).map((c) => c.name)).toEqual(['理财', '运动', '植物', '健康', '学习', '读书']);
  });
  it('隐藏的不算常用', () => {
    const visible = cats.filter((c) => c.id !== id('health'));
    const names = pickFrequentCategories(visible, [{ categoryId: id('health'), at: '1' }]).map((c) => c.name);
    expect(names).not.toContain('健康');
    expect(names).toHaveLength(6);
  });
});
