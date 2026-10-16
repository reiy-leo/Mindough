/**
 * 资料合并（M4）：两条资料其实是同一部片 / 同一本书，或人物库里同一个人记了两次。
 *
 * - 合并只在同类型之间（影视和影视、人物和人物）。
 * - 默认：保留目标（留下的那条）的非空值，目标空着的用来源补；有冲突（两边都有、又不一样）的字段可以按用户选的来。
 *   「更多链接」不算冲突，两边的合起来（按网址去重）。备注拼在一起（已经包含的不重复）。
 * - 来源打墓碑并记 merged_into = 目标 id；读的时候顺着 merged_into 找到最后那条（见 Store.resolveItemId），
 *   这样别的设备离线新建、还指向旧 id 的任务同步后自动显示成目标，并在合适的时候改写过来。
 *
 * 这里只放纯逻辑（算合并后的值、冲突、可能重复的分组）；写入在 Store.mergeLibraryItems / mergePeople。
 */
import { itemData, normalizeName } from './library';
import { linksOf, siteIdOf } from './links';
import type { FieldDef, FieldValue, LibraryItem, LinkValue, Person, TaskType } from './types';

import { tr } from './i18n';

/** 每个冲突字段选谁的值：字段 key → 那条资料（或人物）的 id。没写的字段按默认（目标优先）。 */
export type MergeChoices = Record<string, string>;

export interface MergeOption {
  /** 值来自哪一条（资料 / 人物 id）。 */
  from: string;
  value: FieldValue;
}

/** 一个有冲突的字段：两条以上都有值、值又不一样。 */
export interface MergeConflict {
  key: string;
  /** 显示用的字段名（已翻译）。 */
  label: string;
  /** 资料字段的定义（人物的字段没有）。 */
  def?: FieldDef;
  /** 'image'：图片（海报、头像），界面显示缩略图。 */
  kind: 'image' | 'value';
  options: MergeOption[];
  /** 现在选中的那条（choices 里的，或默认的目标）。 */
  chosen: string;
}

const isEmpty = (v: FieldValue | undefined) =>
  v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0) || (typeof v === 'string' && !v.trim());

const same = (a: FieldValue | undefined, b: FieldValue | undefined) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** 备注拼接：目标在前，来源的备注接在后面；已经包含（或被包含）的那段不重复。 */
export function mergeNotes(notes: readonly string[]): string {
  const parts: string[] = [];
  for (const raw of notes) {
    const n = raw.trim();
    if (!n) continue;
    if (parts.some((p) => p.includes(n))) continue;
    // 新的这段包含了已有的某段：用新的替换（不重复）
    const i = parts.findIndex((p) => n.includes(p));
    if (i >= 0) parts.splice(i, 1, n);
    else parts.push(n);
  }
  return parts.join('\n\n');
}

/** 「更多链接」合并：按网址去重，先出现的在前（目标的在最前）。 */
function unionLinks(values: readonly (FieldValue | undefined)[]): LinkValue[] {
  const out: LinkValue[] = [];
  const seen = new Set<string>();
  for (const v of values)
    for (const l of linksOf(v)) {
      const k = l.url.replace(/\/+$/, '').toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(l);
    }
  return out;
}

interface Pick1 {
  value: FieldValue | undefined;
  conflict: MergeConflict | null;
}

/** 一个字段：按 choices 或默认（第一个非空 = 目标优先）取值，并算出是否冲突。 */
function pickField(key: string, label: string, kind: MergeConflict['kind'], def: FieldDef | undefined, vals: Array<{ from: string; value: FieldValue | undefined }>, choices: MergeChoices): Pick1 {
  const filled = vals.filter((x) => !isEmpty(x.value)) as MergeOption[];
  const distinct: MergeOption[] = [];
  for (const o of filled) if (!distinct.some((d) => same(d.value, o.value))) distinct.push(o);
  const chosenId = choices[key];
  const chosen = (chosenId !== undefined ? filled.find((o) => o.from === chosenId) : undefined) ?? filled[0];
  const conflict =
    distinct.length >= 2
      ? {
          key,
          label,
          kind,
          ...(def ? { def } : {}),
          options: distinct,
          // 选中的值等于某个去重后的选项：显示那一项被选
          chosen: distinct.find((d) => chosen && same(d.value, chosen.value))?.from ?? distinct[0]!.from,
        }
      : null;
  return { value: chosen?.value, conflict };
}

export interface ItemMergePlan {
  name: string;
  image: string | null;
  fields: Record<string, FieldValue>;
  note_md: string;
  conflicts: MergeConflict[];
}

