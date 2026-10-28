/**
 * 任务详情的属性胶囊行（Rei 2026-10-25 选方案 A · 胶囊行）：只显示设置过（不是默认值）的属性，
 * 没设的收进行尾「+」菜单。这里是纯逻辑：哪些属性适用、默认值是什么、设没设、清除回默认要改哪些字段。
 *
 * 默认值（= 未设置，胶囊不显示）：
 * - 类型（Rei 2026-10-28 起能挂多个）：一个都没有（PropId 叫 category）
 * - 完成方式：打勾（completion_mode = 'once'）
 * - 日期：没有（scheduled_date = null；重复任务按规则出现，不适用）
 * - 重复：一次（recurrence = null / 空）
 * - 提醒：不提醒（remind_time = null；要有日期 / 重复 / 倒数日目标日才适用，见 core canRemind）
 * - 组：不放进组（group_id = null）
 * 资料（Rei 2026-10-28：和类型平级，跨库多选，含人物）不是胶囊：挂了就在胶囊下面按库分组列出来；
 * 一条都没挂时，「+」菜单里有「资料」（PropId refs）。以前的「资料库」「和谁有关」两个胶囊并进了资料。
 */
import { canRemind, type Task } from '@mindough/core';

export type PropId = 'category' | 'refs' | 'mode' | 'date' | 'repeat' | 'remind' | 'group';

/** 固定顺序：先说「是什么、和什么有关、怎么算完成」，再说「什么时候」，最后「放哪」。 */
export const PROP_ORDER: readonly PropId[] = ['category', 'refs', 'mode', 'date', 'repeat', 'remind', 'group'];

export type PropTask = Pick<Task, 'completion_mode' | 'scheduled_date' | 'recurrence' | 'category_id' | 'remind_time' | 'group_id' | 'target_date'>;

/** 挂了几个类型、几条资料（含人物）。不给类型数时看单值 category_id。 */
export interface PropCounts {
  categories?: number;
  refs?: number;
}

/** 这件任务现在能有哪些属性（日期看重不重复，提醒要有时间可以响；类型、资料所有任务都能挂）。 */
export function applicableProps(t: PropTask): PropId[] {
  return PROP_ORDER.filter((id) => {
    if (id === 'date') return !t.recurrence;
    if (id === 'remind') return canRemind(t) || !!t.remind_time;
    return true;
  });
}

/** 这个属性设过没有（不是默认值）。 */
export function isPropSet(id: PropId, t: PropTask, counts: PropCounts = {}): boolean {
  switch (id) {
    case 'category':
      return (counts.categories ?? (t.category_id ? 1 : 0)) > 0;
    case 'refs':
      return (counts.refs ?? 0) > 0;
    case 'mode':
      return t.completion_mode !== 'once';
    case 'date':
      return !!t.scheduled_date;
    case 'repeat':
      return !!t.recurrence;
    case 'remind':
      return !!t.remind_time;
    case 'group':
      return !!t.group_id;
  }
}

/** 显示成胶囊的属性（按固定顺序）。资料不是胶囊。 */
export function setProps(t: PropTask, counts: PropCounts = {}): PropId[] {
  return applicableProps(t).filter((id) => id !== 'refs' && isPropSet(id, t, counts));
}

/** 「+」菜单里列出的属性：适用但还没设的（按固定顺序）。全都设了就是空的，「+」隐藏。 */
export function unsetProps(t: PropTask, counts: PropCounts = {}): PropId[] {
  return applicableProps(t).filter((id) => !isPropSet(id, t, counts));
}

/**
 * 清除回默认要写的字段。类型（去掉全部关联，走 store.setTaskCategories）和资料不是改任务字段，返回 null，由调用方处理。
 */
export function clearPatch(id: PropId): Partial<Task> | null {
  switch (id) {
    case 'mode':
      return { completion_mode: 'once' };
    case 'date':
      return { scheduled_date: null };
    case 'repeat':
      return { recurrence: null };
    case 'remind':
      return { remind_time: null };
    case 'group':
      return { group_id: null };
    case 'category':
    case 'refs':
      return null;
  }
}

/** 「+」菜单的一项：没设的属性，或者「附件」。 */
export type AddMenuId = PropId | 'attachment';

/**
 * 「+」菜单要列的项（Rei 2026-10-25「附件也收到这个下拉列表，但附件可以添加多个，添加后下拉列表中还要显示」）：
 * 没设的属性按固定顺序，能加附件时「附件」放在最后，而且一直在（加过附件也还在）。
 * 菜单是空的时「+」隐藏。
 */
export function addMenuItems(t: PropTask, counts: PropCounts = {}, canAttach = false): AddMenuId[] {
  const items: AddMenuId[] = unsetProps(t, counts);
  if (canAttach) items.push('attachment');
  return items;
}
