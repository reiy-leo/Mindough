/**
 * 内置任务类型：普通 + 10 种。与自定义类型走同一套 layout + fields + body_template 机制。
 * id 固定（UUIDv7 格式、时间戳 0），各设备生成同一批内置类型，同步时自然合并。
 */
import type { FieldDef, TaskType } from '../types';

export const PLAIN_TYPE_ID = '00000000-0000-7000-8000-000000000000';
const tid = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;

export const BUILTIN_TYPE_IDS = {
  plain: PLAIN_TYPE_ID,
  movie: tid(1),
  game: tid(2),
  book: tid(3),
  project: tid(4),
  course: tid(5),
  travel: tid(6),
  shopping: tid(7),
  restaurant: tid(8),
  meal: tid(9),
  person: tid(10),
} as const;

/**
 * 内置定义的版本戳。改了内置类型的定义（如资料库拆分 资料字段 / 任务字段）就把序号加一：
 * 打开时，存着的内置类型若仍是更早的内置版本（用户没改过），自动换成新定义；用户改过的（真实 HLC）不动。
 * r1 = 资料库（2026-10-15）；r2 = 影视去掉「平台」、加 IMDb / 豆瓣 / 更多链接，游戏「平台」改多选、加更多链接，购物「价格」改金额 + 币种，「看到哪」认 S02E03 / 第二季第三集（2026-10-15）。
 */
export const BUILTIN_TYPES_REVISION = '0000000000000-0002-builtin';

/** 游戏平台的选项（多选；界面文案见 docs/COPY.md）。 */
export const GAME_PLATFORMS = [
  'PC（Steam）',
  'PC（Epic）',
  'PC（其他）',
  'PlayStation 5',
  'PlayStation 4',
  'Xbox Series X|S',
  'Xbox One',
  'Nintendo Switch',
  'Switch 2',
  'iOS',
  'Android',
  'macOS',
  'Linux / Steam Deck',
  '网页',
  '其他',
];
const BASE = { updated_at: BUILTIN_TYPES_REVISION, deleted: false, builtin: true, hidden: false } as const;

