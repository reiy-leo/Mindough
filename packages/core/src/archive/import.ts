/**
 * 从 Markdown 文件夹导入（格式见 docs/EXPORT.md）。两种来源：
 * - Mindough 自己导出的（有 _meta/mindough.json）：按 id 认，已有的默认跳过（可选「用文件覆盖」），新的就建；
 * - 普通 markdown 文件夹（Obsidian 等）：每个 .md 一件任务，最上一层文件夹 → 组，`- [ ]` 清单原样留在正文里。
 * 先 planImport 出预览（新建 / 更新 / 跳过 / 出错），确认后 applyImport 一次写入（同一批进 outbox），
 * 返回的回执可以 undoImport 整批撤销。畸形的 front matter 只记进出错列表，不会抛。
 */
import type { Store } from '../store';
import { uuidv7 } from '../uuid';
import { firstLine } from '../preview';
import { normalizeName } from '../library';
import { parseRecurrence } from '../recurrence';
import { canonicalPair, taskLinkId } from '../related';
import { tr } from '../i18n';
import { isDateKey, journalEntryId } from '../journal';
import {
  COMPLETION_MODES,
  TASK_STATUSES,
  normalizeStatus,
  type Asset,
  type BaseRow,
  type CheckIn,
  type CheckInCategory,
  type Category,
  type CompletionMode,
  type FieldValue,
  type Group,
  type LibraryItem,
  type Person,
  type JournalEntry,
  type Pref,
  type TableName,
  type Task,
  type TaskStatus,
  type TaskType,
  type TypeLayout,
} from '../types';
import { ARCHIVE_FORMAT, MANIFEST_PATH, RESERVED_DIRS } from './export';
import {
  MD_IMAGE,
  WIKI_IMAGE,
  baseOf,
  dirOf,
  encodeDataUrl,
  fromUtf8,
  isImagePath,
  mdHref,
  mimeOfPath,
  normPath,
  parseFrontMatter,
  resolveLink,
  safeName,
  splitFrontMatter,
  stableId,
  stemOf,
  type ArchiveFile,
} from './text';

/** 预览里分开数的几种东西（打卡记录、图片、分类这些跟着走，不单独数）。 */
export type ImportKind = 'task' | 'group' | 'library' | 'person' | 'type' | 'journal';
export const IMPORT_KINDS: readonly ImportKind[] = ['task', 'group', 'library', 'person', 'type', 'journal'];

/** new = 库里没有（或已删除）；existing = 有，内容不同；same = 有，内容一样（总是跳过）。 */
export type EntryState = 'new' | 'existing' | 'same';

export interface ImportEntry {
  kind: ImportKind | 'extra';
  table: TableName;
  id: string;
  path: string;
  label: string;
  state: EntryState;
  row: BaseRow;
}

export interface ImportIssue {
  path: string;
  message: string;
  /** error = 这个文件没导入；warning = 导入了，但有一处没接上（找不到的前后关系…）。 */
  level: 'error' | 'warning';
}

interface TaskRefs {
  taskId: string;
  path: string;
  after: string[];
  related: string[];
  people: string[];
  myDay: string[];
}

export interface ImportPlan {
  format: 'mindough' | 'markdown';
  entries: ImportEntry[];
  refs: TaskRefs[];
  issues: ImportIssue[];
  /** 正文 / 字段里用到的图片文件（归档内路径）：登录时可以先上传，再用 assetUrls 重新 plan。 */
  imagePaths: string[];
}

export interface ImportOptions {
  /** 图片文件 → 地址（上传到 R2 后的链接）；没给的转成 data URL。 */
  assetUrls?: ReadonlyMap<string, string>;
  now?: Date;
}

export interface ImportCounts {
  create: number;
  update: number;
  skip: number;
  errors: number;
  byKind: Record<ImportKind, { create: number; update: number; skip: number }>;
}

// ───────────── 读文件 ─────────────

const JUNK = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini|\.obsidian|\.trash|\.git)(\/|$)/i;

/** 整理选进来的文件：去掉系统垃圾和隐藏文件；所有文件都在同一个顶层文件夹里时去掉这一层（zip 里的根文件夹、选文件夹时的文件夹名）。 */
export function normalizeArchive(files: readonly ArchiveFile[]): { files: ArchiveFile[]; root: string } {
  let list = files
    .map((f) => ({ path: normPath(f.path), data: f.data }))
    .filter((f) => f.path && !JUNK.test(f.path) && !f.path.split('/').some((s) => s.startsWith('.')) && !f.path.endsWith('/'));
  let root = '';
  for (;;) {
    const first = list[0]?.path.split('/')[0];
    if (!first || !list.every((f) => f.path.includes('/') && f.path.split('/')[0] === first)) break;
    // 自己导出的格式：根上就是 _meta 等，别再往下剥
    if (list.some((f) => f.path === MANIFEST_PATH)) break;
    root = root ? `${root}/${first}` : first;
    list = list.map((f) => ({ path: f.path.slice(first.length + 1), data: f.data }));
  }
  return { files: list, root };
}

