import { describe, expect, it } from 'vitest';
import { Store } from '../src/store';
import { MemoryAdapter } from '../src/storage/memory';
import { SyncEngine } from '../src/sync/engine';
import { MemoryRemote } from '../src/sync/memory-remote';
import { ATTACHMENTS_MARKER, applyImport, exportArchive, fromUtf8, planImport, stripAttachmentBlock, summarizeImport, undoImport, unzipArchive, zipArchive } from '../src/archive';
import { setLocale } from '../src/i18n';
import { journalEntryId } from '../src/journal';
import {
  MAX_ATTACHMENT_BYTES,
  canThumbnail,
  extOf,
  fileKind,
  fileKindLabel,
  fileStem,
  formatFileSize,
  isFileKey,
  isViewableImage,
  renamedFileName,
  safeFileName,
  sortAttachments,
  tooLarge,
  uniqueFileName,
} from '../src/attachments';
import { local } from './helpers';

const KEY = `${'a'.repeat(16)}/f/${'b'.repeat(64)}`;
const THUMB = `${'a'.repeat(16)}/f/${'c'.repeat(64)}`;

async function open(deviceId = 'dev-a', t0 = local(2026, 10, 17, 20).getTime()) {
  let t = t0;
  const store = await Store.open(new MemoryAdapter(), { deviceId, now: () => new Date(t) });
  return { store, advance: (ms: number) => (t += ms) };
}

