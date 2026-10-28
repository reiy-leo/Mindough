/**
 * 导出成 Markdown 文件夹（格式见 docs/EXPORT.md）：一件任务一个 .md（YAML front matter + 正文），
 * 组 = 一层文件夹（_group.md 记组的属性），资料库 library/<库名>/<名字>.md，人物 people/<名字>.md，
 * 日记 journal/YYYY/MM/YYYY-MM-DD.md（一天一个文件，每条一段：标记注释记 id / created / mood，见 journal-feed.ts 的 formatJournalDay），附件 attachments/<文件名>（记录在 _meta/attachments.json，正文后面附一段链接），类型、打卡分类、打卡记录等放 _meta/*.json，图片放 assets/ 并把正文里的引用改成相对路径。
 * id 才是身份：文件名只给人看，改名不影响再导入。
 */
import type { Store } from '../store';
import { firstLine } from '../preview';
import { toDateKey } from '../dates';
import { journalEntryId } from '../journal';
import { entryIdOfPost, formatJournalDay, groupPostsByDay } from '../journal-feed';
import { libraryCopy } from '../library';
import { dataLabel, tr } from '../i18n';
import { fileKind, sortAttachments, uniqueFileName } from '../attachments';
import { type Asset, type Attachment, type FieldDef, type FieldValue, type Group, type Task, type TaskType } from '../types';
import {
  MD_IMAGE,
  NameSet,
  Noted,
  Quoted,
  decodeDataUrl,
  extOfMime,
  hash16,
  mdHref,
  relativePath,
  safeName,
  stringifyFrontMatter,
  utf8,
  type ArchiveFile,
} from './text';

export const ARCHIVE_FORMAT = 'mindough-markdown';
export const ARCHIVE_VERSION = 1;
/** 归档根下保留的文件夹（不当成组）。 */
export const RESERVED_DIRS = ['_meta', 'library', 'people', 'assets', 'journal', 'attachments'] as const;
/** 正文后面列附件的那一段从这行开始（只给人看、Obsidian 里能点；导入时整段去掉，附件以 _meta/attachments.json 为准）。 */
export const ATTACHMENTS_MARKER = '<!-- mindough:attachments -->';
export const MANIFEST_PATH = '_meta/mindough.json';

export interface ExportImage {
  mime: string;
  data: Uint8Array;
}

export interface ExportOptions {
  now?: Date;
  /** 远程图片（http 链接）事先取回的内容；取不到的照原链接写。 */
  images?: ReadonlyMap<string, ExportImage>;
  /** 附件的文件内容（附件 id → 字节），事先取回（本机上传队列里的、或从 R2 下载的）；取不到的只写记录。 */
  attachments?: ReadonlyMap<string, Uint8Array>;
}

export interface ExportCounts {
  tasks: number;
  groups: number;
  library: number;
  people: number;
  /** 日记篇数。 */
  journal: number;
  images: number;
  /** 附件个数（含没取到文件、只写了记录的）。 */
  attachments: number;
  /** 其中没取到文件的。 */
  missingAttachments: number;
}

export interface ExportResult {
  files: ArchiveFile[];
  counts: ExportCounts;
}

const isRemote = (s: string) => /^(https?:|blob:)/i.test(s);
const isUrlish = (s: string) => /^(https?:|blob:|data:)/i.test(s);

/** 要事先取回的远程图片：asset 行的 http 地址、正文里的 http 图片、字段里直接写的图片链接。 */
export function remoteImageUrls(store: Store): string[] {
  const out = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v !== 'string' || !v) return;
    if (isRemote(v)) out.add(v);
    else if (!isUrlish(v)) {
      const a = store.get('asset', v);
      if (a?.url && isRemote(a.url)) out.add(a.url);
    }
  };
  const scanBody = (md: string) => {
    for (const m of md.matchAll(MD_IMAGE)) {
      const u = m[2]!.replace(/^<|>$/g, '');
      if (isRemote(u)) out.add(u);
    }
  };
  const types = new Map(store.list('task_type').map((t) => [t.id, t]));
  for (const t of store.list('task')) {
    scanBody(t.body_md);
    for (const f of imageFields(types.get(t.type_id ?? ''))) add(t.type_data[f.key]);
  }
  for (const i of store.list('library_item')) {
    add(i.image);
    scanBody(i.note_md);
    for (const f of imageFields(types.get(i.type_id))) add(i.fields[f.key]);
  }
  for (const p of store.list('person')) {
    add(p.avatar_asset_id);
    scanBody(p.note_md);
  }
  return [...out];
}

