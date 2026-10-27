/**
 * 资料库：每种非“普通”的类型各有一个库（影视库、书库、游戏库…），自定义类型自动有库。
 * 一条资料（library_item）存属于“这部片 / 这本书本身”的资料字段；任务只引用它（library_item_id），
 * 自己的 type_data 里只放任务字段（看到第几集、读到第几页、这次的预算）。
 * 人物类型的库就是 person 表（人物库），这里用 LibraryEntry 把两者统一成一个样子。
 *
 * 界面叫法见 docs/COPY.md（资料库、影视库、书库…、「新建“xxx”」、「换一个」「编辑资料」）。
 */
import { BUILTIN_TYPE_IDS, PLAIN_TYPE_ID } from './seed/builtin-types';
import { fieldText } from './preview';
import { isLinkField, linkChips, matchOptions, type LinkChip } from './links';
import { DEFAULT_CURRENCY, moneyOf } from './money';
import { isShownField } from './typedef';
import { isHiddenFieldKey, sourceOfFields, type ItemSource } from './lookup';
import type { FieldDef, FieldValue, LibraryItem, Person, Task, TaskType } from './types';

import { dataLabel, tr } from './i18n';

// ───────────── 叫法 ─────────────

export interface LibraryCopy {
  /** 库名：影视库、书库… */
  name: string;
  /** 短名（资料库页的分段）：影视、书… */
  short: string;
  /** 选择框占位：选一部影视… */
  pick: string;
  /** 量词：部、本、款… */
  measure: string;
  /** 条数：「12 部」/「12 titles」。 */
  count(n: number): string;
  /** 空库时的按钮：「添加第一部」/「Add your first title」。 */
  addFirst: string;
}

const B = BUILTIN_TYPE_IDS;
export const LIBRARY_COPY: Record<string, LibraryCopy> = {
  [B.movie]: { get name() { return tr('影视库'); }, get short() { return tr('影视'); }, get pick() { return tr('选一部影视…'); }, get measure() { return tr('部'); }, count: (n) => tr('{n} 部', { n }), get addFirst() { return tr('添加第一部'); } },
  [B.book]: { get name() { return tr('书库'); }, get short() { return tr('书'); }, get pick() { return tr('选一本书…'); }, get measure() { return tr('本'); }, count: (n) => tr('{n} 本', { n }), get addFirst() { return tr('添加第一本'); } },
  [B.game]: { get name() { return tr('游戏库'); }, get short() { return tr('游戏'); }, get pick() { return tr('选一款游戏…'); }, get measure() { return tr('款'); }, count: (n) => tr('{n} 款', { n }), get addFirst() { return tr('添加第一款'); } },
  [B.project]: { get name() { return tr('项目库'); }, get short() { return tr('项目'); }, get pick() { return tr('选一个项目…'); }, get measure() { return tr('个'); }, count: (n) => tr('{n} 个项目', { n }), get addFirst() { return tr('添加第一个项目'); } },
  [B.course]: { get name() { return tr('课程库'); }, get short() { return tr('课程'); }, get pick() { return tr('选一门课…'); }, get measure() { return tr('门'); }, count: (n) => tr('{n} 门课', { n }), get addFirst() { return tr('添加第一门课'); } },
  [B.travel]: { get name() { return tr('目的地'); }, get short() { return tr('目的地'); }, get pick() { return tr('选一个目的地…'); }, get measure() { return tr('个'); }, count: (n) => tr('{n} 个目的地', { n }), get addFirst() { return tr('添加第一个目的地'); } },
  [B.shopping]: { get name() { return tr('好物清单'); }, get short() { return tr('好物'); }, get pick() { return tr('选一件东西…'); }, get measure() { return tr('件'); }, count: (n) => tr('{n} 件', { n }), get addFirst() { return tr('添加第一件'); } },
  [B.restaurant]: { get name() { return tr('餐厅库'); }, get short() { return tr('餐厅'); }, get pick() { return tr('选一家餐厅…'); }, get measure() { return tr('家'); }, count: (n) => tr('{n} 家', { n }), get addFirst() { return tr('添加第一家'); } },
  [B.meal]: { get name() { return tr('菜谱'); }, get short() { return tr('菜谱'); }, get pick() { return tr('选一道菜…'); }, get measure() { return tr('道'); }, count: (n) => tr('{n} 道菜', { n }), get addFirst() { return tr('添加第一道菜'); } },
  [B.person]: { get name() { return tr('人物'); }, get short() { return tr('人物'); }, get pick() { return tr('选一个人…'); }, get measure() { return tr('位'); }, count: (n) => tr('{n} 位', { n }), get addFirst() { return tr('添加第一位'); } },
};