describe('文件类型', () => {
  it('按 MIME 认，MIME 不明时看扩展名', () => {
    expect(fileKind('a.png', 'image/png')).toBe('image');
    expect(fileKind('scan.PDF', '')).toBe('pdf');
    expect(fileKind('x', 'application/pdf')).toBe('pdf');
    expect(fileKind('报告.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('doc');
    expect(fileKind('预算.xlsx', 'application/octet-stream')).toBe('sheet');
    expect(fileKind('a.csv', 'text/csv')).toBe('sheet');
    expect(fileKind('deck.key', '')).toBe('slides');
    expect(fileKind('p.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')).toBe('slides');
    expect(fileKind('a.tar.gz', 'application/gzip')).toBe('archive');
    expect(fileKind('a.7z', '')).toBe('archive');
    expect(fileKind('song.flac', '')).toBe('audio');
    expect(fileKind('v', 'video/mp4')).toBe('video');
    expect(fileKind('main.rs', '')).toBe('code');
    expect(fileKind('notes', 'text/plain')).toBe('code');
    expect(fileKind('README.md', 'text/markdown')).toBe('code');
    expect(fileKind('thing.xyz', 'application/octet-stream')).toBe('file');
    expect(fileKind('noext', '')).toBe('file');
  });

  it('扩展名、主干', () => {
    expect(extOf('a.B.Txt')).toBe('txt');
    expect(extOf('.bashrc')).toBe('');
    expect(extOf('a.')).toBe('');
    expect(fileStem('收据.2026.pdf')).toBe('收据.2026');
    expect(fileStem('Makefile')).toBe('Makefile');
  });

  it('能直接显示的图片；HEIC 有缩略图才当图片显示', () => {
    expect(isViewableImage({ file_name: 'a.jpg', mime: 'image/jpeg', thumb_key: null })).toBe(true);
    expect(isViewableImage({ file_name: 'a.heic', mime: 'image/heic', thumb_key: null })).toBe(false);
    expect(isViewableImage({ file_name: 'a.heic', mime: 'image/heic', thumb_key: THUMB })).toBe(true);
    expect(isViewableImage({ file_name: 'a.pdf', mime: 'application/pdf', thumb_key: THUMB })).toBe(false);
    expect(canThumbnail('image/png')).toBe(true);
    expect(canThumbnail('image/svg+xml')).toBe(false);
  });

  it('每种都有叫法', () => {
    setLocale('en');
    try {
      expect(fileKindLabel('sheet')).toBe('Spreadsheet');
      expect(fileKindLabel('code')).toBe('Code / Text');
    } finally {
      setLocale('zh');
    }
    expect(fileKindLabel('archive')).toBe('压缩包');
  });
});

describe('大小与名字', () => {
  it('大小：1024 进位、一位小数', () => {
    expect(formatFileSize(0)).toBe('0 字节');
    expect(formatFileSize(1023)).toBe('1023 字节');
    expect(formatFileSize(1024)).toBe('1 KB');
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(5 * 1024 * 1024 + 300 * 1024)).toBe('5.3 MB');
    expect(formatFileSize(250 * 1024 * 1024)).toBe('250 MB');
    expect(formatFileSize(3 * 1024 ** 3)).toBe('3 GB');
    setLocale('en');
    try {
      expect(formatFileSize(1)).toBe('1 byte');
      expect(formatFileSize(12)).toBe('12 bytes');
    } finally {
      setLocale('zh');
    }
  });

  it('上限 50 MB', () => {
    expect(MAX_ATTACHMENT_BYTES).toBe(52428800);
    expect(tooLarge(MAX_ATTACHMENT_BYTES)).toBe(false);
    expect(tooLarge(MAX_ATTACHMENT_BYTES + 1)).toBe(true);
  });

  it('文件名：去掉非法字符、保留名、太长截断保留扩展名', () => {
    expect(safeFileName('a/b:c*?.txt')).toBe('abc.txt');
    expect(safeFileName('  ..hidden.  ')).toBe('hidden');
    expect(safeFileName('CON.txt')).toBe('CON_.txt');
    expect(safeFileName('')).toBe('file');
    const long = safeFileName('字'.repeat(200) + '.pdf');
    expect([...long].length).toBe(120);
    expect(long.endsWith('.pdf')).toBe(true);
  });

  it('改名：没写扩展名补回原来的；写了就照用户的；空的不改', () => {
    expect(renamedFileName('收据.pdf', '房租收据')).toBe('房租收据.pdf');
    expect(renamedFileName('a.pdf', 'b.txt')).toBe('b.txt');
    expect(renamedFileName('Makefile', 'Build')).toBe('Build');
    expect(renamedFileName('a.pdf', '   ')).toBeNull();
    expect(renamedFileName('a.pdf', '///')).toBeNull();
  });

  it('同一个文件夹不重名（不分大小写）', () => {
    const used = new Set<string>();
    expect(uniqueFileName('a.pdf', used)).toBe('a.pdf');
    expect(uniqueFileName('A.pdf', used)).toBe('A 2.pdf');
    expect(uniqueFileName('a.pdf', used)).toBe('a 3.pdf');
    expect(uniqueFileName('notes', used)).toBe('notes');
    expect(uniqueFileName('notes', used)).toBe('notes 2');
  });

  it('key 的形状、排序', () => {
    expect(isFileKey(KEY)).toBe(true);
    expect(isFileKey('x/f/y')).toBe(false);
    const s = sortAttachments([
      { id: 'b', created_at: '2026-01-02' },
      { id: 'a', created_at: '2026-01-02' },
      { id: 'c', created_at: '2026-01-01' },
    ]);
    expect(s.map((x) => x.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('Store：附件', () => {
  it('加、传好后填 key、改名、删、撤销删除；删任务一起删', async () => {
    const { store, advance } = await open();
    const task = store.createTask({ body_md: '退押金' });
    const a = store.addAttachment({ owner_type: 'task', owner_id: task.id, file_name: '收据:1.pdf', mime: '', size: 1234.6 });
    expect(a).toMatchObject({ file_name: '收据1.pdf', mime: 'application/octet-stream', size: 1235, r2_key: null, thumb_key: null, width: null });
    advance(10);
    const b = store.addAttachment({ owner_type: 'task', owner_id: task.id, file_name: 'p.jpg', mime: 'image/jpeg', size: 10, width: 4000, height: 3000 });
    expect(store.attachmentsOf('task', task.id).map((x) => x.id)).toEqual([a.id, b.id]);
    expect(store.attachmentsOf('journal', task.id)).toEqual([]);

    store.setAttachmentFile(b.id, { r2_key: KEY, thumb_key: THUMB });
    expect(store.get('attachment', b.id)).toMatchObject({ r2_key: KEY, thumb_key: THUMB });
    expect(store.renameAttachment(a.id, '房租收据')?.file_name).toBe('房租收据.pdf');
    expect(store.renameAttachment(a.id, '  ')).toBeUndefined();

    store.removeAttachment(a.id);
    expect(store.attachmentsOf('task', task.id).map((x) => x.id)).toEqual([b.id]);
    expect(store.setAttachmentFile(a.id, { r2_key: KEY })).toBeUndefined();
    store.restoreAttachment(a.id);
    expect(store.attachmentsOf('task', task.id)).toHaveLength(2);

    store.deleteTask(task.id);
    expect(store.list('attachment')).toEqual([]);
  });

  it('日记：ensureJournal 建一行空日记，删日记一起删附件；将来的日子不行', async () => {
    const { store } = await open();
    const date = store.journalToday();
    const e = store.ensureJournal(date);
    expect(e).toMatchObject({ id: journalEntryId(date), body_md: '', mood: null });
    expect(store.ensureJournal(date).updated_at).toBe(e.updated_at);
    store.addAttachment({ owner_type: 'journal', owner_id: e.id, file_name: 'a.txt', mime: 'text/plain', size: 3 });
    expect(store.attachmentsOf('journal', e.id)).toHaveLength(1);
    store.deleteJournal(date);
    expect(store.list('attachment')).toEqual([]);
    expect(() => store.ensureJournal('2099-01-01')).toThrow();
  });

  it('同步：附件行跟别的行一样推拉；缺的列补成 null；另一台改名后写赢', async () => {
    const remote = new MemoryRemote();
    let t = local(2026, 10, 17, 20).getTime();
    const mk = async (id: string) => {
      const store = await Store.open(new MemoryAdapter(), { deviceId: id, now: () => new Date(t) });
      const engine = new SyncEngine(store, remote.transport(), { account: 'rei@example.com', now: () => new Date(t), timers: { set: () => 0, clear: () => {} } });
      return { store, engine };
    };
    const A = await mk('dev-a');
    const B = await mk('dev-b');
    await A.engine.start();
    await B.engine.start();
    const task = A.store.createTask({ body_md: 'x' });
    const att = A.store.addAttachment({ owner_type: 'task', owner_id: task.id, file_name: 'a.pdf', mime: 'application/pdf', size: 9 });
    await A.engine.syncNow();
    await B.engine.syncNow();
    expect(B.store.get('attachment', att.id)).toMatchObject({ file_name: 'a.pdf', r2_key: null });
    t += 1000;
    A.store.setAttachmentFile(att.id, { r2_key: KEY });
    await A.engine.syncNow();
    await B.engine.syncNow();
    expect(B.store.get('attachment', att.id)?.r2_key).toBe(KEY);
    t += 1000;
    B.store.renameAttachment(att.id, '合同');
    await B.engine.syncNow();
    await A.engine.syncNow();
    expect(A.store.get('attachment', att.id)?.file_name).toBe('合同.pdf');

    // 老版本推上来的行缺列
    const n = A.store.applyRemote([
      { table: 'attachment', row: { id: 'x1', updated_at: `${Date.now() + 99999}-0000-zz`, deleted: false, owner_type: 'task', owner_id: task.id, file_name: 'b', created_at: '2026-10-17' } as never },
    ]);
    expect(n).toBe(1);
    expect(A.store.get('attachment', 'x1')).toMatchObject({ r2_key: null, thumb_key: null, width: null, height: null, mime: 'application/octet-stream', size: 0 });
  });
});

describe('导出 / 导入', () => {
  async function source() {
    const { store, advance } = await open('dev-src');
    const g = store.insert('group', { name: '搬家', icon: 'box', start_at: null, end_at: null, category_id: null, default_type_id: null });
    const task = store.createTask({ body_md: '退押金\n\n- [ ] 拍水电表\n', group_id: g.id });
    const pdf = store.addAttachment({ owner_type: 'task', owner_id: task.id, file_name: '收据 (1).pdf', mime: 'application/pdf', size: 4, r2_key: KEY });
    advance(5);
    const img = store.addAttachment({ owner_type: 'task', owner_id: task.id, file_name: 'photo.jpg', mime: 'image/jpeg', size: 3, width: 40, height: 30, r2_key: KEY, thumb_key: THUMB });
    advance(5);
    const same = store.addAttachment({ owner_type: 'task', owner_id: task.id, file_name: '收据 (1).PDF', mime: 'application/pdf', size: 2 });
    advance(5);
    const missing = store.addAttachment({ owner_type: 'task', owner_id: task.id, file_name: 'gone.zip', mime: 'application/zip', size: 1, r2_key: KEY });
    const date = store.journalToday();
    const j = store.ensureJournal(date);
    const jtxt = store.addAttachment({ owner_type: 'journal', owner_id: j.id, file_name: 'notes.md', mime: 'text/markdown', size: 5 });
    const bytes = new Map<string, Uint8Array>([
      [pdf.id, new Uint8Array([1, 2, 3, 4])],
      [img.id, new Uint8Array([9, 9, 9])],
      [same.id, new Uint8Array([7, 7])],
      [jtxt.id, new TextEncoder().encode('# hi\n')],
    ]);
    return { store, task, g, pdf, img, same, missing, jtxt, j, date, bytes };
  }

  it('附件放进 attachments/（同名加「 2」），记录在 _meta/attachments.json，正文后面一段链接；没取到的只写记录', async () => {
    const s = await source();
    const { files, counts } = exportArchive(s.store, { attachments: s.bytes });
    const paths = files.map((f) => f.path);
    expect(paths).toContain('attachments/收据 (1).pdf');
    expect(paths).toContain('attachments/收据 (1) 2.PDF');
    expect(paths).toContain('attachments/photo.jpg');
    expect(paths).toContain('attachments/notes.md');
    expect(counts).toMatchObject({ attachments: 5, missingAttachments: 1 });
    const meta = JSON.parse(fromUtf8(files.find((f) => f.path === '_meta/attachments.json')!.data)) as Array<{ id: string; file?: string; r2_key: string | null }>;
    expect(meta).toHaveLength(5);
    expect(meta.find((m) => m.id === s.missing.id)).toMatchObject({ r2_key: KEY });
    expect(meta.find((m) => m.id === s.missing.id)!.file).toBeUndefined();
    const md = fromUtf8(files.find((f) => f.path === '搬家/退押金.md')!.data);
    expect(md).toContain(ATTACHMENTS_MARKER);
    expect(md).toContain('- [收据 (1).pdf](<../attachments/收据 (1).pdf>)');
    expect(md).toContain('- ![photo.jpg](../attachments/photo.jpg)');
    expect(md).toContain('- gone.zip');
    // 日记只有附件（正文空）也导出
    const jpath = `journal/${s.date.slice(0, 4)}/${s.date.slice(5, 7)}/${s.date}.md`;
    expect(fromUtf8(files.find((f) => f.path === jpath)!.data)).toContain('[notes.md](../../../attachments/notes.md)');
    // 附件里的 .md 不会被当成任务
    const dst = (await open('dev-dst')).store;
    const plan = planImport(dst, unzipArchive(zipArchive(files, 'Mindough 2026-10-17')));
    expect(plan.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(summarizeImport(plan, false).byKind.task.create).toBe(1);
  });

  it('往返：正文原样（附件那段去掉）、附件按 id 回来；带文件的 r2_key 留空等重新上传，不带的照记录', async () => {
    const s = await source();
    const { files } = exportArchive(s.store, { attachments: s.bytes });
    const dst = (await open('dev-dst')).store;
    const plan = planImport(dst, files);
    expect(summarizeImport(plan, false).byKind.attachment).toEqual({ create: 5, update: 0, skip: 0 });
    expect(plan.attachmentFiles.map((f) => f.path).sort()).toEqual(['attachments/notes.md', 'attachments/photo.jpg', 'attachments/收据 (1) 2.PDF', 'attachments/收据 (1).pdf']);
    const receipt = applyImport(dst, plan);
    expect(dst.get('task', s.task.id)?.body_md).toBe(s.task.body_md);
    expect(dst.get('journal_entry', s.j.id)?.body_md).toBe('');
    const got = dst.attachmentsOf('task', s.task.id);
    expect(got.map((a) => a.id)).toEqual([s.pdf.id, s.img.id, s.same.id, s.missing.id]);
    expect(dst.get('attachment', s.img.id)).toMatchObject({ file_name: 'photo.jpg', width: 40, height: 30, r2_key: null, thumb_key: null, size: 3 });
    expect(dst.get('attachment', s.missing.id)?.r2_key).toBe(KEY);
    expect(dst.attachmentsOf('journal', s.j.id)).toHaveLength(1);
    // 再导一次：一样的跳过
    expect(summarizeImport(planImport(dst, files), false).byKind.attachment.skip).toBe(5);
    // 撤销整批
    undoImport(dst, receipt);
    expect(dst.list('attachment')).toEqual([]);
  });

  it('挂的东西找不到：提示、不导入；文件不在包里：只导入记录', async () => {
    const s = await source();
    const { files } = exportArchive(s.store, { attachments: s.bytes });
    const noTask = files.filter((f) => f.path !== '搬家/退押金.md' && f.path !== 'attachments/photo.jpg');
    const dst = (await open('dev-dst')).store;
    const plan = planImport(dst, noTask);
    expect(plan.issues.filter((i) => i.message.includes('找不到'))).toHaveLength(4);
    expect(summarizeImport(plan, false).byKind.attachment.create).toBe(1);

    const noFile = files.filter((f) => f.path !== 'attachments/photo.jpg');
    const p2 = planImport(dst, noFile);
    expect(p2.issues.some((i) => i.message.includes('attachments/photo.jpg'))).toBe(true);
    applyImport(dst, p2);
    expect(dst.get('attachment', s.img.id)?.r2_key).toBe(KEY);
  });

  it('库里已有同一个附件且传过：带文件导入时沿用 key（不用重传）', async () => {
    const s = await source();
    const { files } = exportArchive(s.store, { attachments: s.bytes });
    const plan = planImport(s.store, files);
    const img = plan.entries.find((e) => e.id === s.img.id)!;
    expect(img.state).toBe('same');
    expect((img.row as unknown as { r2_key: string }).r2_key).toBe(KEY);
  });

  it('stripAttachmentBlock', () => {
    expect(stripAttachmentBlock(`abc\n\n${ATTACHMENTS_MARKER}\n## 附件\n- a`)).toBe('abc');
    expect(stripAttachmentBlock(`abc\n\n\n${ATTACHMENTS_MARKER}\n`)).toBe('abc\n');
    expect(stripAttachmentBlock(`\n\n${ATTACHMENTS_MARKER}\n`)).toBe('');
    expect(stripAttachmentBlock('no block')).toBe('no block');
  });
});
