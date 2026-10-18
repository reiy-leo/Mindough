/**
 * 离线或没登录时存的图片是 data: 地址（整张图塞在 asset 行里，旧图还没统一宽高，常常超过云端单行 2 MB）。
 * 同步前把它们传到 R2，行里只留地址。传不上的原样留着，下次再试。
 */
import type { Store } from '@mindough/core';
import { uploadImage } from './upload';

export async function migrateDataAssets(store: Store, fetcher: typeof fetch = (...a) => fetch(...a)): Promise<number> {
  let n = 0;
  for (const a of store.list('asset')) {
    if (!a.url || !a.url.startsWith('data:')) continue;
    let blob: Blob;
    try {
      blob = await (await fetch(a.url)).blob();
    } catch {
      continue;
    }
    const up = await uploadImage(blob, fetcher);
    if (!up) continue;
    store.update('asset', a.id, { url: up.url, r2_key: up.r2_key, sha256: up.sha256, mime: up.mime });
    n++;
  }
  return n;
}
