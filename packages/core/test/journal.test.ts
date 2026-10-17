import { describe, expect, it } from 'vitest';
import { Store } from '../src/store';
import { MemoryAdapter } from '../src/storage/memory';
import { SyncEngine } from '../src/sync/engine';
import { MemoryRemote } from '../src/sync/memory-remote';
import { search } from '../src/search';
import { journalReminders, reminderBody } from '../src/reminders';
import { applyImport, exportArchive, fromUtf8, planImport, summarizeImport } from '../src/archive';
import { setLocale } from '../src/i18n';
import {
  FutureJournalError,
  JOURNAL_PREFS,
  MOOD_IDS,
  addMonths,
  canWriteJournal,
  hasJournalContent,
  isDateKey,
  isMoodId,
  journalEntryId,
  journalOfMonth,
  journalPreview,
  journalToday,
  journalWordCount,
  mergeJournalConflict,
  monthGrid,
  moodLabel,
  moods,
  normalizeDayStart,
  splitConflictBlocks,
} from '../src/journal';
import { local } from './helpers';

const ACCOUNT = 'rei@example.com';

async function device(remote: MemoryRemote, deviceId: string, t0 = local(2026, 10, 17, 20).getTime()) {
  let t = t0;
  const store = await Store.open(new MemoryAdapter(), { deviceId, now: () => new Date(t) });
  const engine = new SyncEngine(store, remote.transport(), { account: ACCOUNT, now: () => new Date(t), timers: { set: () => 0, clear: () => {} } });
  return { store, engine, advance: (ms: number) => (t += ms), sync: () => engine.syncNow() };
}

describe('日记：日期与 id', () => {
  it('isDateKey 只认真的日期', () => {
    expect(isDateKey('2026-10-17')).toBe(true);
    expect(isDateKey('2024-02-29')).toBe(true);
    expect(isDateKey('2026-02-29')).toBe(false);
    expect(isDateKey('2026-13-01')).toBe(false);
    expect(isDateKey('2026-1-1')).toBe(false);
    expect(isDateKey('today')).toBe(false);
    expect(isDateKey(null)).toBe(false);
  });

  it('id 由日期算：各处一样、像 UUID、不同日子不同', () => {
    const a = journalEntryId('2026-10-17');
    expect(a).toBe(journalEntryId('2026-10-17'));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7000-8002-0{12}$/);
    expect(journalEntryId('2026-10-18')).not.toBe(a);
    // 日期先后 = id 先后
    expect(journalEntryId('2026-10-16') < a).toBe(true);
  });

  it('「一天从几点开始」：默认 5 点，凌晨 3 点还算昨天', () => {
    expect(journalToday(local(2026, 10, 17, 3))).toBe('2026-10-16');
    expect(journalToday(local(2026, 10, 17, 5))).toBe('2026-10-17');
    expect(journalToday(local(2026, 10, 17, 4, 59))).toBe('2026-10-16');
    expect(journalToday(local(2026, 10, 17, 3), 0)).toBe('2026-10-17');
    expect(journalToday(local(2026, 10, 17, 9), 10)).toBe('2026-10-16');
    // 跨月、跨年
    expect(journalToday(local(2027, 1, 1, 2))).toBe('2026-12-31');
  });

  it('normalizeDayStart：0–23 整点，别的用默认 5', () => {
    expect(normalizeDayStart(0)).toBe(0);
    expect(normalizeDayStart(23)).toBe(23);
    expect(normalizeDayStart('6')).toBe(6);
    expect(normalizeDayStart(24)).toBe(5);
    expect(normalizeDayStart(4.5)).toBe(5);
    expect(normalizeDayStart(undefined)).toBe(5);
  });

  it('将来的日子不能写', () => {
    expect(canWriteJournal('2026-10-17', '2026-10-17')).toBe(true);
    expect(canWriteJournal('2020-01-01', '2026-10-17')).toBe(true);
    expect(canWriteJournal('2026-10-18', '2026-10-17')).toBe(false);
    expect(canWriteJournal('2026-02-30', '2026-10-17')).toBe(false);
  });

  it('月历周一开始、补成整周；月份加减', () => {
    const g = monthGrid('2026-10'); // 10 月 1 日是周四
    expect(g.length % 7).toBe(0);
    expect(g.slice(0, 3)).toEqual([null, null, null]);
    expect(g[3]).toBe('2026-10-01');
    expect(g.filter(Boolean)).toHaveLength(31);
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-10', -14)).toBe('2025-08');
  });
});

