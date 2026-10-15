/**
 * Mindough 数据模型。
 * 每条记录：UUIDv7 id + updated_at（HLC 字符串，可字典序比较）+ deleted 墓碑。
 * 不物理删除；同步时按行 / 字段 LWW 合并。
 */

/** 本地日期键，格式 YYYY-MM-DD（按本机时区）。 */
export type DateKey = string;
/** ISO 8601 时间戳（UTC）。 */
export type Timestamp = string;
/** HLC 字符串，见 hlc.ts，字典序即因果序。 */
export type Hlc = string;

export interface BaseRow {
  id: string;
  updated_at: Hlc;
  deleted: boolean;
}

/**
 * 任务状态。结束态只有两种：完成、关闭（Rei 2026-10-15：“任务没有取消之说，只有完成和关闭两种，关闭也是完成状态”）。
 * - 完成：做成了，算成就（热力图、连续天数、组进度）。
 * - 关闭：不做了 / 不需要了，同样算“已结束”：解锁后续、不进待办清单，但不算成就。
 * 两种都可以重新打开（改回待办）。
 */
export type TaskStatus = '待办' | '进行中' | '完成' | '关闭';
export const TASK_STATUSES: readonly TaskStatus[] = ['待办', '进行中', '完成', '关闭'];

/** 已结束（完成或关闭）：满足依赖、不出现在待办 / 可做清单里。 */
export function isFinished(status: TaskStatus): boolean {
  return status === '完成' || status === '关闭';
}

/** 旧数据兼容：M0 存过的“取消”一律视作“关闭”；未知值当“待办”。 */
export function normalizeStatus(status: unknown): TaskStatus {
  if (status === '取消' || status === 'cancelled') return '关闭';
  return (TASK_STATUSES as readonly unknown[]).includes(status) ? (status as TaskStatus) : '待办';
}

/** 完成方式：点一下 / 计时 / 计量 / 倒数日。 */
export type CompletionMode = 'once' | 'timer' | 'count' | 'countdown';
export const COMPLETION_MODE_LABEL: Record<CompletionMode, string> = {
  once: '点一下',
  timer: '计时',
  count: '计量',
  countdown: '倒数日',
};

/** type_data 中的值：按字段定义填写；图片存 asset_id 或链接，人物存 person_id。 */
export type FieldValue = string | number | boolean | string[] | null;

export interface Task extends BaseRow {
  /** 无标题的 markdown 正文；列表显示首行。 */
  body_md: string;
  status: TaskStatus;
  group_id: string | null;
  scheduled_date: DateKey | null;
  type_id: string | null;
  type_data: Record<string, FieldValue>;
  completion_mode: CompletionMode;
  /** 计时：目标毫秒数；计量：目标数量。 */
  target_value: number | null;
  unit: string | null;
  /** 倒数日目标日期。 */
  target_date: DateKey | null;
  /** RRULE 子集，见 recurrence.ts；null 表示不重复。 */
  recurrence: string | null;
  done_at: Timestamp | null;
  sort: number;
  created_at: Timestamp;
}

export type DependencyType = 'FS' | 'SS' | 'FF' | 'SF';

export interface Dependency extends BaseRow {
  pred_id: string;
  succ_id: string;
  /** MVP 只用 FS，其余留作以后。 */
  type: DependencyType;
  /** 延迟（天），MVP 恒为 0。 */
  lag: number;
}

export interface Group extends BaseRow {
  name: string;
  /** emoji 或 lucide 图标名（以 "lucide:" 前缀）。 */
  icon: string;
  start_at: DateKey | null;
  end_at: DateKey | null;
  category_id: string | null;
  default_type_id: string | null;
}

export interface Category extends BaseRow {
  name: string;
  color: string;
}

export type TypeLayout = 'poster' | 'icon_name' | 'banner' | 'text';
export const TYPE_LAYOUT_LABEL: Record<TypeLayout, string> = {
  poster: '海报',
  icon_name: '图标+名称',
  banner: '横幅',
  text: '纯文字',
};

export type FieldKind = 'text' | 'number' | 'progress' | 'date' | 'link' | 'image' | 'select' | 'person' | 'list';

export interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  /** 该字段作为卡片主名称（片名、店名…）。 */
  primary?: boolean;
  /** 该字段作为卡片图片（海报、封面…）。 */
  media?: boolean;
  options?: string[];
  /** progress 字段的单位提示，如 "%"、"页"、"集"。 */
  unit?: string;
  placeholder?: string;
}

export interface TaskType extends BaseRow {
  name: string;
  /** lucide 图标名。 */
  icon: string;
  color: string;
  layout: TypeLayout;
  fields: FieldDef[];
  body_template: string;
  builtin: boolean;
  hidden: boolean;
  default_completion_mode: CompletionMode;
  sort: number;
}

export interface Person extends BaseRow {
  name: string;
  avatar_asset_id: string | null;
  relation: string | null;
  birthday: DateKey | null;
  note_md: string;
}

export interface TaskPerson extends BaseRow {
  task_id: string;
  person_id: string;
}

export interface MyDayEntry extends BaseRow {
  task_id: string;
  /** 本地日期。同步时按 task_id + date 合并。 */
  date: DateKey;
  sort: number;
  added_at: Timestamp;
}

export type CheckInKind = 'start' | 'pause' | 'resume' | 'stop' | 'add';

/** 打卡事件：只追加，不修改；进度一律由事件折叠得出。 */
export interface CheckIn extends BaseRow {
  task_id: string;
  /** 重复任务的周期键；不重复的任务为 "once"。 */
  period_key: string;
  kind: CheckInKind;
  amount: number;
  at: Timestamp;
}

export interface Asset extends BaseRow {
  sha256: string;
  mime: string;
  width: number | null;
  height: number | null;
  /** 同步后才有。 */
  r2_key: string | null;
  /** M0：本地 data URL 或外链，原生端以后改为本地文件路径。 */
  url: string | null;
}

export interface TableMap {
  task: Task;
  dependency: Dependency;
  group: Group;
  category: Category;
  task_type: TaskType;
  person: Person;
  task_person: TaskPerson;
  my_day: MyDayEntry;
  check_in: CheckIn;
  asset: Asset;
}

export type TableName = keyof TableMap;
export const TABLES: readonly TableName[] = [
  'task',
  'dependency',
  'group',
  'category',
  'task_type',
  'person',
  'task_person',
  'my_day',
  'check_in',
  'asset',
];

/** 写入时调用方提供的部分：id / updated_at / deleted 由存储层补齐。 */
export type NewRow<T extends BaseRow> = Omit<T, 'id' | 'updated_at' | 'deleted'> & { id?: string };
