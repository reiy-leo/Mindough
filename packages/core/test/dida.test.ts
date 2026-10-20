import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Store } from '../src/store';
import { MemoryAdapter } from '../src/storage/memory';
import {
  applyDida,
  checklistToMarkdown,
  didaBody,
  didaInstant,
  didaLocal,
  didaRecurrence,
  didaRemindTime,
  didaTaskId,
  DidaFormatError,
  durationMinutes,
  matchHeader,
  parseCsv,
  parseDidaCsv,
  planDida,
  previewDida,
  undoDida,
  apiTaskToRow,
  DidaAbort,
  DidaApiError,
  fetchDidaAccount,
  type DidaApiTask,
  type DidaCall,
  type DidaOptions,
} from '../src/dida';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const ALL: DidaOptions = { include: { open: true, done: true, closed: true }, timeZone: 'Asia/Shanghai' };

async function open() {
  let t = Date.UTC(2026, 9, 21, 0, 0, 0);
  return Store.open(new MemoryAdapter(), { deviceId: 'dev1', now: () => new Date((t += 1000)) });
}

describe('CSV', () => {
  it('引号里的逗号、换行、转义引号；BOM；\\r\\n', () => {
    const rows = parseCsv('\ufeffa,"b,c","d\r\ne","f""g"\r\n1,2,3,4\r\n');
    expect(rows).toEqual([
      ['a', 'b,c', 'd\ne', 'f"g'],
      ['1', '2', '3', '4'],
    ]);
  });
  it('没有结尾换行、空格子', () => {
    expect(parseCsv('a,,b\n,,')).toEqual([
      ['a', '', 'b'],
      ['', '', ''],
    ]);
  });
});

describe('表头', () => {
  it('英文 / 中文表头按名字认，不靠顺序', () => {
    expect(matchHeader(['Title', 'List Name', 'Status', 'taskId'])).toMatchObject({ title: 0, list: 1, status: 2, taskId: 3 });
    expect(matchHeader(['状态', '标题', '清单名称', '内容'])).toMatchObject({ status: 0, title: 1, list: 2, content: 3 });
    expect(matchHeader(['Date: 2026-10-21+0000'])).toBeNull();
  });
  it('不是滴答清单的文件报错', () => {
    expect(() => parseDidaCsv('name,age\nbob,3\n')).toThrow(DidaFormatError);
  });
});

describe('读备份文件', () => {
  const { rows, issues } = parseDidaCsv(fixture('dida-backup.csv'));
  it('跳过开头的说明行，读出每一行', () => {
    expect(issues).toEqual([]);
    expect(rows).toHaveLength(9);
    expect(rows.map((r) => r.taskId)).toEqual(['t-inbox-1', 't-a-1', 't-a-2', 't-a-3', 't-l-1', 't-l-2', 't-l-3', 't-l-4', 't-l-5']);
  });
  it('引号里的逗号和换行、标签、状态、类型', () => {
    const a1 = rows[1]!;
    expect(a1.title).toBe('写周报, 发给老板');
    expect(a1.content).toBe('第一段\n第二段，带 "引号"');
    expect(a1.tags).toEqual(['工作', '周报']);
    expect(a1.folder).toBe('工作');
    expect(a1.priority).toBe(5);
    expect(rows.map((r) => r.status)).toEqual(['open', 'open', 'open', 'done', 'open', 'open', 'closed', 'open', 'done']);
    expect(rows[2]!.kind).toBe('CHECKLIST');
    expect(rows[2]!.parentId).toBe('t-a-1');
    expect(rows[7]!.kind).toBe('NOTE');
    expect(rows[0]!.allDay).toBe(true);
  });
  it('报告的行号算上引号里的换行', () => {
    // 说明 3 行 + 状态说明多占 3 行 + 空行 + 表头 → 第一条在第 9 行；第二条内容里有换行，第三条从第 11 行开始
    expect(rows.slice(0, 3).map((r) => r.line)).toEqual([9, 10, 12]);
  });
  it('中文表头的导出也认', () => {
    const zh = parseDidaCsv(fixture('dida-backup-zh.csv'));
    expect(zh.rows).toHaveLength(3);
    expect(zh.rows[1]).toMatchObject({ title: '写周报, 发给老板', list: '项目 A', priority: 5, status: 'open' });
  });
  it('看不懂的状态当未完成并提示；没标题没内容的跳过', () => {
    const r = parseDidaCsv('"Title","List Name","Status","Content"\n"a","L","9",""\n"","L","0",""\n');
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.status).toBe('open');
    expect(r.issues.map((i) => i.level)).toEqual(['warning', 'error']);
  });
});

