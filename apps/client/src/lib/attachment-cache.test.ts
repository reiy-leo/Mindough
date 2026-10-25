// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ATTACHMENT_CACHE_TTL_MS, MemoryAdapter, Store, attachmentActionState, type Attachment } from '@mindough/core';
import { AttachmentCache, CACHE_INDEX_KEY, installAttachmentCache, memoryBackend, setAttachmentCache, type KeyValue } from './attachment-cache';
import { memoryQueue, setPendingQueue } from './attachments-queue';
import { downloadAttachment } from './attachments';
import { menuOf } from '../components/attachments/Attachments';
import './i18n';

const H = 3_600_000;
const KEY = (c: string) => `${'a'.repeat(16)}/f/${c.repeat(64)}`;

function kv(): KeyValue & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

let store: Store;
let clock: number;
let backend: ReturnType<typeof memoryBackend>;
let storage: ReturnType<typeof kv>;
let cache: AttachmentCache;

const addRow = (name: string, mime: string, key: string | null = KEY('1')) => {
  const row = store.addAttachment({ owner_type: 'task', owner_id: 'task-1', file_name: name, mime, size: 4, width: null, height: null });
  if (key) store.setAttachmentFile(row.id, { r2_key: key, thumb_key: null });
  return store.get('attachment', row.id)!;
};

beforeEach(async () => {
  setPendingQueue(memoryQueue());
  store = await Store.open(new MemoryAdapter(), { deviceId: 'dev-a' });
  clock = Date.UTC(2026, 9, 25);
  backend = memoryBackend();
  storage = kv();
  cache = new AttachmentCache({ backend, kv: storage, now: () => clock });
  setAttachmentCache(cache);
});
afterEach(() => {
  setAttachmentCache(null);
  setPendingQueue(null);
  vi.useRealTimers();
});

describe('缓存记录', () => {
  it('缓存：存文件、记 id / key / 大小 / 时间，只存本机（不进同步表）', async () => {
    const a = addRow('a.pdf', 'application/pdf');
    const outbox = store.raw('attachment', a.id);
    expect(await cache.cache(a, async () => new Blob(['data']))).toBe(true);
    expect(cache.record(a)).toEqual({ id: a.id, key: KEY('1'), size: 4, cached_at: clock });
    expect(JSON.parse(storage.map.get(CACHE_INDEX_KEY)!)[a.id].cached_at).toBe(clock);
    expect(await (await cache.get(a))!.text()).toBe('data');
    expect(store.raw('attachment', a.id)).toEqual(outbox);
  });

  it('还没传上去的（没有 key）不能缓存；取不到文件不记', async () => {
    const pending = addRow('p.pdf', 'application/pdf', null);
    expect(await cache.cache(pending, async () => new Blob(['x']))).toBe(false);
    const a = addRow('a.pdf', 'application/pdf');
    expect(await cache.cache(a, async () => null)).toBe(false);
    expect(cache.record(a)).toBeNull();
    expect(backend.size()).toBe(0);
  });

  it('删除缓存只删本机副本，附件行不动', async () => {
    const a = addRow('a.pdf', 'application/pdf');
    await cache.cache(a, async () => new Blob(['data']));
    await cache.remove(a.id);
    expect(cache.record(a)).toBeNull();
    expect(backend.size()).toBe(0);
    expect(store.get('attachment', a.id)?.deleted).toBeFalsy();
  });

  it('附件换了文件（key 变了）不算缓存着', async () => {
    const a = addRow('a.pdf', 'application/pdf');
    await cache.cache(a, async () => new Blob(['data']));
    expect(cache.record({ ...a, r2_key: KEY('2') })).toBeNull();
    expect(await cache.get({ ...a, r2_key: KEY('2') })).toBeNull();
    expect(backend.size()).toBe(0);
  });

  it('重新启动后从本机记录读回来', async () => {
    const a = addRow('a.pdf', 'application/pdf');
    await cache.cache(a, async () => new Blob(['data']));
    const again = new AttachmentCache({ backend, kv: storage, now: () => clock });
    expect(again.record(a)?.cached_at).toBe(clock);
  });
});

