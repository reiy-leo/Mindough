/**
 * 读滴答清单（dida365.com）/ TickTick 的「备份」CSV（网页版 设置 → 账户与安全 → 生成备份）。
 * 文件开头几行是说明（Date / Version / Status 的含义），之后才是表头；表头按名字和别名认（中英文导出都行），
 * 不靠列的顺序。字段映射见 docs/IMPORT-DIDA.md。
 */
import { tr } from '../i18n';
import { parseCsvLines } from './csv';

/** 我们用到的列（内部名）→ 表头可能的写法（小写、去空格比较）。 */
const HEADERS = {
  folder: ['foldername', 'folder', '文件夹名称', '文件夹', '清单文件夹'], // i18n-ignore 表头别名
  list: ['listname', 'list', 'project', 'projectname', '清单名称', '清单', '列表名称', '所属清单'], // i18n-ignore 表头别名
  title: ['title', 'name', 'taskname', '标题', '任务标题', '任务名称', '名称'], // i18n-ignore 表头别名
  kind: ['kind', 'type', '类型', '任务类型'], // i18n-ignore 表头别名
  tags: ['tags', 'tag', '标签'], // i18n-ignore 表头别名
  content: ['content', 'description', 'desc', 'notes', '内容', '描述', '备注'], // i18n-ignore 表头别名
  checklist: ['ischecklist', 'checklist', '是否为清单', '是否检查清单', '检查清单', '是否清单'], // i18n-ignore 表头别名
  start: ['startdate', 'start', '开始日期', '开始时间'], // i18n-ignore 表头别名
  due: ['duedate', 'due', '截止日期', '到期日期', '截止时间', '到期时间'], // i18n-ignore 表头别名
  reminder: ['reminder', 'reminders', '提醒'], // i18n-ignore 表头别名
  repeat: ['repeat', 'repeatflag', 'rrule', '重复', '重复规则'], // i18n-ignore 表头别名
  priority: ['priority', '优先级'], // i18n-ignore 表头别名
  status: ['status', '状态'], // i18n-ignore 表头别名
  created: ['createdtime', 'created', 'createdate', '创建时间', '创建日期'], // i18n-ignore 表头别名
  completed: ['completedtime', 'completed', 'completeddate', '完成时间', '完成日期'], // i18n-ignore 表头别名
  modified: ['modifiedtime', 'modified', 'updatedtime', 'updated', '修改时间', '更新时间'], // i18n-ignore 表头别名
  order: ['order', 'sortorder', '排序', '顺序'], // i18n-ignore 表头别名
  timezone: ['timezone', 'tz', '时区'], // i18n-ignore 表头别名
  allDay: ['isallday', 'allday', '是否全天', '全天'], // i18n-ignore 表头别名
  floating: ['isfloating', 'floating', '是否浮动', '浮动'], // i18n-ignore 表头别名
  taskId: ['taskid', 'id', '任务id'], // i18n-ignore 表头别名
  parentId: ['parentid', 'parent', '父任务id', '父任务'], // i18n-ignore 表头别名
} as const;
export type DidaColumn = keyof typeof HEADERS;

const norm = (s: string) => s.normalize('NFKC').trim().toLowerCase().replace(/[\s_\-]+/g, '');

/** 表头一行 → 内部名 → 列号。认出的列太少（没有标题，或少于 4 列）返回 null。 */
export function matchHeader(cells: readonly string[]): Partial<Record<DidaColumn, number>> | null {
  const out: Partial<Record<DidaColumn, number>> = {};
  cells.forEach((c, i) => {
    const n = norm(c);
    if (!n) return;
    for (const [k, names] of Object.entries(HEADERS) as Array<[DidaColumn, readonly string[]]>) {
      if (out[k] === undefined && names.includes(n)) {
        out[k] = i;
        return;
      }
    }
  });
  const found = Object.keys(out).length;
  return out.title !== undefined && found >= 4 && (out.list !== undefined || out.taskId !== undefined || out.status !== undefined) ? out : null;
}

export type DidaKind = 'TEXT' | 'CHECKLIST' | 'NOTE';
/** open 未完成（0）、done 已完成（1 完成 / 2 归档）、closed 已放弃（-1，Mindough 没有「取消」→ 关闭）。 */
export type DidaStatus = 'open' | 'done' | 'closed';

export interface DidaRow {
  /** 文件里的第几行（1 起），出错提示用。 */
  line: number;
  taskId: string | null;
  parentId: string | null;
  folder: string;
  list: string;
  title: string;
  kind: DidaKind;
  tags: string[];
  content: string;
  isChecklist: boolean;
  start: string | null;
  due: string | null;
  reminder: string;
  repeat: string;
  /** 0 无、1 低、3 中、5 高。 */
  priority: number;
  status: DidaStatus;
  created: string | null;
  completed: string | null;
  /** 修改时间（API 的 modifiedTime；备份 CSV 一般没有这列）。按范围筛已放弃的任务时，没有完成时间就看它。 */
  modified?: string | null;
  order: number | null;
  timezone: string | null;
  allDay: boolean;
  floating: boolean;
}