export function libraryCopy(type: Pick<TaskType, 'id' | 'name'>): LibraryCopy {
  return LIBRARY_COPY[type.id] ?? { name: tr('{name}库', { name: type.name }), short: type.name, pick: tr('选一个{name}…', { name: type.name }), measure: tr('个'), count: (n) => tr('{n} 个', { n }), addFirst: tr('添加第一个') };
}

// ───────────── 字段拆分 ─────────────

export const isItemField = (f: FieldDef) => f.primary || f.media || f.scope !== 'task';
export const isTaskField = (f: FieldDef) => !isItemField(f);

/** 有资料库的类型：非普通、有主字段。 */
export function hasLibrary(type: Pick<TaskType, 'id' | 'fields'> | null | undefined): type is TaskType {
  return !!type && type.id !== PLAIN_TYPE_ID && type.fields.some((f) => f.primary);
}

/** 人物类型：库就是 person 表。 */
/**
 * 归档的类型（Rei 2026-10-17：类型只能改、能归档，不能删）。存储沿用 task_type.hidden 列（不加列、不加迁移），
 * 语义是「归档」：任何选择器、资料库标签条、搜索、类型编辑器主列表里都不出现；引用它的任务和资料照常显示。
 */
export function isArchivedType(t: Pick<TaskType, 'hidden'> | null | undefined): boolean {
  return !!t?.hidden;
}

/** 新建 / 改类型时能选的类型：不含归档的，也不含「人物」（任务本身就能关联人物，Rei 2026-10-16 删掉了这个分类；人物库仍在）。 */
export function isPickableType(t: Pick<TaskType, 'id' | 'hidden'>): boolean {
  return !isArchivedType(t) && t.id !== BUILTIN_TYPE_IDS.person;
}

export function isPersonLibrary(type: Pick<TaskType, 'fields'> | null | undefined): boolean {
  return !!type?.fields.find((f) => f.primary)?.kind && type.fields.find((f) => f.primary)!.kind === 'person';
}

/** 显示的资料字段（不含隐藏、删掉的；见 typedef.ts）。 */
export function itemFieldsOf(type: Pick<TaskType, 'fields'> | null | undefined): FieldDef[] {
  return (type?.fields ?? []).filter((f) => isShownField(f) && isItemField(f));
}

/** 显示的任务字段（不含隐藏、删掉的）。改类型时要留的值用 allTaskFieldsOf。 */
export function taskFieldsOf(type: Pick<TaskType, 'fields'> | null | undefined): FieldDef[] {
  return (type?.fields ?? []).filter((f) => isShownField(f) && isTaskField(f));
}

/** 全部任务字段（含隐藏、删掉的）：数据保留用。 */
export function allTaskFieldsOf(type: Pick<TaskType, 'fields'> | null | undefined): FieldDef[] {
  return (type?.fields ?? []).filter(isTaskField);
}

/** 资料字段里除主字段、图片外的那些（年份、作者、平台、链接…）。 */
export function extraItemFieldsOf(type: Pick<TaskType, 'fields'> | null | undefined): FieldDef[] {
  return itemFieldsOf(type).filter((f) => !f.primary && !f.media);
}

/** 一条资料展开成 type_data 的样子（主字段 = name，图片字段 = image）。 */
/** 资料页「事实」列表里显示的字段：除去链接类（链接单独显示成一排）。 */
export function factFieldsOf(type: Pick<TaskType, 'fields'> | null | undefined): FieldDef[] {
  return extraItemFieldsOf(type).filter((f) => !isLinkField(f));
}

