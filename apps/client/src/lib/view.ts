import { fieldText, mediaFieldKey, taskSubtitle, taskTitle, type DerivedStatus, type FieldDef, type FieldValue, type Group, type Person, type Store, type Task, type TaskType } from '@mindough/core';

/** 图片字段值：外链 / data URL 直接用，否则当作 asset id。 */
export function imageUrl(store: Store, v: FieldValue | undefined | null): string | null {
  if (typeof v !== 'string' || !v) return null;
  if (/^(https?:|data:|blob:)/.test(v)) return v;
  return store.get('asset', v)?.url ?? null;
}

export function personAvatar(store: Store, p: Person | undefined | null): string | null {
  return p ? imageUrl(store, p.avatar_asset_id) : null;
}

export function resolver(store: Store) {
  return (def: FieldDef, v: FieldValue) => (def.kind === 'person' && typeof v === 'string' ? (store.get('person', v)?.name ?? '') : fieldText(v));
}

/** 任务显示用的数据（资料库里的资料 + 任务自己的字段）。 */
export function dataOf(store: Store, task: Task) {
  return store.taskData(task);
}

/** 任务标题：资料名（片名…）→ 内容首行。所有界面都从这里取，别直接用 task.type_data。 */
export function titleOf(store: Store, task: Task): string {
  return taskTitle({ body_md: task.body_md, type_data: store.taskData(task) }, store.get('task_type', task.type_id), resolver(store));
}

export interface TaskView {
  task: Task;
  title: string;
  subtitle: string;
  type: TaskType | undefined;
  /** 资料 + 任务字段合并后的数据。 */
  data: Record<string, FieldValue>;
  media: string | null;
  /** 挂着资料却没图时，占位图用的名字（按名字生成渐变 + 缩写）。 */
  artName: string | null;
  /** 人物类型：主图是对方头像。 */
  mediaIsAvatar: boolean;
  group: Group | undefined;
  people: Person[];
  derived: DerivedStatus | undefined;
}

export function viewOf(store: Store, task: Task): TaskView {
  const type = store.get('task_type', task.type_id);
  const data = store.taskData(task);
  const shaped = { body_md: task.body_md, type_data: data };
  const key = mediaFieldKey(type);
  const def = type?.fields.find((f) => f.key === key);
  let media: string | null = null;
  let mediaIsAvatar = false;
  if (def?.kind === 'person') {
    media = personAvatar(store, store.get('person', data[def.key] as string));
    mediaIsAvatar = true;
  } else if (key) media = imageUrl(store, data[key]);
  return {
    task,
    title: taskTitle(shaped, type, resolver(store)),
    subtitle: taskSubtitle(shaped, type),
    data,
    artName: store.itemOf(task)?.name ?? null,
    type,
    media,
    mediaIsAvatar,
    group: store.get('group', task.group_id),
    people: store.peopleOf(task.id),
    derived: store.derived().get(task.id),
  };
}

export const STATE_CLASS: Record<string, string> = {
  完成: 'state-done',
  关闭: 'state-closed',
  可开始: 'state-ready',
  被阻塞: 'state-blocked',
};
