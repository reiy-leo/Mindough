/**
 * 直接连滴答清单：个人 API 令牌存在这台设备上（localStorage，不进同步表、不上传），请求经 Worker 代理 /api/dida/*
 * （浏览器不能跨域直接调 api.dida365.com；Tauri 也走同一个代理）。令牌放在 `x-dida-token` 头里，Authorization 仍是 Mindough 的登录。
 */
import { DidaApiError, type DidaCall } from '@mindough/core/dida';
import { API_BASE, authInit } from './account';
import { tr } from './i18n';

const KEY = 'mindough:dida-token';

export function savedDidaToken(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveDidaToken(token: string): void {
  try {
    localStorage.setItem(KEY, token.trim());
  } catch {
    /* 存不了就下次再填 */
  }
}

export function forgetDidaToken(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 没有就算了 */
  }
}

/** 一个 DidaCall：经 Worker 代理调 Open API。401 分两种：Mindough 没登录（没有 upstream_status）和令牌不对（upstream_status 401）。 */
export function didaCall(token: string, signal?: AbortSignal, fetcher: typeof fetch = (...a) => fetch(...a)): DidaCall {
  return async (method, path, body) => {
    const init = authInit({
      method,
      headers: { 'x-dida-token': token.trim(), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(signal ? { signal } : {}),
    });
    let res: Response;
    try {
      res = await fetcher(`${API_BASE}/api/dida/${path}`, init);
    } catch (e) {
      if (signal?.aborted) throw e;
      throw new DidaApiError(tr('没连上网络'), 0);
    }
    const data = (await res.json().catch(() => null)) as { error?: string; upstream_status?: number } | null;
    if (res.ok) return data;
    if (res.status === 401 && !data?.upstream_status) throw new DidaApiError(tr('先登录 Mindough（401 未登录）'), -401);
    throw new DidaApiError(data?.error ?? tr('{status} 出错了', { status: res.status }), data?.upstream_status ?? res.status);
  };
}
