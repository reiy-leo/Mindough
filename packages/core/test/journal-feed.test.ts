import { describe, expect, it } from 'vitest';
import { Store } from '../src/store';
import { MemoryAdapter } from '../src/storage/memory';
import { SyncEngine } from '../src/sync/engine';
import { MemoryRemote } from '../src/sync/memory-remote';
import { search } from '../src/search';
import { applyImport, exportArchive, fromUtf8, planImport, summarizeImport, undoImport } from '../src/archive';
import { JournalPostLockedError, journalEntryId } from '../src/journal';
import {
  dayMoodColor,
  entryIdOfPost,
  filterPosts,
  formatJournalDay,
  groupPostsByDay,
  heatStrength,
  journalHeatRange,
  migratedPostId,
  mixOklab,
  moodCounts,
  parseJournalDay,
  planJournalMigration,
} from '../src/journal-feed';
import type { JournalEntry, JournalPost } from '../src/types';
import { local } from './helpers';

const ACCOUNT = 'rei@example.com';

async function device(remote: MemoryRemote, deviceId: string, t0 = local(2026, 10, 28, 20).getTime(), adapter = new MemoryAdapter()) {
  let t = t0;
  const store = await Store.open(adapter, { deviceId, now: () => new Date(t) });
  const engine = new SyncEngine(store, remote.transport(), { account: ACCOUNT, now: () => new Date(t), timers: { set: () => 0, clear: () => {} } });
  return { store, engine, advance: (ms: number) => (t += ms), sync: () => engine.syncNow() };
}

/** 旧客户端（alpha.9 及以前）写的一天一篇。updated_at 是 HLC。 */
const oldEntry = (date: string, body: string, mood: string | null, ms: number, dev = 'olddev', patch: Partial<JournalEntry> = {}): JournalEntry => ({
  id: journalEntryId(date),
  updated_at: `${String(ms).padStart(13, '0')}-0000-${dev}`,
  deleted: false,
  date,
  body_md: body,
  mood,
  base_at: null,
  created_at: new Date(ms - 3600_000).toISOString(),
  ...patch,
});

const post = (id: string, day: string, mood: string | null, created: string, body = 'x', deleted = false): JournalPost => ({ id, updated_at: '', deleted, day, body_md: body, mood, created_at: created });

describe('Feed 流：id', () => {
  it('旧日记转来的 id 由那篇的 id 算，能反推回去', () => {
    const e = journalEntryId('2026-10-17');
    expect(migratedPostId(e)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7000-8003-0{12}$/);
    expect(migratedPostId(e, 2)!.endsWith('-000000000002')).toBe(true);
    expect(entryIdOfPost(migratedPostId(e, 2)!)).toBe(e);
    expect(entryIdOfPost('0192a0e4-1c00-7abc-8def-0123456789ab')).toBeNull();
    expect(migratedPostId('not-an-entry')).toBeNull();
  });
});

