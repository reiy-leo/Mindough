/**
 * 任务详情的属性胶囊行（Rei 2026-10-25 选方案 A · 胶囊行）：只显示设置过（不是默认值）的单值属性，
 * 没设的收进行尾「+」菜单。这里是纯逻辑：哪些属性适用、默认值是什么、设没设、清除回默认要改哪些字段。
 *
 * 默认值（= 未设置，胶囊不显示）：
 * - 类型：普通（type_id 为 null 或 PLAIN_TYPE_ID）
 * - 完成方式：打勾（completion_mode = 'once'）
 * - 日期：没有（scheduled_date = null；重复任务按规则出现，不适用）
 * - 重复：一次（recurrence = null / 空）
 * - 打卡分类：未分类（checkin_category_id = null；只有重复任务适用）
 * - 提醒：不提醒（remind_time = null；要有日期 / 重复 / 倒数日目标日才适用，见 core canRemind）
 * - 组：不放进组（group_id = null）
 * - 和谁有关：没有人（task_person 没有关联）
 * 资料行和任务字段（进度、看到哪…）不是单值属性，不进胶囊，留在原来的属性卡片里。
 */
import { PLAIN_TYPE_ID, canRemind, type Task } from '@mindough/core';

export type PropId = 'type' | 'mode' | 'date' | 'repeat' | 'category' | 'remind' | 'group' | 'people';

/** 胶囊固定顺序：先说「是什么、怎么算完成」，再说「什么时候」，最后「放哪、和谁」。 */
export const PROP_ORDER: readonly PropId[] = ['type', 'mode', 'date', 'repeat', 'category', 'remind', 'group', 'people'];

export type PropTask = Pick<Task, 'type_id' | 'completion_mode' | 'scheduled_date' | 'recurrence' | 'checkin_category_id' | 'remind_time' | 'group_id' | 'target_date'>;

/** 这件任务现在能有哪些属性（日期和打卡分类看重不重复，提醒要有时间可以响）。 */
export function applicableProps(t: PropTask): PropId[] {
  return PROP_ORDER.filter((id) => {
    if (id === 'date') return !t.recurrence;
    if (id === 'category') return !!t.recurrence;
    if (id === 'remind') return canRemind(t) || !!t.remind_time;
    return true;
  });
}

/** 这个属性设过没有（不是默认值）。peopleCount：关联了几个人。 */
export function isPropSet(id: PropId, t: PropTask, peopleCount = 0): boolean {
  switch (id) {
    case 'type':
      return !!t.type_id && t.type_id !== PLAIN_TYPE_ID;
    case 'mode':
      return t.completion_mode !== 'once';
    case 'date':
      return !!t.scheduled_date;
    case 'repeat':
      return !!t.recurrence;
    case 'category':
      return !!t.checkin_category_id;
    case 'remind':
      return !!t.remind_time;
    case 'group':
      return !!t.group_id;
    case 'people':
      return peopleCount > 0;
  }
}

/** 显示成胶囊的属性（按固定顺序）。 */
export function setProps(t: PropTask, peopleCount = 0): PropId[] {
  return applicableProps(t).filter((id) => isPropSet(id, t, peopleCount));
}

/** 「+」菜单里列出的属性：适用但还没设的（按固定顺序）。全都设了就是空的，「+」隐藏。 */
export function unsetProps(t: PropTask, peopleCount = 0): PropId[] {
  return applicableProps(t).filter((id) => !isPropSet(id, t, peopleCount));
}

/**
 * 清除回默认要写的字段。类型（要清掉旧资料、可能套模板，走 store.changeTaskType）和人物（解除关联）
 * 不是改任务字段，返回 null，由调用方处理。
 */
export function clearPatch(id: PropId): Partial<Task> | null {
  switch (id) {
    case 'mode':
      return { completion_mode: 'once' };
    case 'date':
      return { scheduled_date: null };
    case 'repeat':
      return { recurrence: null };
    case 'category':
      return { checkin_category_id: null };
    case 'remind':
      return { remind_time: null };
    case 'group':
      return { group_id: null };
    case 'type':
    case 'people':
      return null;
  }
}
