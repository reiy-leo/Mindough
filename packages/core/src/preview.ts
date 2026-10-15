/** 任务预览：没有标题，列表里显示 body_md 首行；有类型主字段时用主字段。 */
import type { FieldDef, FieldValue, Task, TaskType } from './types';

/** 把字段值解析成显示文本（如人物字段 person_id → 姓名）。 */
export type FieldResolver = (def: FieldDef, value: FieldValue) => string;

/** 去掉 markdown 行首标记，取第一条非空行。 */
export function firstLine(md: string): string {
  for (const raw of md.split(/\r?\n/)) {
    const line = raw
      .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/, '')
      .replace(/[*_`~]/g, '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .trim();
    if (line) return line;
  }
  return '';
}

export function fieldText(v: FieldValue | undefined): string {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.join('、');
  return String(v);
}

export function primaryFieldKey(type: Pick<TaskType, 'fields'> | null | undefined): string | null {
  return type?.fields.find((f) => f.primary)?.key ?? null;
}

export function mediaFieldKey(type: Pick<TaskType, 'fields'> | null | undefined): string | null {
  return type?.fields.find((f) => f.media)?.key ?? null;
}

/** 卡片标题：类型主字段 → 正文首行 → “空白任务”。 */
export function taskTitle(
  task: Pick<Task, 'body_md' | 'type_data'>,
  type?: Pick<TaskType, 'fields'> | null,
  resolve?: FieldResolver,
): string {
  const def = type?.fields.find((f) => f.primary);
  if (def) {
    const raw = task.type_data[def.key];
    const v = raw !== undefined && raw !== null && resolve ? resolve(def, raw) : fieldText(raw);
    if (v) return v;
  }
  return firstLine(task.body_md) || '空白任务';
}

/** 卡片副标题：有主字段时显示正文首行。 */
export function taskSubtitle(task: Pick<Task, 'body_md' | 'type_data'>, type?: Pick<TaskType, 'fields'> | null): string {
  const key = primaryFieldKey(type);
  if (key && fieldText(task.type_data[key])) return firstLine(task.body_md);
  return '';
}