const imageFields = (type: TaskType | undefined): FieldDef[] => (type?.fields ?? []).filter((f) => f.kind === 'image');

/** 图片登记：同一张图只写一次。 */
class Images {
  readonly files = new Map<string, ArchiveFile>();
  readonly assets = new Map<string, Asset & { file?: string }>();
  constructor(
    private readonly store: Store,
    private readonly fetched: ReadonlyMap<string, ExportImage>,
  ) {}

  private put(path: string, data: Uint8Array): string {
    if (!this.files.has(path)) this.files.set(path, { path, data });
    return path;
  }

  /** 一个链接（data: / http）→ assets/ 下的文件路径；取不到内容时 null。 */
  private urlFile(url: string): string | null {
    const d = decodeDataUrl(url);
    if (d && url.startsWith('data:')) return this.put(`assets/img-${hash16(url)}.${extOfMime(d.mime)}`, d.data);
    const f = this.fetched.get(url);
    if (f) return this.put(`assets/img-${hash16(url)}.${extOfMime(f.mime)}`, f.data);
    return null;
  }

  /** 字段里的图片值（asset id / 链接 / data URL）→ front matter 里写的值。 */
  value(v: FieldValue | undefined): FieldValue | undefined {
    if (typeof v !== 'string' || !v) return v;
    if (isUrlish(v)) return this.urlFile(v) ?? v;
    const a = this.store.get('asset', v);
    if (!a) return v;
    let file: string | undefined;
    const d = a.url ? decodeDataUrl(a.url) : null;
    if (d && a.url!.startsWith('data:')) file = this.put(`assets/${a.id}.${extOfMime(a.mime || d.mime)}`, d.data);
    else if (a.url && this.fetched.get(a.url)) {
      const f = this.fetched.get(a.url)!;
      file = this.put(`assets/${a.id}.${extOfMime(a.mime || f.mime)}`, f.data);
    }
    const { updated_at: _u, deleted: _d, ...row } = a;
    this.assets.set(a.id, { ...(row as Asset), ...(file ? { file, url: null } : {}) });
    // 有文件：写文件路径（看得懂、Obsidian 能预览）；没有文件：写 asset id（导入时按 _meta/assets.json 接回原地址）
    return file ?? a.id;
  }

  /** 正文里的图片链接改成相对这篇文件的路径。 */
  body(md: string, filePath: string): string {
    return md.replace(MD_IMAGE, (all, alt: string, href: string, title: string | undefined) => {
      const url = href.replace(/^<|>$/g, '');
      if (!isUrlish(url)) return all;
      const file = this.urlFile(url);
      return file ? `![${alt}](${mdHref(relativePath(filePath, file))}${title ?? ''})` : all;
    });
  }
}

const json = (v: unknown) => utf8(JSON.stringify(v, null, 2) + '\n');
const strip = <T extends { updated_at: string; deleted: boolean }>(r: T): Omit<T, 'updated_at' | 'deleted'> => {
  const { updated_at: _u, deleted: _d, ...rest } = r;
  return rest;
};
const dateKey = (iso: string) => (Number.isFinite(Date.parse(iso)) ? toDateKey(new Date(iso)) : iso.slice(0, 10));

/** 要导出的附件：挂在活着的任务 / 日记上的。 */
export function exportableAttachments(store: Store): Attachment[] {
  const tasks = new Set(store.tasks().map((t) => t.id));
  const journal = new Set(store.list('journal_entry').map((e) => e.id));
  // 旧日记转来的那条还在（旧表那行可能不在，比如导入进来的）也算
  for (const p of store.list('journal_post')) {
    const e = entryIdOfPost(p.id);
    if (e) journal.add(e);
  }
  return sortAttachments(store.list('attachment').filter((a) => (a.owner_type === 'task' && tasks.has(a.owner_id)) || (a.owner_type === 'journal' && journal.has(a.owner_id))));
}

