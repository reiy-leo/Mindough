/**
 * 附件（Rei 2026-10-17）：选 / 拖进来的文件 → 本机队列（attachments-queue.ts）→ 登录且联网时传到 R2（POST /api/files，带进度、能取消）。
 * - 行（attachment）先建好，r2_key 为空；传好后 setAttachmentFile 填上，其他设备同步后就能看、能下。
 * - 图片在本机生成一张小缩略图（长边 480，WebP / JPEG），网格里用它；原文件不压缩、不改尺寸。
 * - 失败可以重试；离线 / 没登录时排着，联网、登录后自动接着传。
 * - 显示：本机队列里有就用本机的文件；传好了 Web 端直接用 /api/files/<key>（同源带 cookie），原生端带 Bearer 取回再显示。
 * - 下载：Web 端走浏览器下载（保留原文件名）；Tauri 桌面弹系统保存框（2026-10-25 起，dialog 插件），手机存进「下载」文件夹（save_download）。
 * - 本机缓存（attachment-cache.ts，Rei 2026-10-25）：缓存着的附件打开大图、下载都先用本机的；离线又没缓存的下载不了。
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { attachmentCache } from './attachment-cache';
import { MAX_ATTACHMENT_BYTES, canThumbnail, formatFileSize, tooLarge, type Attachment, type AttachmentOwnerType, type Store } from '@mindough/core';
import { checkExisting } from './content-hash';
import { API_BASE, authInit, getAccount, statusZh, subscribeAccount } from './account';
import { pendingQueue } from './attachments-queue';
import { forgetProbe, probeKey } from './attachment-gone';
import { isTauri } from '../store/sqlite-tauri';
import { tr } from './i18n';

// ───────────── 联网状态 ─────────────

/** 现在连得上吗：浏览器说离线，或账户检查连不上服务器，都算离线。 */
export function isOnline(): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  return getAccount().status !== 'offline';
}

let onlineVersion = 0;
const onlineListeners = new Set<() => void>();
let onlineWired = false;
function wireOnline() {
  if (onlineWired || typeof window === 'undefined') return;
  onlineWired = true;
  const bump = () => {
    onlineVersion++;
    for (const f of onlineListeners) f();
  };
  window.addEventListener('online', bump);
  window.addEventListener('offline', bump);
  subscribeAccount(bump);
}

export function useOnline(): boolean {
  wireOnline();
  useSyncExternalStore(
    (f) => (onlineListeners.add(f), () => onlineListeners.delete(f)),
    () => onlineVersion,
  );
  return isOnline();
}

// ───────────── 上传状态 ─────────────

export type UploadPhase = 'queued' | 'uploading' | 'failed' | 'offline' | 'signed-out';
export interface UploadState {
  phase: UploadPhase;
  loaded: number;
  total: number;
  error?: string;
}

const states = new Map<string, UploadState>();
const listeners = new Set<() => void>();
let version = 0;
const emit = () => {
  version++;
  for (const f of listeners) f();
};
const setState = (id: string, s: UploadState | null) => {
  if (s) states.set(id, s);
  else states.delete(id);
  emit();
};

export function uploadState(id: string): UploadState | undefined {
  return states.get(id);
}

export function useUploadState(id: string): UploadState | undefined {
  useSyncExternalStore(
    (f) => (listeners.add(f), () => listeners.delete(f)),
    () => version,
  );
  return states.get(id);
}

// ───────────── 传输 ─────────────

export interface UploadedFile {
  r2_key: string;
  sha256: string;
  mime: string;
  size: number;
}

export class UploadError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

export type UploadFn = (blob: Blob, onProgress: (loaded: number, total: number) => void, signal: AbortSignal) => Promise<UploadedFile>;

/** 先在本机算哈希问服务器，已经有这份内容就不传（进度直接满）；没有再用 XMLHttpRequest 传（fetch 拿不到上传进度）。 */
export const xhrUpload: UploadFn = async (blob, onProgress, signal) => {
  const existing = await checkExisting<UploadedFile>('files', blob, undefined, signal);
  if (existing?.r2_key) {
    onProgress(blob.size, blob.size);
    return existing;
  }
  return xhrSend(blob, onProgress, signal);
};

