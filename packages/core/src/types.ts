/**
 * Mindough 数据模型。
 * 每条记录：UUIDv7 id + updated_at（HLC 字符串，可字典序比较）+ deleted 墓碑。
 * 不物理删除；同步时按行 / 字段 LWW 合并。
 */
import { tr, trc } from './i18n';

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
/** 状态的显示文字（内部值是中文，显示按当前语言）。 */
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  get 待办() { return trc('状态', '待办'); },
  get 进行中() { return trc('状态', '进行中'); },
  get 完成() { return trc('状态', '完成'); },
  get 关闭() { return trc('状态', '关闭'); },
};

/** 已结束（完成或关闭）：满足依赖、不出现在待办 / 可做清单里。 */
export function isFinished(status: TaskStatus): boolean {
  return status === '完成' || status === '关闭';
}

/** 旧数据兼容：M0 存过的“取消”一律视作“关闭”；未知值当“待办”。 */
export function normalizeStatus(status: unknown): TaskStatus {
  if (status === '取消' || status === 'cancelled') return '关闭';
  return (TASK_STATUSES as readonly unknown[]).includes(status) ? (status as TaskStatus) : '待办';
}

/**
 * 完成方式（内部枚举值不变；界面叫法见 docs/COPY.md）：
 * once 勾选完成 / timer 计时 / count 计数 / countdown 倒数日。
 */
export type CompletionMode = 'once' | 'timer' | 'count' | 'countdown';
export const COMPLETION_MODES: readonly CompletionMode[] = ['once', 'timer', 'count', 'countdown'];
export const COMPLETION_MODE_LABEL: Record<CompletionMode, string> = {
  get once() { return tr('勾选完成'); },
  get timer() { return tr('计时'); },
  get count() { return tr('计数'); },
  get countdown() { return tr('倒数日'); },
};
/** 每种完成方式的一句话说明（新建时给用户挑）。 */
export const COMPLETION_MODE_HINT: Record<CompletionMode, string> = {
  get once() { return tr('做完就打勾'); },
  get timer() { return tr('做够一段时间，如冥想 10 分钟'); },
  get count() { return tr('做够一定数量，如喝 8 杯水'); },
  get countdown() { return tr('等到某一天，如考试、纪念日'); },
};

/** 「更多链接」里的一条：label 只在用户自己改过名字时才存，否则按网址自动认出（EXT、烂番茄、Steam…）。 */
/** 金额字段的值：金额 + 币种（ISO 4217，如 CNY、USD），不做换算。 */
export interface MoneyValue {
  amount: number;
  currency: string;
}

/** 看片进度（episode 字段）：第几季第几集，两者至少有一个。 */
export interface EpisodeValue {
  season?: number;
  episode?: number;
}

export interface LinkValue {
  url: string;
  label?: string;
}

/**
 * type_data 中的值：按字段定义填写；图片存 asset_id 或链接，人物存 person_id，
 * 多选存选中的选项数组，money 存 MoneyValue，site_id 存站点编号（tt0816692、1889243），links 存 LinkValue 数组。
 */
export type FieldValue = string | number | boolean | string[] | LinkValue[] | MoneyValue | EpisodeValue | null;

/** 计数配置（task.count_config）。都可省略。 */
export interface CountConfig {
  /** 每次加多少（正数，可以是小数）。 */
  step?: number;
  /** 手改过步长：之后换单位不再自动填默认步长。 */
  step_set?: boolean;
  /** 快捷按钮（最多三个）；没设过按步长算（见 count.ts quickAmounts）。 */
  quick?: number[];
}

