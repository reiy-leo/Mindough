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
import type { FieldDef, FieldValue, LibraryItem, Person, Task, TaskType } from './types';

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
}

const B = BUILTIN_TYPE_IDS;
export const LIBRARY_COPY: Record<string, LibraryCopy> = {
  [B.movie]: { name: '影视库', short: '影视', pick: '选一部影视…', measure: '部' },
  [B.book]: { name: '书库', short: '书', pick: '选一本书…', measure: '本' },
  [B.game]: { name: '游戏库', short: '游戏', pick: '选一款游戏…', measure: '款' },
  [B.project]: { name: '项目库', short: '项目', pick: '选一个项目…', measure: '个' },
  [B.course]: { name: '课程库', short: '课程', pick: '选一门课…', measure: '门' },
  [B.travel]: { name: '目的地', short: '目的地', pick: '选一个目的地…', measure: '个' },
  [B.shopping]: { name: '好物清单', short: '好物', pick: '选一件东西…', measure: '件' },
  [B.restaurant]: { name: '餐厅库', short: '餐厅', pick: '选一家餐厅…', measure: '家' },
  [B.meal]: { name: '菜谱', short: '菜谱', pick: '选一道菜…', measure: '道' },
  [B.person]: { name: '人物', short: '人物', pick: '选一个人…', measure: '位' },
};

export function libraryCopy(type: Pick<TaskType, 'id' | 'name'>): LibraryCopy {
  return LIBRARY_COPY[type.id] ?? { name: `${type.name}库`, short: type.name, pick: `选一个${type.name}…`, measure: '个' };
}

// ───────────── 字段拆分 ─────────────

export const isItemField = (f: FieldDef) => f.primary || f.media || f.scope !== 'task';
export const isTaskField = (f: FieldDef) => !isItemField(f);

/** 有资料库的类型：非普通、有主字段。 */
export function hasLibrary(type: Pick<TaskType, 'id' | 'fields'> | null | undefined): type is TaskType {
  return !!type && type.id !== PLAIN_TYPE_ID && type.fields.some((f) => f.primary);
}

/** 人物类型：库就是 person 表。 */
export function isPersonLibrary(type: Pick<TaskType, 'fields'> | null | undefined): boolean {
  return !!type?.fields.find((f) => f.primary)?.kind && type.fields.find((f) => f.primary)!.kind === 'person';
}

export function itemFieldsOf(type: Pick<TaskType, 'fields'> | null | undefined): FieldDef[] {
  return (type?.fields ?? []).filter(isItemField);
}

export function taskFieldsOf(type: Pick<TaskType, 'fields'> | null | undefined): FieldDef[] {
  return (type?.fields ?? []).filter(isTaskField);
}

/** 资料字段里除主字段、图片外的那些（年份、作者、平台…）。 */
export function extraItemFieldsOf(type: Pick<TaskType, 'fields'> | null | undefined): FieldDef[] {
  return itemFieldsOf(type).filter((f) => !f.primary && !f.media);
}

/** 一条资料展开成 type_data 的样子（主字段 = name，图片字段 = image）。 */
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
}

/** 一行简介：取前三个有值的简单资料字段。 */
export function itemSubtitle(type: Pick<TaskType, 'fields'> | null | undefined, fields: Record<string, FieldValue>): string {
  return extraItemFieldsOf(type)
    .filter((f) => f.kind === 'text' || f.kind === 'number' || f.kind === 'select')
    .map((f) => fieldText(fields[f.key]).trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(' · ');
}

export function entryOfItem(type: TaskType | undefined, item: LibraryItem, recency: number, uses: number): LibraryEntry {
  return {
    kind: 'item',
    id: item.id,
    type_id: item.type_id,
    name: item.name,
    image: item.image,
    subtitle: itemSubtitle(type, item.fields),
    keywords: Object.values(item.fields).map(fieldText).join(' '),
    recency,
    uses,
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
