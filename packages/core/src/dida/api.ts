/**
 * 直接连滴答清单账户（官方 Open API，https://developer.dida365.com/docs/openapi.md）：用「个人 API 令牌」拉清单和任务，
 * 换成和备份 CSV 一样的 DidaRow，后面的预览 / 映射 / 幂等 / 结果一套流程共用（plan.ts）。
 *
 * 这里不发网络请求：调用方传一个 call(method, path, body)（客户端经 Worker 代理 /api/dida/*，测试里用假数据）。
 * 拉取顺序：
 *   1. GET /open/v1/project（清单）+ GET /open/v1/project/group（文件夹名）
 *   2. 每个清单 GET /open/v1/project/{id}/data（未完成的任务），收集箱用 "inbox"
 *   3. 已完成：POST /open/v1/task/completed {startDate, endDate}（不传 projectIds = 所有清单，含收集箱），
 *      每次最多 200 条：按时间窗口往回翻，一个窗口拿满 200 条就对半切开再拉
 *   4. 已放弃：POST /open/v1/task/filter {status: [-1]}（同样最多 200 条；拿不到就跳过并提示）。
 *      filter 的 startDate / endDate 筛的是任务的开始日期，不是放弃的时间，所以不传
 *   5. 最后所有任务（未完成 / 已完成 / 已放弃）在本地按所选范围再筛一遍（range.ts；Rei 2026-10-26
 *      「选择30天实际是全部」「选择了30天，还是会导入全部」）
 */
import { tr } from '../i18n';
import type { DidaIssue, DidaKind, DidaRow, DidaStatus } from './parse';
import { applyDidaRange, didaMs } from './range';

export interface DidaApiItem {
  id?: string;
  title?: string;
  status?: number;
  sortOrder?: number;
}

export interface DidaApiTask {
  id: string;
  projectId?: string;
  title?: string;
  content?: string;
  desc?: string;
  items?: DidaApiItem[];
  startDate?: string;
  dueDate?: string;
  timeZone?: string;
  isAllDay?: boolean;
  repeatFlag?: string;
  reminders?: string[];
  tags?: string[];
  priority?: number;
  status?: number;
  completedTime?: string;
  createdTime?: string;
  modifiedTime?: string;
  sortOrder?: number;
  parentId?: string;
  kind?: string;
}

export interface DidaApiProject {
  id: string;
  name?: string;
  groupId?: string | null;
  closed?: boolean;
  kind?: string;
  sortOrder?: number;
}

export interface DidaApiGroup {
  id: string;
  name?: string;
}

/** 收集箱的清单名（和 CSV 导出里写的一样）。 */
export const DIDA_INBOX = 'Inbox';

const statusOf = (n: number | undefined): DidaStatus => (n === -1 ? 'closed' : n === 1 || n === 2 ? 'done' : 'open');
const kindOf = (k: string | undefined, items: boolean): DidaKind => {
  const s = (k ?? '').toUpperCase();
  if (s === 'NOTE' || s === 'CHECKLIST' || s === 'TEXT') return s;
  return items ? 'CHECKLIST' : 'TEXT';
};

