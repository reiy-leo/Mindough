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

export interface TaskView {
  task: Task;
  title: string;
  subtitle: string;
  type: TaskType | undefined;
  media: string | null;
  /** 人物类型：主图是对方头像。 */
  mediaIsAvatar: boolean;
  group: Group | undefined;
  people: Person[];
  derived: DerivedStatus | undefined;
}

export function viewOf(store: Store, task: Task): TaskView {
  const type = store.get('task_type', task.type_id);
  const key = mediaFieldKey(type);
  const def = type?.fields.find((f) => f.key === key);
  let media: string | null = null;
  let mediaIsAvatar = false;
  if (def?.kind === 'person') {
    media = personAvatar(store, store.get('person', task.type_data[def.key] as string));
    mediaIsAvatar = true;
  } else if (key) media = imageUrl(store, task.type_data[key]);
  return {
    task,
    title: taskTitle(task, type, resolver(store)),
    subtitle: taskSubtitle(task, type),
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
