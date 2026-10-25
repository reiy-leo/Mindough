import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_CACHE_TTL_MS,
  attachmentActionState,
  attachmentPressAction,
  cacheExpiresAt,
  cacheHoursLeft,
  isCacheExpired,
  isCacheFresh,
  nextCacheExpiry,
  parseCacheIndex,
  sweepCacheIndex,
  type AttachmentCacheIndex,
} from '../src/attachment-cache';

const H = 3_600_000;
const T0 = Date.UTC(2026, 9, 25, 0, 0, 0);
const rec = (id: string, at: number, key = `k-${id}`) => ({ id, key, size: 100, cached_at: at });

describe('缓存记录', () => {
  it('24 小时从缓存那一刻起算，到点就算到期', () => {
    const r = rec('a', T0);
    expect(ATTACHMENT_CACHE_TTL_MS).toBe(24 * H);
    expect(cacheExpiresAt(r)).toBe(T0 + 24 * H);
    expect(isCacheExpired(r, T0 + 24 * H - 1)).toBe(false);
    expect(isCacheExpired(r, T0 + 24 * H)).toBe(true);
  });

  it('缓存时间在将来（时钟往回拨）当到期', () => {
    expect(isCacheExpired(rec('a', T0 + 5 * H), T0)).toBe(true);
    expect(isCacheExpired(rec('a', T0 + 30_000), T0)).toBe(false);
  });

  it('换了文件（key 不同）不算缓存着', () => {
    const r = rec('a', T0, 'k1');
    expect(isCacheFresh(r, T0 + H, 'k1')).toBe(true);
    expect(isCacheFresh(r, T0 + H, 'k2')).toBe(false);
    expect(isCacheFresh(r, T0 + H)).toBe(true);
    expect(isCacheFresh(undefined, T0)).toBe(false);
    expect(isCacheFresh(r, T0 + 25 * H, 'k1')).toBe(false);
  });

  it('读本机记录：坏 JSON、缺字段、id 不一致的丢掉', () => {
    expect(parseCacheIndex(null)).toEqual({});
    expect(parseCacheIndex('{oops')).toEqual({});
    expect(parseCacheIndex('[]')).toEqual({});
    const raw = JSON.stringify({ a: rec('a', T0), b: { id: 'b', key: 'x' }, c: rec('x', T0) });
    expect(Object.keys(parseCacheIndex(raw))).toEqual(['a']);
  });

  it('还剩几小时：向上取整、至少 1、到期 0', () => {
    const r = rec('a', T0);
    expect(cacheHoursLeft(r, T0)).toBe(24);
    expect(cacheHoursLeft(r, T0 + 30 * 60_000)).toBe(24);
    expect(cacheHoursLeft(r, T0 + 23 * H + 59 * 60_000)).toBe(1);
    expect(cacheHoursLeft(r, T0 + 24 * H)).toBe(0);
  });
});

describe('过期清理（假时钟）', () => {
  const index: AttachmentCacheIndex = { a: rec('a', T0), b: rec('b', T0 + 10 * H), c: rec('c', T0 + 20 * H) };

  it('按时间推进逐个清掉', () => {
    let now = T0 + 23 * H;
    expect(sweepCacheIndex(index, now).expired).toEqual([]);
    now = T0 + 24 * H;
    let r = sweepCacheIndex(index, now);
    expect(r.expired).toEqual(['a']);
    expect(Object.keys(r.keep)).toEqual(['b', 'c']);
    now = T0 + 34 * H;
    r = sweepCacheIndex(r.keep, now);
    expect(r.expired).toEqual(['b']);
    now = T0 + 48 * H;
    r = sweepCacheIndex(r.keep, now);
    expect(r.expired).toEqual(['c']);
    expect(r.keep).toEqual({});
  });

  it('附件删掉了、换了文件的也清掉；还没传上来（key 空）的不动', () => {
    const keyOf = (id: string) => ({ a: undefined, b: 'other', c: null })[id];
    const r = sweepCacheIndex(index, T0 + 21 * H, keyOf);
    expect(r.expired.sort()).toEqual(['a', 'b']);
    expect(Object.keys(r.keep)).toEqual(['c']);
  });

  it('下一次最早到期', () => {
    expect(nextCacheExpiry({})).toBeNull();
    expect(nextCacheExpiry(index)).toBe(T0 + 24 * H);
  });
});

describe('图片 / 非图片', () => {
  it('图片开灯箱，其他文件不预览（点一下下载）', () => {
    expect(attachmentPressAction({ file_name: 'a.png', mime: 'image/png', thumb_key: null })).toBe('lightbox');
    expect(attachmentPressAction({ file_name: 'a.heic', mime: 'image/heic', thumb_key: 'k' })).toBe('lightbox');
    expect(attachmentPressAction({ file_name: 'a.svg', mime: 'image/svg+xml', thumb_key: null })).toBe('lightbox');
    expect(attachmentPressAction({ file_name: 'a.heic', mime: 'image/heic', thumb_key: null })).toBe('download');
    for (const [n, m] of [
      ['a.pdf', 'application/pdf'],
      ['a.mp4', 'video/mp4'],
      ['a.mp3', 'audio/mpeg'],
      ['a.docx', ''],
      ['a.tiff', 'image/tiff'],
    ] as const)
      expect(attachmentPressAction({ file_name: n, mime: m, thumb_key: null })).toBe('download');
  });
});

describe('操作能不能用', () => {
  const up = { r2_key: 'k' };
  it('联网、没缓存：能下载、能缓存', () => {
    expect(attachmentActionState(up, { cached: false, online: true, pending: false })).toEqual({ download: true, downloadBlocked: null, cacheItem: 'cache', cacheEnabled: true });
  });
  it('离线、没缓存：下载、缓存都不能', () => {
    expect(attachmentActionState(up, { cached: false, online: false, pending: false })).toEqual({ download: false, downloadBlocked: 'offline', cacheItem: 'cache', cacheEnabled: false });
  });
  it('离线、缓存着：能下载、能删除缓存', () => {
    expect(attachmentActionState(up, { cached: true, online: false, pending: false })).toEqual({ download: true, downloadBlocked: null, cacheItem: 'remove-cache', cacheEnabled: true });
  });
  it('还在本机队列：能下载、不显示缓存', () => {
    expect(attachmentActionState({ r2_key: null }, { cached: false, online: false, pending: true })).toEqual({ download: true, downloadBlocked: null, cacheItem: null, cacheEnabled: false });
  });
  it('在另一台设备上：下载不了', () => {
    expect(attachmentActionState({ r2_key: null }, { cached: false, online: true, pending: false }).downloadBlocked).toBe('missing');
  });
});