/**
 * 算合并后的资料：目标优先，空的用来源（按给的顺序）补；choices 覆盖冲突字段的取舍。
 * 类型里已经没有的旧字段（不显示的旧值）同样目标优先、空的补上，不算冲突、不丢。
 */
export function planItemMerge(type: Pick<TaskType, 'fields'> | null | undefined, target: LibraryItem, sources: readonly LibraryItem[], choices: MergeChoices = {}): ItemMergePlan {
  const all = [target, ...sources];
  const datas = all.map((it) => ({ id: it.id, data: itemData(type, it) }));
  const defs = type?.fields ?? [];
  const primary = defs.find((f) => f.primary);
  const media = defs.find((f) => f.media && !f.primary);
  const keys: string[] = [];
  for (const f of defs) keys.push(f.key);
  for (const d of datas) for (const k of Object.keys(d.data)) if (!keys.includes(k)) keys.push(k);
  const out: Record<string, FieldValue> = {};
  const conflicts: MergeConflict[] = [];
  for (const key of keys) {
    const def = defs.find((f) => f.key === key);
    const vals = datas.map((d) => ({ from: d.id, value: d.data[key] }));
    if (def?.kind === 'links') {
      const u = unionLinks(vals.map((v) => v.value));
      if (u.length) out[key] = u;
      continue;
    }
    // 不在类型里的旧字段：目标优先补空，不问
    const { value, conflict } = pickField(key, def?.label ?? key, def === media ? 'image' : 'value', def, vals, def ? choices : {});
    if (!isEmpty(value)) out[key] = value!;
    if (conflict && def) conflicts.push(conflict);
  }
  const name = primary && typeof out[primary.key] === 'string' && (out[primary.key] as string).trim() ? (out[primary.key] as string) : target.name;
  const image = media && typeof out[media.key] === 'string' ? (out[media.key] as string) : media ? null : target.image;
  const fields: Record<string, FieldValue> = {};
  for (const [k, v] of Object.entries(out)) if (k !== primary?.key && k !== media?.key) fields[k] = v;
  return { name, image, fields, note_md: mergeNotes(all.map((x) => x.note_md)), conflicts };
}

/** 人物能合并的字段（列名）及显示名。 */
export const PERSON_MERGE_FIELDS = ['name', 'avatar_asset_id', 'relation', 'birthday'] as const;
type PersonKey = (typeof PERSON_MERGE_FIELDS)[number];

function personLabel(k: PersonKey): string {
  switch (k) {
    case 'name':
      return tr('姓名');
    case 'avatar_asset_id':
      return tr('头像');
    case 'relation':
      return tr('关系');
    case 'birthday':
      return tr('生日');
  }
}

export interface PersonMergePlan {
  patch: Pick<Person, 'name' | 'avatar_asset_id' | 'relation' | 'birthday' | 'note_md'>;
  conflicts: MergeConflict[];
}

export function planPersonMerge(target: Person, sources: readonly Person[], choices: MergeChoices = {}): PersonMergePlan {
  const all = [target, ...sources];
  const conflicts: MergeConflict[] = [];
  const patch = { name: target.name, avatar_asset_id: target.avatar_asset_id, relation: target.relation, birthday: target.birthday, note_md: '' };
  for (const k of PERSON_MERGE_FIELDS) {
    const { value, conflict } = pickField(k, personLabel(k), k === 'avatar_asset_id' ? 'image' : 'value', undefined, all.map((p) => ({ from: p.id, value: p[k] })), choices);
    if (k === 'name') patch.name = typeof value === 'string' && value.trim() ? value : target.name;
    else (patch as Record<string, unknown>)[k] = isEmpty(value) ? null : value;
    if (conflict) conflicts.push(conflict);
  }
  patch.note_md = mergeNotes(all.map((p) => p.note_md));
  return { patch, conflicts };
}

// ───────────── 可能重复 ─────────────

/** 一组「可能是同一个」：ids 按建议的目标在前。 */
export interface DuplicateGroup {
  ids: string[];
  /** 为什么觉得是同一个：同名 / 同一个 IMDb 编号…（已翻译，界面直接显示）。 */
  reason: string;
  /** 这一组的签名（排好序的 id 用 | 连起来），「不是同一个」记的就是它。 */
  key: string;
}

export const groupKey = (ids: readonly string[]) => [...ids].sort().join('|');

/**
 * 同类型里可能重复的分组：规范化名字相同，或某个站点编号（IMDb / 豆瓣…）相同；传递合并（A 和 B 同名、B 和 C 同编号 → 一组）。
 * dismissed 里记着的组（用户点过「不是同一个」）不再出现；组里多了新的一条，签名变了，会重新出现。
 * 每组按「用到的任务多 → 建得早 → id」排，第一个是建议留下的。
 */