describe('时间', () => {
  it('全天任务按那一行的时区换算回当天', () => {
    expect(didaLocal('2026-10-24T16:00:00+0000', 'Asia/Shanghai')).toEqual({ date: '2026-10-25', minutes: 0 });
  });
  it('有时刻的任务按时区（含夏令时）', () => {
    expect(didaLocal('2026-10-22T13:30:00+0000', 'America/New_York')).toEqual({ date: '2026-10-22', minutes: 9 * 60 + 30 });
    expect(didaLocal('2026-12-22T14:30:00+0000', 'America/New_York')).toEqual({ date: '2026-12-22', minutes: 9 * 60 + 30 });
    expect(didaLocal('2026-10-22T13:30:00+0000', 'Asia/Singapore')).toEqual({ date: '2026-10-22', minutes: 21 * 60 + 30 });
  });
  it('不带偏移当作当地时间；认不出 null', () => {
    expect(didaLocal('2026-10-22 08:05:00', 'Asia/Shanghai')).toEqual({ date: '2026-10-22', minutes: 485 });
    expect(didaLocal('昨天', 'Asia/Shanghai')).toBeNull();
    expect(didaInstant('2026-10-20T02:00:00+0000')).toBe('2026-10-20T02:00:00.000Z');
    expect(didaInstant('2026-10-20T10:00:00+08:00')).toBe('2026-10-20T02:00:00.000Z');
  });
  it('提醒：同一天里的才放进来', () => {
    expect(durationMinutes('-PT15M')).toBe(-15);
    expect(durationMinutes('P0DT9H0M0S')).toBe(540);
    expect(didaRemindTime('TRIGGER:-PT15M', { date: '2026-10-22', minutes: 570 }, false)).toBe('09:15');
    expect(didaRemindTime('TRIGGER:P0DT9H0M0S', { date: '2026-10-25', minutes: 0 }, true)).toBe('09:00');
    expect(didaRemindTime('TRIGGER:-P1DT15H0M0S', { date: '2026-10-25', minutes: 0 }, true)).toBeNull();
    expect(didaRemindTime('TRIGGER:-P1DT15H0M0S,TRIGGER:PT8H', { date: '2026-10-25', minutes: 0 }, true)).toBe('08:00');
    expect(didaRemindTime('', { date: '2026-10-25', minutes: 0 }, true)).toBeNull();
  });
});

describe('重复', () => {
  it('能照样重复的换成 Mindough 的写法', () => {
    expect(didaRecurrence('RRULE:FREQ=DAILY;INTERVAL=1', '2026-10-21')).toBe('FREQ=DAILY');
    expect(didaRecurrence('RRULE:FREQ=DAILY;INTERVAL=3', '2026-10-21')).toBe('FREQ=DAILY;INTERVAL=3;DTSTART=20261021');
    expect(didaRecurrence('RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE', null)).toBe('FREQ=WEEKLY;BYDAY=MO,WE');
    expect(didaRecurrence('RRULE:FREQ=WEEKLY;INTERVAL=1', '2026-10-21')).toBe('FREQ=WEEKLY;BYDAY=WE');
    expect(didaRecurrence('RRULE:FREQ=MONTHLY;INTERVAL=1', '2026-10-21')).toBe('FREQ=MONTHLY;BYMONTHDAY=21');
  });
  it('做不到的返回 null（写进正文）', () => {
    expect(didaRecurrence('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=SA', '2026-10-24')).toBeNull();
    expect(didaRecurrence('RRULE:FREQ=YEARLY;INTERVAL=1', '2026-10-24')).toBeNull();
    expect(didaRecurrence('RRULE:FREQ=DAILY;INTERVAL=1;UNTIL=20261231', '2026-10-24')).toBeNull();
    expect(didaRecurrence('RRULE:FREQ=DAILY;INTERVAL=1;TT_SKIP=HOLIDAY', '2026-10-24')).toBeNull();
    expect(didaRecurrence('ERULE:NAME=CUSTOM;BYDATE=20261024', '2026-10-24')).toBeNull();
    expect(didaRecurrence('RRULE:FREQ=MONTHLY;BYDAY=1MO', '2026-10-24')).toBeNull();
  });
});

