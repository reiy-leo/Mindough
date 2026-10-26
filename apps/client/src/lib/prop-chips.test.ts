import { describe, expect, it } from 'vitest';
import { PLAIN_TYPE_ID } from '@mindough/core';
import { PROP_ORDER, addMenuItems, applicableProps, clearPatch, isPropSet, setProps, unsetProps, type PropTask } from './prop-chips';

const base: PropTask = {
  type_id: null,
  completion_mode: 'once',
  scheduled_date: null,
  recurrence: null,
  category_id: null,
  remind_time: null,
  group_id: null,
  target_date: null,
};
const t = (p: Partial<PropTask> = {}): PropTask => ({ ...base, ...p });

describe('属性胶囊：默认值判定（Rei 2026-10-25 方案 A）', () => {
  it('全是默认值：一个胶囊都没有', () => {
    expect(setProps(t())).toEqual([]);
    expect(setProps(t({ type_id: PLAIN_TYPE_ID }))).toEqual([]);
  });
  it('普通 / 打勾 / 一次 / 没日期 / 不提醒 / 不放进组 / 没人 都算没设', () => {
    for (const id of PROP_ORDER) expect(isPropSet(id, t(), 0)).toBe(false);
  });
  it('设过的才算：类型、完成方式、日期、组、人物', () => {
    expect(isPropSet('type', t({ type_id: 'builtin-game' }))).toBe(true);
    expect(isPropSet('mode', t({ completion_mode: 'timer' }))).toBe(true);
    expect(isPropSet('date', t({ scheduled_date: '2026-10-16' }))).toBe(true);
    expect(isPropSet('group', t({ group_id: 'g1' }))).toBe(true);
    expect(isPropSet('people', t(), 2)).toBe(true);
  });
  it('胶囊按固定顺序：类型、完成方式、日期、重复、提醒、组、人物', () => {
    const task = t({ group_id: 'g', scheduled_date: '2026-10-16', remind_time: '09:00', type_id: 'x', completion_mode: 'count' });
    expect(setProps(task, 1)).toEqual(['type', 'mode', 'date', 'remind', 'group', 'people']);
  });
  it('重复任务：没有日期；类型排在资料库后面', () => {
    const task = t({ recurrence: 'FREQ=DAILY', category_id: 'c1' });
    expect(applicableProps(task)).not.toContain('date');
    expect(setProps(task)).toEqual(['category', 'repeat']);
  });
  it('类型（Rei 2026-10-26）所有任务都能挂', () => {
    expect(applicableProps(t())).toContain('category');
    expect(setProps(t({ category_id: 'c1', scheduled_date: '2026-10-16' }))).toEqual(['category', 'date']);
  });
});

describe('「+」菜单：列出没设的属性', () => {
  it('什么都没设：没日期时不能提醒，所以不列提醒', () => {
    expect(unsetProps(t())).toEqual(['type', 'category', 'mode', 'date', 'repeat', 'group', 'people']);
  });
  it('有日期就能加提醒', () => {
    expect(unsetProps(t({ scheduled_date: '2026-10-16' }))).toEqual(['type', 'category', 'mode', 'repeat', 'remind', 'group', 'people']);
  });
  it('重复任务不列日期', () => {
    expect(unsetProps(t({ recurrence: 'FREQ=DAILY' }))).toEqual(['type', 'category', 'mode', 'remind', 'group', 'people']);
  });
  it('全都设了：菜单是空的（「+」隐藏）', () => {
    const task = t({ type_id: 'x', category_id: 'c', completion_mode: 'timer', scheduled_date: '2026-10-16', recurrence: null, remind_time: '09:00', group_id: 'g' });
    expect(unsetProps(task, 1)).toEqual(['repeat']);
    expect(unsetProps(t({ type_id: 'x', completion_mode: 'timer', recurrence: 'FREQ=DAILY', category_id: 'c', remind_time: '09:00', group_id: 'g' }), 1)).toEqual([]);
  });
  it('设过的 + 没设的 = 适用的全部，不重不漏', () => {
    const task = t({ group_id: 'g', completion_mode: 'countdown', target_date: '2026-11-01' });
    expect([...setProps(task), ...unsetProps(task)].sort()).toEqual([...applicableProps(task)].sort());
  });
});

describe('清除回默认', () => {
  it('清除后的字段就是默认值，胶囊消失、回到「+」菜单', () => {
    const task = t({ completion_mode: 'timer', scheduled_date: '2026-10-16', recurrence: null, remind_time: '09:00', group_id: 'g' });
    for (const id of ['mode', 'date', 'remind', 'group'] as const) {
      const next = { ...task, ...clearPatch(id) } as PropTask;
      expect(isPropSet(id, next)).toBe(false);
    }
    const rec = t({ recurrence: 'FREQ=DAILY', category_id: 'c' });
    expect(isPropSet('repeat', { ...rec, ...clearPatch('repeat') } as PropTask)).toBe(false);
    expect(isPropSet('category', { ...rec, ...clearPatch('category') } as PropTask)).toBe(false);
  });
  it('清掉重复后日期重新出现在「+」菜单里', () => {
    const rec = t({ recurrence: 'FREQ=WEEKLY;BYDAY=MO' });
    expect(unsetProps({ ...rec, ...clearPatch('repeat') } as PropTask)).toContain('date');
  });
  it('类型和人物交给调用方（changeTaskType / 解除关联）', () => {
    expect(clearPatch('type')).toBeNull();
    expect(clearPatch('people')).toBeNull();
  });
});

describe('「+」菜单里的附件（Rei 2026-10-25）', () => {
  it('能加附件时「附件」排在最后', () => {
    expect(addMenuItems(t(), 0, true)).toEqual([...unsetProps(t()), 'attachment']);
    expect(addMenuItems(t(), 0, false)).toEqual(unsetProps(t()));
  });
  it('属性都设了，菜单里还剩「附件」，「+」不藏', () => {
    const full = t({ type_id: 'x', completion_mode: 'count', recurrence: 'FREQ=DAILY', category_id: 'c', remind_time: '09:00', group_id: 'g' });
    expect(unsetProps(full, 1)).toEqual([]);
    expect(addMenuItems(full, 1, true)).toEqual(['attachment']);
  });
});