export function itemData(type: Pick<TaskType, 'fields'> | null | undefined, item: Pick<LibraryItem, 'name' | 'image' | 'fields'>): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = { ...item.fields };
  const p = type?.fields.find((f) => f.primary);
  const m = type?.fields.find((f) => f.media && !f.primary);
  if (p) out[p.key] = item.name;
  if (m && item.image) out[m.key] = item.image;
  return out;
}

/** 任务显示用的完整数据：资料 + 任务自己的字段（任务字段同名时以任务为准）。 */
export function mergedData(type: Pick<TaskType, 'fields'> | null | undefined, task: Pick<Task, 'type_data'>, item: LibraryItem | null | undefined): Record<string, FieldValue> {
  if (!item) return task.type_data;
  return { ...itemData(type, item), ...task.type_data };
}

const empty = (v: FieldValue | undefined) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.every((x) => !x));

/** 把一份 type_data 拆成 资料部分 与 任务部分。 */
export function splitTypeData(type: Pick<TaskType, 'fields'>, data: Record<string, FieldValue>) {
  const p = type.fields.find((f) => f.primary);
  const m = type.fields.find((f) => f.media && !f.primary);
  const name = p ? fieldText(data[p.key]).trim() : '';
  const image = m && typeof data[m.key] === 'string' && data[m.key] ? (data[m.key] as string) : null;
  const fields: Record<string, FieldValue> = {};
  const task: Record<string, FieldValue> = {};
  const defs = new Map(type.fields.map((f) => [f.key, f]));
  for (const [k, v] of Object.entries(data)) {
    const def = defs.get(k);
    if (def === p || def === m) continue;
    // 类型里已经没有的字段：留在任务上（改类型时“先隐藏不删”）
    if (!def || isTaskField(def)) task[k] = v;
    else if (!empty(v)) fields[k] = v;
  }
  return { name, image, fields, task };
}

// ───────────── 去重与搜索 ─────────────

/** 去重用的名字：全角转半角、小写、去掉空白与常见标点（「沙丘 2」=「沙丘2」=「沙丘·2」）。 */
export function normalizeName(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s·・.,，。:：;；!！?？'"“”‘’()（）[\]【】《》<>\-—_/\\|]+/g, '');
}

/** 统一的资料条目：资料库里的一条资料，或人物库里的一个人。 */
export interface LibraryEntry {
  kind: 'item' | 'person';
  id: string;
  type_id: string;
  name: string;
  /** asset id / 外链 / data URL。 */
  image: string | null;
  /** 一行简介：2024 · 电影 · 影院、刘慈欣… */
  subtitle: string;
  /** 参与搜索的其余文本。 */
  keywords: string;
  /** 最近一次用到（或新建）的时间，毫秒。 */
  recency: number;
  /** 有几件任务用到它。 */
  uses: number;
  /** 资料上的链接（IMDb、豆瓣、更多链接…），按显示顺序。 */
  links?: LinkChip[];
  /** 在线补全来的资料：来源（「资料来自 TMDB」）。 */
  source?: ItemSource | null;
}

/** 一行简介：取前三个有值的简单资料字段。 */
export function itemSubtitle(type: Pick<TaskType, 'fields'> | null | undefined, fields: Record<string, FieldValue>): string {
  return extraItemFieldsOf(type)
    .filter((f) => f.kind === 'text' || f.kind === 'number' || f.kind === 'select' || f.kind === 'multiselect' || f.kind === 'money')
    .map((f) => fieldDisplay(f, fields[f.key]))
    .filter(Boolean)
    .slice(0, 3)
    .join(' · ');
}

/** 一个资料字段的显示文本：数字带单位（302 页、1299 元）。 */
export function fieldDisplay(f: Pick<FieldDef, 'kind' | 'unit'>, v: FieldValue | undefined): string {
  const t = fieldText(v).trim();
  if (!t) return '';
  return f.kind === 'number' && f.unit ? `${t} ${dataLabel(f.unit)}` : t;
}