describe('正文', () => {
  it('清单子项转成待办列表', () => {
    expect(checklistToMarkdown('说明一行\n▪已完成的一项\n▫没做的一项')).toBe('说明一行\n\n- [x] 已完成的一项\n- [ ] 没做的一项');
  });
  it('标题第一行、内容、标签与优先级、截止、重复说明', () => {
    const { rows } = parseDidaCsv(fixture('dida-backup.csv'));
    expect(didaBody(rows[1]!)).toBe('写周报, 发给老板\n\n第一段\n第二段，带 "引号"\n\n#工作 #周报 #高优先级');
    expect(didaBody(rows[2]!, { due: '2026-10-28' })).toBe('准备材料\n\n说明一行\n\n- [x] 已完成的一项\n- [ ] 没做的一项\n\n#中优先级\n\n截止：2026-10-28');
    expect(didaBody(rows[5]!, { repeatNote: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=SA' })).toContain('重复（滴答清单的规则，这里没法照样重复）：FREQ=WEEKLY;INTERVAL=2;BYDAY=SA');
  });
});

describe('导入', () => {
  it('预览：每个清单几件、各状态、收集箱默认不放进组', async () => {
    const s = await open();
    const { rows, issues } = parseDidaCsv(fixture('dida-backup.csv'));
    const plan = planDida(s, rows, issues);
    expect(plan.counts).toEqual({ total: 9, open: 6, done: 2, closed: 1, notes: 1, subtasks: 1, already: 0 });
    expect(plan.lists.map((l) => [l.name, l.total, l.defaultTarget.kind])).toEqual([
      ['Inbox', 1, 'none'],
      ['项目 A', 3, 'new'],
      ['生活', 5, 'new'],
    ]);
    const pv = previewDida(s, plan, ALL);
    expect(pv).toEqual({ create: 9, already: 0, filtered: 0, newGroups: ['项目 A', '生活'] });
    expect(previewDida(s, plan, { ...ALL, include: { open: true, done: false, closed: false } })).toMatchObject({ create: 6, filtered: 3 });
  });

  it('写入：组、分类、状态、日期、提醒、重复、子任务；再导一次全跳过；撤销', async () => {
    const s = await open();
    const { rows } = parseDidaCsv(fixture('dida-backup.csv'));
    const plan = planDida(s, rows);
    const before = s.list('task').length;
    const receipt = applyDida(s, plan, ALL);
    expect(receipt.created).toBe(9);
    expect(receipt.groups).toBe(2);
    expect(receipt.issues).toEqual([]);
    expect(s.list('task').length).toBe(before + 9);

    const t = (id: string) => s.get('task', didaTaskId({ taskId: id, list: '', title: '', created: null, line: 0 }))!;
    const groupA = s.list('group').find((g) => g.name === '项目 A')!;
    expect(groupA).toBeTruthy();
    expect(s.get('category', groupA.category_id)?.name).toBe('工作');
    expect(s.list('group').find((g) => g.name === '生活')!.category_id).toBeNull();

    expect(t('t-inbox-1')).toMatchObject({ body_md: '买牛奶', group_id: null, scheduled_date: '2026-10-25', status: '待办' });
    expect(t('t-a-1')).toMatchObject({ group_id: groupA.id, scheduled_date: '2026-10-22', remind_time: '09:15', created_at: '2026-10-19T01:00:00.000Z' });
    expect(t('t-a-2')).toMatchObject({ scheduled_date: '2026-10-26', remind_time: '09:00' });
    expect(t('t-a-2').body_md).toContain('截止：2026-10-28');
    expect(t('t-a-3')).toMatchObject({ status: '完成', done_at: '2026-10-02T10:00:00.000Z' });
    expect(t('t-l-1')).toMatchObject({ recurrence: 'FREQ=DAILY', scheduled_date: null });
    expect(t('t-l-2').recurrence).toBeNull();
    expect(t('t-l-2').body_md).toContain('FREQ=WEEKLY;INTERVAL=2;BYDAY=SA');
    expect(t('t-l-3')).toMatchObject({ status: '关闭', done_at: '2026-09-15T00:00:00.000Z' });
    expect(t('t-l-4').body_md).toBe('读书笔记\n\n# 三体\n\n- 黑暗森林');

    // 子任务 → 父任务的「先做完这些」
    expect(s.edges()).toContainEqual({ pred_id: t('t-a-2').id, succ_id: t('t-a-1').id });

    // 再导一次：全跳过
    const again = planDida(s, rows);
    expect(again.counts.already).toBe(9);
    expect(previewDida(s, again, ALL)).toMatchObject({ create: 0, already: 9, newGroups: [] });
    const r2 = applyDida(s, again, ALL);
    expect(r2.created).toBe(0);
    expect(r2.skipped.already).toBe(9);
    expect(s.list('group').filter((g) => g.name === '项目 A')).toHaveLength(1);

    // 撤销第一次：任务、组、分类、前后关系都打墓碑
    const parentId = t('t-a-1').id;
    undoDida(s, receipt);
    expect(s.list('task').length).toBe(before);
    expect(s.list('group').find((g) => g.name === '项目 A')).toBeUndefined();
    expect(s.list('category').find((c) => c.name === '工作' && c.id === groupA.category_id)).toBeUndefined();
    expect(s.edges().some((e) => e.succ_id === parentId)).toBe(false);

    // 撤销后再导：重新建
    expect(applyDida(s, planDida(s, rows), ALL).created).toBe(9);
  });

  it('选项：只导未完成；清单并入已有组 / 不放进组；同名组复用', async () => {
    const s = await open();
    const life = s.insert('group', { name: '生活', icon: '🏠', start_at: null, end_at: null, category_id: null, default_type_id: null });
    const other = s.insert('group', { name: '别的组', icon: '🧩', start_at: null, end_at: null, category_id: null, default_type_id: null });
    const { rows } = parseDidaCsv(fixture('dida-backup.csv'));
    const plan = planDida(s, rows);
    expect(plan.lists.find((l) => l.name === '生活')!.defaultTarget).toEqual({ kind: 'group', id: life.id });
    const r = applyDida(s, plan, { ...ALL, include: { open: true, done: false, closed: false }, targets: { '项目 A': { kind: 'group', id: other.id }, 生活: { kind: 'none' } } });
    expect(r.created).toBe(6);
    expect(r.skipped.filtered).toEqual({ open: 0, done: 2, closed: 1 });
    expect(r.groups).toBe(0);
    const imported = s.list('task').filter((t) => rows.some((x) => didaTaskId(x) === t.id));
    expect(imported.filter((t) => t.group_id === other.id)).toHaveLength(2);
    expect(imported.filter((t) => t.group_id === null)).toHaveLength(4);
  });

  it('父任务没导入时提示，不连', async () => {
    const s = await open();
    const { rows } = parseDidaCsv(fixture('dida-backup.csv'));
    const plan = planDida(s, rows.filter((r) => r.taskId !== 't-a-1'));
    const r = applyDida(s, plan, ALL);
    expect(r.issues).toEqual([{ line: 12, title: '准备材料', message: '父任务没导入，没连上', level: 'warning' }]);
  });
});

describe('直接连账户（Open API）', () => {
  const api = JSON.parse(fixture('dida-api.json')) as {
    project: unknown;
    'project/group': unknown;
    data: Record<string, unknown>;
    completed: Array<{ completedTime: string }>;
    abandoned: unknown[];
  };
  /** 假的 Open API：按路径回 fixture；已完成按时间窗口筛。 */
  const fake = (over: Partial<Record<string, (body: unknown) => unknown>> = {}) => {
    const calls: string[] = [];
    const call: DidaCall = async (method, path, body) => {
      calls.push(`${method} ${path}`);
      const o = over[path];
      if (o) return o(body);
      if (path === 'open/v1/project') return api.project;
      if (path === 'open/v1/project/group') return api['project/group'];
      const m = /^open\/v1\/project\/(.+)\/data$/.exec(path);
      if (m) return api.data[decodeURIComponent(m[1]!)] ?? { tasks: [] };
      if (path === 'open/v1/task/completed') {
        const { startDate, endDate } = body as { startDate: string; endDate: string };
        const ms = (s: string) => Date.parse(s.replace('+0000', 'Z'));
        return api.completed.filter((t) => ms(t.completedTime) >= ms(startDate) && ms(t.completedTime) <= ms(endDate));
      }
      if (path === 'open/v1/task/filter') return api.abandoned;
      throw new DidaApiError('404 未找到', 404);
    };
    return { call, calls };
  };
  const NOW = new Date('2026-10-21T00:00:00Z');

  it('任务 JSON → 和备份文件同样的行：清单子项、标签、状态、时区', () => {
    const t = (api.data['p-work'] as { tasks: DidaApiTask[] }).tasks[1]!;
    const row = apiTaskToRow(t, { list: '项目 A', folder: '工作', line: 1 });
    expect(row).toMatchObject({ taskId: 'a-a-2', parentId: 'a-a-1', kind: 'CHECKLIST', status: 'open', priority: 3, allDay: true, timezone: 'Asia/Shanghai', reminder: 'TRIGGER:P0DT9H0M0S' });
    expect(row.content).toBe('说明一行\n▪已完成的一项\n▫没做的一项');
    expect(didaBody(row)).toBe('准备材料\n\n说明一行\n\n- [x] 已完成的一项\n- [ ] 没做的一项\n\n#中优先级');
    expect(apiTaskToRow({ id: 'x', status: 2 }, { list: 'L', folder: null, line: 1 }).status).toBe('done');
    expect(apiTaskToRow({ id: 'x', status: -1 }, { list: 'L', folder: null, line: 1 }).status).toBe('closed');
  });

  it('拉整个账户：清单、文件夹、收集箱、未完成、已完成、已放弃', async () => {
    const { call, calls } = fake();
    const progress: string[] = [];
    const { rows, issues } = await fetchDidaAccount(call, { completedDays: null, now: NOW, onProgress: (p) => progress.push(p.step) });
    expect(issues).toEqual([]);
    expect(rows.map((r) => [r.taskId, r.list, r.status])).toEqual([
      ['a-inbox-1', 'Inbox', 'open'],
      ['a-a-1', '项目 A', 'open'],
      ['a-a-2', '项目 A', 'open'],
      ['a-l-1', '生活', 'open'],
      ['a-a-3', '项目 A', 'done'],
      ['a-inbox-2', 'Inbox', 'done'],
      ['a-l-3', '生活', 'closed'],
    ]);
    expect(rows.find((r) => r.taskId === 'a-a-1')!.folder).toBe('工作');
    expect(calls).toContain('GET open/v1/project/inbox/data');
    expect(new Set(progress)).toEqual(new Set(['projects', 'open', 'completed', 'abandoned']));
  });

  it('和备份文件走同一套导入：组、日期、提醒、子任务、再导跳过', async () => {
    const s = await open();
    const { rows } = await fetchDidaAccount(fake().call, { completedDays: null, now: NOW });
    const r = applyDida(s, planDida(s, rows), ALL);
    expect(r.created).toBe(7);
    const t = (id: string) => s.get('task', didaTaskId({ taskId: id, list: '', title: '', created: null, line: 0 }))!;
    expect(t('a-a-1')).toMatchObject({ scheduled_date: '2026-10-22', remind_time: '09:15' });
    expect(t('a-l-1').recurrence).toBe('FREQ=DAILY');
    expect(t('a-l-3').status).toBe('关闭');
    expect(s.edges()).toContainEqual({ pred_id: t('a-a-2').id, succ_id: t('a-a-1').id });
    expect(s.get('category', s.list('group').find((g) => g.name === '项目 A')!.category_id)?.name).toBe('工作');
    expect(applyDida(s, planDida(s, rows), ALL).skipped.already).toBe(7);
  });

  it('已完成每次最多 200 条：拿满就对半切开再拉，不重复', async () => {
    const many = Array.from({ length: 450 }, (_, i) => ({ id: `c${i}`, projectId: 'p-life', title: `t${i}`, status: 2, completedTime: new Date(Date.UTC(2026, 0, 1) + i * 3_600_000).toISOString().replace('Z', '+0000') }));
    let requests = 0;
    const { call } = fake({
      'open/v1/task/completed': (body) => {
        requests++;
        const { startDate, endDate } = body as { startDate: string; endDate: string };
        const ms = (x: string) => Date.parse(x.replace('+0000', 'Z'));
        return many.filter((t) => ms(t.completedTime) >= ms(startDate) && ms(t.completedTime) <= ms(endDate)).slice(0, 200);
      },
      'open/v1/task/filter': () => [],
    });
    const { rows, issues } = await fetchDidaAccount(call, { completedDays: 365, now: NOW });
    expect(issues).toEqual([]);
    expect(rows.filter((r) => r.status === 'done')).toHaveLength(450);
    expect(requests).toBeGreaterThan(3);
  });

  it('只拉最近 N 天 / 不拉已完成', async () => {
    const a = await fetchDidaAccount(fake().call, { completedDays: 30, now: NOW });
    expect(a.rows.filter((r) => r.status === 'done').map((r) => r.taskId)).toEqual(['a-a-3']);
    const { call, calls } = fake();
    const b = await fetchDidaAccount(call, { completedDays: 0, abandoned: false, now: NOW });
    expect(b.rows.every((r) => r.status === 'open')).toBe(true);
    expect(calls.some((c) => c.includes('completed') || c.includes('filter'))).toBe(false);
  });

  it('令牌不对（401）直接停；别的清单出错只提示；已放弃拿不到也只提示', async () => {
    const bad = fake({ 'open/v1/project': () => { throw new DidaApiError('401 未授权', 401); } });
    await expect(fetchDidaAccount(bad.call, { completedDays: 0 })).rejects.toMatchObject({ status: 401 });
    const partial = fake({
      'open/v1/project/p-life/data': () => { throw new DidaApiError('500 服务器出错', 500); },
      'open/v1/task/filter': () => { throw new DidaApiError('400 请求有误', 400); },
    });
    const r = await fetchDidaAccount(partial.call, { completedDays: 0, now: NOW });
    expect(r.issues.map((i) => i.message)).toEqual(['清单「生活」没拉下来：500 服务器出错', '已放弃的任务没拉下来：400 请求有误']);
    expect(r.rows.some((x) => x.list === '生活')).toBe(false);
  });

  it('可以取消', async () => {
    const ctl = new AbortController();
    const { call } = fake();
    const p = fetchDidaAccount(async (m, path, body) => {
      if (path.endsWith('/data')) ctl.abort();
      return call(m, path, body);
    }, { completedDays: null, signal: ctl.signal });
    await expect(p).rejects.toBeInstanceOf(DidaAbort);
  });
});
