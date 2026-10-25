/**
 * 云端文件清掉以后（Rei 2026-10-25：附件删了、没别的地方用，Worker 就删 R2 里的文件，见 apps/server/src/purge.ts）。
 *
 * 撤销删除、或者别的设备拿到恢复的附件行时，文件可能已经不在云端了（HEAD /api/files/<key> 回 404 未找到）：
 * - 本机还有（上传队列、本机缓存）：重新传上去。同一个人的同一份内容 key 不变，行不用改；缩略图本机重新生成，key 变了才改行。
 * - 本机也没有：标成「文件已删除」，缩略图位置放占位图标，下载、缓存都不能点。
 *
 * 只在显示附件时查（每个文件 10 分钟内只问一次），用 HEAD，不下载内容。离线、没登录不查。
 */
import { useSyncExternalStore } from 'react';
import type { Attachment, Store } from '@mindough/core';
import { authInit, getAccount } from './account';
import { attachmentCache } from './attachment-cache';
import { pendingQueue } from './attachments-queue';

export type ProbeResult = 'ok' | 'missing' | 'unknown';
export type GoneState = 'gone' | 'restoring';
export type CheckResult = 'ok' | 'restored' | 'gone' | 'unknown' | 'skipped';

/** 一次上传：传一个文件，返回它的 key（lib/attachments.ts 的 xhrUpload 包一层）。 */
export type PutFn = (blob: Blob) => Promise<{ r2_key: string }>;

export interface GoneDeps {
  /** 查文件还在不在：HEAD 的状态码；连不上抛错。 */
  head?: (key: string) => Promise<number>;
  put?: PutFn;
  /** 从原图重新生成缩略图（lib/attachments.ts 的 imageInfo）。 */
  thumb?: (blob: Blob) => Promise<Blob | null>;
  /** 现在能查吗（联网且登录）。 */
  canCheck?: () => boolean;
  now?: () => number;
}

export const PROBE_TTL_MS = 10 * 60_000;

const probes = new Map<string, { at: number; result: Promise<ProbeResult> }>();
const goneById = new Map<string, { key: string; state: GoneState }>();
const inflight = new Map<string, Promise<CheckResult>>();
const listeners = new Set<() => void>();
let version = 0;
let deps: Required<GoneDeps> | null = null;

const emit = () => {
  version++;
  for (const f of listeners) f();
};

const defaultHead = async (key: string) => {
  const { fileUrl } = await import('./attachments');
  const r = await fetch(fileUrl(key), authInit({ method: 'HEAD' }));
  return r.status;
};

const defaultPut: PutFn = async (blob) => {
  const { xhrUpload } = await import('./attachments');
  return xhrUpload(blob, () => {}, new AbortController().signal);
};

const defaultThumb = async (blob: Blob) => {
  const { imageInfo } = await import('./attachments');
  return (await imageInfo(blob)).thumb;
};

const defaultCanCheck = () => (typeof navigator === 'undefined' || navigator.onLine !== false) && getAccount().status === 'in';

function d(): Required<GoneDeps> {
  return (deps ??= { head: defaultHead, put: defaultPut, thumb: defaultThumb, canCheck: defaultCanCheck, now: Date.now });
}

/** 测试用：换掉网络和时钟；null = 恢复默认并清掉所有记录。 */
export function setGoneDeps(x: GoneDeps | null) {
  deps = x ? { head: x.head ?? defaultHead, put: x.put ?? defaultPut, thumb: x.thumb ?? defaultThumb, canCheck: x.canCheck ?? (() => true), now: x.now ?? Date.now } : null;
  probes.clear();
  goneById.clear();
  inflight.clear();
  emit();
}

/** 这个 key 在云端还在吗（10 分钟内的结果直接用；查不出来的不记）。 */
export function probeKey(key: string, fresh = false): Promise<ProbeResult> {
  const now = d().now();
  const hit = probes.get(key);
  if (!fresh && hit && now - hit.at < PROBE_TTL_MS) return hit.result;
  const result = d()
    .head(key)
    .then((s): ProbeResult => (s >= 200 && s < 300 ? 'ok' : s === 404 ? 'missing' : 'unknown'))
    .catch((): ProbeResult => 'unknown');
  probes.set(key, { at: now, result });
  void result.then((r) => r === 'unknown' && probes.get(key)?.result === result && probes.delete(key));
  return result;
}