export function entryOfItem(type: TaskType | undefined, item: LibraryItem, recency: number, uses: number): LibraryEntry {
  return {
    kind: 'item',
    id: item.id,
    type_id: item.type_id,
    name: item.name,
    image: item.image,
    subtitle: itemSubtitle(type, item.fields),
    keywords: Object.entries(item.fields).filter(([k]) => !isHiddenFieldKey(k)).map(([, v]) => fieldText(v)).join(' '),
    recency,
    uses,
    links: linkChips(type?.fields, item.fields),
    source: sourceOfFields(item.fields),
  };
}

export function entryOfPerson(typeId: string, p: Person, recency: number, uses: number): LibraryEntry {
  return { kind: 'person', id: p.id, type_id: typeId, name: p.name, image: p.avatar_asset_id, subtitle: p.relation ?? '', keywords: p.note_md, recency, uses };
}

/** 名字与查询的模糊匹配分：完全一致 > 开头 > 包含 > 按顺序出现（如「王泪」→「王国之泪」）；0 = 不匹配。 */
export function fuzzyScore(name: string, query: string): number {
  const h = normalizeName(name);
  const q = normalizeName(query);
  if (!q) return 1;
  if (!h) return 0;
  if (h === q) return 100;
  if (h.startsWith(q)) return 80 - Math.min(20, h.length - q.length);
  const i = h.indexOf(q);
  if (i >= 0) return 60 - Math.min(20, i);
  // 子序列：每个字按顺序出现，越紧凑分越高
  let pos = -1;
  let gaps = 0;
  for (const ch of q) {
    const next = h.indexOf(ch, pos + 1);
    if (next < 0) return 0;
    if (pos >= 0) gaps += next - pos - 1;
    pos = next;
  }
  return Math.max(5, 30 - gaps * 2);
}

/** 在一个库里搜：空查询按最近用到排；有查询按匹配分，同分按最近。简介 / 其余字段也能搜到，分低一些。 */
export function searchLibrary(entries: readonly LibraryEntry[], query: string, limit = 50): LibraryEntry[] {
  const q = query.trim();
  if (!q) return [...entries].sort((a, b) => b.recency - a.recency).slice(0, limit);
  const scored: Array<[LibraryEntry, number]> = [];
  for (const e of entries) {
    const s = Math.max(fuzzyScore(e.name, q), normalizeName(`${e.subtitle} ${e.keywords}`).includes(normalizeName(q)) ? 20 : 0);
    if (s > 0) scored.push([e, s]);
  }
  return scored
    .sort((a, b) => b[1] - a[1] || b[0].recency - a[0].recency)
    .slice(0, limit)
    .map(([e]) => e);
}

/** 库里已有完全同名（规范化后）的条目。 */
export function findSameName(entries: readonly LibraryEntry[], name: string): LibraryEntry | undefined {
  const n = normalizeName(name);
  return n ? entries.find((e) => normalizeName(e.name) === n) : undefined;
}

// ───────────── 迁移 ─────────────