// ───────────── 值的整理（front matter 里什么都可能写） ─────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isId = (v: unknown): v is string => typeof v === 'string' && UUID.test(v.trim());
const str = (v: unknown): string | null => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
const dateKey = (v: unknown): string | null => {
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : str(v)?.trim();
  return s && DATE.test(s.slice(0, 10)) ? s.slice(0, 10) : null;
};
const iso = (v: unknown): string | null => {
  const s = v instanceof Date ? v.toISOString() : str(v)?.trim();
  if (!s) return null;
  const t = Date.parse(s);
  // 能认出来就原样留着（往返不变）；认不出的当没有
  return Number.isFinite(t) ? s : null;
};
const idList = (v: unknown): string[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]).filter(isId).map((x) => x.trim());
const dateList = (v: unknown): string[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]).map(dateKey).filter((x): x is string => !!x);

function fieldValue(v: unknown): FieldValue | undefined {
  if (v === null) return null;
  if (typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x === 'string')) return v as string[];
    const links = v.filter((x): x is { url: unknown; label?: unknown } => !!x && typeof x === 'object' && typeof (x as { url?: unknown }).url === 'string');
    if (links.length) return links.map((l) => ({ url: l.url as string, ...(typeof l.label === 'string' ? { label: l.label } : {}) }));
    return v.map((x) => str(x)).filter((x): x is string => x !== null);
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('amount' in o) {
      const amount = num(o.amount);
      return amount === null ? undefined : { amount, currency: str(o.currency) ?? 'CNY' };
    }
    if ('season' in o || 'episode' in o) {
      const season = num(o.season);
      const episode = num(o.episode);
      return { ...(season !== null ? { season } : {}), ...(episode !== null ? { episode } : {}) };
    }
  }
  return undefined;
}

/** 普通 markdown 的状态写法（Obsidian 插件常见的几种）。 */
function plainStatus(fm: Record<string, unknown>): TaskStatus {
  if (fm.done === true || fm.completed === true) return TASK_STATUSES[2]!;
  const s = str(fm.status)?.trim().toLowerCase();
  if (!s) return TASK_STATUSES[0]!;
  if (['done', 'completed', 'complete', 'finished', 'x'].includes(s)) return TASK_STATUSES[2]!;
  if (['doing', 'in progress', 'in-progress', 'wip', 'started', 'active'].includes(s)) return TASK_STATUSES[1]!;
  if (['closed', 'cancelled', 'canceled', 'dropped', 'abandoned'].includes(s)) return TASK_STATUSES[3]!;
  return normalizeStatus(fm.status);
}

const stableJson = (v: unknown): string =>
  JSON.stringify(v, (_k, x: unknown) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));
const content = (r: BaseRow) => {
  const { updated_at: _u, deleted: _d, ...rest } = r as BaseRow & { merged_into?: string | null };
  // merged_into 只在被并掉的墓碑上有值；活的行是 null，文件里不写，比较时当没有
  if (rest.merged_into == null) delete rest.merged_into;
  // 日记的 base_at 是同步用的记号，不算内容
  delete (rest as { base_at?: unknown }).base_at;
  return stableJson(rest);
};

// ───────────── 计划 ─────────────