describe('日记：心情', () => {
  it('12 个，id 稳定、各不相同，中英文都有名字', () => {
    expect(MOOD_IDS).toHaveLength(12);
    expect(new Set(MOOD_IDS).size).toBe(12);
    const zh = moods().map((m) => m.label);
    expect(new Set(zh).size).toBe(12);
    setLocale('en');
    try {
      const en = moods().map((m) => m.label);
      expect(en).toEqual(['Happy', 'Excited', 'Grateful', 'Content', 'Calm', 'Okay', 'Bored', 'Tired', 'Anxious', 'Sad', 'Irritated', 'Angry']);
    } finally {
      setLocale('zh');
    }
    expect(moodLabel('happy')).toBe('开心');
    expect(moodLabel('nope')).toBe('');
    expect(isMoodId('angry')).toBe(true);
    expect(isMoodId(3)).toBe(false);
    // 正面、平、负面都有
    expect(new Set(moods().map((m) => m.tone))).toEqual(new Set(['positive', 'neutral', 'negative']));
  });
});

describe('日记：字数与预览', () => {
  it('中文按字、英文按词，不算 markdown 记号', () => {
    expect(journalWordCount('今天天气很好')).toBe(6);
    expect(journalWordCount('Went for a walk.')).toBe(4);
    expect(journalWordCount('# 标题\n\n- [x] 散步 walk')).toBe(5);
    expect(journalWordCount('[链接](https://example.com)')).toBe(2);
    expect(journalWordCount('')).toBe(0);
  });
  it('预览取第一行文字', () => {
    expect(journalPreview('\n\n# 今天\n\n写完了')).toBe('今天');
    expect(journalPreview('a'.repeat(100), 10)).toBe(`${'a'.repeat(10)}…`);
    expect(hasJournalContent({ body_md: '  ', mood: null })).toBe(false);
    expect(hasJournalContent({ body_md: '', mood: 'calm' })).toBe(true);
  });
});

describe('日记：同步保护（合并两版）', () => {
  it('输家里赢家没有的收进折叠块；已经有的不重复', () => {
    const m = mergeJournalConflict('B 写的', 'A 写的', '另一台设备上同时写的 · 10-17 20:00')!;
    expect(m).toContain('B 写的');
    expect(m).toContain('<details data-journal="conflict">');
    expect(m).toContain('A 写的');
    expect(splitConflictBlocks(m)).toEqual({ core: 'B 写的', kept: ['A 写的'] });
    // 输家的内容赢家里已经有（比如赢家是在它上面接着写的）：不用改
    expect(mergeJournalConflict('A 写的\n\n后来又写了', 'A 写的', 's')).toBeNull();
    // 再合一次（另一台设备也合了）：收敛，不会越收越多
    expect(mergeJournalConflict(m, m.replace('20:00', '21:00'), 's')).toBeNull();
    // 输家自己收着的块也带过来，但不重复
    const m2 = mergeJournalConflict('C', m, 's')!;
    expect(splitConflictBlocks(m2).kept.sort()).toEqual(['A 写的', 'B 写的']);
  });
  it('列表符号、空行变了也认得是同一段', () => {
    expect(mergeJournalConflict('- 一\n- 二\n\n还有', '* 一\n* 二', 's')).toBeNull();
  });
});