/** 正文后面那段附件清单（图片用 ![]()，其余 []()；没取到文件的只写名字）。 */
function attachmentBlock(list: readonly Attachment[], paths: ReadonlyMap<string, string>, filePath: string, heading: string): string {
  if (!list.length) return '';
  const lines = list.map((a) => {
    const p = paths.get(a.id);
    const label = a.file_name.replace(/[[\]\n]/g, ' ');
    if (!p) return `- ${label}`;
    const href = mdHref(relativePath(filePath, p));
    return fileKind(a.file_name, a.mime) === 'image' ? `- ![${label}](${href})` : `- [${label}](${href})`;
  });
  return `\n\n${ATTACHMENTS_MARKER}\n## ${heading}\n\n${lines.join('\n')}\n`;
}

/** 导出全部（未删除的）数据。纯函数式地读 Store，不写。 */
export function exportArchive(store: Store, opts: ExportOptions = {}): ExportResult {
  const now = opts.now ?? store.now();
  const images = new Images(store, opts.images ?? new Map());
  const files: ArchiveFile[] = [];
  const types = new Map(store.list('task_type').map((t) => [t.id, t]));
  const groups = store.list('group').sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1));
  const tasks = store.tasks();
  const typeNote = (id: string | null | undefined) => {
    const t = id ? types.get(id) : undefined;
    return t ? dataLabel(t.name) : '';
  };
  const taskName = (t: Task) => firstLine(t.body_md) || store.itemOf(t)?.name || tr('空白任务');

  // ── 附件：attachments/<文件名>（同名加「 2」），记录在 _meta/attachments.json ──
  const attachments = exportableAttachments(store);
  const attachmentPath = new Map<string, string>();
  const attachmentNames = new Set<string>();
  const attachmentFiles: ArchiveFile[] = [];
  for (const a of attachments) {
    const data = opts.attachments?.get(a.id);
    if (!data) continue;
    const path = `attachments/${uniqueFileName(a.file_name, attachmentNames)}`;
    attachmentPath.set(a.id, path);
    attachmentFiles.push({ path, data });
  }
  const attachmentsOf = new Map<string, Attachment[]>();
  for (const a of attachments) attachmentsOf.set(`${a.owner_type}:${a.owner_id}`, [...(attachmentsOf.get(`${a.owner_type}:${a.owner_id}`) ?? []), a]);
  const block = (ownerType: string, ownerId: string, path: string) => attachmentBlock(attachmentsOf.get(`${ownerType}:${ownerId}`) ?? [], attachmentPath, path, tr('附件'));

  // ── 组：一层文件夹 ──
  const rootDirs = new NameSet([...RESERVED_DIRS]);
  const groupDir = new Map<string, string>();
  for (const g of groups) {
    const dir = rootDirs.take(safeName(g.name, tr('未命名项目')));
    groupDir.set(g.id, dir);
    const fm = stringifyFrontMatter(groupFront(g, store));
    files.push({ path: `${dir}/_group.md`, data: utf8(`${fm}\n# ${g.name.replace(/\n/g, ' ')}\n`) });
  }

  // ── 任务 ──
  const namesIn = new Map<string, NameSet>();
  const preds = new Map<string, string[]>();
  for (const e of store.edges()) preds.set(e.succ_id, [...(preds.get(e.succ_id) ?? []), e.pred_id]);
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const noteOfTask = (id: string) => {
    const t = taskById.get(id);
    return t ? taskName(t) : '';
  };
  const checkins = store.list('check_in').sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1));
  const checkinsOf = new Map<string, typeof checkins>();
  for (const c of checkins) if (taskById.has(c.task_id)) checkinsOf.set(c.task_id, [...(checkinsOf.get(c.task_id) ?? []), c]);
  const myDayOf = new Map<string, string[]>();
  for (const m of store.list('my_day').sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.sort - b.sort))) myDayOf.set(m.task_id, [...(myDayOf.get(m.task_id) ?? []), m.date]);
  const peopleOf = new Map<string, string[]>();
  for (const x of store.list('task_person')) if (store.get('person', x.person_id)) peopleOf.set(x.task_id, [...new Set([...(peopleOf.get(x.task_id) ?? []), x.person_id])]);

  const catsOf = (t: Task) => store.categoryIdsOfTask(t);
  const itemsOf = (t: Task) => store.itemIdsOfTask(t);
  for (const t of tasks) {
    const dir = (t.group_id && groupDir.get(t.group_id)) || '';
    let names = namesIn.get(dir);
    if (!names) namesIn.set(dir, (names = new NameSet(dir ? ['_group.md'] : [])));
    const file = names.take(safeName(taskName(t), tr('空白任务')), '.md');
    const path = dir ? `${dir}/${file}` : file;
    const type = types.get(t.type_id ?? '');
    const imgKeys = new Set(imageFields(type).map((f) => f.key));
    const fields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(t.type_data)) fields[k] = imgKeys.has(k) ? images.value(v) : v;
    const cis = checkinsOf.get(t.id) ?? [];
    const item = store.itemOf(t);
    const fm: Record<string, unknown> = {
      id: t.id,
      status: t.status,
      created: t.created_at,
      done: t.done_at ?? undefined,
      scheduled: t.scheduled_date ?? undefined,
      end_date: t.scheduled_date && t.end_date && t.end_date > t.scheduled_date ? t.end_date : undefined,
      group: t.group_id ? new Noted(t.group_id, store.get('group', t.group_id)?.name ?? '') : undefined,
      type: t.type_id ? new Noted(t.type_id, typeNote(t.type_id)) : undefined,
      item: t.library_item_id ? new Noted(t.library_item_id, item?.name ?? '') : undefined,
      fields: Object.keys(fields).length ? fields : undefined,
      completion: t.completion_mode,
      target: t.target_value ?? undefined,
      unit: t.unit ?? undefined,
      count: t.completion_mode === 'count' && t.count_config && Object.keys(t.count_config).length ? t.count_config : undefined,
      target_date: t.target_date ?? undefined,
      repeat: t.recurrence ?? undefined,
      category: t.category_id ? new Noted(store.categoryOf(t)?.id ?? t.category_id, dataLabel(store.categoryOf(t)?.name ?? '')) : undefined,
      // 多类型与多资料（Rei 2026-10-28）：有两个以上才写全部；第一个照旧写在 category / item 里（旧版本只读那两项）
      categories: catsOf(t).length > 1 ? listOf(catsOf(t), (id) => dataLabel(store.category(id)?.name ?? '')) : undefined,
      items: itemsOf(t).length > 1 ? listOf(itemsOf(t), (id) => store.get('library_item', id)?.name ?? '') : undefined,
      remind: t.remind_time ? new Quoted(t.remind_time) : undefined,
      time_zone: t.time_zone ?? undefined,
      sort: t.sort,
      people: listOf(peopleOf.get(t.id), (id) => store.get('person', id)?.name ?? ''),
      after: listOf(
        (preds.get(t.id) ?? []).filter((id) => taskById.has(id)),
        noteOfTask,
      ),
      related: listOf(
        store.relatedTasks(t.id).map((r) => r.id),
        noteOfTask,
      ),
      my_day: myDayOf.get(t.id),
      checkins: cis.length ? { count: cis.length, last: dateKey(cis[cis.length - 1]!.at) } : undefined,
    };
    files.push({ path, data: utf8(stringifyFrontMatter(fm) + images.body(t.body_md, path) + block('task', t.id, path)) });
  }

  // ── 资料库 ──
  const libDirs = new NameSet();
  const libDirOf = new Map<string, string>();
  const libNames = new Map<string, NameSet>();
  const items = store.list('library_item').sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1));
  for (const it of items) {
    const type = types.get(it.type_id);
    let dir = libDirOf.get(it.type_id);
    if (!dir) {
      dir = `library/${libDirs.take(safeName(type ? libraryCopy({ id: type.id, name: dataLabel(type.name) }).name : tr('其他'), tr('其他')))}`;
      libDirOf.set(it.type_id, dir);
      libNames.set(dir, new NameSet());
    }
    const path = `${dir}/${libNames.get(dir)!.take(safeName(it.name), '.md')}`;
    const imgKeys = new Set(imageFields(type).map((f) => f.key));
    const fields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(it.fields)) fields[k] = imgKeys.has(k) ? images.value(v) : v;
    const fm = {
      id: it.id,
      type: new Noted(it.type_id, typeNote(it.type_id)),
      name: it.name,
      image: it.image ? images.value(it.image) : undefined,
      fields: Object.keys(fields).length ? fields : undefined,
      created: it.created_at,
    };
    files.push({ path, data: utf8(stringifyFrontMatter(fm) + images.body(it.note_md, path)) });
  }

  // ── 人物 ──
  const peopleNames = new NameSet();
  const people = store.list('person').sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1));
  for (const p of people) {
    const path = `people/${peopleNames.take(safeName(p.name), '.md')}`;
    const fm = {
      id: p.id,
      name: p.name,
      avatar: p.avatar_asset_id ? images.value(p.avatar_asset_id) : undefined,
      relation: p.relation ?? undefined,
      birthday: p.birthday ?? undefined,
    };
    files.push({ path, data: utf8(stringifyFrontMatter(fm) + images.body(p.note_md, path)) });
  }

  // ── 日记：journal/YYYY/MM/YYYY-MM-DD.md，一天一个文件，每条一段（2026-10-28 改成 Feed 流） ──
  const days: Array<{ day: string; posts: ReturnType<typeof groupPostsByDay>[number]['posts'] }> = groupPostsByDay(store.list('journal_post')).reverse();
  // 旧日记只挂了附件、没转出条目的那天：也写一个文件（附件要挂在它上面）
  const haveDay = new Set(days.map((d) => d.day));
  for (const e of store.list('journal_entry'))
    if (!haveDay.has(e.date) && attachmentsOf.has(`journal:${e.id}`)) {
      days.push({ day: e.date, posts: [] });
      haveDay.add(e.date);
    }
  days.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  let journalPosts = 0;
  for (const { day, posts } of days) {
    const path = `journal/${day.slice(0, 4)}/${day.slice(5, 7)}/${day}.md`;
    const entryId = journalEntryId(day);
    const fm = { id: entryId, date: day, posts: posts.length };
    journalPosts += posts.length;
    files.push({ path, data: utf8(stringifyFrontMatter(fm) + formatJournalDay(posts, (md) => images.body(md, path)) + block('journal', entryId, path)) });
  }

  // ── _meta ──
  const counts: ExportCounts = {
    tasks: tasks.length,
    groups: groups.length,
    library: items.length,
    people: people.length,
    journal: journalPosts,
    images: images.files.size,
    attachments: attachments.length,
    missingAttachments: attachments.length - attachmentPath.size,
  };
  files.push({ path: MANIFEST_PATH, data: json({ format: ARCHIVE_FORMAT, version: ARCHIVE_VERSION, exported_at: now.toISOString(), device: store.deviceId, counts }) });
  // 类型的 hidden 列语义是「归档」（Rei 2026-10-17），文件里写 archived；导入兼容旧文件的 hidden
  files.push({
    path: '_meta/types.json',
    data: json(
      store
        .list('task_type')
        .sort((a, b) => a.sort - b.sort || (a.id < b.id ? -1 : 1))
        .map((t) => {
          const { hidden, ...rest } = strip(t);
          return { ...rest, archived: hidden };
        }),
    ),
  });
  // 类型（打卡分类和项目分类合成的一套，2026-10-26）：只写 categories.json；旧的 checkin-categories.json 不再写，导入还认
  files.push({ path: '_meta/categories.json', data: json(store.categories(true).map(strip)) });
  files.push({ path: '_meta/prefs.json', data: json(store.list('pref').map(strip)) });
  files.push({ path: '_meta/checkins.json', data: json(checkins.filter((c) => taskById.has(c.task_id)).map(strip)) });
  files.push({ path: '_meta/assets.json', data: json([...images.assets.values()]) });
  files.push({ path: '_meta/attachments.json', data: json(attachments.map((a) => ({ ...strip(a), ...(attachmentPath.has(a.id) ? { file: attachmentPath.get(a.id) } : {}) }))) });
  files.push(...images.files.values());
  files.push(...attachmentFiles);
  return { files, counts };
}

function listOf(ids: readonly string[] | undefined, note: (id: string) => string): Noted[] | undefined {
  if (!ids?.length) return undefined;
  return ids.map((id) => new Noted(id, note(id)));
}

function groupFront(g: Group, store: Store): Record<string, unknown> {
  const cat = store.category(g.category_id);
  const type = store.get('task_type', g.default_type_id);
  return {
    id: g.id,
    name: g.name,
    icon: g.icon || undefined,
    start: g.start_at ?? undefined,
    end: g.end_at ?? undefined,
    category: g.category_id ? new Noted(cat?.id ?? g.category_id, cat ? dataLabel(cat.name) : '') : undefined,
    default_type: g.default_type_id ? new Noted(g.default_type_id, type ? dataLabel(type.name) : '') : undefined,
  };
}

/** 导出的文件夹名 / zip 名：「Mindough 2026-10-16」。 */
export function archiveName(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `Mindough ${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