export function planImport(store: Store, input: readonly ArchiveFile[], opts: ImportOptions = {}): ImportPlan {
  const now = opts.now ?? store.now();
  const { files, root } = normalizeArchive(input);
  const byPath = new Map(files.map((f) => [f.path, f]));
  const byBase = new Map<string, string>();
  for (const f of files) if (isImagePath(f.path) && !byBase.has(baseOf(f.path).toLowerCase())) byBase.set(baseOf(f.path).toLowerCase(), f.path);
  const format: ImportPlan['format'] = byPath.has(MANIFEST_PATH) ? 'mindough' : 'markdown';
  const issues: ImportIssue[] = [];
  const entries: ImportEntry[] = [];
  const refs: TaskRefs[] = [];
  const imagePaths = new Set<string>();
  const err = (path: string, message: string) => issues.push({ path, message, level: 'error' });
  const warn = (path: string, message: string) => issues.push({ path, message, level: 'warning' });

  const seen = new Set<string>();
  const add = (kind: ImportEntry['kind'], table: TableName, path: string, label: string, row: BaseRow) => {
    if (seen.has(`${table}:${row.id}`)) {
      err(path, tr('和别的文件 id 重复，没导入'));
      return;
    }
    seen.add(`${table}:${row.id}`);
    const cur = store.raw(table, row.id);
    const state: EntryState = !cur || cur.deleted ? 'new' : content(cur) === content(row) ? 'same' : 'existing';
    entries.push({ kind, table, id: row.id, path, label, state, row });
  };
  const fresh = <T extends object>(r: T) => ({ ...r, updated_at: '', deleted: false }) as unknown as BaseRow;

  // ── 图片 ──
  const fileUrl = (path: string): string => {
    imagePaths.add(path);
    const hit = opts.assetUrls?.get(path);
    if (hit) return hit;
    const f = byPath.get(path)!;
    return encodeDataUrl(mimeOfPath(path) ?? 'application/octet-stream', f.data);
  };
  const assetByFile = new Map<string, string>();

  // ── _meta ──
  const readJson = (path: string): unknown[] => {
    const f = byPath.get(path);
    if (!f) return [];
    try {
      const v: unknown = JSON.parse(fromUtf8(f.data));
      if (!Array.isArray(v)) throw new Error('not array');
      return v;
    } catch {
      err(path, tr('这个文件读不出来（不是有效的 JSON），里面的内容没导入'));
      return [];
    }
  };
  const rowsOf = (path: string, check: (r: Record<string, unknown>) => boolean) => {
    const out: Record<string, unknown>[] = [];
    readJson(path).forEach((r, i) => {
      if (r && typeof r === 'object' && isId((r as { id?: unknown }).id) && check(r as Record<string, unknown>)) out.push(r as Record<string, unknown>);
      else err(`${path} #${i + 1}`, tr('这一条缺少必要的内容，没导入'));
    });
    return out;
  };
  const archiveTypes = new Set<string>();
  const archiveGroups = new Set<string>();
  const archiveItems = new Set<string>();
  const archivePeople = new Set<string>();
  const archiveCats = new Set<string>();
  const archiveCheckinCats = new Set<string>();
  const archiveTasks = new Set<string>();

  if (format === 'mindough') {
    for (const r of rowsOf('_meta/types.json', (r) => typeof r.name === 'string' && Array.isArray(r.fields) && (r.fields as unknown[]).every((f) => !!f && typeof f === 'object' && typeof (f as { key?: unknown }).key === 'string' && typeof (f as { kind?: unknown }).kind === 'string'))) {
      const t = r as unknown as TaskType;
      const row: TaskType = {
        id: t.id,
        updated_at: '',
        deleted: false,
        name: t.name,
        icon: str(t.icon) ?? 'square',
        color: str(t.color) ?? '#8e8e93',
        layout: (['poster', 'icon_name', 'banner', 'round', 'text'] as readonly TypeLayout[]).includes(t.layout) ? t.layout : 'text',
        fields: t.fields,
        body_template: str(t.body_template) ?? '',
        builtin: t.builtin === true,
        // 归档：新文件写 archived，旧文件（M4 初版）写 hidden
        hidden: (t as { archived?: unknown }).archived === true || t.hidden === true,
        default_completion_mode: COMPLETION_MODES.includes(t.default_completion_mode) ? t.default_completion_mode : 'once',
        sort: num(t.sort) ?? 0,
      };
      archiveTypes.add(row.id);
      add('type', 'task_type', '_meta/types.json', row.name, row);
    }
    for (const r of rowsOf('_meta/checkin-categories.json', (r) => typeof r.name === 'string')) {
      const c = r as unknown as CheckInCategory;
      archiveCheckinCats.add(c.id);
      add('extra', 'checkin_category', '_meta/checkin-categories.json', c.name, fresh<Omit<CheckInCategory, 'updated_at' | 'deleted'>>({ id: c.id, name: c.name, icon: str(c.icon) ?? 'tag', color: str(c.color) ?? '#8e8e93', builtin: c.builtin === true, hidden: c.hidden === true, sort: num(c.sort) ?? 0 }));
    }
    for (const r of rowsOf('_meta/categories.json', (r) => typeof r.name === 'string')) {
      const c = r as unknown as Category;
      archiveCats.add(c.id);
      add('extra', 'category', '_meta/categories.json', c.name, fresh<Omit<Category, 'updated_at' | 'deleted'>>({ id: c.id, name: c.name, color: str(c.color) ?? '#8e8e93' }));
    }
    for (const r of rowsOf('_meta/prefs.json', (r) => typeof r.key === 'string')) {
      const p = r as unknown as Pref;
      const value = fieldValue(p.value);
      if (value !== undefined) add('extra', 'pref', '_meta/prefs.json', p.key, fresh<Omit<Pref, 'updated_at' | 'deleted'>>({ id: p.id, key: p.key, value }));
    }
    for (const r of rowsOf('_meta/assets.json', () => true)) {
      const a = r as unknown as Asset & { file?: unknown };
      const file = typeof a.file === 'string' ? normPath(a.file) : null;
      if (file && !byPath.has(file)) {
        warn('_meta/assets.json', tr('找不到图片文件 {file}', { file }));
        if (!str(a.url)) continue;
      }
      const url = file && byPath.has(file) ? fileUrl(file) : str(a.url);
      if (file) assetByFile.set(file, a.id);
      add('extra', 'asset', '_meta/assets.json', a.id, fresh<Omit<Asset, 'updated_at' | 'deleted'>>({ id: a.id, sha256: str(a.sha256) ?? '', mime: str(a.mime) ?? (file ? (mimeOfPath(file) ?? '') : ''), width: num(a.width), height: num(a.height), r2_key: str(a.r2_key), url }));
    }
  }

  /** 字段里的字符串值若是归档里的图片路径 → asset id（_meta/assets.json 里有）或地址。 */
  const imageValue = (v: FieldValue | undefined, fromFile: string): FieldValue | undefined => {
    if (typeof v !== 'string' || !v || /^(https?:|data:|blob:)/i.test(v) || isId(v)) return v;
    for (const p of [normPath(v), resolveLink(fromFile, v)]) {
      if (byPath.has(p) && isImagePath(p)) return assetByFile.get(p) ?? fileUrl(p);
    }
    return v;
  };
  const fieldsOf = (v: unknown, path: string): Record<string, FieldValue> => {
    const out: Record<string, FieldValue> = {};
    if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      const fv = imageValue(fieldValue(x), path);
      if (fv !== undefined) out[k] = fv;
    }
    return out;
  };
  /** 正文里指向归档内图片的链接 → 地址；Obsidian 的 ![[x.png]] 一样。 */
  const body = (md: string, path: string): string =>
    md
      .replace(MD_IMAGE, (all, alt: string, href: string, title: string | undefined) => {
        const h = href.replace(/^<|>$/g, '');
        if (/^[a-z][a-z0-9+.-]*:/i.test(h)) return all;
        const p = resolveLink(path, h);
        return byPath.has(p) && isImagePath(p) ? `![${alt}](${mdHref(fileUrl(p))}${title ?? ''})` : all;
      })
      .replace(WIKI_IMAGE, (all, target: string, alt: string | undefined) => {
        const t = target.trim();
        const p = [normPath(t), resolveLink(path, t)].find((x) => byPath.has(x)) ?? byBase.get(baseOf(t).toLowerCase());
        return p && isImagePath(p) ? `![${alt ?? ''}](${fileUrl(p)})` : all;
      });

  // ── markdown 文件 ──
  type Parsed = { path: string; fm: Record<string, unknown>; body: string };
  const parsed: Parsed[] = [];
  for (const f of files) {
    if (!/\.(md|markdown)$/i.test(f.path)) continue;
    if (format === 'mindough' && (f.path.startsWith('_meta/') || f.path.startsWith('assets/'))) continue;
    const split = splitFrontMatter(fromUtf8(f.data));
    if (split.unterminated) {
      err(f.path, tr('开头的属性（front matter）没有用 --- 收尾'));
      continue;
    }
    const r = split.front === null ? { ok: true as const, data: {} } : parseFrontMatter(split.front);
    if (!r.ok) {
      err(f.path, r.error);
      continue;
    }
    parsed.push({ path: f.path, fm: r.data, body: split.body });
  }

  const own = (p: Parsed) => format === 'mindough' && p.fm.id !== undefined;
  const top = (path: string) => (path.includes('/') ? path.split('/')[0]! : '');
  const isLib = (p: Parsed) => format === 'mindough' && p.path.startsWith('library/');
  const isPerson = (p: Parsed) => format === 'mindough' && p.path.startsWith('people/');
  const isJournal = (p: Parsed) => format === 'mindough' && p.path.startsWith('journal/');
  const isGroupFile = (p: Parsed) => baseOf(p.path) === '_group.md' && dirOf(p.path) !== '' && !dirOf(p.path).includes('/');

  // 组
  const folderGroup = new Map<string, string>();
  const groupNames = new Map(store.list('group').map((g) => [normalizeName(g.name), g.id]));
  for (const p of parsed.filter(isGroupFile)) {
    const dir = dirOf(p.path);
    if (format === 'mindough' && (RESERVED_DIRS as readonly string[]).includes(dir)) continue;
    if (p.fm.id !== undefined && !isId(p.fm.id)) {
      err(p.path, tr('id 写得不对，没导入'));
      continue;
    }
    const name = str(p.fm.name)?.trim() || dir;
    const id = isId(p.fm.id) ? p.fm.id.trim() : (groupNames.get(normalizeName(name)) ?? stableId(`md-group\u0000${normalizeName(name)}`));
    const cat = isId(p.fm.category) ? p.fm.category.trim() : null;
    const dt = isId(p.fm.default_type) ? p.fm.default_type.trim() : null;
    const row = fresh<Omit<Group, 'updated_at' | 'deleted'>>({
      id,
      name,
      icon: str(p.fm.icon) ?? '📁',
      start_at: dateKey(p.fm.start),
      end_at: dateKey(p.fm.end),
      category_id: cat && (archiveCats.has(cat) || store.get('category', cat)) ? cat : null,
      default_type_id: dt && (archiveTypes.has(dt) || store.get('task_type', dt)) ? dt : null,
    });
    folderGroup.set(dir, id);
    archiveGroups.add(id);
    add('group', 'group', p.path, name, row);
  }
  /** 没有 _group.md 的文件夹：按名字找已有的组，没有就建一个。 */
  const groupForFolder = (dir: string): string => {
    const hit = folderGroup.get(dir);
    if (hit) return hit;
    const name = dir;
    const id = groupNames.get(normalizeName(name)) ?? stableId(`md-group\u0000${normalizeName(name)}`);
    folderGroup.set(dir, id);
    if (!store.get('group', id)) {
      archiveGroups.add(id);
      add('group', 'group', `${dir}/`, name, fresh<Omit<Group, 'updated_at' | 'deleted'>>({ id, name, icon: '📁', start_at: null, end_at: null, category_id: null, default_type_id: null }));
    }
    return id;
  };

  // 资料库、人物
  for (const p of parsed.filter(isLib)) {
    const type = isId(p.fm.type) ? p.fm.type.trim() : null;
    if (!isId(p.fm.id)) {
      err(p.path, tr('id 写得不对，没导入'));
      continue;
    }
    if (!type || !(archiveTypes.has(type) || store.get('task_type', type))) {
      err(p.path, tr('找不到它的类型，没导入'));
      continue;
    }
    const name = str(p.fm.name)?.trim() || stemOf(p.path);
    const image = imageValue(fieldValue(p.fm.image), p.path);
    const row = fresh<Omit<LibraryItem, 'updated_at' | 'deleted'>>({
      id: p.fm.id.trim(),
      type_id: type,
      name,
      image: typeof image === 'string' && image ? image : null,
      fields: fieldsOf(p.fm.fields, p.path),
      note_md: body(p.body, p.path),
      created_at: iso(p.fm.created) ?? now.toISOString(),
    });
    archiveItems.add(row.id);
    add('library', 'library_item', p.path, name, row);
  }
  for (const p of parsed.filter(isPerson)) {
    if (!isId(p.fm.id)) {
      err(p.path, tr('id 写得不对，没导入'));
      continue;
    }
    const name = str(p.fm.name)?.trim() || stemOf(p.path);
    const avatar = imageValue(fieldValue(p.fm.avatar), p.path);
    const row = fresh<Omit<Person, 'updated_at' | 'deleted'>>({
      id: p.fm.id.trim(),
      name,
      avatar_asset_id: typeof avatar === 'string' && avatar ? avatar : null,
      relation: str(p.fm.relation),
      birthday: dateKey(p.fm.birthday),
      note_md: body(p.body, p.path),
    });
    archivePeople.add(row.id);
    add('person', 'person', p.path, name, row);
  }

  // 日记：按日期认（id 由日期算，文件里的 id 只是核对）
  for (const p of parsed.filter(isJournal)) {
    const date = dateKey(p.fm.date) ?? (/^\d{4}-\d{2}-\d{2}$/.test(stemOf(p.path)) ? stemOf(p.path) : null);
    if (!date || !isDateKey(date)) {
      err(p.path, tr('日期写得不对，没导入'));
      continue;
    }
    const id = journalEntryId(date);
    if (p.fm.id !== undefined && (!isId(p.fm.id) || p.fm.id.trim() !== id)) warn(p.path, tr('id 和日期对不上，按日期导入'));
    const mood = str(p.fm.mood)?.trim() || null;
    const row = fresh<Omit<JournalEntry, 'updated_at' | 'deleted'>>({
      id,
      date,
      body_md: body(p.body, p.path),
      mood,
      base_at: null,
      created_at: iso(p.fm.created) ?? now.toISOString(),
    });
    add('journal', 'journal_entry', p.path, date, row);
  }

  // 任务
  let sort = store.list('task').reduce((m, t) => Math.max(m, t.sort), 0);
  const taskFiles = parsed.filter((p) => !isGroupFile(p) && !isLib(p) && !isPerson(p) && !isJournal(p));
  for (const p of taskFiles) if (own(p) && isId(p.fm.id)) archiveTasks.add(p.fm.id.trim());
  for (const p of taskFiles) {
    const fm = p.fm;
    const dir = top(p.path);
    const ownFile = own(p);
    if (ownFile && !isId(fm.id)) {
      err(p.path, tr('id 写得不对，没导入'));
      continue;
    }
    // 普通 markdown：文件名就是标题，正文第一行不是它时补在最前面
    let md = p.body;
    if (!ownFile) {
      const stem = stemOf(p.path);
      const first = safeName(firstLine(md), '');
      if (!first || (first !== stem && !stem.startsWith(`${first} `))) md = `# ${stem}\n\n${md.replace(/^\n+/, '')}`;
    }
    const id = ownFile || isId(fm.id) ? (fm.id as string).trim() : stableId(`md-task\u0000${root}\u0000${p.path}`);
    let group: string | null = null;
    if (isId(fm.group) && (archiveGroups.has(fm.group.trim()) || store.get('group', fm.group.trim()))) group = fm.group.trim();
    else {
      if (fm.group !== undefined && fm.group !== null && ownFile) warn(p.path, tr('找不到它的组，放进所在的文件夹'));
      group = dir ? groupForFolder(dir) : null;
    }
    let type: string | null = isId(fm.type) ? fm.type.trim() : null;
    if (type && !(archiveTypes.has(type) || store.get('task_type', type))) {
      warn(p.path, tr('找不到它的类型，当普通任务导入'));
      type = null;
    }
    let item: string | null = isId(fm.item) ? fm.item.trim() : null;
    if (item && !(archiveItems.has(item) || store.get('library_item', item))) {
      warn(p.path, tr('找不到它挂的资料，没接上'));
      item = null;
    }
    let cat: string | null = isId(fm.checkin_category) ? fm.checkin_category.trim() : null;
    if (cat && !(archiveCheckinCats.has(cat) || store.get('checkin_category', cat))) cat = null;
    let repeat = str(fm.repeat)?.trim() || null;
    if (repeat && !parseRecurrence(repeat)) {
      warn(p.path, tr('重复规则看不懂，当只做一次导入'));
      repeat = null;
    }
    const remind = str(fm.remind)?.trim() ?? null;
    const status = ownFile ? normalizeStatus(fm.status) : plainStatus(fm);
    const completion = COMPLETION_MODES.includes(fm.completion as CompletionMode) ? (fm.completion as CompletionMode) : 'once';
    const row = fresh<Omit<Task, 'updated_at' | 'deleted'>>({
      id,
      body_md: body(md, p.path),
      status,
      group_id: group,
      scheduled_date: dateKey(fm.scheduled ?? (ownFile ? undefined : (fm.due ?? fm.date))),
      type_id: type,
      type_data: fieldsOf(fm.fields, p.path),
      completion_mode: completion,
      target_value: num(fm.target),
      unit: str(fm.unit),
      target_date: dateKey(fm.target_date),
      recurrence: repeat,
      checkin_category_id: cat,
      library_item_id: item,
      remind_time: remind && /^\d{1,2}:\d{2}$/.test(remind) ? remind.padStart(5, '0') : null,
      done_at: iso(fm.done) ?? null,
      sort: num(fm.sort) ?? ++sort,
      created_at: iso(fm.created) ?? now.toISOString(),
    });
    add('task', 'task', p.path, firstLine((row as unknown as Task).body_md) || stemOf(p.path), row);
    refs.push({ taskId: id, path: p.path, after: idList(fm.after), related: idList(fm.related), people: idList(fm.people), myDay: dateList(fm.my_day) });
  }

  // 打卡记录：只给这次导入里的任务
  if (format === 'mindough') {
    for (const r of rowsOf('_meta/checkins.json', (r) => isId(r.task_id) && typeof r.period_key === 'string' && typeof r.kind === 'string')) {
      const c = r as unknown as CheckIn;
      if (!archiveTasks.has(c.task_id)) continue;
      if (!(['start', 'pause', 'resume', 'stop', 'add'] as const).includes(c.kind)) continue;
      add('extra', 'check_in', '_meta/checkins.json', c.id, fresh<Omit<CheckIn, 'updated_at' | 'deleted'>>({ id: c.id, task_id: c.task_id, period_key: c.period_key, kind: c.kind, amount: num(c.amount) ?? 0, at: iso(c.at) ?? now.toISOString() }));
    }
  }

  // 引用检查：找不到的前后关系 / 人物
  const taskExists = (id: string) => seen.has(`task:${id}`) || !!store.get('task', id);
  for (const r of refs) {
    const missing = [...r.after, ...r.related].filter((id) => !taskExists(id)).length;
    if (missing) warn(r.path, tr('有 {n} 件关联的任务找不到，没连上', { n: missing }));
    const missingPeople = r.people.filter((id) => !archivePeople.has(id) && !store.get('person', id)).length;
    if (missingPeople) warn(r.path, tr('有 {n} 个人物找不到，没关联', { n: missingPeople }));
  }

  return { format, entries, refs, issues, imagePaths: [...imagePaths] };
}

