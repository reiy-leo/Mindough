import { describe, expect, it } from 'vitest';
import { Store } from '../src/store';
import { MemoryAdapter } from '../src/storage/memory';
import { seedDemo } from '../src/seed/demo';
import { BUILTIN_TYPE_IDS } from '../src/seed/builtin-types';
import { TABLES, type BaseRow, type TableName } from '../src/types';
import {
  applyImport,
  exportArchive,
  fromUtf8,
  normalizeArchive,
  parseFrontMatter,
  planImport,
  safeName,
  splitFrontMatter,
  stringifyFrontMatter,
  summarizeImport,
  undoImport,
  unzipArchive,
  utf8,
  zipArchive,
  Noted,
  NameSet,
  toBase64,
  fromBase64,
  relativePath,
  decodeDataUrl,
  type ArchiveFile,
} from '../src/archive';
import { local } from './helpers';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function open(dev = 'dev1') {
  let t = local(2026, 10, 16, 10).getTime();
  return Store.open(new MemoryAdapter(), { deviceId: dev, now: () => new Date((t += 1000)) });
}

/** 一份有各种东西的库：演示数据 + 组 / 资料图 / 人物头像 / 正文图片 / 前后关系 / 相关 / 打卡 / 我的一天 / 提醒。 */
async function richStore() {
  const s = await open();
  seedDemo(s);
  const asset = s.insert('asset', { sha256: '', mime: 'image/png', width: null, height: null, r2_key: null, url: PNG });
  const g = s.insert('group', { name: '搬家 / 收拾', icon: '📦', start_at: '2026-10-01', end_at: null, category_id: null, default_type_id: null });
  const p = s.insert('person', { name: '王小明', avatar_asset_id: asset.id, relation: '朋友', birthday: '1990-05-01', note_md: '喜欢**猫**' });
  const a = s.createTask({ body_md: `# 打包书\n\n![封面](${PNG})\n\n- [ ] 第一箱\n- [x] 第二箱\n`, group_id: g.id, remind_time: '08:00', scheduled_date: '2026-10-20' });
  const b = s.createTask({ body_md: '# 打包书', group_id: g.id }); // 同名 → 文件名去重
  const c = s.createTask({ body_md: '叫车', recurrence: 'FREQ=WEEKLY;BYDAY=MO,TH', completion_mode: 'count', target_value: 3, unit: '次' });
  s.addDependency(a.id, b.id);
  s.linkTasks(b.id, c.id);
  s.linkPerson(a.id, p.id);
  s.addToMyDay(a.id, '2026-10-16');
  s.checkIn(c.id, 'add', 1, '2026-10-16');
  s.checkIn(c.id, 'add', 2, '2026-10-16');
  const item = s.createLibraryItem(BUILTIN_TYPE_IDS.movie, { name: '星际穿越', image: asset.id, fields: { year: 2014, imdb: 'tt0816692', links: [{ url: 'https://example.com/x' }] }, note_md: '好看' });
  s.createTask({ type_id: BUILTIN_TYPE_IDS.movie, library_item_id: item.id, type_data: { progress: { season: 1, episode: 3 } }, body_md: '' });
  s.closeTask(b.id);
  await s.flush();
  return s;
}

const dataKey = (u: string) => {
  const d = decodeDataUrl(u)!;
  return `${d.mime}:${toBase64(d.data)}`;
};