const xhrSend: UploadFn = (blob, onProgress, signal) =>
  new Promise((resolve, reject) => {
    const init = authInit({ headers: { 'content-type': blob.type || 'application/octet-stream' } });
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/api/files`);
    xhr.withCredentials = init.credentials === 'include';
    new Headers(init.headers).forEach((v, k) => xhr.setRequestHeader(k, v));
    xhr.upload.onprogress = (e) => onProgress(e.loaded, e.lengthComputable ? e.total : blob.size);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as UploadedFile);
        } catch {
          reject(new UploadError(tr('服务端返回的内容看不懂')));
        }
      } else reject(new UploadError(`${xhr.status} ${statusZh(xhr.status)}`, xhr.status));
    };
    xhr.onerror = () => reject(new UploadError(tr('连不上服务器')));
    xhr.onabort = () => reject(new DOMException('aborted', 'AbortError'));
    signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(blob);
  });

// ───────────── 上传器 ─────────────

const CONCURRENCY = 2;

export interface UploaderDeps {
  upload?: UploadFn;
  /** 现在能传吗：offline / signed-out / null（能）。 */
  blocked?: () => 'offline' | 'signed-out' | null;
}

const defaultBlocked = (): 'offline' | 'signed-out' | null => {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  const a = getAccount();
  if (a.status === 'offline') return 'offline';
  if (a.status !== 'in') return 'signed-out';
  return null;
};

export class Uploader {
  private running = new Map<string, AbortController>();
  private waiting: string[] = [];
  private readonly upload: UploadFn;
  private readonly blocked: () => 'offline' | 'signed-out' | null;

  constructor(
    private readonly store: Store,
    deps: UploaderDeps = {},
  ) {
    this.upload = deps.upload ?? xhrUpload;
    this.blocked = deps.blocked ?? defaultBlocked;
  }

  /** 启动时：队列里的接着传；行已删、已传好的清掉。 */
  async resume(): Promise<void> {
    const q = pendingQueue();
    for (const id of await q.ids()) {
      const raw = this.store.raw('attachment', id);
      if (!raw || raw.deleted || raw.r2_key) {
        // 删掉的：留到下次启动再清（这次可能还会撤销）——这里就是下次
        await q.delete(id);
        continue;
      }
      this.enqueue(id);
    }
  }

  enqueue(id: string) {
    if (this.running.has(id) || this.waiting.includes(id)) return;
    this.waiting.push(id);
    const s = states.get(id);
    setState(id, { phase: 'queued', loaded: 0, total: s?.total ?? this.store.raw('attachment', id)?.size ?? 0 });
    this.pump();
  }

  /** 失败的、等着的都再试一次（联网、登录后调用）。 */
  kick() {
    for (const [id, s] of states) if (s.phase === 'failed' || s.phase === 'offline' || s.phase === 'signed-out') this.enqueue(id);
    this.pump();
  }

  retry(id: string) {
    this.enqueue(id);
  }

  /** 取消：停掉上传、删本机文件和这一行（不留撤销）。 */
  async cancel(id: string) {
    this.running.get(id)?.abort();
    this.running.delete(id);
    this.waiting = this.waiting.filter((x) => x !== id);
    setState(id, null);
    await pendingQueue().delete(id);
    this.store.removeAttachment(id);
  }

  private pump() {
    while (this.running.size < CONCURRENCY && this.waiting.length) {
      const block = this.blocked();
      if (block) {
        for (const id of this.waiting) setState(id, { ...(states.get(id) ?? { loaded: 0, total: 0 }), phase: block });
        this.waiting = [];
        return;
      }
      const id = this.waiting.shift()!;
      void this.run(id);
    }
  }

  private async run(id: string) {
    const ctl = new AbortController();
    this.running.set(id, ctl);
    try {
      const row = this.store.get('attachment', id);
      const pending = await pendingQueue().get(id);
      if (!row || row.r2_key || !pending) {
        if (!row || row.r2_key) await pendingQueue().delete(id);
        setState(id, null);
        return;
      }
      const total = pending.file.size + (pending.thumb?.size ?? 0);
      setState(id, { phase: 'uploading', loaded: 0, total });
      let thumbKey: string | null = row.thumb_key;
      if (pending.thumb && !thumbKey) {
        const t = await this.upload(pending.thumb, (l) => setState(id, { phase: 'uploading', loaded: l, total }), ctl.signal);
        thumbKey = t.r2_key;
      }
      const base = pending.thumb?.size ?? 0;
      const up = await this.upload(pending.file, (l) => setState(id, { phase: 'uploading', loaded: base + l, total }), ctl.signal);
      if (ctl.signal.aborted) return;
      this.store.setAttachmentFile(id, { r2_key: up.r2_key, thumb_key: thumbKey });
      // 本机文件留一份作显示缓存没必要：服务端有了就删
      await pendingQueue().delete(id);
      setState(id, null);
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return;
      const block = this.blocked();
      setState(id, { phase: block ?? 'failed', loaded: 0, total: states.get(id)?.total ?? 0, error: e instanceof Error ? e.message : String(e) });
    } finally {
      this.running.delete(id);
      this.pump();
    }
  }
}

let uploader: Uploader | null = null;

export function getUploader(): Uploader | null {
  return uploader;
}

/** StoreProvider 打开 Store 后调用：接着传队列里的，联网 / 登录后自动重试。 */
export function installUploader(store: Store, deps?: UploaderDeps): () => void {
  const u = new Uploader(store, deps);
  uploader = u;
  void u.resume();
  const kick = () => u.kick();
  window.addEventListener('online', kick);
  const unsub = subscribeAccount(kick);
  return () => {
    window.removeEventListener('online', kick);
    unsub();
    if (uploader === u) uploader = null;
  };
}

// ───────────── 添加 ─────────────

export const THUMB_SIDE = 480;

/** 图片：原图宽高 + 一张小缩略图（解不开就都没有，照样当附件存）。 */
export async function imageInfo(file: Blob): Promise<{ width: number | null; height: number | null; thumb: Blob | null }> {
  if (!canThumbnail(file.type) || typeof createImageBitmap !== 'function') return { width: null, height: null, thumb: null };
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return { width: null, height: null, thumb: null };
  }
  try {
    const { width, height } = bmp;
    const k = Math.min(1, THUMB_SIDE / Math.max(width, height));
    const w = Math.max(1, Math.round(width * k));
    const h = Math.max(1, Math.round(height * k));
    const canvas: HTMLCanvasElement | OffscreenCanvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) return { width, height, thumb: null };
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, w, h);
    const enc = (mime: string) =>
      'convertToBlob' in canvas ? canvas.convertToBlob({ type: mime, quality: 0.82 }).catch(() => null) : new Promise<Blob | null>((r) => (canvas as HTMLCanvasElement).toBlob(r, mime, 0.82));
    let thumb = await enc('image/webp');
    if (!thumb || thumb.type !== 'image/webp') thumb = await enc('image/jpeg');
    return { width, height, thumb: thumb && thumb.size > 0 ? thumb : null };
  } finally {
    bmp.close();
  }
}

export interface AddResult {
  added: Attachment[];
  /** 太大没加的文件名。 */
  tooBig: string[];
}

/** 加附件：建行、文件进本机队列、开始传。日记先确保那天有一行（ensureJournal）。 */
export async function addAttachments(store: Store, owner: { type: AttachmentOwnerType; id: string; date?: string }, files: readonly File[]): Promise<AddResult> {
  const added: Attachment[] = [];
  const tooBig: string[] = [];
  if (owner.type === 'journal' && owner.date) store.ensureJournal(owner.date);
  for (const f of files) {
    if (tooLarge(f.size)) {
      tooBig.push(f.name);
      continue;
    }
    const info = await imageInfo(f);
    const row = store.addAttachment({ owner_type: owner.type, owner_id: owner.id, file_name: f.name || tr('未命名文件'), mime: f.type, size: f.size, width: info.width, height: info.height });
    await pendingQueue().put({ id: row.id, file: f, thumb: info.thumb, added_at: Date.now() });
    added.push(row);
    getUploader()?.enqueue(row.id);
  }
  return { added, tooBig };
}

/** 导入进来的附件文件：放进本机队列等上传（图片重新生成缩略图）。 */
export async function enqueueImported(row: Attachment, blob: Blob): Promise<void> {
  const info = await imageInfo(blob);
  await pendingQueue().put({ id: row.id, file: blob, thumb: info.thumb, added_at: Date.now() });
  getUploader()?.enqueue(row.id);
}

/** 太大的提示。 */
export function tooBigMessage(names: readonly string[]): string {
  return names.length === 1
    ? tr('「{name}」超过 {max}，没有添加', { name: names[0]!, max: formatFileSize(MAX_ATTACHMENT_BYTES) })
    : tr('{n} 个文件超过 {max}，没有添加', { n: names.length, max: formatFileSize(MAX_ATTACHMENT_BYTES) });
}

// ───────────── 显示与下载 ─────────────

export const fileUrl = (key: string, opts: { name?: string; download?: boolean } = {}) => {
  const q = new URLSearchParams();
  if (opts.download) q.set('dl', '1');
  if (opts.name) q.set('name', opts.name);
  const s = q.toString();
  return `${API_BASE}/api/files/${key}${s ? `?${s}` : ''}`;
};

const blobUrls = new Map<string, Promise<string | null>>();

/** 一个 key 的可显示地址：Web 端直接用接口地址（同源带 cookie）；原生端带 Bearer 取回成 blob: 地址（缓存）。 */
export function remoteUrl(key: string): Promise<string | null> {
  if (!isTauri()) return Promise.resolve(fileUrl(key));
  let p = blobUrls.get(key);
  if (!p) {
    p = fetch(fileUrl(key), authInit())
      .then(async (r) => (r.ok ? URL.createObjectURL(await r.blob()) : null))
      .catch(() => null);
    blobUrls.set(key, p);
    void p.then((u) => u === null && blobUrls.delete(key));
  }
  return p;
}

/**
 * 附件的显示地址：本机队列里有（还没传完 / 刚加的）用本机文件；传好了用 R2。
 * which = thumb：有缩略图用缩略图，没有用原图。null = 还没有（在另一台设备上、取不到）。
 */
export function useAttachmentUrl(a: Attachment, which: 'thumb' | 'full'): string | null | undefined {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  const key = which === 'thumb' ? (a.thumb_key ?? a.r2_key) : a.r2_key;
  useEffect(() => {
    let alive = true;
    let local: string | null = null;
    (async () => {
      const p = await pendingQueue().get(a.id);
      if (!alive) return;
      if (p) {
        local = URL.createObjectURL(which === 'thumb' && p.thumb ? p.thumb : p.file);
        setUrl(local);
        return;
      }
      if (which === 'full') {
        const cached = await attachmentCache().get(a);
        if (!alive) return;
        if (cached) {
          local = URL.createObjectURL(cached);
          setUrl(local);
          return;
        }
      }
      if (!key) return setUrl(null);
      const u = await remoteUrl(key);
      if (alive) setUrl(u);
    })().catch(() => alive && setUrl(null));
    return () => {
      alive = false;
      if (local) URL.revokeObjectURL(local);
    };
  }, [a.id, key, which, which === 'full' && attachmentCache().record(a)?.cached_at]);
  return url;
}

/** 从 R2 取回原文件（不看本机）；取不到 null。 */
export async function remoteBytes(a: Attachment): Promise<Blob | null> {
  if (!a.r2_key) return null;
  try {
    const r = await fetch(fileUrl(a.r2_key), authInit());
    if (r.status === 404) forgetProbe(a.r2_key);
    return r.ok ? await r.blob() : null;
  } catch {
    return null;
  }
}

/** 文件内容（导出、原生端下载用）：本机队列里的、本机缓存的，或从 R2 取回；取不到 null。 */
export async function attachmentBytes(a: Attachment): Promise<Blob | null> {
  const p = await pendingQueue().get(a.id);
  if (p) return p.file;
  const cached = await attachmentCache().get(a);
  if (cached) return cached;
  if (!a.r2_key) return null;
  try {
    const r = await fetch(fileUrl(a.r2_key), authInit());
    return r.ok ? await r.blob() : null;
  } catch {
    return null;
  }
}

function anchorDownload(href: string, name: string) {
  const el = document.createElement('a');
  el.href = href;
  el.download = name;
  el.rel = 'noopener';
  document.body.appendChild(el);
  el.click();
  el.remove();
}

/** reason：missing = 还没传上来；gone = 云端的文件清掉了（attachment-gone.ts）；offline / failed / cancelled。 */
export type DownloadResult = { ok: true; path?: string; folder?: 'downloads' | 'chosen' } | { ok: false; reason: 'missing' | 'gone' | 'failed' | 'offline' | 'cancelled'; error?: string };

/** 缓存：取回原文件存进本机（24 小时后自动清掉）。 */
export function cacheAttachment(a: Attachment): Promise<boolean> {
  return attachmentCache().cache(a, () => remoteBytes(a));
}

/** 删除缓存：只删本机副本。 */
export function uncacheAttachment(a: Attachment): Promise<void> {
  return attachmentCache().remove(a.id);
}

const isMobileOs = () => typeof navigator !== 'undefined' && /android|iphone|ipad|ipod/i.test(navigator.userAgent);

/**
 * 下载（保留原文件名）。先用本机的：上传队列里的、缓存着的；都没有再从网上取，离线就不行（reason: offline）。
 * Web：本机的用 blob: 地址，网上的直接让浏览器下（带 cookie，服务端给 Content-Disposition）。
 * Tauri 桌面：弹系统保存框（默认原文件名），缓存着的从缓存目录拷过去（att_cache_copy），否则取回内容写过去（save_to_path）；取消返回 cancelled。
 * Tauri 手机：存进「下载」文件夹（save_download），返回路径。
 */
export async function downloadAttachment(a: Attachment): Promise<DownloadResult> {
  const pending = await pendingQueue().get(a.id);
  const cache = attachmentCache();
  const cached = !pending && cache.record(a) ? await cache.get(a) : null;
  const local = pending?.file ?? cached;
  if (!local) {
    if (!a.r2_key) return { ok: false, reason: 'missing' };
    if (!isOnline()) return { ok: false, reason: 'offline' };
    // 云端清掉了就别让浏览器去下一个「404 未找到」
    if ((await probeKey(a.r2_key)) === 'missing') return { ok: false, reason: 'gone' };
  }
  if (!isTauri()) {
    if (local) {
      const u = URL.createObjectURL(local);
      anchorDownload(u, a.file_name);
      setTimeout(() => URL.revokeObjectURL(u), 60_000);
      return { ok: true };
    }
    anchorDownload(fileUrl(a.r2_key!, { download: true, name: a.file_name }), a.file_name);
    return { ok: true };
  }
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    if (!isMobileOs()) {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const dest = await save({ defaultPath: a.file_name, title: tr('保存附件') });
      if (!dest) return { ok: false, reason: 'cancelled' };
      if (cached) {
        await invoke('att_cache_copy', { id: a.id, dest });
        return { ok: true, path: dest, folder: 'chosen' };
      }
      const blob = local ?? (await remoteBytes(a));
      if (!blob) return { ok: false, reason: 'failed' };
      await invoke('save_to_path', new Uint8Array(await blob.arrayBuffer()), { headers: { 'x-path': encodeURIComponent(dest) } });
      return { ok: true, path: dest, folder: 'chosen' };
    }
    const blob = local ?? (await remoteBytes(a));
    if (!blob) return { ok: false, reason: 'failed' };
    const path = await invoke<string>('save_download', new Uint8Array(await blob.arrayBuffer()), { headers: { 'x-file-name': encodeURIComponent(a.file_name) } });
    return { ok: true, path, folder: 'downloads' };
  } catch (e) {
    return { ok: false, reason: 'failed', error: String(e) };
  }
}

/** Tauri：在文件夹里显示刚下载的文件。 */
export async function revealDownloaded(path: string): Promise<void> {
  try {
    const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
    await revealItemInDir(path);
  } catch (e) {
    console.warn('打不开文件夹', e);
  }
}