export function duplicateGroups(
  type: Pick<TaskType, 'fields'> | null | undefined,
  rows: ReadonlyArray<{ id: string; name: string; created_at?: string; fields?: Record<string, FieldValue> }>,
  opts: { uses?: ReadonlyMap<string, number>; dismissed?: ReadonlySet<string> } = {},
): DuplicateGroup[] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (parent.get(c) !== r) {
      const n = parent.get(c)!;
      parent.set(c, r);
      c = n;
    }
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  };
  const sorted = [...rows].sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const r of sorted) parent.set(r.id, r.id);
  const siteDefs = (type?.fields ?? []).filter((f) => f.kind === 'site_id' && f.site);
  const byKey = new Map<string, string>();
  const why = new Map<string, Set<string>>(); // root 之前先记在 key 上，最后再按组收
  const pairReason: Array<[string, string, string]> = [];
  for (const r of sorted) {
    const keys: Array<[string, string]> = [];
    const n = normalizeName(r.name);
    if (n) keys.push([`n:${n}`, tr('同名')]);
    for (const f of siteDefs) {
      const id = siteIdOf(f.site, r.fields?.[f.key]);
      if (id) keys.push([`s:${f.site}:${id}`, tr('{label} 编号相同', { label: f.label })]);
    }
    for (const [k, label] of keys) {
      const hit = byKey.get(k);
      if (hit) {
        union(hit, r.id);
        pairReason.push([hit, r.id, label]);
      } else byKey.set(k, r.id);
    }
  }
  const groups = new Map<string, string[]>();
  for (const r of sorted) {
    const root = find(r.id);
    groups.set(root, [...(groups.get(root) ?? []), r.id]);
  }
  for (const [a, , label] of pairReason) {
    const root = find(a);
    why.set(root, (why.get(root) ?? new Set()).add(label));
  }
  const info = new Map(rows.map((r) => [r.id, r]));
  const out: DuplicateGroup[] = [];
  for (const [root, ids] of groups) {
    if (ids.length < 2) continue;
    const key = groupKey(ids);
    if (opts.dismissed?.has(key)) continue;
    const ordered = [...ids].sort((a, b) => {
      const ua = opts.uses?.get(a) ?? 0;
      const ub = opts.uses?.get(b) ?? 0;
      if (ua !== ub) return ub - ua;
      const ca = info.get(a)?.created_at ?? '';
      const cb = info.get(b)?.created_at ?? '';
      if (ca !== cb) return ca < cb ? -1 : 1;
      return a < b ? -1 : 1;
    });
    out.push({ ids: ordered, key, reason: [...(why.get(root) ?? [])].join(tr('、')) });
  }
  return out.sort((a, b) => (a.key < b.key ? -1 : 1));
}

/** 顺着 merged_into 找到最后那条；成环 / 断了（终点被直接删掉）返回 undefined。 */
export function resolveMerged<T extends { id: string; deleted: boolean; merged_into?: string | null }>(get: (id: string) => T | undefined, id: string | null | undefined): T | undefined {
  if (!id) return undefined;
  const seen = new Set<string>();
  let cur = get(id);
  while (cur && cur.deleted && cur.merged_into) {
    if (seen.has(cur.id)) return undefined;
    seen.add(cur.id);
    cur = get(cur.merged_into);
  }
  return cur && !cur.deleted ? cur : undefined;
}

/**
 * 两台设备同时把 A 并进 B、把 B 并进 A：同步后可能两条都是墓碑、互相指着（成环）。
 * 每个环留 id 最小的那条（各端算出来一样），返回要翻回来的 id。
 */
export function mergeCycleSurvivors<T extends { id: string; deleted: boolean; merged_into?: string | null }>(rows: Iterable<T>, get: (id: string) => T | undefined): string[] {
  const out = new Set<string>();
  const done = new Set<string>();
  for (const r of rows) {
    if (!r.deleted || !r.merged_into || done.has(r.id)) continue;
    const path: string[] = [];
    const idx = new Map<string, number>();
    let cur: T | undefined = r;
    while (cur && cur.deleted && cur.merged_into && !done.has(cur.id)) {
      if (idx.has(cur.id)) {
        const loop = path.slice(idx.get(cur.id)!);
        out.add([...loop].sort()[0]!);
        break;
      }
      idx.set(cur.id, path.length);
      path.push(cur.id);
      cur = get(cur.merged_into);
    }
    for (const p of path) done.add(p);
  }
  return [...out];
}
