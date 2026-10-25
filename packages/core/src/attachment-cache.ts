/**
 * 附件的本机缓存（Rei 2026-10-25：「附件可以下载、删除、缓存、删除缓存。缓存的附件24小时后清除本地缓存。」）
 * 纯逻辑：缓存记录（只存本机、不同步）、24 小时到期（从缓存那一刻起算，不看最后一次打开）、
 * 每个附件能做哪些操作（下载 / 缓存 / 删除缓存 / 重命名 / 删除）、点一下做什么（图片开灯箱，其他文件不预览）。
 * 文件本身存在哪由客户端决定（Web：Cache Storage；Tauri：app 缓存目录）。
 */
import { isViewableImage } from './attachments';
import type { Attachment } from './types';

/** 缓存的附件留多久：24 小时。 */
export const ATTACHMENT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** 运行中多久查一次到期：1 小时。 */
export const ATTACHMENT_CACHE_SWEEP_MS = 60 * 60 * 1000;

/** 一条缓存记录（只在这台设备上）。key = 缓存时附件的 r2_key：附件换了文件（key 变了）就不算缓存着。 */
export interface AttachmentCacheRecord {
  id: string;
  key: string;
  size: number;
  /** 缓存那一刻（毫秒时间戳）。 */
  cached_at: number;
}

export type AttachmentCacheIndex = Record<string, AttachmentCacheRecord>;

const isRecord = (v: unknown): v is AttachmentCacheRecord => {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return typeof r.id === 'string' && typeof r.key === 'string' && typeof r.size === 'number' && typeof r.cached_at === 'number' && Number.isFinite(r.cached_at);
};

/** 读本机存的缓存记录（坏的、缺字段的丢掉）。 */
export function parseCacheIndex(raw: string | null | undefined): AttachmentCacheIndex {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: AttachmentCacheIndex = {};
    for (const [id, r] of Object.entries(v as Record<string, unknown>)) if (isRecord(r) && r.id === id) out[id] = r;
    return out;
  } catch {
    return {};
  }
}

/** 什么时候到期（毫秒时间戳）。 */
export function cacheExpiresAt(r: Pick<AttachmentCacheRecord, 'cached_at'>, ttl = ATTACHMENT_CACHE_TTL_MS): number {
  return r.cached_at + ttl;
}

/** 到期了吗（到点那一刻就算到期）。缓存时间在将来（时钟被往回拨）也当到期，免得永远不清。 */
export function isCacheExpired(r: Pick<AttachmentCacheRecord, 'cached_at'>, now: number, ttl = ATTACHMENT_CACHE_TTL_MS): boolean {
  return now >= cacheExpiresAt(r, ttl) || r.cached_at > now + 60_000;
}

/** 这条记录现在能用吗：没到期，且附件还是那个文件。 */
export function isCacheFresh(r: AttachmentCacheRecord | undefined, now: number, key?: string | null, ttl = ATTACHMENT_CACHE_TTL_MS): r is AttachmentCacheRecord {
  if (!r || isCacheExpired(r, now, ttl)) return false;
  return key == null || key === r.key;
}

/**
 * 清理：哪些要删（到期的、附件已删除的、换了文件的），剩下哪些。
 * keyOf(id)：附件现在的 r2_key；undefined = 这一行没了或删掉了（墓碑）。不传就只看到期。
 */
export function sweepCacheIndex(
  index: AttachmentCacheIndex,
  now: number,
  keyOf?: (id: string) => string | null | undefined,
  ttl = ATTACHMENT_CACHE_TTL_MS,
): { keep: AttachmentCacheIndex; expired: string[] } {
  const keep: AttachmentCacheIndex = {};
  const expired: string[] = [];
  for (const [id, r] of Object.entries(index)) {
    let drop = isCacheExpired(r, now, ttl);
    if (!drop && keyOf) {
      const k = keyOf(id);
      drop = k === undefined || (k !== null && k !== r.key);
    }
    if (drop) expired.push(id);
    else keep[id] = r;
  }
  return { keep, expired };
}

/** 下一次最早到期的时间（没有就 null），可以用来精确排下一次清理。 */
export function nextCacheExpiry(index: AttachmentCacheIndex, ttl = ATTACHMENT_CACHE_TTL_MS): number | null {
  let min: number | null = null;
  for (const r of Object.values(index)) {
    const t = cacheExpiresAt(r, ttl);
    if (min === null || t < min) min = t;
  }
  return min;
}

/** 还剩多少整小时（向上取整，至少 1；到期了 0）。界面写「23 小时后清除」。 */
export function cacheHoursLeft(r: Pick<AttachmentCacheRecord, 'cached_at'>, now: number, ttl = ATTACHMENT_CACHE_TTL_MS): number {
  const left = cacheExpiresAt(r, ttl) - now;
  if (left <= 0) return 0;
  return Math.max(1, Math.ceil(left / 3_600_000));
}

/** 点一下附件做什么：图片开灯箱看大图；其他文件（PDF、视频、音频、文档…）一律不预览，点一下就是下载。 */
export type AttachmentPressAction = 'lightbox' | 'download';
export function attachmentPressAction(a: Pick<Attachment, 'file_name' | 'mime' | 'thumb_key'>): AttachmentPressAction {
  return isViewableImage(a) ? 'lightbox' : 'download';
}

export interface AttachmentActionContext {
  /** 本机缓存着（没到期、还是那个文件）。 */
  cached: boolean;
  /** 现在连得上服务器。 */
  online: boolean;
  /** 还在本机上传队列里（文件就在本机，还没传完）。 */
  pending: boolean;
}

export interface AttachmentActionState {
  /** 能下载：缓存着 / 在本机队列里 / 传上去了且联网。 */
  download: boolean;
  /** 下载为什么不行：offline = 离线又没缓存；missing = 文件还在另一台设备上。 */
  downloadBlocked: 'offline' | 'missing' | null;
  /** 菜单里显示「缓存」（传上去了、还没缓存）还是「删除缓存」（缓存着）；都不显示 = null（还没传上去，文件本来就在本机或在别的设备上）。 */
  cacheItem: 'cache' | 'remove-cache' | null;
  /** 「缓存」能不能点（离线时不能）。 */
  cacheEnabled: boolean;
}

/** 每个附件的操作能不能用（重命名、删除一直能用）。 */
export function attachmentActionState(a: Pick<Attachment, 'r2_key'>, ctx: AttachmentActionContext): AttachmentActionState {
  const uploaded = !!a.r2_key;
  const local = ctx.cached || ctx.pending;
  const download = local || (uploaded && ctx.online);
  const downloadBlocked = download ? null : uploaded ? 'offline' : 'missing';
  const cacheItem = ctx.cached ? 'remove-cache' : uploaded && !ctx.pending ? 'cache' : null;
  return { download, downloadBlocked, cacheItem, cacheEnabled: cacheItem === 'remove-cache' || (cacheItem === 'cache' && ctx.online) };
}
