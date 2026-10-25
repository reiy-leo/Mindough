/**
 * 附件的本机缓存（Rei 2026-10-25：「附件可以下载、删除、缓存、删除缓存。缓存的附件24小时后清除本地缓存。」）
 * - 「缓存」把原文件存到这台设备上，离线也能打开（图片在灯箱里看大图）、下载。缩略图不算，照常走原来的显示逻辑。
 * - 文件放哪：Web 用 Cache Storage（缓存名 mindough-attachments-v1，一个附件一条，假地址 /__attachment-cache/<id>，
 *   service worker 不碰它，外壳缓存清理只删 mindough-shell-*）；Tauri 用 app 缓存目录 attachments/<id>（files.rs 的 att_cache_* 命令）。
 * - 缓存记录（附件 id、r2_key、大小、缓存时间）存 localStorage `mindough:att_cache`，只在这台设备上，不进同步表。
 * - 24 小时从缓存那一刻起算（不看最后打开），到期删本机副本：启动时、回到前台时、运行中每小时查一次；读的时候发现到期也当没缓存并删掉。
 * - 「删除缓存」只删本机副本，云端的文件不动。
 */
import { useSyncExternalStore } from 'react';
import { ATTACHMENT_CACHE_SWEEP_MS, isCacheFresh, parseCacheIndex, sweepCacheIndex, type Attachment, type AttachmentCacheIndex, type AttachmentCacheRecord, type Store } from '@mindough/core';
import { isTauri } from '../store/sqlite-tauri';

export const CACHE_INDEX_KEY = 'mindough:att_cache';
export const WEB_CACHE_NAME = 'mindough-attachments-v1';

/** 文件存在哪（Web / Tauri / 测试用内存）。 */
export interface CacheBackend {
  put(id: string, blob: Blob): Promise<void>;
  get(id: string): Promise<Blob | null>;
  delete(id: string): Promise<void>;
  /** 存着的都有哪些 id（清理没有记录的孤儿文件）；不支持就不传。 */
  ids?(): Promise<string[]>;
}

export function memoryBackend(): CacheBackend & { size(): number } {
  const m = new Map<string, Blob>();
  return {
    put: async (id, b) => void m.set(id, b),
    get: async (id) => m.get(id) ?? null,
    delete: async (id) => void m.delete(id),
    ids: async () => [...m.keys()],
    size: () => m.size,
  };
}

const cacheUrl = (id: string) => new URL(`/__attachment-cache/${encodeURIComponent(id)}`, location.origin).toString();

/** Web：Cache Storage（iOS Safari、Chrome、Firefox 都有；比 OPFS 的写入接口支持得齐）。 */
export function webBackend(): CacheBackend {
  const open = () => caches.open(WEB_CACHE_NAME);
  return {
    async put(id, blob) {
      const c = await open();
      await c.put(cacheUrl(id), new Response(blob, { headers: { 'content-type': blob.type || 'application/octet-stream', 'content-length': String(blob.size) } }));
    },
    async get(id) {
      const r = await (await open()).match(cacheUrl(id));
      return r ? await r.blob() : null;
    },
    async delete(id) {
      await (await open()).delete(cacheUrl(id));
    },
    async ids() {
      const keys = await (await open()).keys();
      return keys.map((r) => decodeURIComponent(new URL(r.url).pathname.split('/').pop() ?? '')).filter(Boolean);
    },
  };
}

/** Tauri：app 缓存目录（src-tauri/src/files.rs）。 */
export function tauriBackend(): CacheBackend {
  const inv = async <T,>(cmd: string, args?: unknown, opts?: { headers: Record<string, string> }) => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<T>(cmd, args as never, opts);
  };
  return {
    async put(id, blob) {
      await inv('att_cache_put', new Uint8Array(await blob.arrayBuffer()), { headers: { 'x-id': id } });
    },
    async get(id) {
      try {
        const buf = await inv<ArrayBuffer | null>('att_cache_get', { id });
        return buf ? new Blob([buf]) : null;
      } catch {
        return null;
      }
    },
    async delete(id) {
      await inv('att_cache_delete', { id });
    },
    ids: () => inv<string[]>('att_cache_list'),
  };
}

function defaultBackend(): CacheBackend {
  if (isTauri()) return tauriBackend();
  if (typeof caches !== 'undefined' && typeof location !== 'undefined') return webBackend();
  return memoryBackend();
}

export interface KeyValue {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

const memoryKv = (): KeyValue => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
};

export interface AttachmentCacheDeps {
  backend?: CacheBackend;
  kv?: KeyValue;
  now?: () => number;
}

export class AttachmentCache {
  readonly backend: CacheBackend;
  private readonly kv: KeyValue;
  readonly now: () => number;
  private index: AttachmentCacheIndex;
  private listeners = new Set<() => void>();
  private busy = new Set<string>();
  version = 0;

  constructor(deps: AttachmentCacheDeps = {}) {
    this.backend = deps.backend ?? defaultBackend();
    this.kv = deps.kv ?? (typeof localStorage !== 'undefined' ? localStorage : memoryKv());
    this.now = deps.now ?? Date.now;
    this.index = parseCacheIndex(this.kv.getItem(CACHE_INDEX_KEY));
  }

  subscribe = (f: () => void) => {
    this.listeners.add(f);
    return () => void this.listeners.delete(f);
  };