/** 一条 API 任务 → DidaRow。清单子项写成 ▪ / ▫ 行（和 CSV 导出同一种写法），之后统一转成待办列表。 */
export function apiTaskToRow(t: DidaApiTask, ctx: { list: string; folder: string | null; line: number }): DidaRow {
  const items = [...(t.items ?? [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const kind = kindOf(t.kind, items.length > 0);
  // CHECKLIST 的说明在 desc，TEXT / NOTE 的正文在 content
  const lead = (kind === 'CHECKLIST' ? (t.desc || t.content) : (t.content || t.desc)) ?? '';
  const lines = items.filter((i) => (i.title ?? '').trim()).map((i) => `${i.status === 1 || i.status === 2 ? '▪' : '▫'}${(i.title ?? '').trim()}`);
  const content = [lead.replace(/\s+$/, ''), lines.join('\n')].filter(Boolean).join('\n');
  return {
    line: ctx.line,
    taskId: t.id || null,
    parentId: t.parentId || null,
    folder: ctx.folder ?? '',
    list: ctx.list,
    title: (t.title ?? '').trim(),
    kind,
    tags: (t.tags ?? []).map((x) => String(x).trim().replace(/^#/, '')).filter(Boolean),
    content,
    isChecklist: items.length > 0,
    start: t.startDate || null,
    due: t.dueDate || null,
    reminder: (t.reminders ?? []).join(','),
    repeat: t.repeatFlag ?? '',
    priority: Number(t.priority ?? 0) || 0,
    status: statusOf(t.status),
    created: t.createdTime || null,
    completed: t.completedTime || null,
    modified: t.modifiedTime || null,
    order: typeof t.sortOrder === 'number' ? t.sortOrder : null,
    timezone: t.timeZone || null,
    allDay: !!t.isAllDay,
    floating: false,
  };
}

/** 调用 Open API 的函数：method + 路径（open/v1/…）+ 可选 JSON 体 → 解析好的 JSON。出错抛 DidaApiError。 */
export type DidaCall = (method: 'GET' | 'POST', path: string, body?: unknown) => Promise<unknown>;

export class DidaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface DidaFetchOptions {
  /**
   * 导入最近多少天的任务；null = 全部（不筛）。对所有任务都生效，按最后修改或完成的时间算（range.ts）。
   * 已完成的还会让接口只给这段时间的；不管接口筛没筛，拿回来都在本地再筛一遍。
   */
  days: number | null;
  /** 拉已完成的（默认拉）。 */
  completed?: boolean;
  /** 拉已放弃的（-1，默认拉）。 */
  abandoned?: boolean;
  now?: Date;
  /** 「全部」从哪天开始往回翻（滴答清单 2013 年上线）。 */
  earliest?: Date;
  /** 取消（AbortSignal；core 不带 DOM 类型，只用到 aborted）。 */
  signal?: { readonly aborted: boolean };
  onProgress?: (p: DidaProgress) => void;
}

export interface DidaProgress {
  step: 'projects' | 'open' | 'completed' | 'abandoned';
  /** 已经拿到的任务数。 */
  tasks: number;
  /** 未完成那一步：第几个清单 / 共几个。 */
  done?: number;
  total?: number;
}

export class DidaAbort extends Error {}

/** API 要的时间写法：2026-03-01T00:58:20.000+0000。 */
export const apiStamp = (d: Date) => d.toISOString().replace('Z', '+0000');

const PAGE = 200;
const MIN_WINDOW_MS = 60_000;
/** 判断「接口没按时间筛」时留的余量。 */
const SLACK_MS = 86_400_000;

/** 拉整个账户 → DidaRow（未完成 + 已完成 + 已放弃，按 id 去重，按范围筛过；dropped = 不在范围里筛掉的件数）。 */
export async function fetchDidaAccount(call: DidaCall, opts: DidaFetchOptions): Promise<{ rows: DidaRow[]; issues: DidaIssue[]; dropped: number }> {
  const now = opts.now ?? new Date();
  const check = () => {
    if (opts.signal?.aborted) throw new DidaAbort(tr('已取消'));
  };
  const issues: DidaIssue[] = [];
  const byId = new Map<string, DidaRow>();
  let line = 0;
  const progress = (p: Omit<DidaProgress, 'tasks'>) => opts.onProgress?.({ ...p, tasks: byId.size });

  progress({ step: 'projects' });
  const projects = ((await call('GET', 'open/v1/project')) as DidaApiProject[] | null) ?? [];
  check();
  let groups: DidaApiGroup[] = [];
  try {
    groups = ((await call('GET', 'open/v1/project/group')) as DidaApiGroup[] | null) ?? [];
  } catch (e) {
    if (e instanceof DidaApiError && e.status === 401) throw e;
    // 拿不到文件夹名只少了分类，不挡导入
  }
  check();
  const folderOf = new Map(groups.map((g) => [g.id, (g.name ?? '').trim()]));
  const info = new Map<string, { list: string; folder: string | null }>();
  for (const p of projects) info.set(p.id, { list: (p.name ?? '').trim(), folder: (p.groupId && folderOf.get(p.groupId)) || null });
  const where = (projectId: string | undefined) => {
    if (projectId && info.has(projectId)) return info.get(projectId)!;
    return { list: DIDA_INBOX, folder: null }; // 收集箱的 projectId 是 inbox + 数字，不在清单列表里
  };
  const add = (t: DidaApiTask, fallback?: { list: string; folder: string | null }) => {
    if (!t?.id || byId.has(t.id)) return;
    const w = t.projectId && info.has(t.projectId) ? info.get(t.projectId)! : (fallback ?? where(t.projectId));
    byId.set(t.id, apiTaskToRow(t, { ...w, line: ++line }));
  };

  // 未完成：每个清单 + 收集箱（关掉的清单（已归档）也拉，里面的任务照样是用户的）
  const ids = ['inbox', ...projects.map((p) => p.id)];
  for (const [i, id] of ids.entries()) {
    check();
    progress({ step: 'open', done: i, total: ids.length });
    try {
      const data = (await call('GET', `open/v1/project/${encodeURIComponent(id)}/data`)) as { tasks?: DidaApiTask[] } | null;
      for (const t of data?.tasks ?? []) add(t, id === 'inbox' ? { list: DIDA_INBOX, folder: null } : undefined);
    } catch (e) {
      if (e instanceof DidaApiError && e.status === 401) throw e;
      const name = id === 'inbox' ? DIDA_INBOX : info.get(id)?.list || id;
      issues.push({ line: 0, message: tr('清单「{name}」没拉下来：{msg}', { name, msg: e instanceof Error ? e.message : String(e) }), level: 'warning' });
    }
  }

  // 已完成：按时间窗口往回翻
  if (opts.completed !== false) {
    const end = now.getTime();
    const start = opts.days === null ? (opts.earliest ?? new Date(Date.UTC(2013, 0, 1))).getTime() : end - opts.days * 86_400_000;
    progress({ step: 'completed' });
    const windows: Array<[number, number]> = [[start, end]];
    while (windows.length) {
      check();
      const [a, b] = windows.pop()!;
      const got = ((await call('POST', 'open/v1/task/completed', { startDate: apiStamp(new Date(a)), endDate: apiStamp(new Date(b)) })) as DidaApiTask[] | null) ?? [];
      // 接口没按时间筛（给回来的完成时间明显在窗口外）：别再对半切（切多少次都一样），拿到的交给最后的本地筛
      const outside = got.some((t) => {
        const ms = didaMs(t.completedTime);
        return ms !== null && (ms < a - SLACK_MS || ms > b + SLACK_MS);
      });
      if (outside) {
        for (const t of got) add(t);
        issues.push({ line: 0, message: tr('滴答清单没按时间给已完成的任务，只拿到 {n} 件，已按所选范围在本地筛过', { n: got.length }), level: 'warning' });
        break;
      }
      if (got.length >= PAGE && b - a > MIN_WINDOW_MS) {
        const mid = Math.floor((a + b) / 2);
        windows.push([a, mid], [mid + 1, b]);
        continue;
      }
      if (got.length >= PAGE) issues.push({ line: 0, message: tr('同一分钟里完成的任务超过 {n} 件，可能有几件没拉到', { n: PAGE }), level: 'warning' });
      for (const t of got) add(t);
      progress({ step: 'completed' });
    }
  }

  // 已放弃：接口不按放弃时间筛，拿回来在本地按范围筛
  if (opts.abandoned !== false) {
    check();
    progress({ step: 'abandoned' });
    try {
      const got = ((await call('POST', 'open/v1/task/filter', { status: [-1] })) as DidaApiTask[] | null) ?? [];
      for (const t of got) if (t.status === -1) add(t);
      if (got.length >= PAGE) issues.push({ line: 0, message: tr('已放弃的任务一次最多拉 {n} 件，更早的没拉到', { n: PAGE }), level: 'warning' });
    } catch (e) {
      if (e instanceof DidaApiError && e.status === 401) throw e;
      issues.push({ line: 0, message: tr('已放弃的任务没拉下来：{msg}', { msg: e instanceof Error ? e.message : String(e) }), level: 'warning' });
    }
  }

  // 范围对所有任务生效：未完成、已完成（接口筛过也再筛一遍）、已放弃，统一在本地按时间筛；「全部」不筛
  return applyDidaRange({ rows: [...byId.values()], issues }, opts.days, now);
}