export const BUILTIN_TASK_TYPES: TaskType[] = [
  {
    ...BASE,
    id: BUILTIN_TYPE_IDS.plain,
    name: '普通',
    icon: 'file-text',
    color: '#8e8e93',
    layout: 'text',
    fields: [],
    body_template: '',
    default_completion_mode: 'once',
    sort: 0,
  },
  {
    ...BASE,
    id: BUILTIN_TYPE_IDS.movie,
    name: '影视',
    icon: 'clapperboard',
    color: '#ff6b5b',
    layout: 'poster',
    fields: [
      { key: 'title', label: '片名', kind: 'text', primary: true, placeholder: '比如：沙丘 2' },
      { key: 'poster', label: '海报', kind: 'image', media: true },
      { key: 'year', label: '年份', kind: 'number' },
      { key: 'kind', label: '电影/剧集', kind: 'select', options: ['电影', '剧集'] },
      { key: 'imdb', label: 'IMDb', kind: 'site_id', site: 'imdb' },
      { key: 'douban', label: '豆瓣', kind: 'site_id', site: 'douban' },
      { key: 'links', label: '更多链接', kind: 'links' },
      { key: 'episode', label: '看到哪', kind: 'episode', placeholder: '第 2 季第 3 集，或 S02E03', scope: 'task' },
    ],
    body_template: '## 想看理由\n\n\n## 观后感\n',
    default_completion_mode: 'once',
    sort: 1,
  },
  {
    ...BASE,
    id: BUILTIN_TYPE_IDS.game,
    name: '游戏',
    icon: 'gamepad-2',
    color: '#7c5cff',
    layout: 'icon_name',
    fields: [
      { key: 'name', label: '游戏名', kind: 'text', primary: true },
      { key: 'icon', label: '图标', kind: 'image', media: true },
      { key: 'platform', label: '平台', kind: 'multiselect', options: GAME_PLATFORMS },
      { key: 'links', label: '更多链接', kind: 'links' },
      { key: 'progress', label: '进度', kind: 'progress', unit: '%', scope: 'task' },
    ],
    body_template: '## 目标\n\n\n## 心得\n',
    default_completion_mode: 'once',
    sort: 2,
  },
  {
    ...BASE,
    id: BUILTIN_TYPE_IDS.book,
    name: '书籍',
    icon: 'book-open',
    color: '#c58b3d',
    layout: 'poster',
    fields: [
      { key: 'title', label: '书名', kind: 'text', primary: true },
      { key: 'cover', label: '封面', kind: 'image', media: true },
      { key: 'author', label: '作者', kind: 'text' },
      { key: 'total_pages', label: '页数', kind: 'number', unit: '页' },
      { key: 'pages', label: '读到第几页', kind: 'progress', unit: '页', scope: 'task' },
    ],
    body_template: '## 摘录\n\n\n## 笔记\n',
    default_completion_mode: 'once',
    sort: 3,
  },
  {
    ...BASE,
    id: BUILTIN_TYPE_IDS.project,
    name: '项目',
    icon: 'folder-git-2',
    color: '#2f80ed',
    layout: 'icon_name',
    fields: [
      { key: 'name', label: '项目名', kind: 'text', primary: true },
      { key: 'icon', label: '图标', kind: 'image', media: true },
      { key: 'link', label: '仓库或链接', kind: 'link' },
    ],
    body_template: '## 目标\n\n\n## 下一步\n- [ ] \n',
    default_completion_mode: 'once',
    sort: 4,
  },
  {
    ...BASE,
    id: BUILTIN_TYPE_IDS.course,
    name: '课程',
    icon: 'graduation-cap',
    color: '#00a6a6',
    layout: 'icon_name',
    fields: [
      { key: 'name', label: '课程名', kind: 'text', primary: true },
      { key: 'icon', label: '图标', kind: 'image', media: true },
      { key: 'platform', label: '平台', kind: 'text' },
      { key: 'link', label: '链接', kind: 'link' },
      { key: 'lessons', label: '学到第几课', kind: 'progress', unit: '课', scope: 'task' },
    ],
    body_template: '## 笔记\n',
    default_completion_mode: 'once',
    sort: 5,
  },
  {
    ...BASE,
    id: BUILTIN_TYPE_IDS.travel,
    name: '旅行',
    icon: 'plane',
    color: '#0a84ff',
    layout: 'banner',
    fields: [
      { key: 'destination', label: '目的地', kind: 'text', primary: true },
      { key: 'photo', label: '照片', kind: 'image', media: true },
      { key: 'depart', label: '出发日期', kind: 'date', scope: 'task' },
      { key: 'return', label: '返回日期', kind: 'date', scope: 'task' },
    ],
    body_template: '## 行程\n\n\n## 待办\n- [ ] \n',
    default_completion_mode: 'countdown',
    sort: 6,
  },
  {
    ...BASE,
    id: BUILTIN_TYPE_IDS.shopping,
    name: '购物',
    icon: 'shopping-bag',
    color: '#ff9f0a',
    layout: 'icon_name',
    fields: [
      { key: 'name', label: '名称', kind: 'text', primary: true },
      { key: 'image', label: '图片', kind: 'image', media: true },
      { key: 'price', label: '价格', kind: 'money' },
      { key: 'link', label: '链接', kind: 'link' },
      { key: 'quantity', label: '买几件', kind: 'number', scope: 'task' },
    ],
    body_template: '## 备注\n',
    default_completion_mode: 'once',
    sort: 7,
  },
  {
    ...BASE,
    id: BUILTIN_TYPE_IDS.restaurant,
    name: '餐厅',
    icon: 'utensils',
    color: '#e8590c',
    layout: 'banner',
    fields: [
      { key: 'name', label: '店名', kind: 'text', primary: true },
      { key: 'photo', label: '照片', kind: 'image', media: true },
      { key: 'address', label: '地址', kind: 'text' },
      { key: 'link', label: '链接', kind: 'link' },
    ],
    body_template: '## 想吃什么\n\n\n## 评价\n',
    default_completion_mode: 'once',
    sort: 8,
  },
  {
    ...BASE,
    id: BUILTIN_TYPE_IDS.meal,
    name: '饮食',
    icon: 'salad',
    color: '#34c759',
    layout: 'banner',
    fields: [
      { key: 'dish', label: '菜名', kind: 'text', primary: true },
      { key: 'photo', label: '照片', kind: 'image', media: true },
      { key: 'ingredients', label: '食材清单', kind: 'list' },
      { key: 'meal', label: '餐次', kind: 'select', options: ['早餐', '午餐', '晚餐', '加餐'], scope: 'task' },
    ],
    body_template: '## 做法\n\n\n## 感受\n',
    default_completion_mode: 'once',
    sort: 9,
  },
  {
    ...BASE,
    id: BUILTIN_TYPE_IDS.person,
    name: '人物',
    icon: 'user-round',
    color: '#af52de',
    layout: 'icon_name',
    fields: [
      { key: 'person', label: '人物', kind: 'person', primary: true, media: true },
      { key: 'reason', label: '事由', kind: 'text', scope: 'task' },
    ],
    body_template: '## 要聊什么\n\n\n## 备注\n',
    default_completion_mode: 'once',
    sort: 10,
  },
];

/** 内置定义的版本戳（「0000000000000-000N-builtin」）；真实 HLC 是用户改过的。 */
export const isBuiltinStamp = (updatedAt: string) => /^0{13}-\d{4}-builtin$/.test(updatedAt);

/**
 * 用户改过的内置类型：保留它的字段，补上新内置定义里新增、它还没有的字段（按 key 判断），
 * 插在新定义里前一个字段之后（找不到就放最后）。已有字段一个不动。
 */
export function withNewBuiltinFields(cur: readonly FieldDef[], next: readonly FieldDef[]): FieldDef[] {
  const out = [...cur];
  const has = new Set(cur.map((f) => f.key));
  next.forEach((f, i) => {
    if (has.has(f.key)) return;
    let at = out.length;
    for (let j = i - 1; j >= 0; j--) {
      const k = out.findIndex((x) => x.key === next[j]!.key);
      if (k >= 0) {
        at = k + 1;
        break;
      }
    }
    out.splice(at, 0, { ...f });
    has.add(f.key);
  });
  return out;
}
