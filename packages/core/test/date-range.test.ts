/** 日期段（Rei 2026-10-26「现在的日期只是单个日期，要支持日期段」）。 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  agendaBuckets,
  formatDateRange,
  formatTaskDateRange,
  isDateRange,
  normalizeRange,
  pickRangeDay,
  rangeCellRole,
  rangeDayIndex,
  rangeLength,
  shiftRangeTo,
  taskEndDate,
} from '../src/date-range';
import { setLocale } from '../src/i18n';
import { isTaskOverdue } from '../src/timezone';
import { suggestions } from '../src/myday';
import { chainStepWhen, chainWhenLabel, taskPlannedDate } from '../src/dag';
import { upcomingReminders } from '../src/reminders';
import { Store } from '../src/store';
import { MemoryAdapter } from '../src/storage/memory';
import { SqlAdapter, migrate } from '../src/storage/sql';
import { MIGRATIONS, SCHEMA_VERSION } from '../src/storage/schema';
import { exportArchive, planImport, applyImport, splitFrontMatter, parseFrontMatter, fromUtf8 } from '../src/archive';
import { local, mkTask } from './helpers';
import { NodeSqliteDriver } from './sql-drivers';

afterEach(() => setLocale('zh'));

async function open(now = local(2026, 10, 26, 10)) {
  let t = now.getTime();
  return Store.open(new MemoryAdapter(), { deviceId: 'dev1', now: () => new Date((t += 1000)) });
}

describe('数据：end_date', () => {
  it('迁移 v10：老库（v9）加上 end_date 列，老任务为空 = 单日', async () => {
    const d = new NodeSqliteDriver();
    await migrate(d, MIGRATIONS.filter((m) => m.version <= 9));
    await d.run(`INSERT INTO "task" ("id","updated_at","deleted","body_md","scheduled_date","created_at") VALUES ('t1','1',0,'老任务','2026-10-26','2026-10-01T00:00:00Z')`);
    expect(await migrate(d)).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(10);
    const snap = await new SqlAdapter(d).loadAll();
    expect(snap.task[0]!.end_date).toBeNull();
    expect(snap.task[0]!.scheduled_date).toBe('2026-10-26');
  });

  it('SQLite 读写 end_date', async () => {
    const ad = new SqlAdapter(new NodeSqliteDriver());
    await ad.applyChanges([{ table: 'task', row: { ...mkTask('t1', { scheduled_date: '2026-10-26', end_date: '2026-10-30' }), updated_at: '1' } }]);
    expect((await ad.loadAll()).task[0]!.end_date).toBe('2026-10-30');
  });

  it('老行（没有 end_date 字段）打开后补 null；拉下来的老行也补', async () => {
    const adapter = new MemoryAdapter();
    const old = mkTask('00000000-0000-7000-8000-000000000001', { scheduled_date: '2026-10-26' }) as unknown as Record<string, unknown>;
    delete old.end_date;
    await adapter.applyRemoteChanges([{ table: 'task', row: old as never }]);
    const store = await Store.open(adapter, { deviceId: 'dev1', now: () => local(2026, 10, 26, 10) });
    expect(store.get('task', old.id as string)!.end_date).toBeNull();
  });

  it('结束日只会晚于开始日：等于、早于、没开始都存 null', async () => {
    expect(normalizeRange('2026-10-26', '2026-10-30')).toEqual({ start: '2026-10-26', end: '2026-10-30' });
    expect(normalizeRange('2026-10-26', '2026-10-26')).toEqual({ start: '2026-10-26', end: null });
    expect(normalizeRange('2026-10-26', '2026-10-20')).toEqual({ start: '2026-10-26', end: null });
    expect(normalizeRange(null, '2026-10-20')).toEqual({ start: null, end: null });

    const s = await open();
    const t = s.createTask({ body_md: 'a', scheduled_date: '2026-10-26', end_date: '2026-10-30' });
    expect(t.end_date).toBe('2026-10-30');
    // 开始挪到结束之后：结束去掉
    expect(s.updateTask(t.id, { scheduled_date: '2026-11-02' }).end_date).toBeNull();
    s.updateTask(t.id, { end_date: '2026-11-05' });
    expect(s.get('task', t.id)!.end_date).toBe('2026-11-05');
    // 清掉日期：结束一起清
    expect(s.updateTask(t.id, { scheduled_date: null })).toMatchObject({ scheduled_date: null, end_date: null });
    // 没开始日时单设结束日：不存
    expect(s.updateTask(t.id, { end_date: '2026-11-05' }).end_date).toBeNull();
    expect(s.createTask({ end_date: '2026-11-05' }).end_date).toBeNull();
  });

  it('isDateRange / taskEndDate / 天数', () => {
    expect(isDateRange({ scheduled_date: '2026-10-26', end_date: '2026-10-30' })).toBe(true);
    expect(isDateRange({ scheduled_date: '2026-10-26', end_date: null })).toBe(false);
    expect(taskEndDate({ scheduled_date: '2026-10-26', end_date: '2026-10-30' })).toBe('2026-10-30');
    expect(taskEndDate({ scheduled_date: '2026-10-26', end_date: null })).toBe('2026-10-26');
    expect(taskEndDate({ scheduled_date: null, end_date: null })).toBeNull();
    expect(rangeLength('2026-10-26', '2026-10-30')).toBe(5);
    expect(rangeLength('2026-10-26', null)).toBe(1);
    expect(rangeDayIndex('2026-10-26', '2026-10-30', '2026-10-28')).toEqual({ index: 3, total: 5 });
    expect(rangeDayIndex('2026-10-26', '2026-10-30', '2026-10-31')).toBeNull();
  });

  it('导出带 end_date，导入读回来；end_date 不晚于 scheduled 时当单日', async () => {
    const src = await open();
    const t = src.createTask({ body_md: '出差', scheduled_date: '2026-10-26', end_date: '2026-10-30' });
    src.createTask({ body_md: '单日', scheduled_date: '2026-10-27' });
    const { files } = exportArchive(src);
    const file = files.find((f) => fromUtf8(f.data).includes('出差'))!;
    const fm = parseFrontMatter(splitFrontMatter(fromUtf8(file.data)).front!);
    expect(fm.ok && fm.data.end_date).toBe('2026-10-30');
    const single = files.find((f) => fromUtf8(f.data).includes('单日'))!;
    expect(fromUtf8(single.data)).not.toContain('end_date');

    const dst = await open();
    applyImport(dst, planImport(dst, files));
    expect(dst.get('task', t.id)).toMatchObject({ scheduled_date: '2026-10-26', end_date: '2026-10-30' });

    const bad = [{ path: 'x.md', data: new TextEncoder().encode('---\nscheduled: 2026-10-26\nend_date: 2026-10-01\n---\n乱写的\n') }];
    const dst2 = await open();
    applyImport(dst2, planImport(dst2, bad));
    expect(dst2.tasks().find((x) => x.body_md.includes('乱写的'))).toMatchObject({ scheduled_date: '2026-10-26', end_date: null });
  });
});

describe('显示：formatDateRange', () => {
  it('中文：同月 / 跨月 / 跨年 / 不在今年', () => {
    expect(formatDateRange('2026-10-26', '2026-10-30', '2026-10-26')).toBe('10月26日 – 30日');
    expect(formatDateRange('2026-10-30', '2026-11-02', '2026-10-26')).toBe('10月30日 – 11月2日');
    expect(formatDateRange('2026-12-30', '2027-01-02', '2026-10-26')).toBe('2026年12月30日 – 2027年1月2日');
    expect(formatDateRange('2027-03-01', '2027-03-05', '2026-10-26')).toBe('2027年3月1日 – 5日');
    // 没有结束日：单个日期，不带星期
    expect(formatDateRange('2026-10-26', null, '2026-10-26')).toBe('10月26日');
  });

  it('英文：Intl formatRange', () => {
    setLocale('en');
    const norm = (s: string) => s.replace(/[\u2009\u202f]/g, ' ');
    expect(norm(formatDateRange('2026-10-26', '2026-10-30', '2026-10-26'))).toBe('Oct 26 – 30');
    expect(norm(formatDateRange('2026-10-30', '2026-11-02', '2026-10-26'))).toBe('Oct 30 – Nov 2');
    expect(norm(formatDateRange('2026-12-30', '2027-01-02', '2026-10-26'))).toBe('Dec 30, 2026 – Jan 2, 2027');
  });
});

describe('四种日期显示（formatTaskDateRange）', () => {
  const today = '2026-10-26';
  it('中文', () => {
    expect(formatTaskDateRange('2026-10-26', '2026-10-30', { mode: 'auto', today })).toBe('10月26日 – 30日');
    expect(formatTaskDateRange('2026-10-26', '2026-10-30', { mode: 'relative', today })).toBe('今天 – 4 天后');
    expect(formatTaskDateRange('2026-10-26', '2026-10-30', { mode: 'ymd', today })).toBe('2026年10月26日 – 30日');
    expect(formatTaskDateRange('2026-10-30', '2026-11-02', { mode: 'ymd', today })).toBe('2026年10月30日 – 11月2日');
    expect(formatTaskDateRange('2026-10-26', '2026-10-30', { mode: 'ymd-tz', today, timeZone: 'Asia/Shanghai' })).toBe('2026年10月26日 – 30日 GMT+8');
    // 远了两头一样：只写一次，带天数
    expect(formatTaskDateRange('2026-12-30', '2027-01-02', { mode: 'relative', today })).toBe('2 个月后，共 4 天');
    // 没有结束日：和 formatTaskDate 一样
    expect(formatTaskDateRange('2026-10-27', null, { mode: 'auto', today })).toBe('明天');
  });
  it('英文', () => {
    setLocale('en');
    const norm = (s: string) => s.replace(/[\u2009\u202f]/g, ' ');
    expect(norm(formatTaskDateRange('2026-10-26', '2026-10-30', { mode: 'ymd', today }))).toBe('Oct 26 – 30, 2026');
    expect(norm(formatTaskDateRange('2026-10-26', '2026-10-30', { mode: 'relative', today }))).toBe('today – in 4 days');
    expect(norm(formatTaskDateRange('2026-12-30', '2027-01-02', { mode: 'ymd-tz', today, timeZone: 'America/New_York' }))).toBe('Dec 30, 2026 – Jan 2, 2027 GMT-5');
  });
});

describe('选择器：pickRangeDay', () => {
  it('点起点再点终点', () => {
    let s = pickRangeDay({ start: null, end: null, editing: 'start' }, '2026-10-26');
    expect(s).toEqual({ start: '2026-10-26', end: null, editing: 'end', done: false });
    s = pickRangeDay(s, '2026-10-30');
    expect(s).toEqual({ start: '2026-10-26', end: '2026-10-30', editing: 'start', done: true });
  });

  it('等结束时点在开始之前：开始挪过去，继续等结束；点开始当天 = 单日', () => {
    let s = pickRangeDay({ start: '2026-10-26', end: null, editing: 'end' }, '2026-10-20');
    expect(s).toEqual({ start: '2026-10-20', end: null, editing: 'end', done: false });
    s = pickRangeDay(s, '2026-10-20');
    expect(s).toEqual({ start: '2026-10-20', end: null, editing: 'start', done: true });
  });

  it('只改一头：改开始不动还在后面的结束；新开始越过结束就去掉结束', () => {
    expect(pickRangeDay({ start: '2026-10-26', end: '2026-10-30', editing: 'start' }, '2026-10-27')).toMatchObject({ start: '2026-10-27', end: '2026-10-30' });
    expect(pickRangeDay({ start: '2026-10-26', end: '2026-10-30', editing: 'start' }, '2026-11-01')).toMatchObject({ start: '2026-11-01', end: null });
    expect(pickRangeDay({ start: '2026-10-26', end: '2026-10-30', editing: 'end' }, '2026-11-03')).toMatchObject({ start: '2026-10-26', end: '2026-11-03', done: true });
  });

  it('快捷项保持天数；格子角色', () => {
    expect(shiftRangeTo({ start: '2026-10-26', end: '2026-10-30' }, '2026-11-01')).toEqual({ start: '2026-11-01', end: '2026-11-05' });
    expect(shiftRangeTo({ start: '2026-10-26', end: null }, '2026-11-01')).toEqual({ start: '2026-11-01', end: null });
    const r = { start: '2026-10-26', end: '2026-10-30' };
    expect(rangeCellRole(r, '2026-10-26')).toBe('start');
    expect(rangeCellRole(r, '2026-10-28')).toBe('middle');
    expect(rangeCellRole(r, '2026-10-30')).toBe('end');
    expect(rangeCellRole(r, '2026-10-31')).toBeNull();
    expect(rangeCellRole({ start: '2026-10-26', end: null }, '2026-10-26')).toBe('single');
  });
});

describe('列表（Agenda）', () => {
  const today = '2026-10-28';
  it('放在开始那天；跨过今天的今天也放一份，标第几天', () => {
    const a = mkTask('a', { scheduled_date: '2026-10-26', end_date: '2026-10-30' });
    const b = mkTask('b', { scheduled_date: '2026-10-28' });
    const c = mkTask('c', { scheduled_date: '2026-10-28', end_date: '2026-10-29' });
    const { byDate, hiddenPast } = agendaBuckets([a, b, c], '2026-10-14', today);
    expect(byDate.get('2026-10-26')!.map((x) => [x.task.id, x.span])).toEqual([['a', { index: 1, total: 5 }]]);
    // 今天：a 第 3/5 天；c 今天开始（只放一次）
    expect(byDate.get(today)!.map((x) => [x.task.id, x.span ?? null])).toEqual([
      ['a', { index: 3, total: 5 }],
      ['b', null],
      ['c', { index: 1, total: 2 }],
    ]);
    expect(hiddenPast).toBe(0);
  });

  it('开始在「更早」之前、还没结束的照样出现在今天，不算进「更早的 N 条」', () => {
    const a = mkTask('a', { scheduled_date: '2026-09-01', end_date: '2026-11-30' });
    const old = mkTask('old', { scheduled_date: '2026-09-02' });
    const { byDate, hiddenPast } = agendaBuckets([a, old], '2026-10-14', today);
    expect(byDate.has('2026-09-01')).toBe(false);
    expect(byDate.get(today)!.map((x) => x.task.id)).toEqual(['a']);
    expect(hiddenPast).toBe(1);
  });

  it('已经结束的日期段只在开始那天', () => {
    const a = mkTask('a', { scheduled_date: '2026-10-20', end_date: '2026-10-25' });
    const { byDate } = agendaBuckets([a], '2026-10-14', today);
    expect(byDate.get('2026-10-20')).toHaveLength(1);
    expect(byDate.get(today)).toBeUndefined();
  });
});

describe('到期按结束日', () => {
  const now = local(2026, 10, 28, 10);
  it('过期：段里不算过期，过了结束日才算', () => {
    expect(isTaskOverdue(mkTask('a', { scheduled_date: '2026-10-26', end_date: '2026-10-30' }), now, '2026-10-28')).toBe(false);
    expect(isTaskOverdue(mkTask('a', { scheduled_date: '2026-10-20', end_date: '2026-10-27' }), now, '2026-10-28')).toBe(true);
    expect(isTaskOverdue(mkTask('a', { scheduled_date: '2026-10-27' }), now, '2026-10-28')).toBe(true);
  });

  it('我的一天建议：段里是「这几天要做」，到了结束日是「今天到期」，未开始不建议，不自动加入', () => {
    const tasks = [
      mkTask('in', { scheduled_date: '2026-10-26', end_date: '2026-10-30' }),
      mkTask('last', { scheduled_date: '2026-10-26', end_date: '2026-10-28' }),
      mkTask('later', { scheduled_date: '2026-10-29', end_date: '2026-10-31' }),
    ];
    const out = suggestions({ tasks, entries: [], checkIns: [], derived: new Map(), recentlyUnlocked: [], today: '2026-10-28', now });
    expect(out.map((s) => [s.task.id, s.reason])).toEqual([
      ['in', '这几天要做'],
      ['last', '今天到期'],
    ]);
  });

  it('任务链：日期段按结束日算「明天 / 已过」', () => {
    const t = { ...mkTask('a', { scheduled_date: '2026-10-20', end_date: '2026-10-29' }) };
    expect(taskPlannedDate(t)).toBe('2026-10-29');
    expect(chainWhenLabel(chainStepWhen([t], '2026-10-28'), '2026-10-28').text).toBe('明天');
    const past = mkTask('b', { scheduled_date: '2026-10-20', end_date: '2026-10-26' });
    expect(chainWhenLabel(chainStepWhen([past], '2026-10-28'), '2026-10-28')).toEqual({ text: '已过 2 天', tone: 'overdue' });
  });

  it('提醒照旧按开始日', () => {
    const t = mkTask('a', { scheduled_date: '2026-10-26', end_date: '2026-10-30', remind_time: '09:00' });
    const r = upcomingReminders([t], [], { now: local(2026, 10, 25, 20), timeZone: 'Asia/Shanghai' });
    expect(r.map((x) => [x.kind, x.date])).toEqual([['due', '2026-10-26']]);
    // 段里的其他日子不再提醒
    expect(upcomingReminders([t], [], { now: local(2026, 10, 27, 8), timeZone: 'Asia/Shanghai' })).toEqual([]);
  });
});