/** 别处取文件拿到 404 未找到时调：忘掉之前「还在」的结论，下次重新查。 */
export function forgetProbe(key: string) {
  probes.delete(key);
}

function setGone(id: string, v: { key: string; state: GoneState } | null) {
  if (v) goneById.set(id, v);
  else goneById.delete(id);
  emit();
}

/** 这个附件现在的状态：gone = 云端没了、本机也没有；restoring = 正在从本机补传；null = 正常。 */
export function goneState(a: Pick<Attachment, 'id' | 'r2_key'>): GoneState | null {
  const g = goneById.get(a.id);
  return g && g.key === a.r2_key ? g.state : null;
}

export function useGoneState(a: Pick<Attachment, 'id' | 'r2_key'>): GoneState | null {
  useGoneVersion();
  return goneState(a);
}

export function useGoneVersion(): number {
  return useSyncExternalStore(
    (f) => (listeners.add(f), () => listeners.delete(f)),
    () => version,
  );
}

/** 本机的原文件：上传队列里的，或者本机缓存的。 */
async function localCopy(a: Attachment): Promise<Blob | null> {
  const p = await pendingQueue()
    .get(a.id)
    .catch(() => undefined);
  if (p) return p.file;
  return attachmentCache()
    .get(a)
    .catch(() => null);
}

/**
 * 查一个附件的文件在不在云端；不在就从本机补传，补不了标「文件已删除」。
 * fresh = 不用 10 分钟内的结论（撤销删除、拿到 404 时）。
 */
export function checkAttachment(store: Pick<Store, 'get' | 'setAttachmentFile'>, a: Attachment, fresh = false): Promise<CheckResult> {
  if (!a.r2_key || a.deleted) return Promise.resolve('skipped');
  if (!d().canCheck()) return Promise.resolve('skipped');
  const id = `${a.id}|${a.r2_key}`;
  let p = inflight.get(id);
  if (!p) {
    p = run(store, a, fresh).finally(() => inflight.delete(id));
    inflight.set(id, p);
  }
  return p;
}

async function run(store: Pick<Store, 'get' | 'setAttachmentFile'>, a: Attachment, fresh: boolean): Promise<CheckResult> {
  const key = a.r2_key!;
  const main = await probeKey(key, fresh);
  if (main === 'unknown') return 'unknown';
  const thumbKey = a.thumb_key && a.thumb_key !== key ? a.thumb_key : null;
  const thumb = thumbKey ? await probeKey(thumbKey, fresh) : 'ok';
  if (main === 'ok' && thumb !== 'missing') {
    if (goneState(a)) setGone(a.id, null);
    return 'ok';
  }
  const local = await localCopy(a);
  if (!local) {
    if (main === 'missing') {
      setGone(a.id, { key, state: 'gone' });
      return 'gone';
    }
    // 原文件还在、只是缩略图没了：网格退回用原图（key 不变，不动行）
    return 'ok';
  }
  setGone(a.id, { key, state: 'restoring' });
  try {
    let newKey = key;
    if (main === 'missing') {
      newKey = (await d().put(local)).r2_key;
      probes.set(newKey, { at: d().now(), result: Promise.resolve('ok') });
    }
    let newThumb = a.thumb_key;
    if (thumbKey && thumb === 'missing') {
      const t = await d().thumb(local);
      newThumb = t ? (await d().put(t)).r2_key : null;
      if (newThumb) probes.set(newThumb, { at: d().now(), result: Promise.resolve('ok') });
    }
    const cur = store.get('attachment', a.id);
    // 同内容 key 不变，一般不用改行；万一变了（比如缩略图重新编码）才写，别的设备同步后跟着用新的
    if (cur && (newKey !== cur.r2_key || newThumb !== cur.thumb_key)) store.setAttachmentFile(a.id, { r2_key: newKey, thumb_key: newThumb });
    setGone(a.id, null);
    return 'restored';
  } catch (e) {
    console.warn('补传附件失败', e);
    setGone(a.id, main === 'missing' ? { key, state: 'gone' } : null);
    return main === 'missing' ? 'gone' : 'unknown';
  }
}
