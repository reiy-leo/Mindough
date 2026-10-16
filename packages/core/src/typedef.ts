/**
 * 类型编辑器的纯逻辑（M4）：字段的增、改名、排序、隐藏、删除，类型在选择器里的顺序。
 * 都是对 FieldDef[] / 类型列表的纯函数，Store 负责写入（类型整行 LWW 同步）。
 *
 * 关键约定：
 * - 字段 key 一经生成就不变，改名只改 label；新字段 key 是随机的 `f` + 8 位，不从名字推。
 * - 删字段 = 在定义里留一条 `removed: true` 的墓碑（不显示），资料 / 任务里的值一个不动；
 *   之后加回同名同种类的字段，就把这条墓碑翻回来（同一个 key），以前的值又能看到。
 *   墓碑也让「用户改过的内置类型」在内置升级补字段（withNewBuiltinFields 按 key 判断）时不会把删掉的字段又补回来。
 * - 隐藏字段：编辑器里还在（灰显），新建 / 详情 / 资料页都不显示，值也保留。
 * - 主字段（名字）与图片字段固定是资料字段，不能隐藏、不能删、不能改种类。
 */
import { BUILTIN_TYPE_IDS, PLAIN_TYPE_ID } from './seed/builtin-types';
import { trc } from './i18n';
import type { FieldDef, FieldKind, TaskType, TypeLayout } from './types';

/** 资料库版式（编辑器里能选的四种）：竖版海报 2:3、方形、横幅 16:9、圆形。 */
export const LIBRARY_LAYOUTS: readonly TypeLayout[] = ['poster', 'icon_name', 'banner', 'round'];

/** 编辑器里能加的字段种类（不含 person：任务本身就能关联人物，「人物」类型 2026-10-16 已删）。 */
export const EDITABLE_FIELD_KINDS: readonly FieldKind[] = ['text', 'number', 'progress', 'date', 'select', 'multiselect', 'link', 'links', 'site_id', 'image', 'list', 'money', 'episode'];

export const FIELD_KIND_LABEL: Record<FieldKind, string> = {
  get text() { return trc('字段种类', '文字'); },
  get number() { return trc('字段种类', '数字'); },
  get progress() { return trc('字段种类', '进度'); },
  get date() { return trc('字段种类', '日期'); },
  get link() { return trc('字段种类', '链接'); },
  get image() { return trc('字段种类', '图片'); },
  get select() { return trc('字段种类', '单选'); },
  get multiselect() { return trc('字段种类', '多选'); },
  get money() { return trc('字段种类', '金额'); },
  get episode() { return trc('字段种类', '看到第几集'); },
  get person() { return trc('字段种类', '人物'); },
  get list() { return trc('字段种类', '清单'); },
  get site_id() { return trc('字段种类', '站点编号'); },
  get links() { return trc('字段种类', '更多链接'); },
};

/** 类型编辑器里出现的类型：不含「普通」（没有字段和版式）和「人物」（已从可选类型删掉，人物库保留）。 */
export function isEditableType(t: Pick<TaskType, 'id'>): boolean {
  return t.id !== PLAIN_TYPE_ID && t.id !== BUILTIN_TYPE_IDS.person;
}

/** 还在的字段（含隐藏的，不含删掉的）：编辑器列表用。 */
export function liveFields(type: Pick<TaskType, 'fields'> | null | undefined): FieldDef[] {
  return (type?.fields ?? []).filter((f) => !f.removed);
}

/** 显示的字段（不含隐藏的、删掉的）：新建、详情、资料页、卡片用。 */
export function shownFields(type: Pick<TaskType, 'fields'> | null | undefined): FieldDef[] {
  return (type?.fields ?? []).filter(isShownField);
}

export const isShownField = (f: FieldDef) => !f.removed && !f.hidden;

/** 主字段、图片字段：固定，不能隐藏、删除、改种类或改成任务字段。 */
export const isFixedField = (f: FieldDef) => !!f.primary || !!f.media;

const norm = (s: string) => s.normalize('NFKC').trim().toLowerCase();

/** 生成一个新字段 key（随机、不从名字推，和已有的、删掉的都不重）。rand 可注入（测试）。 */
export function newFieldKey(fields: readonly FieldDef[], rand: () => number = Math.random): string {
  const used = new Set(fields.map((f) => f.key));
  for (;;) {
    let k = 'f';
    for (let i = 0; i < 8; i++) k += '0123456789abcdefghijklmnopqrstuvwxyz'[Math.floor(rand() * 36)];
    if (!used.has(k)) return k;
  }
}

export interface NewFieldInput {
  label: string;
  kind: FieldKind;
  scope?: 'item' | 'task';
  options?: string[];
  unit?: string;
  site?: string;
}

/**
 * 加一个字段，返回新的字段表和这个字段的 key。
 * 有同名（规范化后）、同种类的删掉的字段（墓碑，或 legacy 里记着的旧内置字段）就用回它的 key，以前的值又能看到；
 * 否则生成新 key。新字段放在最后。
 */