/** FNV-1a 32 位。 */
function fnv(s: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * 迁移出来的资料用确定的 id（由类型 + 规范化名字算出，UUID 形状、版本位 7、时间戳段为 0）：
 * 两台设备各自迁移同一批旧任务，会得到同一条资料，同步时自然合并而不是变成两条。
 */
export function migratedItemId(typeId: string, name: string): string {
  const key = `${typeId}\u0000${normalizeName(name)}`;
  const hex = [fnv(key), fnv(key, 0x01234567), fnv(key, 0x89abcdef), fnv(key, 0x2468ace0)].map((n) => n.toString(16).padStart(8, '0')).join('');
  return `00000000-${hex.slice(0, 4)}-7${hex.slice(5, 8)}-8${hex.slice(9, 12)}-${hex.slice(12, 24)}`;
}

export interface LibraryMigrationPlan {
  /** 要新建的资料（含 id）。 */
  items: Array<Omit<LibraryItem, 'updated_at' | 'deleted'>>;
  /** 要改的任务：挂上资料、type_data 只留任务字段。 */
  tasks: Array<{ id: string; library_item_id: string; type_data: Record<string, FieldValue> }>;
}

/**
 * 旧任务（资料直接写在 type_data 里）→ 资料库：按 类型 + 规范化名字 去重，先找已有资料，
 * 没有再新建；同名的旧任务指向同一条资料，资料字段以先出现的为准、后面的只补空缺。
 * 没填主字段的任务、人物类型、普通任务不动。
 */
export function planLibraryMigration(tasks: readonly Task[], types: readonly TaskType[], existing: readonly LibraryItem[]): LibraryMigrationPlan {
  const typeById = new Map(types.map((t) => [t.id, t]));
  const byKey = new Map<string, { id: string; fields: Record<string, FieldValue>; image: string | null; isNew: boolean }>();
  for (const it of existing) if (!it.deleted) byKey.set(`${it.type_id}|${normalizeName(it.name)}`, { id: it.id, fields: it.fields, image: it.image, isNew: false });
  const plan: LibraryMigrationPlan = { items: [], tasks: [] };
  const newItems = new Map<string, Omit<LibraryItem, 'updated_at' | 'deleted'>>();
  const ordered = [...tasks].filter((t) => !t.deleted).sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
  for (const t of ordered) {
    if (t.library_item_id || !t.type_id) continue;
    const type = typeById.get(t.type_id);
    if (!hasLibrary(type) || isPersonLibrary(type)) continue;
    const split = splitTypeData(type, t.type_data);
    if (!split.name) continue;
    const key = `${type.id}|${normalizeName(split.name)}`;
    let hit = byKey.get(key);
    if (!hit) {
      const id = migratedItemId(type.id, split.name);
      const row = { id, type_id: type.id, name: split.name, image: split.image, fields: { ...split.fields }, note_md: '', created_at: t.created_at };
      newItems.set(id, row);
      hit = { id, fields: row.fields, image: row.image, isNew: true };
      byKey.set(key, hit);
    } else if (hit.isNew) {
      // 同名的后来者只补空缺
      const row = newItems.get(hit.id)!;
      for (const [k, v] of Object.entries(split.fields)) if (empty(row.fields[k])) row.fields[k] = v;
      if (!row.image && split.image) row.image = split.image;
    }
    plan.tasks.push({ id: t.id, library_item_id: hit.id, type_data: split.task });
  }
  plan.items = [...newItems.values()];
  return plan;
}

/**
 * 字段种类改了之后迁移已有资料里的旧值（只处理还是旧形状的值，所以重复跑、多台设备各跑一遍都得到同样的结果）：
 * - 自由文本 → 多选（游戏「平台」：「Switch / PC」→ Nintendo Switch、PC（其他））：对得上的选上；
 *   有对不上的片段就加选「其他」（选项里有的话），并把原来填的整段文字记进备注，不丢。
 * - 数字 / 文字 → 金额（好物「价格」：1299 → ¥1,299；「$12.5」→ 12.5 美元）：没写币种的算人民币；
 *   认不出的文字记进备注。
 */
export function planFieldMigration(items: readonly LibraryItem[], types: readonly TaskType[]): Array<{ id: string; fields: Record<string, FieldValue>; note_md: string }> {
  const typeById = new Map(types.map((t) => [t.id, t]));
  const out: Array<{ id: string; fields: Record<string, FieldValue>; note_md: string }> = [];
  for (const it of items) {
    if (it.deleted) continue;
    const defs = typeById.get(it.type_id)?.fields.filter((f) => f.kind === 'multiselect' || f.kind === 'money') ?? [];
    let fields: Record<string, FieldValue> | null = null;
    let note = it.note_md;
    const keep = (label: string, text: string) => {
      const line = `${label}：${text}`; // i18n-ignore 写进数据的备注，不随界面语言变
      if (!note.includes(line)) note = note.trim() ? `${note.replace(/\s+$/, '')}\n\n${line}` : line;
    };
    for (const f of defs) {
      const v = it.fields[f.key];
      if (f.kind === 'money') {
        if (typeof v !== 'number' && typeof v !== 'string') continue;
        fields ??= { ...it.fields };
        const m = moneyOf(v, DEFAULT_CURRENCY);
        if (m) fields[f.key] = m;
        else {
          delete fields[f.key];
          if (typeof v === 'string' && v.trim()) keep(f.label, v.trim());
        }
        continue;
      }
      if (typeof v !== 'string') continue;
      fields ??= { ...it.fields };
      const text = v.trim();
      if (!text) {
        delete fields[f.key];
        continue;
      }
      const options = f.options ?? [];
      const { values, unmatched } = matchOptions(options, text);
      if (unmatched.length) {
        if (options.includes('其他') && !values.includes('其他')) values.push('其他'); // i18n-ignore 选项值（数据）
        keep(f.label, text);
      }
      if (values.length) fields[f.key] = values;
      else delete fields[f.key];
    }
    if (fields) out.push({ id: it.id, fields, note_md: note });
  }
  return out;
}

// ───────────── 占位图 ─────────────

/** 没有图片时的占位：按名字算出的一对渐变色 + 缩写（中文取前两个字，英文取首字母）。 */
export function placeholderArt(name: string): { initials: string; from: string; to: string } {
  const n = name.trim();
  const h = fnv(n || '?');
  const hue = h % 360;
  const hue2 = (hue + 28 + ((h >>> 9) % 40)) % 360;
  let initials: string;
  const words = n.split(/\s+/).filter(Boolean);
  if (/^[\p{Script=Han}]/u.test(n)) initials = [...n.replace(/\s+/g, '')].filter((c) => /[\p{Script=Han}\p{L}\p{N}]/u.test(c)).slice(0, 2).join('');
  else if (words.length >= 2) initials = (words[0]![0]! + words[1]![0]!).toUpperCase();
  else initials = [...n].slice(0, 2).join('').toUpperCase();
  return { initials: initials || '?', from: `hsl(${hue} 62% 58%)`, to: `hsl(${hue2} 58% 38%)` };
}

// ───────────── 侧边栏里的资料库 ─────────────

/**
 * 放进侧边栏的资料库（Rei 2026-10-26「资料库中，任何一个资料库都可以“在侧边栏显示”，“取消在侧边栏显示”」）。
 * 存成同步偏好 `library.sidebar`（类型 id 列表），不加列、不改类型行：
 * - 改类型行会让内置资料库变成「用户改过」，以后内置升级就不覆盖它了（同 type_order 的理由）；
 * - 旧客户端只认已知列，改一下类型名就会把新列冲掉；偏好行它们原样留着、不碰。
 * 侧边栏里的顺序跟资料库顺序走（orderedTypes），不看列表里的先后；归档的不出现，但 id 留着，取消归档后回来。
 */
export const LIBRARY_SIDEBAR_PREF = 'library.sidebar';

/** 偏好值 → id 列表（坏值、非字符串都丢掉，去重）。 */
export function sidebarLibraryIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((x): x is string => typeof x === 'string' && x.length > 0))];
}

/** 打开 / 关掉一个资料库的侧边栏入口，返回新的 id 列表（没变就原样返回同样的内容）。 */
export function withSidebarLibrary(ids: readonly string[], id: string, on: boolean): string[] {
  const rest = ids.filter((x) => x !== id);
  return on ? [...rest, id] : rest;
}

// ───────────── 侧边栏里的项目 ─────────────

/**
 * 放进侧边栏的项目（Rei 2026-10-28「项目和资料库一样，项目也可以显示在侧边栏」）。
 * 跟资料库一样存成同步偏好 `group.sidebar`（项目 id 列表），不加列、不改项目行（旧客户端改项目名不会把它冲掉）。
 * 侧边栏里的顺序跟项目页一样（store.list('group') 的顺序），不看列表里的先后；删掉的项目不出现。
 * 项目没有归档，结束日期过了也照常显示（项目页也照常列着）。id 列表的读写复用 sidebarLibraryIds / withSidebarLibrary。
 */
export const GROUP_SIDEBAR_PREF = 'group.sidebar';
