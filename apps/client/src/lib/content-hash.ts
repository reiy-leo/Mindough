/**
 * 上传前查重（Rei 2026-10-29：「不应该在本地先算好hash，去云端查看是否重复，不重复再上传么」）：
 * 本机先算内容的 SHA-256，问服务器这个人有没有这份内容（GET /api/assets/check/<sha>、/api/files/check/<sha>），
 * 有就直接用服务器给的 key，不再传；没有（404 未找到）或者问不通，照常上传。
 */
import { API_BASE, authInit } from './account';

export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 问服务器有没有这份内容。有 → 返回服务器给的信息；没有或问不通 → null（调用方照常上传）。 */
export async function checkExisting<T>(kind: 'assets' | 'files', blob: Blob, fetcher: typeof fetch = (...a) => fetch(...a), signal?: AbortSignal): Promise<T | null> {
  try {
    const sha = await sha256Hex(blob);
    const res = await fetcher(`${API_BASE}/api/${kind}/check/${sha}`, authInit({ method: 'GET', signal }));
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') throw err;
    return null;
  }
}