export interface DidaIssue {
  /** 备份文件里的第几行；直接连账户拉的没有行号（0）。 */
  line: number;
  /** 是哪件任务（标题），直接连账户时用它指认。 */
  title?: string;
  message: string;
  /** error = 这一行没导入；warning = 导入了，有一处没照原样（看不懂的状态、找不到的父任务…）。 */
  level: 'error' | 'warning';
}

export class DidaFormatError extends Error {}

const truthy = (s: string) => /^(y|yes|true|1|是|t)$/i.test(s.trim()); // i18n-ignore 「是」是中文导出里的布尔值

function statusOf(raw: string): DidaStatus | null {
  const s = raw.trim();
  if (s === '' || s === '0') return 'open';
  if (s === '1' || s === '2') return 'done';
  if (s === '-1') return 'closed';
  const n = norm(s);
  if (['normal', 'open', 'todo', '未完成', '进行中'].includes(n)) return 'open'; // i18n-ignore 状态别名
  if (['completed', 'done', 'archived', '已完成', '完成', '已归档'].includes(n)) return 'done'; // i18n-ignore 状态别名
  if (['wontdo', 'abandoned', '已放弃', '放弃', '不做了'].includes(n)) return 'closed'; // i18n-ignore 状态别名
  return null;
}

function kindOf(raw: string, checklist: boolean): DidaKind {
  const s = raw.trim().toUpperCase();
  if (s === 'CHECKLIST' || s === 'NOTE' || s === 'TEXT') return s;
  if (/清单|检查/.test(raw)) return 'CHECKLIST'; // i18n-ignore 中文类型名
  if (/笔记/.test(raw)) return 'NOTE'; // i18n-ignore 中文类型名
  return checklist ? 'CHECKLIST' : 'TEXT';
}

/** 读整份 CSV：找表头（说明行跳过），每行一条。找不到表头抛 DidaFormatError。 */
export function parseDidaCsv(text: string): { rows: DidaRow[]; issues: DidaIssue[] } {
  const records = parseCsvLines(text);
  let header: Partial<Record<DidaColumn, number>> | null = null;
  let at = -1;
  for (let i = 0; i < Math.min(records.length, 40); i++) {
    header = matchHeader(records[i]!.cells);
    if (header) {
      at = i;
      break;
    }
  }
  if (!header) throw new DidaFormatError(tr('这不像滴答清单的备份文件：没找到表头（标题、清单、状态…）'));
  const h = header;
  const rows: DidaRow[] = [];
  const issues: DidaIssue[] = [];
  for (const rec of records.slice(at + 1)) {
    const c = rec.cells;
    if (c.every((x) => !x.trim())) continue;
    const get = (k: DidaColumn): string => {
      const i = h[k];
      return i === undefined ? '' : (c[i] ?? '');
    };
    const title = get('title').trim();
    const content = get('content');
    if (!title && !content.trim()) {
      issues.push({ line: rec.line, message: tr('没有标题也没有内容，跳过'), level: 'error' });
      continue;
    }
    let status = statusOf(get('status'));
    if (!status) {
      issues.push({ line: rec.line, message: tr('状态「{s}」看不懂，当未完成导入', { s: get('status') }), level: 'warning' });
      status = 'open';
    }
    const checklist = truthy(get('checklist'));
    const pr = Number(get('priority').trim() || '0');
    const order = get('order').trim();
    const tz = get('timezone').trim();
    rows.push({
      line: rec.line,
      taskId: get('taskId').trim() || null,
      parentId: get('parentId').trim() || null,
      folder: get('folder').trim(),
      list: get('list').trim(),
      title,
      kind: kindOf(get('kind'), checklist),
      tags: get('tags')
        .split(/[,，、]/)
        .map((t) => t.trim().replace(/^#/, ''))
        .filter(Boolean),
      content,
      isChecklist: checklist,
      start: get('start').trim() || null,
      due: get('due').trim() || null,
      reminder: get('reminder').trim(),
      repeat: get('repeat').trim(),
      priority: Number.isFinite(pr) ? pr : 0,
      status,
      created: get('created').trim() || null,
      completed: get('completed').trim() || null,
      modified: get('modified').trim() || null,
      order: order && Number.isFinite(Number(order)) ? Number(order) : null,
      timezone: tz || null,
      allDay: truthy(get('allDay')),
      floating: truthy(get('floating')),
    });
  }
  return { rows, issues };
}