export interface Task extends BaseRow {
  /** 无标题的 markdown 正文；列表显示首行。 */
  body_md: string;
  status: TaskStatus;
  group_id: string | null;
  scheduled_date: DateKey | null;
  /**
   * 结束日（Rei 2026-10-26 日期段，见 date-range.ts）：可空，只会晚于 scheduled_date；空 = 单日（老任务都空）。SQLite 迁移 v11。
   */
  end_date: DateKey | null;
  type_id: string | null;
  type_data: Record<string, FieldValue>;
  completion_mode: CompletionMode;
  /** 计时：目标毫秒数；计量：目标数量。 */
  target_value: number | null;
  unit: string | null;
  /**
   * 计数的步长和快捷按钮（Rei 2026-10-26，见 count.ts）。空对象 = 老任务（步长 1、只有 +1）。SQLite 迁移 v9。
   */
  count_config: CountConfig;
  /** 倒数日目标日期。 */
  target_date: DateKey | null;
  /** RRULE 子集，见 recurrence.ts；null 表示不重复。 */
  recurrence: string | null;
  /**
   * 类型（统一的分类，见 categories.ts；Rei 2026-10-26）：任何任务都能挂一个，指向 category 表；可空。SQLite 迁移 v11。
   * 读的时候用 store.categoryOf(task)（会顺着合并找到留下的那个）。
   */
  category_id: string | null;
  /**
   * 旧字段：以前的打卡分类。v11 起只为旧客户端留着——本机写任务时把 category_id 抄过来；
   * 拉到没有 category_id 的旧任务时，拿它当 category_id。别的地方别读它。
   */
  checkin_category_id: string | null;
  /**
   * 资料库里的一条资料（片名、海报、作者…都在资料上）；可空。
   * 多件任务可以指向同一条资料（重看、再去一次）。type_data 只放这件任务自己的字段（看到第几集…）。
   * 人物类型不走这里，仍用 type_data.person 指向 person 表。
   */
  library_item_id: string | null;
  /**
   * 提醒时间「HH:MM」（本机时区），可空。只做一次的任务：到期那天（日期，或倒数日的目标日）这个时间提醒；
   * 定期打卡：每个要打卡的日子这个时间提醒（「每天 X 点提醒」）。计时到点的提醒不靠它（总会提醒）。SQLite 迁移 v4。
   */
  remind_time: string | null;
  /**
   * 任务时区（Rei 2026-10-25）：IANA 名，如 'America/New_York'；空 = 跟着设备当前时区（浮动），老任务都是空。
   * 日期和提醒时间按这个时区的墙上时间解释（见 timezone.ts）。SQLite 迁移 v8。
   */
  time_zone: string | null;
  /**
   * 单值的签名（多类型与多资料，Rei 2026-10-28，见 task-refs.ts）：新客户端写任务时记 `category_id|library_item_id`。
   * 旧客户端不认这一列，推上来的行没有它或对不上，就知道单值是旧客户端改的。SQLite 迁移 v12。
   */
  refs_mirror: string | null;
  done_at: Timestamp | null;
  sort: number;
  created_at: Timestamp;
}

/**
 * 任务挂的类型（多对多，Rei 2026-10-28「一个任务可以关联多个类型」）。id = taskCategoryId(task_id, category_id)。
 * 第一个（sort 最小）同时写进 task.category_id，给旧客户端看。SQLite 迁移 v12。
 */
export interface TaskCategory extends BaseRow {
  task_id: string;
  category_id: string;
  sort: number;
  created_at: Timestamp;
}

/**
 * 任务挂的资料（多对多，Rei 2026-10-28「一个任务可以连多个资料库的资料」），资料来自哪个库都行。
 * id = taskItemId(task_id, item_id)。第一条同时写进 task.library_item_id（和它的库 task.type_id）。人物不在这里，还是 task_person。
 */