  private emit() {
    this.version++;
    for (const f of this.listeners) f();
  }

  private save() {
    try {
      this.kv.setItem(CACHE_INDEX_KEY, JSON.stringify(this.index));
    } catch {
      /* 存不下就只在内存里 */
    }
    this.emit();
  }

  /** 别的标签页改了记录（storage 事件）：重新读。 */
  reload() {
    this.index = parseCacheIndex(this.kv.getItem(CACHE_INDEX_KEY));
    this.emit();
  }

  /** 这条附件现在缓存着吗（没到期、还是那个文件）。 */
  record(a: Pick<Attachment, 'id' | 'r2_key'>): AttachmentCacheRecord | null {
    const r = this.index[a.id];
    return isCacheFresh(r, this.now(), a.r2_key) ? r : null;
  }

  isBusy(id: string): boolean {
    return this.busy.has(id);
  }

  records(): AttachmentCacheIndex {
    return { ...this.index };
  }

  /** 缓存：取回原文件（fetchBytes），存本机，记一笔（缓存时间 = 现在）。已经缓存着就只是重新起算 24 小时。 */
  async cache(a: Pick<Attachment, 'id' | 'r2_key'>, fetchBytes: () => Promise<Blob | null>): Promise<boolean> {
    if (!a.r2_key || this.busy.has(a.id)) return false;
    this.busy.add(a.id);
    this.emit();
    try {
      const blob = this.record(a) ? await this.backend.get(a.id) : null;
      const data = blob ?? (await fetchBytes());
      if (!data) return false;
      if (!blob) await this.backend.put(a.id, data);
      this.index[a.id] = { id: a.id, key: a.r2_key, size: data.size, cached_at: this.now() };
      this.save();
      return true;
    } catch (e) {
      console.warn('缓存附件失败', e);
      return false;
    } finally {
      this.busy.delete(a.id);
      this.emit();
    }
  }

  /** 删除缓存：只删本机副本。 */
  async remove(id: string): Promise<void> {
    delete this.index[id];
    this.save();
    try {
      await this.backend.delete(id);
    } catch (e) {
      console.warn('删除缓存失败', e);
    }
  }

  /** 缓存着就给本机的文件（到期 / 换了文件的顺手删掉，返回 null）。 */
  async get(a: Pick<Attachment, 'id' | 'r2_key'>): Promise<Blob | null> {
    const r = this.index[a.id];
    if (!r) return null;
    if (!this.record(a)) {
      await this.remove(a.id);
      return null;
    }
    try {
      const b = await this.backend.get(a.id);
      if (!b) await this.remove(a.id);
      return b;
    } catch {
      return null;
    }
  }

  /**
   * 清理：到期的、附件已删除 / 换了文件的删本机副本；有 ids() 的话没有记录的孤儿文件也删。返回删掉的 id。
   * store 传了才看附件行（undefined = 这一行没了或打了墓碑）。
   */
  async sweep(store?: Pick<Store, 'raw'>): Promise<string[]> {
    const keyOf = store
      ? (id: string) => {
          const row = store.raw('attachment', id);
          return !row || row.deleted ? undefined : row.r2_key;
        }
      : undefined;
    const { keep, expired } = sweepCacheIndex(this.index, this.now(), keyOf);
    const removed = [...expired];
    if (expired.length) {
      this.index = keep;
      this.save();
    }
    for (const id of expired) await this.backend.delete(id).catch(() => {});
    if (this.backend.ids) {
      try {
        for (const id of await this.backend.ids())
          if (!this.index[id] && !this.busy.has(id)) {
            await this.backend.delete(id).catch(() => {});
            if (!removed.includes(id)) removed.push(id);
          }
      } catch {
        /* 列不出来就算了 */
      }
    }
    return removed;
  }
}

let shared: AttachmentCache | null = null;

export function attachmentCache(): AttachmentCache {
  return (shared ??= new AttachmentCache());
}

/** 测试用：换一个缓存实例（null = 下次用默认的）。 */
export function setAttachmentCache(c: AttachmentCache | null) {
  shared = c;
}

/** 组件里读缓存状态：缓存着返回记录，否则 null；busy = 正在缓存。 */
export function useCacheRecord(a: Pick<Attachment, 'id' | 'r2_key'>): { record: AttachmentCacheRecord | null; busy: boolean } {
  const c = attachmentCache();
  useSyncExternalStore(c.subscribe, () => c.version);
  return { record: c.record(a), busy: c.isBusy(a.id) };
}

/**
 * StoreProvider 打开 Store 后调用：启动时清一次；回到前台时清；运行中每小时清；别的标签页改了记录跟着变。
 * 返回停止函数。
 */
export function installAttachmentCache(store: Store, cache: AttachmentCache = attachmentCache(), every = ATTACHMENT_CACHE_SWEEP_MS): () => void {
  const sweep = () => void cache.sweep(store);
  sweep();
  const onVisible = () => {
    if (document.visibilityState === 'visible') sweep();
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key === CACHE_INDEX_KEY) cache.reload();
  };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', sweep);
  window.addEventListener('storage', onStorage);
  const timer = setInterval(sweep, every);
  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('focus', sweep);
    window.removeEventListener('storage', onStorage);
    clearInterval(timer);
  };
}