describe('Feed 流：迁移旧日记', () => {
  it('每篇转成一条：created_at 用原 updated_at，心情照搬；折叠块里收着的另一版各成一条', () => {
    const ms = local(2026, 10, 17, 22).getTime();
    const body = '今天去海边\n\n<details data-journal="conflict">\n<summary>另一台设备上同时写的 · 10-17 21:00</summary>\n\n手机上写的那版\n\n</details>\n';
    const rows = planJournalMigration(oldEntry('2026-10-17', body, 'calm', ms), () => undefined);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: migratedPostId(journalEntryId('2026-10-17')), day: '2026-10-17', body_md: '今天去海边', mood: 'calm', created_at: new Date(ms).toISOString() });
    expect(rows[1]).toMatchObject({ body_md: '手机上写的那版', mood: null, day: '2026-10-17' });
    // 空的（只建了一行、没写）不转；只有附件的转一条空正文
    expect(planJournalMigration(oldEntry('2026-10-18', '', null, ms), () => undefined)).toEqual([]);
    expect(planJournalMigration(oldEntry('2026-10-18', '', null, ms), () => undefined, true)).toHaveLength(1);
  });

  it('打开时迁移，不进 outbox；旧表留着；重开不重复', async () => {
    const adapter = new MemoryAdapter();
    const ms = local(2026, 10, 17, 22).getTime();
    await adapter.applyRemoteChanges([
      { table: 'journal_entry', row: oldEntry('2026-10-17', '海边', 'calm', ms) },
      { table: 'journal_entry', row: oldEntry('2026-10-16', '加班', 'tired', ms - 86400_000) },
    ]);
    const s = await Store.open(adapter, { deviceId: 'dev1', now: () => local(2026, 10, 28, 9) });
    expect(s.journalPosts().map((p) => [p.day, p.body_md, p.mood])).toEqual([
      ['2026-10-17', '海边', 'calm'],
      ['2026-10-16', '加班', 'tired'],
    ]);
    expect((await adapter.pendingOutbox(10_000)).filter((o) => o.table === 'journal_post')).toEqual([]);
    expect(s.list('journal_entry')).toHaveLength(2);
    await s.flush();
    const s2 = await Store.open(adapter, { deviceId: 'dev1', now: () => local(2026, 10, 28, 10) });
    expect(s2.journalPosts()).toHaveLength(2);
  });

  it('两台设备各迁一遍：同一个 id；一台删了，同步后另一台也没了，再打开也不翻回来', async () => {
    const remote = new MemoryRemote();
    const ms = local(2026, 10, 17, 22).getTime();
    const mk = async (dev: string) => {
      const ad = new MemoryAdapter();
      await ad.applyRemoteChanges([{ table: 'journal_entry', row: oldEntry('2026-10-17', '海边', 'calm', ms) }]);
      return device(remote, dev, local(2026, 10, 28, 9).getTime(), ad);
    };
    const A = await mk('devA');
    const B = await mk('devB');
    const id = migratedPostId(journalEntryId('2026-10-17'))!;
    expect(A.store.journalPosts()[0]!.id).toBe(id);
    expect(B.store.journalPosts()[0]!.id).toBe(id);
    A.store.deleteJournalPost(id);
    await A.sync();
    await B.sync();
    expect(B.store.journalPosts()).toEqual([]);
    // 新设备：先拉到旧表、再拉到墓碑（或反过来），都不出现
    const C = await device(remote, 'devC', local(2026, 10, 28, 9).getTime());
    await C.sync();
    expect(C.store.journalPosts()).toEqual([]);
  });

  it('旧客户端后来又改了那天：跟着改；删了那天：条目也删', async () => {
    const remote = new MemoryRemote();
    const N = await device(remote, 'devN');
    const ms = local(2026, 10, 17, 22).getTime();
    N.store.applyRemote([{ table: 'journal_entry', row: oldEntry('2026-10-17', '第一版', null, ms) }]);
    expect(N.store.journalPosts()[0]!.body_md).toBe('第一版');
    N.store.applyRemote([{ table: 'journal_entry', row: oldEntry('2026-10-17', '第二版', 'happy', ms + 1000) }]);
    expect(N.store.journalPosts().map((p) => [p.body_md, p.mood])).toEqual([['第二版', 'happy']]);
    N.store.applyRemote([{ table: 'journal_entry', row: oldEntry('2026-10-17', '第二版', 'happy', ms + 2000, 'olddev', { deleted: true }) }]);
    expect(N.store.journalPosts()).toEqual([]);
  });

  it('旧日记的附件跟着转来的那条显示', async () => {
    const s = await Store.open(new MemoryAdapter(), { deviceId: 'dev1', now: () => local(2026, 10, 17, 20) });
    s.ensureJournal('2026-10-17');
    s.addAttachment({ owner_type: 'journal', owner_id: journalEntryId('2026-10-17'), file_name: 'a.png', mime: 'image/png', size: 3 });
    // 有附件以后旧日记再被写一次（旧客户端）就会转出来；这里直接写旧表模拟
    s.setJournal('2026-10-17', { body_md: '带图' });
    const p = s.journalPosts()[0]!;
    expect(s.attachmentsOfPost(p).map((a) => a.file_name)).toEqual(['a.png']);
  });
});

