// @vitest-environment happy-dom
/**
 * 云端文件清掉以后（Rei 2026-10-25）：404 未找到时本机有就补传，没有就标「文件已删除」。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryAdapter, Store, type Attachment } from '@mindough/core';
import { memoryQueue, pendingQueue, setPendingQueue } from './attachments-queue';
import { AttachmentCache, memoryBackend, setAttachmentCache } from './attachment-cache';
import { PROBE_TTL_MS, checkAttachment, goneState, probeKey, setGoneDeps } from './attachment-gone';
import { uploadText } from '../components/attachments/Attachments';
import './i18n';

const KEY = (c: string) => `${'a'.repeat(16)}/f/${c.repeat(64)}`;

let store: Store;
let cache: AttachmentCache;
let remote: Set<string>;
let heads: string[];
let puts: Blob[];
let now: number;
let putKey: (b: Blob) => string;

beforeEach(async () => {
  setPendingQueue(memoryQueue());
  cache = new AttachmentCache({ backend: memoryBackend(), kv: { getItem: () => null, setItem: () => {} }, now: () => now });
  setAttachmentCache(cache);
  store = await Store.open(new MemoryAdapter(), { deviceId: 'dev-a' });
  remote = new Set();
  heads = [];
  puts = [];
  now = 1_000_000;
  putKey = () => KEY('1');
  setGoneDeps({
    head: async (k) => (heads.push(k), remote.has(k) ? 200 : 404),
    put: async (b) => {
      puts.push(b);
      const k = putKey(b);
      remote.add(k);
      return { r2_key: k };
    },
    thumb: async () => new Blob(['thumb'], { type: 'image/webp' }),
    canCheck: () => true,
    now: () => now,
  });
});
afterEach(() => {
  setPendingQueue(null);
  setAttachmentCache(null);
  setGoneDeps(null);
});

function attachment(r2: string | null, thumb: string | null = null, name = 'a.pdf', mime = 'application/pdf'): Attachment {
  const task = store.createTask({ body_md: 'x' });
  const row = store.addAttachment({ owner_type: 'task', owner_id: task.id, file_name: name, mime, size: 3 });
  if (r2) store.setAttachmentFile(row.id, { r2_key: r2, thumb_key: thumb });
  return store.get('attachment', row.id)!;
}

describe('查云端文件还在不在', () => {
  it('还在：ok，不补传；10 分钟内不再问', async () => {
    const a = attachment(KEY('1'));
    remote.add(KEY('1'));
    expect(await checkAttachment(store, a)).toBe('ok');
    expect(await checkAttachment(store, a)).toBe('ok');
    expect(heads).toEqual([KEY('1')]);
    now += PROBE_TTL_MS;
    await checkAttachment(store, a);
    expect(heads).toHaveLength(2);
    expect(puts).toHaveLength(0);
  });

  it('云端没了、本机也没有：标「文件已删除」，文字跟着变', async () => {
    const a = attachment(KEY('1'));
    expect(await checkAttachment(store, a)).toBe('gone');
    expect(goneState(a)).toBe('gone');
    expect(uploadText(undefined, a, goneState(a))).toBe('文件已删除');
    expect(puts).toHaveLength(0);
  });

  it('云端没了、本机缓存着：重新传上去（同内容 key 不变，不改行），状态清掉', async () => {
    const a = attachment(KEY('1'));
    remote.add(KEY('1'));
    await cache.cache(a, async () => new Blob(['abc']));
    remote.delete(KEY('1'));
    const before = store.get('attachment', a.id)!.updated_at;
    expect(await checkAttachment(store, a, true)).toBe('restored');
    expect(puts).toHaveLength(1);
    expect(await puts[0]!.text()).toBe('abc');
    expect(goneState(a)).toBeNull();
    expect(store.get('attachment', a.id)!.updated_at).toBe(before);
    // 补传后记成「还在」，不用再问
    expect(await probeKey(KEY('1'))).toBe('ok');
  });

  it('上传队列里还有原文件也能补；缩略图也没了就重新生成，key 变了才改行', async () => {
    const a = attachment(KEY('1'), KEY('2'), 'p.png', 'image/png');
    await pendingQueue().put({ id: a.id, file: new File(['img'], 'p.png', { type: 'image/png' }), thumb: null, added_at: 0 });
    putKey = (b) => (b.type === 'image/webp' ? KEY('3') : KEY('1'));
    expect(await checkAttachment(store, a, true)).toBe('restored');
    expect(puts).toHaveLength(2);
    const row = store.get('attachment', a.id)!;
    expect(row.r2_key).toBe(KEY('1'));
    expect(row.thumb_key).toBe(KEY('3'));
  });

  it('原文件在、只是缩略图没了、本机又没有：不算删除（网格退回用原图）', async () => {
    const a = attachment(KEY('1'), KEY('2'), 'p.png', 'image/png');
    remote.add(KEY('1'));
    expect(await checkAttachment(store, a)).toBe('ok');
    expect(goneState(a)).toBeNull();
  });

  it('查不出来（网络错、500）：不下结论，下次再问', async () => {
    const a = attachment(KEY('1'));
    setGoneDeps({ head: async () => 500, canCheck: () => true, now: () => now });
    expect(await checkAttachment(store, a)).toBe('unknown');
    expect(goneState(a)).toBeNull();
    setGoneDeps({ head: async () => Promise.reject(new Error('断网')), canCheck: () => true, now: () => now });
    expect(await checkAttachment(store, a)).toBe('unknown');
  });

  it('补传失败：原文件确实没了就标已删除', async () => {
    const a = attachment(KEY('1'));
    await cache.cache(a, async () => new Blob(['abc']));
    setGoneDeps({
      head: async () => 404,
      put: async () => Promise.reject(new Error('413 内容太大')),
      canCheck: () => true,
      now: () => now,
    });
    const warn = console.warn;
    console.warn = () => {};
    try {
      expect(await checkAttachment(store, a, true)).toBe('gone');
    } finally {
      console.warn = warn;
    }
    expect(goneState(a)).toBe('gone');
  });

  it('还没传上去、已删除、离线 / 没登录：不查', async () => {
    const pending = attachment(null);
    expect(await checkAttachment(store, pending)).toBe('skipped');
    const a = attachment(KEY('1'));
    store.removeAttachment(a.id);
    expect(await checkAttachment(store, store.raw('attachment', a.id)!)).toBe('skipped');
    setGoneDeps({ head: async () => 404, canCheck: () => false, now: () => now });
    expect(await checkAttachment(store, attachment(KEY('5')))).toBe('skipped');
    expect(heads).toHaveLength(0);
  });

  it('文件换了（r2_key 变了）：之前的「已删除」不算到新文件上', async () => {
    const a = attachment(KEY('1'));
    await checkAttachment(store, a);
    expect(goneState(a)).toBe('gone');
    expect(goneState({ id: a.id, r2_key: KEY('9') })).toBeNull();
  });

  it('撤销删除后再查：恢复的行本机缓存还在就补传回去', async () => {
    const a = attachment(KEY('1'));
    remote.add(KEY('1'));
    await cache.cache(a, async () => new Blob(['abc']));
    store.removeAttachment(a.id);
    remote.delete(KEY('1')); // Worker 删了文件
    const back = store.restoreAttachment(a.id)!;
    expect(await checkAttachment(store, back, true)).toBe('restored');
    expect(remote.has(KEY('1'))).toBe(true);
  });
});