export function addField(fields: readonly FieldDef[], input: NewFieldInput, opts: { legacy?: readonly FieldDef[]; rand?: () => number } = {}): { fields: FieldDef[]; key: string } {
  const label = input.label.trim();
  const def: Omit<FieldDef, 'key'> = {
    label,
    kind: input.kind,
    ...(input.scope === 'task' ? { scope: 'task' as const } : {}),
    ...(input.kind === 'select' || input.kind === 'multiselect' ? { options: cleanOptions(input.options ?? []) } : {}),
    ...(input.unit && (input.kind === 'number' || input.kind === 'progress') ? { unit: input.unit } : {}),
    ...(input.kind === 'site_id' ? { site: input.site ?? 'imdb' } : {}),
  };
  const same = (f: FieldDef) => norm(f.label) === norm(label) && f.kind === input.kind;
  const tomb = fields.find((f) => f.removed && same(f));
  if (tomb) {
    // 墓碑翻回来：同 key，放到最后；scope 保持原来的（值存在原来的地方）
    const revived: FieldDef = { ...stripFlags(tomb), label, ...(def.options ? { options: def.options.length ? def.options : (tomb.options ?? []) } : {}) };
    return { fields: [...fields.filter((f) => f !== tomb), revived], key: tomb.key };
  }
  const legacy = opts.legacy?.find((f) => same(f) && !fields.some((x) => x.key === f.key));
  if (legacy) return { fields: [...fields, { ...stripFlags(legacy), label, ...(def.options?.length ? { options: def.options } : {}) }], key: legacy.key };
  const key = newFieldKey(fields, opts.rand);
  return { fields: [...fields, { key, ...def }], key };
}

function stripFlags(f: FieldDef): FieldDef {
  const { removed: _r, hidden: _h, ...rest } = f;
  return rest;
}

/** 选项整理：去首尾空白、去空、去重（保留先后）。 */
export function cleanOptions(options: readonly string[]): string[] {
  const out: string[] = [];
  for (const o of options) {
    const s = o.trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

export type FieldPatch = Partial<Pick<FieldDef, 'label' | 'kind' | 'options' | 'unit' | 'site' | 'placeholder' | 'scope' | 'hidden'>>;

/**
 * 改一个字段。主字段 / 图片字段只能改名字和占位（不能隐藏、改种类、改成任务字段）。
 * 改名空字符串不改。key 永远不变。
 */
export function updateField(fields: readonly FieldDef[], key: string, patch: FieldPatch): FieldDef[] {
  return fields.map((f) => {
    if (f.key !== key) return f;
    const p: FieldPatch = { ...patch };
    if (isFixedField(f)) {
      delete p.kind;
      delete p.scope;
      delete p.hidden;
    }
    if (p.label !== undefined && !p.label.trim()) delete p.label;
    const next: FieldDef = { ...f, ...p };
    if (p.label !== undefined) next.label = p.label.trim();
    if (p.options) next.options = cleanOptions(p.options);
    if (p.scope === 'item') delete next.scope;
    if (p.hidden === false) delete next.hidden;
    if (next.kind !== 'select' && next.kind !== 'multiselect') delete next.options;
    else if (!next.options) next.options = [];
    if (next.kind !== 'site_id') delete next.site;
    else if (!next.site) next.site = 'imdb';
    if (next.kind !== 'number' && next.kind !== 'progress') delete next.unit;
    return next;
  });
}

/** 删字段：留墓碑（removed），值不动。主字段 / 图片字段不能删（原样返回）。 */
export function removeField(fields: readonly FieldDef[], key: string): FieldDef[] {
  return fields.map((f) => {
    if (f.key !== key || isFixedField(f)) return f;
    const { hidden: _h, ...rest } = f;
    return { ...rest, removed: true };
  });
}

/**
 * 把还在的字段排成给定顺序（keys 里没写到的还在的字段按原顺序接在后面）；删掉的墓碑放最后。
 */
export function reorderFields(fields: readonly FieldDef[], keys: readonly string[]): FieldDef[] {
  const live = fields.filter((f) => !f.removed);
  const byKey = new Map(live.map((f) => [f.key, f]));
  const ordered: FieldDef[] = [];
  for (const k of keys) {
    const f = byKey.get(k);
    if (f && !ordered.includes(f)) ordered.push(f);
  }
  for (const f of live) if (!ordered.includes(f)) ordered.push(f);
  return [...ordered, ...fields.filter((f) => f.removed)];
}

/** 还在的字段里上移 / 下移一位。 */
export function moveField(fields: readonly FieldDef[], key: string, delta: -1 | 1): FieldDef[] {
  const keys = fields.filter((f) => !f.removed).map((f) => f.key);
  const i = keys.indexOf(key);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= keys.length) return [...fields];
  [keys[i], keys[j]] = [keys[j]!, keys[i]!];
  return reorderFields(fields, keys);
}

/**
 * 类型在选择器 / 资料库标签条里的顺序：同步的偏好 `type_order`（id 列表）里有的按它排，
 * 没写进去的（别的设备新建、还没排过）按 sort 接在后面。顺序单独存，不改类型行——
 * 这样排一下顺序不会让内置类型变成「用户改过」（那样以后内置升级就不覆盖它了）。
 */
export function orderTypes<T extends Pick<TaskType, 'id' | 'sort'>>(types: readonly T[], order: readonly string[] | null | undefined): T[] {
  const rank = new Map((order ?? []).map((id, i) => [id, i]));
  return [...types].sort((a, b) => {
    const ra = rank.get(a.id) ?? Infinity;
    const rb = rank.get(b.id) ?? Infinity;
    if (ra !== rb) return ra - rb;
    return a.sort - b.sort || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
}

/**
 * 内置类型以前版本有、现在定义里已经没有的字段（值还留在资料里）。用户在编辑器里加回同名同种类的字段时用回这个 key，
 * 旧值又能看到（如 r2 去掉的影视「平台」）。
 */
export const LEGACY_BUILTIN_FIELDS: Record<string, readonly FieldDef[]> = {
  [BUILTIN_TYPE_IDS.movie]: [{ key: 'platform', label: '平台', kind: 'text' }],
};
