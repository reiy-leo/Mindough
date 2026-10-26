import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '@mindough/core';
import { tr } from './i18n';
import { cloudStorageName, getCloudStorage, loadCloudStorage, parseCloudStorage, setCloudStorage } from './cloud';

afterEach(() => setLocale('zh'));

describe('云端存在哪（设置 → 账户，只读）', () => {
  it('只认 turso / d1', () => {
    expect(parseCloudStorage('turso')).toBe('turso');
    expect(parseCloudStorage('d1')).toBe('d1');
    expect(parseCloudStorage(null)).toBeNull();
    expect(parseCloudStorage('mysql')).toBeNull();
  });

  it('名字中英文：Turso（东京）/ Cloudflare D1 / 不知道时「云端数据库」', () => {
    setLocale('zh');
    expect([cloudStorageName('turso'), cloudStorageName('d1'), cloudStorageName(null)]).toEqual(['Turso（东京）', 'Cloudflare D1', '云端数据库']);
    setLocale('en');
    expect([cloudStorageName('turso'), cloudStorageName('d1'), cloudStorageName(null)]).toEqual(['Turso (Tokyo)', 'Cloudflare D1', 'Cloud database']);
  });

  it('数据流向说明两种语言都有，库名填进去', () => {
    const key =
      '改动先存在这台设备上。用 Google 登录后，Worker（app.mindough.rei8t.dev）核对是你本人，把改动存进 {storage}；你的其他设备也经 Worker 同步。图片存在 Cloudflare R2。';
    setLocale('zh');
    expect(tr(key, { storage: cloudStorageName('turso') })).toContain('核对是你本人，把改动存进 Turso（东京）；你的其他设备也经 Worker 同步');
    setLocale('en');
    const en = tr(key, { storage: cloudStorageName('d1') });
    expect(en).toContain('checks it’s really you, then saves them to Cloudflare D1. Your other devices sync through the Worker too.');
    expect(en).not.toMatch(/[\u4e00-\u9fff]/);
    expect(tr('数据存在：这台设备 + {storage}', { storage: 'Cloudflare D1' })).toBe('Stored on this device + Cloudflare D1');
    for (const k of ['这台设备', '先存在这里', '核对是你本人，转发改动', '保存一份', '其他设备', '也经 Worker 同步', '登录后数据怎么走', '数据流向']) expect(tr(k)).not.toMatch(/[\u4e00-\u9fff]/);
  });

  it('从 /api/health 读后端；同步凭据里的 storage 也会更新；离线 / 不认识的值不改', async () => {
    const health = (storage: unknown) => (async () => new Response(JSON.stringify({ ok: true, storage }))) as unknown as typeof fetch;
    expect(getCloudStorage()).toBeNull();
    await loadCloudStorage(health('d1'));
    expect(getCloudStorage()).toBe('d1');
    setCloudStorage('nope');
    await loadCloudStorage(health(null));
    await loadCloudStorage((async () => {
      throw new TypeError('offline');
    }) as unknown as typeof fetch);
    expect(getCloudStorage()).toBe('d1');
    setCloudStorage('turso');
    expect(getCloudStorage()).toBe('turso');
  });
});
