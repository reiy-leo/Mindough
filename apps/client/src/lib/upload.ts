/**
 * 图片：登录且在线时上传到 R2（POST /api/assets），行里只存地址；离线或没登录时退回 data: 地址存在行里
 * （照样能用，也会同步，只是大一些）。返回 asset 行的 id。
 */
import type { Store } from '@mindough/core';
import { API_BASE, authInit, getAccount } from './account';

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export interface UploadedAsset {
  url: string;
  r2_key: string;
  sha256: string;
  mime: string;
}

/** 上传到 R2；不行就返回 null（调用方退回 data: 地址）。 */
export async function uploadImage(file: File | Blob, fetcher: typeof fetch = (...a) => fetch(...a)): Promise<UploadedAsset | null> {
  if (getAccount().status !== 'in' || navigator.onLine === false) return null;
  try {
    const res = await fetcher(`${API_BASE}/api/assets`, authInit({ method: 'POST', headers: { 'content-type': file.type || 'application/octet-stream' }, body: file }));
    if (!res.ok) return null;
    return (await res.json()) as UploadedAsset;
  } catch {
    return null;
  }
}

/** 存一张图，返回 asset id。 */
export async function saveImageAsset(store: Store, file: File): Promise<string> {
  const up = await uploadImage(file);
  if (up) return store.insert('asset', { sha256: up.sha256, mime: up.mime, width: null, height: null, r2_key: up.r2_key, url: up.url }).id;
  const data = await readFileAsDataUrl(file);
  return store.insert('asset', { sha256: '', mime: file.type, width: null, height: null, r2_key: null, url: data }).id;
}