export interface TaskItem extends BaseRow {
  task_id: string;
  item_id: string;
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

/**
 * 类型（统一的分类，Rei 2026-10-26，见 categories.ts）：原来的项目分类 + 打卡分类合成的一套。
 * 任务和项目共用；能加、改名 / 颜色 / 图标、不显示，不能删。v11 加了 icon、builtin、hidden、sort、merged_into。
 */
export interface Category extends BaseRow {
  name: string;
  color: string;
  /** lucide 图标名；空 = 默认 tag（老项目分类没有图标）。 */
  icon: string;
  /** 内置的 27 个（原打卡分类，固定 id）。 */
  builtin: boolean;
  /** 不显示：选择器里不出现，已经挂着的照常显示。 */
  hidden: boolean;
  sort: number;
  /** 同名合并时被并掉的那行记下留下的 id（同时打墓碑）；没并过 = null。 */
  merged_into: string | null;
}

/** 版式（也决定资料库里图的形状）：poster 竖版海报 2:3、icon_name 方形、banner 横幅 16:9、round 圆形（M4 加）、text 纯文字（普通）。 */
export type TypeLayout = 'poster' | 'icon_name' | 'banner' | 'round' | 'text';
export const TYPE_LAYOUT_LABEL: Record<TypeLayout, string> = {
  get poster() { return tr('竖版海报'); },
  get icon_name() { return tr('方形'); },
  get banner() { return tr('横幅'); },
  get round() { return tr('圆形'); },
  get text() { return tr('纯文字'); },
};

/**
 * 字段种类。multiselect = 多选（选项见 options，存 string[]）；site_id = 某个站点上的编号（见 site，
 * 只存编号、显示成链接，如 IMDb / 豆瓣）；money = 金额 + 币种（见 money.ts）；episode = 看到第几季第几集（见 episode.ts）；links = 一组可增删的链接（更多链接），各类型通用。
 */
export type FieldKind = 'text' | 'number' | 'progress' | 'date' | 'link' | 'image' | 'select' | 'multiselect' | 'money' | 'episode' | 'person' | 'list' | 'site_id' | 'links';

export interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  /** 该字段作为卡片主名称（片名、店名…）。 */
  primary?: boolean;
  /** 该字段作为卡片图片（海报、封面…）。 */
  media?: boolean;
  options?: string[];
  /** site_id 字段的站点（见 links.ts 的 SITES）。 */
  site?: string;
  /** progress 字段的单位提示，如 "%"、"页"、"集"。 */
  unit?: string;
  placeholder?: string;
  /**
   * 字段属于谁：'item' 资料字段（属于这部片 / 这本书本身，存在 library_item 上，多件任务共用），
   * 'task' 任务字段（属于这一次：看到第几集、读到第几页、这次的预算）。
   * 省略视作 'item'；主字段（primary）与图片字段（media）总是资料字段。
   */
  scope?: 'item' | 'task';
  /** 隐藏：编辑器里还在，新建 / 详情 / 资料页不显示，值保留（M4 类型编辑器）。 */
  hidden?: boolean;
  /** 删掉了：只留这条墓碑（key 不再分给别的字段），值留在数据里不显示；加回同名同种类的字段就翻回来。见 typedef.ts。 */
  removed?: boolean;
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
  /**
   * 归档（Rei 2026-10-17：类型不能删，只能改、能归档）。列名沿用 M4 初版的 hidden（不加列、不加迁移），
   * 旧数据里 hidden=true（以前的「隐藏」）读出来就是归档。导出 JSON 写 archived，导入兼容 hidden。见 library.ts isArchivedType。
   */
  hidden: boolean;
  default_completion_mode: CompletionMode;
  sort: number;
}

/**
 * 旧的打卡分类表（v11 起合进 category，见 categories.ts）。表还留着：旧客户端还会同步这张表，拉到的行映射进 category。
 */
export interface CheckInCategory extends BaseRow {
  name: string;
  /** lucide 图标名。 */
  icon: string;
  color: string;
  builtin: boolean;
  hidden: boolean;
  sort: number;
}

export interface Person extends BaseRow {
  name: string;
  avatar_asset_id: string | null;
  relation: string | null;
  birthday: DateKey | null;
  note_md: string;
  /**
   * 合并进了哪个人（M4 资料合并）：合并时来源打墓碑并记下目标 id，读的时候顺着它找到留下的那个人。SQLite 迁移 v5。
   * 没合并过 = null（旧数据没有这一列，读入时补 null）。
   */
  merged_into?: string | null;
}

/**
 * 资料库里的一条资料：每种非“普通”的类型各有一个库（影视库、书库…），自定义类型自动有库。
 * name = 主字段（片名、书名…），image = 图片字段（asset id 或外链），fields = 其余资料字段。
 */
export interface LibraryItem extends BaseRow {
  type_id: string;
  name: string;
  /** asset id、外链或 data URL（与 type_data 里的图片字段同一种写法）。 */
  image: string | null;
  fields: Record<string, FieldValue>;
  note_md: string;
  created_at: Timestamp;
  /**
   * 合并进了哪条资料（M4 资料合并）：来源打墓碑并记下目标 id。别的设备离线新建、还指向旧 id 的任务，
   * 读的时候顺着 merged_into 找到目标（Store.resolveItemId），同步后再改写过来。SQLite 迁移 v5。
   */
  merged_into?: string | null;
}

export interface TaskPerson extends BaseRow {
  task_id: string;
  person_id: string;
}

/**
 * 相关任务：两件任务只是有关系，没有先后（Rei 2026-10-15：“任务只是有关系，但没有FS关系”）。
 * 无方向、不阻塞：不解锁、不进环检测、关系图上画成没有箭头的虚线。
 * 规范顺序 a_task_id < b_task_id，id 由这一对算出（见 related.ts 的 taskLinkId），
 * 所以两台设备各自连同一对会得到同一行，同步时自然合并；去掉再连上 = 同一行墓碑翻回来。
 */