describe('Store：日记', () => {
  it('写、改心情、清空、删掉再写回同一行', async () => {
    const s = await Store.open(new MemoryAdapter(), { deviceId: 'dev1', now: () => local(2026, 10, 17, 20) });
    expect(s.setJournal('2026-10-17', { body_md: '  ' })).toBeUndefined();
    expect(s.list('journal_entry')).toHaveLength(0);
    const e = s.setJournal('2026-10-17', { body_md: '今天写了日记' })!;
    expect(e.id).toBe(journalEntryId('2026-10-17'));
    expect(e.mood).toBeNull();
    s.setJournal('2026-10-17', { mood: 'happy' });
    expect(s.journalOf('2026-10-17')).toMatchObject({ body_md: '今天写了日记', mood: 'happy' });
    const v = s.version;
    s.setJournal('2026-10-17', { mood: 'happy' });
    expect(s.version).toBe(v); // 没变不写
    s.deleteJournal('2026-10-17');
    expect(s.journalOf('2026-10-17')).toBeUndefined();
    s.setJournal('2026-10-17', { body_md: '又写了' });
    expect(s.list('journal_entry')).toHaveLength(1);
    expect(s.journalOf('2026-10-17')!.body_md).toBe('又写了');
    expect(s.journalOf('2026-10-17')!.mood).toBeNull();
  });

  it('将来的日子写不了；凌晨按「一天从几点开始」还能写昨天', async () => {
    let t = local(2026, 10, 18, 3);
    const s = await Store.open(new MemoryAdapter(), { deviceId: 'dev1', now: () => t });
    expect(s.journalToday()).toBe('2026-10-17');
    // 凌晨 3 点，日历上的「今天」10-18 还没开始
    expect(() => s.setJournal('2026-10-18', { body_md: 'x' })).toThrow(FutureJournalError);
    s.setPref(JOURNAL_PREFS.dayStart, 0);
    expect(s.journalToday()).toBe('2026-10-18');
    expect(s.setJournal('2026-10-18', { body_md: 'x' })).toBeTruthy();
    expect(() => s.setJournal('2026-10-19', { body_md: 'x' })).toThrow(FutureJournalError);
    expect(() => s.setJournal('2026-02-30', { body_md: 'x' })).toThrow();
    t = local(2026, 10, 19, 12);
    expect(s.setJournal('2026-10-19', { body_md: 'y' })).toBeTruthy();
    expect(journalOfMonth(s.list('journal_entry'), '2026-10').map((e) => e.date)).toEqual(['2026-10-19', '2026-10-18']);
  });

  it('重开后读回（SQLite 列齐全由 storage 测试保证）', async () => {
    const adapter = new MemoryAdapter();
    const s = await Store.open(adapter, { deviceId: 'dev1', now: () => local(2026, 10, 17, 20) });
    s.setJournal('2026-10-17', { body_md: '记下来', mood: 'calm' });
    await s.flush();
    const s2 = await Store.open(adapter, { deviceId: 'dev1', now: () => local(2026, 10, 17, 21) });
    expect(s2.journalOf('2026-10-17')).toMatchObject({ body_md: '记下来', mood: 'calm', base_at: null });
  });
});