/** 预览的数字：overwrite = 已有的用文件覆盖。 */
export function summarizeImport(plan: ImportPlan, overwrite: boolean): ImportCounts {
  const byKind = Object.fromEntries(IMPORT_KINDS.map((k) => [k, { create: 0, update: 0, skip: 0 }])) as ImportCounts['byKind'];
  for (const e of plan.entries) {
    if (e.kind === 'extra') continue;
    const k = byKind[e.kind];
    if (e.state === 'new') k.create++;
    else if (e.state === 'existing' && overwrite) k.update++;
    else k.skip++;
  }
  const sum = (f: 'create' | 'update' | 'skip') => IMPORT_KINDS.reduce((n, k) => n + byKind[k][f], 0);
  return { create: sum('create'), update: sum('update'), skip: sum('skip'), errors: plan.issues.filter((i) => i.level === 'error').length, byKind };
}

// ───────────── 写入与撤销 ─────────────

export interface ImportReceipt {
  /** 写之前的样子（null = 原来没有）：撤销时写回去。 */
  before: Array<{ table: TableName; id: string; row: BaseRow | null }>;
  counts: ImportCounts;
  /** 写的时候才发现接不上的（会绕成圈的前后关系…）。 */
  issues: ImportIssue[];
}

/** 一次写入（一批、进 outbox）。overwrite：已有的用文件覆盖（含它的前后关系、相关任务、人物）。 */
export function applyImport(store: Store, plan: ImportPlan, opts: { overwrite?: boolean } = {}): ImportReceipt {
  const overwrite = !!opts.overwrite;
  const rows = new Map<string, { table: TableName; row: BaseRow }>();
  const before: ImportReceipt['before'] = [];
  const issues: ImportIssue[] = [];
  const touched = new Set<string>();
  const put = (table: TableName, row: BaseRow) => {
    const key = `${table}:${row.id}`;
    if (!touched.has(key)) {
      touched.add(key);
      const cur = store.raw(table, row.id);
      before.push({ table, id: row.id, row: cur ? { ...cur } : null });
    }
    rows.set(key, { table, row });
  };

  const active = new Set<string>();
  for (const e of plan.entries) {
    const write = e.state === 'new' || (overwrite && e.state === 'existing');
    if (write) put(e.table, e.table === 'journal_entry' ? ({ ...e.row, updated_at: '', deleted: false, base_at: store.journalBaseOf(e.id) } as BaseRow) : { ...e.row, updated_at: '', deleted: false });
    if (e.table === 'task' && (e.state === 'new' || overwrite)) active.add(e.id);
  }
  const planned = new Set(plan.entries.map((e) => `${e.table}:${e.id}`));
  const taskAlive = (id: string) => !!store.get('task', id) || planned.has(`task:${id}`);
  const personAlive = (id: string) => !!store.get('person', id) || planned.has(`person:${id}`);

  // 前后关系：本机现有的生效边 + 这次加的，逐条过环检测
  let edges = store.edges().map((e) => ({ ...e }));
  const deps = store.list('dependency');
  for (const r of plan.refs) {
    if (!active.has(r.taskId)) continue;
    const want = new Set(r.after.filter((p) => taskAlive(p) && p !== r.taskId));
    if (overwrite && store.get('task', r.taskId)) {
      for (const d of deps)
        if (d.succ_id === r.taskId && !want.has(d.pred_id)) {
          put('dependency', { ...d, deleted: true });
          edges = edges.filter((e) => !(e.pred_id === d.pred_id && e.succ_id === d.succ_id));
        }
    }
    for (const pred of want) {
      if (edges.some((e) => e.pred_id === pred && e.succ_id === r.taskId)) continue;
      if (reaches(edges, r.taskId, pred)) {
        issues.push({ path: r.path, message: tr('有一条前后关系会绕成圈，没连上'), level: 'warning' });
        continue;
      }
      edges.push({ pred_id: pred, succ_id: r.taskId });
      put('dependency', { id: uuidv7(store.now().getTime()), updated_at: '', deleted: false, pred_id: pred, succ_id: r.taskId, type: 'FS', lag: 0 } as BaseRow);
    }
  }

  // 相关任务：两头的文件各写一次，合在一起按对去重
  const wantPairs = new Map<string, [string, string]>();
  for (const r of plan.refs) {
    if (!active.has(r.taskId)) continue;
    for (const o of r.related) if (o !== r.taskId && taskAlive(o)) wantPairs.set(taskLinkId(r.taskId, o), canonicalPair(r.taskId, o));
  }
  if (overwrite) {
    for (const l of store.list('task_link'))
      if ((active.has(l.a_task_id) || active.has(l.b_task_id)) && store.get('task', l.a_task_id) && store.get('task', l.b_task_id) && !wantPairs.has(l.id)) {
        // 只去掉「这次文件里出现的那件」却没写的关系
        const listed = plan.refs.some((r) => active.has(r.taskId) && (r.taskId === l.a_task_id || r.taskId === l.b_task_id));
        if (listed) put('task_link', { ...l, deleted: true });
      }
  }
  for (const [id, [a, b]] of wantPairs) {
    if (edges.some((e) => (e.pred_id === a && e.succ_id === b) || (e.pred_id === b && e.succ_id === a))) continue;
    const cur = store.raw('task_link', id);
    if (cur && !cur.deleted) continue;
    put('task_link', { id, updated_at: '', deleted: false, a_task_id: a, b_task_id: b, note: cur && 'note' in cur ? (cur as { note: string }).note : '', created_at: store.now().toISOString() } as BaseRow);
  }

  // 人物关联、我的一天
  const tp = store.list('task_person');
  const md = store.list('my_day');
  const mdSort = new Map<string, number>();
  for (const m of md) mdSort.set(m.date, Math.max(mdSort.get(m.date) ?? 0, m.sort));
  for (const r of plan.refs) {
    if (!active.has(r.taskId)) continue;
    const want = new Set(r.people.filter(personAlive));
    if (overwrite) for (const x of tp) if (x.task_id === r.taskId && !want.has(x.person_id)) put('task_person', { ...x, deleted: true });
    for (const pid of want) {
      if (tp.some((x) => x.task_id === r.taskId && x.person_id === pid)) continue;
      const id = `${r.taskId}-person-${pid}`;
      put('task_person', { id, updated_at: '', deleted: false, task_id: r.taskId, person_id: pid } as BaseRow);
    }
    for (const date of new Set(r.myDay)) {
      if (md.some((m) => m.task_id === r.taskId && m.date === date)) continue;
      const sort = (mdSort.get(date) ?? 0) + 1;
      mdSort.set(date, sort);
      put('my_day', { id: uuidv7(store.now().getTime()), updated_at: '', deleted: false, task_id: r.taskId, date, sort, added_at: store.now().toISOString() } as BaseRow);
    }
  }

  store.batch(() => store.write([...rows.values()]));
  return { before, counts: summarizeImport(plan, overwrite), issues };
}

/** 有没有一条路从 from 走到 to（加 to → from 这条边会不会成环）。 */
function reaches(edges: ReadonlyArray<{ pred_id: string; succ_id: string }>, from: string, to: string): boolean {
  if (from === to) return true;
  const next = new Map<string, string[]>();
  for (const e of edges) next.set(e.pred_id, [...(next.get(e.pred_id) ?? []), e.succ_id]);
  const seen = new Set<string>([from]);
  const stack = [from];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const n of next.get(cur) ?? []) {
      if (n === to) return true;
      if (!seen.has(n)) {
        seen.add(n);
        stack.push(n);
      }
    }
  }
  return false;
}

/** 整批撤销：这次导入写过的每一行回到导入前（原来没有的打墓碑）。也是一批写入、进 outbox。 */
export function undoImport(store: Store, receipt: ImportReceipt): number {
  const rows: Array<{ table: TableName; row: BaseRow }> = [];
  for (const b of receipt.before) {
    const cur = store.raw(b.table, b.id);
    if (b.row) rows.push({ table: b.table, row: { ...b.row } });
    else if (cur && !cur.deleted) rows.push({ table: b.table, row: { ...cur, deleted: true } });
  }
  store.batch(() => store.write(rows));
  return rows.length;
}