export interface TaskLink extends BaseRow {
  a_task_id: string;
  b_task_id: string;
  /** 一句说明（为什么相关）；界面暂不编辑，先留着。 */
  note: string;
  created_at: Timestamp;
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

/**
 * 用户偏好（跟着账户同步的设置，比如界面语言）：一键一行，id 由 key 算出（各设备同一行，LWW 合并）。SQLite 迁移 v4。
 * 只放应该跨设备一致的；皮肤、明暗这类跟设备走的仍在本机设置里。
 */
export interface Pref extends BaseRow {
  key: string;
  value: FieldValue;
}

/**
 * 日记（Rei 2026-10-17）：一天一篇，id 由日期算（journal.ts 的 journalEntryId）。SQLite 迁移 v6。
 * 正文整段后写赢，另加一道保护：两台设备都改了同一天、互相没看到对方那版时，输掉的那版收进末尾折叠块（见 journal.ts）。
 */
export interface JournalEntry extends BaseRow {
  /** 本地日期（按「一天从几点开始」算的那一天）。 */
  date: DateKey;
  body_md: string;
  /** 心情的稳定 id（journal.ts 的 MOOD_IDS），可空；不认识的（新版本加的）原样保留。 */
  mood: string | null;
  /**
   * 这一版是在哪一版「别的设备写的」内容上改的（那一版的 updated_at）；从没见过别的设备的版本时为 null。
   * 同一台设备连着改不变。拉下来的一版 base_at 早于本机这版 = 它没看到本机写的，触发同步保护。
   */
  base_at: Hlc | null;
  created_at: Timestamp;
}

/**
 * 日记的一条（Rei 2026-10-28 改成 Feed 流：「一天可以添加很多条。每一条都可以标记心情」「a feed提交之后就不能修改了，心情也不能修改」）。
 * SQLite 迁移 v13。只追加，和 check_in 一样：发出去以后正文、心情、日子都不能改，只能删（打墓碑）和撤销删除。
 * 新写的 id 是随机的 UUIDv7；旧的一天一篇（journal_entry）转过来的，id 由那篇的 id 算（journal-feed.ts 的 migratedPostId），各设备转出来一样。
 */
export interface JournalPost extends BaseRow {
  /** 算在哪天（按「一天从几点开始」，默认 5 点）。 */
  day: DateKey;
  body_md: string;
  /** 心情的稳定 id（journal.ts 的 MOOD_IDS），可空；不认识的（新版本加的）原样保留。 */
  mood: string | null;
  /** 发出去的时刻（列表里显示的时间、同一天里的先后都按它）。 */
  created_at: Timestamp;
}

/**
 * 附件（Rei 2026-10-17）：挂在任务详情或日记上的文件。SQLite 迁移 v7。
 * 原文件不压缩、不改尺寸，传到 R2（Worker /api/files，要登录才能读）；图片另有一张小缩略图（thumb_key）给网格用。
 * 还没传上去时 r2_key 为 null：文件在本机的上传队列里（lib/attachments-queue.ts），别的设备显示「还在另一台设备上」。
 */
export interface Attachment extends BaseRow {
  /** 挂在哪：task（任务）或 journal（日记，owner_id = 那天的 journalEntryId）。不认识的（新版本加的）原样保留、不显示。 */
  owner_type: AttachmentOwnerType | string;
  owner_id: string;
  /** 原文件名（下载时用它）；可以改名。 */
  file_name: string;
  mime: string;
  /** 字节数。 */
  size: number;
  r2_key: string | null;
  thumb_key: string | null;
  /** 图片的原始宽高（不是缩略图的）；不是图片 / 读不出来为 null。 */
  width: number | null;
  height: number | null;
  created_at: Timestamp;
}

export type AttachmentOwnerType = 'task' | 'journal';

export interface TableMap {
  task: Task;
  dependency: Dependency;
  group: Group;
  category: Category;
  task_type: TaskType;
  person: Person;
  task_person: TaskPerson;
  task_category: TaskCategory;
  task_item: TaskItem;
  task_link: TaskLink;
  my_day: MyDayEntry;
  check_in: CheckIn;
  checkin_category: CheckInCategory;
  asset: Asset;
  library_item: LibraryItem;
  pref: Pref;
  journal_entry: JournalEntry;
  journal_post: JournalPost;
  attachment: Attachment;
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
  'task_category',
  'task_item',
  'my_day',
  'check_in',
  'checkin_category',
  'asset',
  'library_item',
  'task_link',
  'pref',
  'journal_entry',
  'journal_post',
  'attachment',
];

/** 写入时调用方提供的部分：id / updated_at / deleted 由存储层补齐。 */
export type NewRow<T extends BaseRow> = Omit<T, 'id' | 'updated_at' | 'deleted'> & { id?: string };