describe('同步：日记两台设备', () => {
  it('A 写、B 同步后看到，B 接着写，A 看到 B 的（不触发保护）', async () => {
    const remote = new MemoryRemote();
    const A = await device(remote, 'devA');
    const B = await device(remote, 'devB');
    A.store.setJournal('2026-10-17', { body_md: 'A 写的' });
    await A.sync();
    await B.sync();
    expect(B.store.journalOf('2026-10-17')!.body_md).toBe('A 写的');
    B.advance(60_000);
    B.store.setJournal('2026-10-17', { body_md: 'A 写的\n\nB 接着写' });
    expect(B.store.journalOf('2026-10-17')!.base_at).toBe(A.store.journalOf('2026-10-17')!.updated_at);
    await B.sync();
    await A.sync();
    expect(A.store.journalOf('2026-10-17')!.body_md).toBe('A 写的\n\nB 接着写');
    expect(A.store.journalOf('2026-10-17')!.body_md).not.toContain('<details');
  });

  it('两台离线各写同一天：不丢字，输掉的那版收进折叠块，两边收敛', async () => {
    const remote = new MemoryRemote();
    const A = await device(remote, 'devA');
    const B = await device(remote, 'devB');
    // 先都同步一次（都已初始化）
    await A.sync();
    await B.sync();
    A.store.setJournal('2026-10-17', { body_md: 'A：晚上散步', mood: 'calm' });
    B.advance(5_000);
    B.store.setJournal('2026-10-17', { body_md: 'B：看了电影', mood: 'happy' });
    await A.sync(); // A 先推
    await B.sync(); // B 推（B 的更新，云端 B 赢）、拉到 A 的（比 B 旧，跳过）
    await A.sync(); // A 拉到 B 的：没看到 A 那版 → 合并，推上去
    await B.sync();
    await A.sync(); // 合好的那版是在拉的时候写的，下一轮才推（真机上写入后自动排一次推送）
    await B.sync(); // B 拉到合好的
    const a = A.store.journalOf('2026-10-17')!;
    const b = B.store.journalOf('2026-10-17')!;
    expect(a.body_md).toBe(b.body_md);
    expect(a.body_md.startsWith('B：看了电影')).toBe(true);
    expect(splitConflictBlocks(a.body_md).kept).toEqual(['A：晚上散步']);
    expect(a.body_md).toContain('另一台设备上同时写的');
    // 心情照常后写赢
    expect(a.mood).toBe('happy');
    expect(A.store.list('journal_entry')).toHaveLength(1);
  });

  it('后写的那边赢时，输家那台合并（对称）', async () => {
    const remote = new MemoryRemote();
    const A = await device(remote, 'devA');
    const B = await device(remote, 'devB');
    await A.sync();
    await B.sync();
    B.store.setJournal('2026-10-17', { body_md: 'B 先写' });
    A.advance(5_000);
    A.store.setJournal('2026-10-17', { body_md: 'A 后写' });
    await B.sync();
    await A.sync(); // A 的更新，云端 A 赢；A 拉到 B 的（旧，跳过）
    await B.sync(); // B 拉到 A 的：没看到 B 那版 → 合并
    await A.sync();
    await B.sync(); // 推合好的
    await A.sync();
    const a = A.store.journalOf('2026-10-17')!;
    expect(a.body_md).toBe(B.store.journalOf('2026-10-17')!.body_md);
    expect(splitConflictBlocks(a.body_md)).toEqual({ core: 'A 后写', kept: ['B 先写'] });
  });
});

describe('搜索与提醒', () => {
  it('⌘K 搜得到日记（正文、心情），排在同样命中的任务后面', async () => {
    const s = await Store.open(new MemoryAdapter(), { deviceId: 'dev1', now: () => local(2026, 10, 17, 20) });
    s.setJournal('2026-10-17', { body_md: '今天去海边散步', mood: 'calm' });
    const t = s.createTask({ body_md: '海边' });
    const input = { tasks: s.list('task'), types: [], people: [], groups: [], taskPeople: [], journal: s.list('journal_entry') };
    const hits = search(input, '海边');
    expect(hits.map((h) => h.kind)).toEqual(['task', 'journal']);
    expect(hits[0]!.id).toBe(t.id);
    const j = hits[1]!;
    expect(j.kind === 'journal' && j.entry.date).toBe('2026-10-17');
    expect(j.title).toBe('2026年10月17日 周六');
    expect(j.snippet).toContain('海边');
    expect(search(input, '平静').map((h) => h.kind)).toEqual(['journal']);
  });

  it('日记提醒：每天那个时间都响（写没写都响），已响过的不再算，可稍后再提醒', () => {
    const now = local(2026, 10, 17, 20);
    const list = journalReminders('21:00', { now });
    expect(list.map((r) => [r.kind, r.date, r.taskId])).toEqual([
      ['journal', '2026-10-17', ''],
      ['journal', '2026-10-18', ''],
    ]);
    expect(list[0]!.at).toBe(local(2026, 10, 17, 21).getTime());
    const fired = new Set([list[0]!.id]);
    expect(journalReminders('21:00', { now, fired }).map((r) => r.date)).toEqual(['2026-10-18']);
    const snoozed = new Map([[list[0]!.id, local(2026, 10, 17, 21, 10).getTime()]]);
    expect(journalReminders('21:00', { now, fired, snoozed })[0]).toMatchObject({ snoozed: true, date: '2026-10-17' });
    expect(journalReminders(null, { now })).toEqual([]);
    expect(journalReminders('25:00', { now })).toEqual([]);
    expect(reminderBody({ kind: 'journal' }, { target_value: null })).toBe('今天过得怎么样？写几句吧');
  });
});