describe('Feed 流：只追加', () => {
  it('发一条：算在「今天」（5 点前算昨天），id 随机；空的不发', async () => {
    let now = local(2026, 10, 28, 3);
    const s = await Store.open(new MemoryAdapter(), { deviceId: 'dev1', now: () => now });
    const a = s.addJournalPost({ body_md: '睡不着', mood: 'tired' })!;
    expect(a.day).toBe('2026-10-27');
    now = local(2026, 10, 28, 9);
    const b = s.addJournalPost({ body_md: '早上好\n\n' })!;
    expect(b).toMatchObject({ day: '2026-10-28', body_md: '早上好', mood: null });
    expect(a.id).not.toBe(b.id);
    expect(s.addJournalPost({ body_md: '   ' })).toBeUndefined();
    expect(s.addJournalPost({ body_md: '', mood: 'calm' })).toMatchObject({ body_md: '', mood: 'calm' });
    expect(s.journalPosts().map((p) => p.id)[0]).not.toBe(a.id); // 新的在前
  });

  it('发了不能改正文、心情、日子；能删、能撤销', async () => {
    const s = await Store.open(new MemoryAdapter(), { deviceId: 'dev1', now: () => local(2026, 10, 28, 9) });
    const p = s.addJournalPost({ body_md: '定了', mood: 'happy' })!;
    expect(() => s.update('journal_post', p.id, { body_md: '改了' })).toThrow(JournalPostLockedError);
    expect(() => s.update('journal_post', p.id, { mood: 'sad' })).toThrow(JournalPostLockedError);
    expect(() => s.update('journal_post', p.id, { day: '2026-10-01' })).toThrow(JournalPostLockedError);
    expect(s.get('journal_post', p.id)!.body_md).toBe('定了');
    s.deleteJournalPost(p.id);
    expect(s.journalPosts()).toEqual([]);
    s.restoreJournalPost(p.id);
    expect(s.journalPosts().map((x) => x.body_md)).toEqual(['定了']);
  });
});

describe('Feed 流：两台设备同步', () => {
  it('两台离线各发几条：都在，不冲突；删除和撤销也同步', async () => {
    const remote = new MemoryRemote();
    const A = await device(remote, 'devA');
    const B = await device(remote, 'devB');
    A.store.addJournalPost({ body_md: 'A 一', mood: 'happy' });
    B.advance(1000);
    B.store.addJournalPost({ body_md: 'B 一', mood: 'sad' });
    A.advance(2000);
    const a2 = A.store.addJournalPost({ body_md: 'A 二' })!;
    await A.sync();
    await B.sync();
    await A.sync();
    const bodies = (s: Store) => s.journalPosts().map((p) => p.body_md);
    expect(bodies(A.store)).toEqual(['A 二', 'B 一', 'A 一']);
    expect(bodies(B.store)).toEqual(bodies(A.store));
    B.advance(5000);
    B.store.deleteJournalPost(a2.id);
    await B.sync();
    await A.sync();
    expect(bodies(A.store)).toEqual(['B 一', 'A 一']);
    A.advance(10_000);
    A.store.restoreJournalPost(a2.id);
    await A.sync();
    await B.sync();
    expect(bodies(B.store)).toEqual(['A 二', 'B 一', 'A 一']);
  });

  it('旧客户端还在写旧表：新客户端拉到就转成一条', async () => {
    const remote = new MemoryRemote();
    const N = await device(remote, 'devN');
    const Old = await device(remote, 'devOld');
    Old.store.applyRemote([]); // 占位：旧客户端就是写 journal_entry
    Old.store.setJournal('2026-10-28', { body_md: '旧版写的', mood: 'content' });
    await Old.sync();
    await N.sync();
    expect(N.store.journalPosts().map((p) => [p.body_md, p.mood])).toEqual([['旧版写的', 'content']]);
  });
});