describe('24 小时过期清理（假时钟）', () => {
  it('从缓存那一刻起算，打开过也不续期；到点 sweep 删掉', async () => {
    const a = addRow('a.pdf', 'application/pdf');
    await cache.cache(a, async () => new Blob(['data']));
    clock += 20 * H;
    expect(await cache.get(a)).not.toBeNull(); // 打开一次
    clock += 3 * H + 59 * 60_000;
    expect(await cache.sweep(store)).toEqual([]);
    expect(cache.record(a)).not.toBeNull();
    clock += 60_000; // 正好 24 小时
    expect(cache.record(a)).toBeNull();
    expect(await cache.sweep(store)).toEqual([a.id]);
    expect(backend.size()).toBe(0);
    expect(JSON.parse(storage.map.get(CACHE_INDEX_KEY)!)).toEqual({});
  });

  it('到期了读的时候也当没缓存，顺手删掉', async () => {
    const a = addRow('a.pdf', 'application/pdf');
    await cache.cache(a, async () => new Blob(['data']));
    clock += ATTACHMENT_CACHE_TTL_MS;
    expect(await cache.get(a)).toBeNull();
    expect(backend.size()).toBe(0);
  });

  it('附件删掉了、没有记录的孤儿文件也清掉', async () => {
    const a = addRow('a.pdf', 'application/pdf');
    const b = addRow('b.pdf', 'application/pdf', KEY('2'));
    await cache.cache(a, async () => new Blob(['a']));
    await cache.cache(b, async () => new Blob(['b']));
    await backend.put('orphan', new Blob(['o']));
    store.removeAttachment(a.id);
    expect((await cache.sweep(store)).sort()).toEqual([a.id, 'orphan'].sort());
    expect(cache.record(b)).not.toBeNull();
    expect(backend.size()).toBe(1);
  });

  it('install：启动时清一次、每小时清一次、回到前台清一次', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const a = addRow('a.pdf', 'application/pdf');
    await cache.cache(a, async () => new Blob(['data']));
    const spy = vi.spyOn(cache, 'sweep');
    const stop = installAttachmentCache(store, cache, H);
    expect(spy).toHaveBeenCalledTimes(1);
    clock += 24 * H;
    vi.advanceTimersByTime(H);
    expect(spy).toHaveBeenCalledTimes(2);
    await spy.mock.results[1]!.value;
    expect(backend.size()).toBe(0);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(spy).toHaveBeenCalledTimes(3);
    stop();
    vi.advanceTimersByTime(5 * H);
    expect(spy).toHaveBeenCalledTimes(3);
  });
});

describe('下载优先用本机缓存；离线没缓存下载不了', () => {
  it('缓存着：离线也能下（Web 用 blob: 地址）', async () => {
    const a = addRow('报告.pdf', 'application/pdf');
    await cache.cache(a, async () => new Blob(['data']));
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const clicks: string[] = [];
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      clicks.push(`${this.download}|${this.href.slice(0, 5)}`);
    };
    try {
      expect(await downloadAttachment(a as Attachment)).toEqual({ ok: true });
      expect(clicks).toEqual(['报告.pdf|blob:']);
    } finally {
      HTMLAnchorElement.prototype.click = orig;
      vi.restoreAllMocks();
    }
  });

  it('没缓存又离线：offline', async () => {
    const a = addRow('a.pdf', 'application/pdf');
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      expect(await downloadAttachment(a as Attachment)).toEqual({ ok: false, reason: 'offline' });
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe('附件菜单', () => {
  const act = { remove: () => {}, download: async () => {}, rename: () => {}, cache: async () => {}, uncache: async () => {} };
  const ids = (items: ReturnType<typeof menuOf>) => items.map((i) => `${i.id}${i.disabled ? '(off)' : ''}`);

  it('没缓存：下载、缓存、重命名、删除；离线时下载和缓存灰掉', () => {
    const a = addRow('a.mp4', 'video/mp4');
    expect(ids(menuOf(a, act, attachmentActionState(a, { cached: false, online: true, pending: false })))).toEqual(['download', 'cache', 'rename', 'delete']);
    expect(ids(menuOf(a, act, attachmentActionState(a, { cached: false, online: false, pending: false })))).toEqual(['download(off)', 'cache(off)', 'rename', 'delete']);
  });

  it('缓存着：换成删除缓存，离线也能下载', () => {
    const a = addRow('a.png', 'image/png');
    expect(ids(menuOf(a, act, attachmentActionState(a, { cached: true, online: false, pending: false })))).toEqual(['download', 'uncache', 'rename', 'delete']);
  });

  it('英文 Title Case', async () => {
    const { setLocale } = await import('@mindough/core');
    setLocale('en');
    try {
      const a = addRow('a.png', 'image/png');
      expect(menuOf(a, act, attachmentActionState(a, { cached: false, online: true, pending: false })).map((i) => i.label)).toEqual(['Download', 'Cache', 'Rename…', 'Delete']);
      expect(menuOf(a, act, attachmentActionState(a, { cached: true, online: true, pending: false })).map((i) => i.label)).toEqual(['Download', 'Remove Cache', 'Rename…', 'Delete']);
    } finally {
      setLocale('zh');
    }
  });
});