/** 比较两边的数据：去掉 updated_at；依赖 / 人物关联 / 我的一天的 id 是新生成的，按内容比。 */
function snapshot(s: Store) {
  const out: Record<string, unknown> = {};
  const clean = (r: BaseRow) => {
    const { updated_at: _u, ...rest } = r as BaseRow & Record<string, unknown>;
    return rest;
  };
  for (const t of TABLES) {
    let rows = s.list(t as TableName).map((r) => clean(r as BaseRow) as Record<string, unknown>);
    if (t === 'dependency') rows = rows.map(({ id: _i, ...r }) => r);
    if (t === 'task_person') rows = rows.map(({ id: _i, ...r }) => r);
    if (t === 'my_day') rows = rows.map(({ id: _i, added_at: _a, sort: _s, ...r }) => r);
    if (t === 'task_link') rows = rows.map(({ created_at: _c, ...r }) => r);
    if (t === 'task_category' || t === 'task_item') rows = rows.map(({ created_at: _c, ...r }) => r);
    // data URL 按内容比（导出成文件再读回来是 base64 写法，内容不变）
    const stable = (v: unknown): string => JSON.stringify(v, (_k, x: unknown) => typeof x === 'string' && x.startsWith('data:') ? dataKey(x) : (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
    out[t] = rows.map(stable).sort();
  }
  return out;
}

describe('front matter', () => {
  it('写出来再读回来一样；Noted 只是行尾注释', () => {
    const text = stringifyFrontMatter({ id: 'x', group: new Noted('g-1', '搬家'), after: [new Noted('a', '第一件'), new Noted('b', '')], n: 3, t: '08:00', empty: undefined, money: { amount: 9.9, currency: 'USD' } });
    expect(text).toMatch(/group: g-1 # 搬家/);
    expect(text).not.toContain('empty');
    const split = splitFrontMatter(text + '正文');
    expect(split.body).toBe('正文');
    const r = parseFrontMatter(split.front!);
    expect(r.ok && r.data).toEqual({ id: 'x', group: 'g-1', after: ['a', 'b'], n: 3, t: '08:00', money: { amount: 9.9, currency: 'USD' } });
  });

  it('畸形的 front matter 不抛：返回错误', () => {
    expect(parseFrontMatter('id: [1, 2').ok).toBe(false);
    expect(parseFrontMatter('- a\n- b').ok).toBe(false);
    expect(parseFrontMatter('a: 1\n  b: : :').ok).toBe(false);
    expect(parseFrontMatter('').ok).toBe(true);
    expect(splitFrontMatter('---\nid: 1\n正文').unterminated).toBe(true);
    expect(splitFrontMatter('没有属性').front).toBeNull();
  });
});

describe('文件名与路径', () => {
  it('安全化：去掉不允许的字符、保留字、太长的截断', () => {
    expect(safeName('a/b:c*?"<>|')).toBe('a b c');
    expect(safeName('  ...  ')).toBe('无标题');
    expect(safeName('CON')).toBe('CON_');
    expect([...safeName('长'.repeat(100))].length).toBe(60);
  });
  it('去重不分大小写', () => {
    const n = new NameSet(['_group.md']);
    expect(n.take('A', '.md')).toBe('A.md');
    expect(n.take('a', '.md')).toBe('a 2.md');
    expect(n.take('_group', '.md')).toBe('_group 2.md');
  });
  it('相对路径', () => {
    expect(relativePath('g/x.md', 'assets/a.png')).toBe('../assets/a.png');
    expect(relativePath('x.md', 'assets/a.png')).toBe('assets/a.png');
    expect(relativePath('library/影视库/x.md', 'assets/a.png')).toBe('../../assets/a.png');
  });
  it('base64 往返', () => {
    for (const n of [0, 1, 2, 3, 4, 255, 1000]) {
      const d = Uint8Array.from({ length: n }, (_, i) => (i * 37) & 255);
      expect([...fromBase64(toBase64(d))]).toEqual([...d]);
    }
    expect(toBase64(utf8('hi?'))).toBe('aGk/');
  });
});

describe('导出', () => {
  it('结构：组文件夹 + _group.md、资料库、人物、_meta、图片进 assets 且正文改成相对路径', async () => {
    const s = await richStore();
    const { files, counts } = exportArchive(s);
    const paths = files.map((f) => f.path);
    expect(paths).toContain('_meta/mindough.json');
    expect(paths).toContain('搬家 收拾/_group.md');
    expect(paths).toContain('搬家 收拾/打包书.md');
    expect(paths).toContain('搬家 收拾/打包书 2.md');
    expect(paths).toContain('people/王小明.md');
    expect(paths.some((p) => /^library\/影视库\/星际穿越\.md$/.test(p))).toBe(true);
    expect(paths.filter((p) => p.startsWith('assets/')).length).toBeGreaterThanOrEqual(2);
    const task = fromUtf8(files.find((f) => f.path === '搬家 收拾/打包书.md')!.data);
    expect(task).toMatch(/^---\nid: /);
    expect(task).toMatch(/remind: "08:00"/);
    expect(task).toMatch(/!\[封面\]\(\.\.\/assets\/img-[0-9a-f]{16}\.png\)/);
    expect(task).not.toContain('data:image');
    expect(task).toContain('- [ ] 第一箱');
    const person = fromUtf8(files.find((f) => f.path === 'people/王小明.md')!.data);
    expect(person).toMatch(/avatar: assets\/[0-9a-f-]{36}\.png/);
    expect(counts.tasks).toBe(s.list('task').length);
  });
});

describe('往返：导出再导入到空库，数据等价', () => {
  it('经过 zip 也一样', async () => {
    const src = await richStore();
    const { files } = exportArchive(src);
    const zip = zipArchive(files, 'Mindough 2026-10-16');
    const back = unzipArchive(zip);
    expect(normalizeArchive(back).root).toBe('Mindough 2026-10-16');

    const dst = await open('dev2');
    const plan = planImport(dst, back);
    expect(plan.format).toBe('mindough');
    expect(plan.issues.filter((i) => i.level === 'error')).toEqual([]);
    const sum = summarizeImport(plan, false);
    expect(sum.byKind.task.create).toBe(src.list('task').length);
    applyImport(dst, plan);
    expect(snapshot(dst)).toEqual(snapshot(src));
    expect(dst.edges()).toEqual(expect.arrayContaining(src.edges()));
  });

  it('再导一次：全部跳过（内容一样）；改过的默认跳过，选覆盖就更新', async () => {
    const src = await richStore();
    const { files } = exportArchive(src);
    const dst = await open('dev2');
    applyImport(dst, planImport(dst, files));
    const again = summarizeImport(planImport(dst, files), true);
    expect(again.create).toBe(0);
    expect(again.update).toBe(0);

    const t = dst.tasks().find((x) => x.body_md === '叫车')!;
    dst.updateTask(t.id, { body_md: '叫车（改过）' });
    const plan = planImport(dst, files);
    expect(summarizeImport(plan, false).update).toBe(0);
    expect(summarizeImport(plan, true).update).toBe(1);
    applyImport(dst, plan);
    expect(dst.get('task', t.id)!.body_md).toBe('叫车（改过）');
    applyImport(dst, plan, { overwrite: true });
    expect(dst.get('task', t.id)!.body_md).toBe('叫车');
  });

  it('整批撤销：新建的打墓碑、覆盖的回到原样；进 outbox', async () => {
    const src = await richStore();
    const { files } = exportArchive(src);
    const dst = await open('dev2');
    const before = snapshot(dst);
    const outbox0 = (await dst.adapter.pendingOutbox(1e6)).length;
    const receipt = applyImport(dst, planImport(dst, files));
    await dst.flush();
    expect((await dst.adapter.pendingOutbox(1e6)).length).toBeGreaterThan(outbox0);
    expect(dst.list('task').length).toBe(src.list('task').length);
    undoImport(dst, receipt);
    expect(snapshot(dst)).toEqual(before);
  });
});

describe('普通 markdown 文件夹', () => {
  const md = (path: string, text: string): ArchiveFile => ({ path, data: utf8(text) });

  it('每个 .md 一件任务，最上一层文件夹 → 组，清单不拆，文件名当标题', async () => {
    const s = await open();
    const files = [
      md('Vault/读书/三体.md', '- [ ] 第一部\n- [ ] 第二部\n'),
      md('Vault/读书/笔记/深一层.md', '# 深一层\n内容'),
      md('Vault/随手.md', '---\ntags: [a]\nstatus: done\ndue: 2026-11-01\n---\n买牛奶'),
      md('Vault/图/a.png', ''),
      md('Vault/.obsidian/app.json', '{}'),
      md('Vault/带图.md', '![[a.png]]'),
    ];
    files[3] = { path: 'Vault/图/a.png', data: fromBase64(PNG.split(',')[1]!) };
    const plan = planImport(s, files);
    expect(plan.format).toBe('markdown');
    const sum = summarizeImport(plan, false);
    expect(sum.byKind.task.create).toBe(4);
    expect(sum.byKind.group.create).toBe(1);
    applyImport(s, plan);
    const g = s.list('group').find((x) => x.name === '读书')!;
    const book = s.tasks().find((t) => t.body_md.includes('第一部'))!;
    expect(book.group_id).toBe(g.id);
    expect(book.body_md).toBe('# 三体\n\n- [ ] 第一部\n- [ ] 第二部\n');
    expect(s.tasks().find((t) => t.body_md.includes('深一层'))!.group_id).toBe(g.id);
    const milk = s.tasks().find((t) => t.body_md.includes('买牛奶'))!;
    expect(milk.status).toBe('完成');
    expect(milk.scheduled_date).toBe('2026-11-01');
    expect(milk.group_id).toBeNull();
    expect(s.tasks().find((t) => t.body_md.includes('带图'))!.body_md).toContain('](data:image/png;base64,');
    // 同一个文件夹再导一次：id 由路径定，跳过
    expect(summarizeImport(planImport(s, files), false).create).toBe(0);
  });

  it('同名的已有组直接用', async () => {
    const s = await open();
    const g = s.insert('group', { name: '读书', icon: '📚', start_at: null, end_at: null, category_id: null, default_type_id: null });
    applyImport(s, planImport(s, [md('读书/a.md', 'a'), md('读书/b.md', 'b'), md('别的/c.md', 'c')]));
    expect(s.list('group').filter((x) => x.name === '读书')).toHaveLength(1);
    expect(s.tasks().filter((t) => t.group_id === g.id)).toHaveLength(2);
  });

  it('畸形文件：记进出错列表，别的照常导入，不抛', async () => {
    const s = await open();
    const files = [
      md('a.md', '---\nid: [oops\n---\n坏的'),
      md('b.md', '---\nstatus: done\n没有收尾'),
      md('c.md', '---\n- 一\n- 二\n---\n列表当属性'),
      md('d.md', '好的'),
      { path: 'e.md', data: Uint8Array.from([0xff, 0xfe, 0x00, 0x41]) },
    ];
    const plan = planImport(s, files);
    expect(plan.issues.filter((i) => i.level === 'error').map((i) => i.path).sort()).toEqual(['a.md', 'b.md', 'c.md']);
    applyImport(s, plan);
    expect(s.tasks().some((t) => t.body_md.includes('好的'))).toBe(true);
  });

  it('自己的格式里写坏的值：找不到的引用记警告，不崩', async () => {
    const src = await richStore();
    const { files } = exportArchive(src);
    const bad = files.map((f) => {
      if (f.path === '搬家 收拾/打包书 2.md') return { path: f.path, data: utf8(fromUtf8(f.data).replace(/^after:\n.*$/m, 'after:\n  - 00000000-0000-7000-8000-00000000dead\n  - 不是 id\n').replace(/^completion: .*$/m, 'completion: 乱写').replace(/^sort: .*$/m, 'sort: abc')) };
      if (f.path === '_meta/checkins.json') return { path: f.path, data: utf8('{ 坏掉的 json') };
      if (f.path === '_meta/types.json') return { path: f.path, data: utf8(JSON.stringify([{ id: 'x' }, ...JSON.parse(fromUtf8(f.data))])) };
      return f;
    });
    const dst = await open('dev2');
    const plan = planImport(dst, bad);
    expect(plan.issues.some((i) => i.path === '搬家 收拾/打包书 2.md' && i.level === 'warning')).toBe(true);
    expect(plan.issues.some((i) => i.path === '_meta/checkins.json' && i.level === 'error')).toBe(true);
    expect(() => applyImport(dst, plan)).not.toThrow();
    const t = dst.tasks().find((x) => x.body_md === '# 打包书')!;
    expect(t.completion_mode).toBe('once');
    expect(dst.edges().filter((e) => e.succ_id === t.id)).toEqual([]);
  });
});