describe('Feed 流：分组、筛选、心情列表', () => {
  const list = [
    post('p1', '2026-10-28', 'happy', '2026-10-28T01:00:00.000Z'),
    post('p2', '2026-10-28', 'sad', '2026-10-28T03:00:00.000Z'),
    post('p3', '2026-10-27', 'happy', '2026-10-27T10:00:00.000Z'),
    post('p4', '2026-10-27', null, '2026-10-27T11:00:00.000Z'),
    post('p5', '2026-10-26', 'happy', '2026-10-26T11:00:00.000Z', 'x', true),
    post('p6', '2026-04-01', 'calm', '2026-04-01T11:00:00.000Z'),
    post('p7', '2026-10-25', 'future-mood', '2026-10-25T11:00:00.000Z'),
  ];
  it('按天分组：新的日子在上，一天里新的在上；删了的不算', () => {
    expect(groupPostsByDay(list).map((g) => [g.day, g.posts.map((p) => p.id)])).toEqual([
      ['2026-10-28', ['p2', 'p1']],
      ['2026-10-27', ['p4', 'p3']],
      ['2026-10-25', ['p7']],
      ['2026-04-01', ['p6']],
    ]);
  });
  it('按天、按心情筛，能叠加', () => {
    expect(filterPosts(list, { day: '2026-10-28' }).map((p) => p.id)).toEqual(['p2', 'p1']);
    expect(filterPosts(list, { mood: 'happy' }).map((p) => p.id)).toEqual(['p1', 'p3']);
    expect(filterPosts(list, { day: '2026-10-27', mood: 'happy' }).map((p) => p.id)).toEqual(['p3']);
    expect(filterPosts(list, {}).length).toBe(6);
  });
  it('心情列表：按条数从多到少，一样多按从好到不好；不认识、没心情、删了的、范围外的不算', () => {
    expect(moodCounts(list)).toEqual([
      { id: 'happy', count: 2 },
      { id: 'calm', count: 1 },
      { id: 'sad', count: 1 },
    ]);
    expect(moodCounts(list, { from: '2026-05-01', to: '2026-10-28' })).toEqual([
      { id: 'happy', count: 2 },
      { id: 'sad', count: 1 },
    ]);
  });
  it('热力图范围：至少 26 周，最早一条更早就往前补到它那周', () => {
    const r = journalHeatRange([], '2026-10-28', { weekStartsOn: 1 });
    expect(r).toEqual({ weeks: 26, from: '2026-05-04', to: '2026-10-28' });
    const r2 = journalHeatRange([post('x', '2025-10-01', null, '2025-10-01T00:00:00Z')], '2026-10-28', { weekStartsOn: 1 });
    expect(r2.from <= '2025-10-01').toBe(true);
    expect(r2.from).toBe('2025-09-29');
    expect(r2.weeks).toBe(57);
  });
});

describe('Feed 流：颜色混合', () => {
  it('OKLab 平均：一种颜色还是它自己，黑白混出中灰（不是 sRGB 的 #808080 偏暗那种）', () => {
    expect(mixOklab(['#2e7cf6'])).toBe('#2e7cf6');
    const g = mixOklab(['#000000', '#ffffff'])!;
    // OKLab L=0.5 ≈ #636363
    expect(g).toBe('#636363');
    expect(mixOklab(['nope'])).toBeNull();
  });
  it('一天的颜色：各条心情色平均，没心情的用中性主色；顺序无关', () => {
    const palette = { happy: '#d29a00', sad: '#2e7cf6' };
    expect(dayMoodColor(['happy'], palette, '#888888')).toBe('#d29a00');
    expect(dayMoodColor([null], palette, '#888888')).toBe('#888888');
    expect(dayMoodColor(['unknown-mood'], palette, '#888888')).toBe('#888888');
    const ab = dayMoodColor(['happy', 'sad'], palette, '#888888');
    expect(ab).toBe(dayMoodColor(['sad', 'happy'], palette, '#888888'));
    expect(ab).not.toBe('#d29a00');
    expect(dayMoodColor([], palette, '#888888')).toBeNull();
  });
  it('条数越多越深', () => {
    expect([0, 1, 2, 3, 4, 9].map(heatStrength)).toEqual([0, 0.62, 0.78, 0.9, 1, 1]);
  });
});