describe('导出导入：日记', () => {
  it('journal/YYYY/MM/YYYY-MM-DD.md，导回来按日期认', async () => {
    const src = await Store.open(new MemoryAdapter(), { deviceId: 'dev1', now: () => local(2026, 10, 17, 20) });
    src.setJournal('2026-10-17', { body_md: '今天写完了日记功能', mood: 'content' });
    src.setJournal('2026-09-01', { body_md: '开学' });
    src.setJournal('2026-09-02', { body_md: '' }); // 不建
    const { files, counts } = exportArchive(src);
    expect(counts.journal).toBe(2);
    const f = files.find((x) => x.path === 'journal/2026/10/2026-10-17.md')!;
    const text = fromUtf8(f.data);
    expect(text).toContain(`id: ${journalEntryId('2026-10-17')}`);
    expect(text).toContain('date: 2026-10-17');
    expect(text).toContain('mood: content');
    expect(text).toContain('今天写完了日记功能');
    // 不会被当成任务或组
    const dst = await Store.open(new MemoryAdapter(), { deviceId: 'dev2', now: () => local(2026, 10, 18, 9) });
    const plan = planImport(dst, files);
    expect(plan.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(summarizeImport(plan, false).byKind.journal.create).toBe(2);
    expect(plan.entries.filter((e) => e.kind === 'task')).toHaveLength(0);
    expect(plan.entries.filter((e) => e.kind === 'group')).toHaveLength(0);
    applyImport(dst, plan);
    expect(dst.journalOf('2026-10-17')).toMatchObject({ body_md: '今天写完了日记功能', mood: 'content' });
    expect(dst.journalOf('2026-09-01')!.body_md).toBe('开学');
    // 再导一次：一样的跳过
    expect(summarizeImport(planImport(dst, files), false).byKind.journal).toEqual({ create: 0, update: 0, skip: 2 });
  });

  it('日期不对的报错，id 对不上的按日期导入并提示', async () => {
    const dst = await Store.open(new MemoryAdapter(), { deviceId: 'dev2', now: () => local(2026, 10, 18, 9) });
    const enc = (s: string) => new TextEncoder().encode(s);
    const files = [
      { path: '_meta/mindough.json', data: enc('{"format":"mindough-markdown","version":1}') },
      { path: 'journal/2026/02/2026-02-30.md', data: enc('---\ndate: 2026-02-30\n---\nx') },
      { path: 'journal/2026/10/2026-10-01.md', data: enc('---\nid: 0192a0e4-1c00-7000-8002-000000000000\ndate: 2026-10-01\n---\n国庆') },
    ];
    const plan = planImport(dst, files);
    expect(plan.issues.map((i) => i.level).sort()).toEqual(['error', 'warning']);
    applyImport(dst, plan);
    expect(dst.journalOf('2026-10-01')!.body_md).toBe('国庆');
  });
});