describe('Feed 流：导出导入', () => {
  it('一天一个文件、每条一段，读得回来', () => {
    const md = formatJournalDay([post('a', '2026-10-28', 'happy', '2026-10-28T01:00:00.000Z', '第一条\n\n- 列表'), post('b', '2026-10-28', null, '2026-10-28T03:00:00.000Z', '第二条')]);
    expect(md.indexOf('第一条')).toBeLessThan(md.indexOf('第二条')); // 早的在上
    expect(md).toContain('<!-- mindough:post id="a" created="2026-10-28T01:00:00.000Z" mood="happy" -->');
    expect(md).toMatch(/\*\*\d{2}:\d{2}\*\* · 开心/);
    expect(parseJournalDay(md)).toEqual([
      { id: 'a', created: '2026-10-28T01:00:00.000Z', mood: 'happy', body: '第一条\n\n- 列表' },
      { id: 'b', created: '2026-10-28T03:00:00.000Z', mood: null, body: '第二条' },
    ]);
    expect(parseJournalDay('普通的一天')).toBeNull();
  });

  it('导出 → 导入另一台：条目、心情、时间一样；再导一次全跳过；撤销整批', async () => {
    const src = await Store.open(new MemoryAdapter(), { deviceId: 'dev1', now: () => local(2026, 10, 28, 9) });
    src.addJournalPost({ body_md: '早上', mood: 'calm' });
    src.addJournalPost({ body_md: '又一条' });
    const { files, counts } = exportArchive(src);
    expect(counts.journal).toBe(2);
    const f = files.find((x) => x.path === 'journal/2026/10/2026-10-28.md')!;
    const text = fromUtf8(f.data);
    expect(text).toContain('date: 2026-10-28');
    expect(text).toContain('早上');
    const dst = await Store.open(new MemoryAdapter(), { deviceId: 'dev2', now: () => local(2026, 10, 29, 9) });
    const plan = planImport(dst, files);
    expect(plan.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(summarizeImport(plan, false).byKind.journal.create).toBe(2);
    expect(plan.entries.filter((e) => e.kind === 'task')).toHaveLength(0);
    const receipt = applyImport(dst, plan);
    const pick = (s: Store) => s.journalPosts().map((p) => [p.id, p.day, p.body_md, p.mood, p.created_at]);
    expect(pick(dst)).toEqual(pick(src));
    expect(summarizeImport(planImport(dst, files), false).byKind.journal).toEqual({ create: 0, update: 0, skip: 2 });
    // 覆盖导入也不改已经有的条目（发了不能改）
    expect(() => applyImport(dst, planImport(dst, files), { overwrite: true })).not.toThrow();
    undoImport(dst, receipt);
    expect(dst.journalPosts()).toEqual([]);
  });

  it('旧格式的文件（没有标记）还能导：进旧表，再转成一条', async () => {
    const dst = await Store.open(new MemoryAdapter(), { deviceId: 'dev2', now: () => local(2026, 10, 28, 9) });
    const enc = (s: string) => new TextEncoder().encode(s);
    const files = [
      { path: '_meta/mindough.json', data: enc('{"format":"mindough-markdown","version":1}') },
      { path: 'journal/2026/10/2026-10-01.md', data: enc(`---\nid: ${journalEntryId('2026-10-01')}\ndate: 2026-10-01\nmood: happy\n---\n国庆`) },
      { path: 'journal/2026/02/2026-02-30.md', data: enc('---\ndate: 2026-02-30\n---\nx') },
    ];
    const plan = planImport(dst, files);
    expect(plan.issues.map((i) => i.level)).toEqual(['error']);
    applyImport(dst, plan);
    expect(dst.journalPosts().map((p) => [p.day, p.body_md, p.mood])).toEqual([['2026-10-01', '国庆', 'happy']]);
  });
});

describe('Feed 流：搜索', () => {
  it('⌘K 搜得到条目（正文、心情），排在同样命中的任务后面', async () => {
    const s = await Store.open(new MemoryAdapter(), { deviceId: 'dev1', now: () => local(2026, 10, 17, 20) });
    s.addJournalPost({ body_md: '今天去海边散步', mood: 'calm' });
    const t = s.createTask({ body_md: '海边' });
    const input = { tasks: s.list('task'), types: [], people: [], groups: [], taskPeople: [], journal: s.list('journal_post') };
    const hits = search(input, '海边');
    expect(hits.map((h) => h.kind)).toEqual(['task', 'journal']);
    expect(hits[0]!.id).toBe(t.id);
    const j = hits[1]!;
    expect(j.kind === 'journal' && j.post.day).toBe('2026-10-17');
    expect(j.title).toBe('2026年10月17日 周六 · 20:00');
    expect(j.snippet).toContain('海边');
    expect(search(input, '平静').map((h) => h.kind)).toEqual(['journal']);
  });
});
