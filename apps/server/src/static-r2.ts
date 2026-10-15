/**
 * 从 R2 读 Web 端静态文件（apps/client/dist 上传到 mindough-web 桶）。
 * 用于 API Token 部署：Hark 的 token 网关下 wrangler assets 上传会 401 未授权，所以改走 R2。
 * 带上 COOP / COEP（OPFS 版 SQLite 需要跨源隔离）。
 */
export interface R2Like {
  get(key: string): Promise<{ body: ReadableStream; httpEtag: string } | null>;
}

const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  wasm: 'application/wasm',
  svg: 'image/svg+xml',
  png: 'image/png',
  ico: 'image/x-icon',
  webp: 'image/webp',
  txt: 'text/plain; charset=utf-8',
  webmanifest: 'application/manifest+json',
};

export function contentType(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  return TYPES[ext] ?? 'application/octet-stream';
}

export async function serveFromR2(request: Request, bucket: R2Like): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('405 方法不允许', { status: 405 });
  }
  const { pathname } = new URL(request.url);
  let key = decodeURIComponent(pathname.replace(/^\/+/, ''));
  if (key === '' || key.endsWith('/')) key += 'index.html';

  let obj = key.startsWith('_') ? null : await bucket.get(key);
  // 单页应用：不是静态资源的路径都回 index.html
  if (!obj && !key.startsWith('assets/')) {
    key = 'index.html';
    obj = await bucket.get(key);
  }
  if (!obj) return new Response('404 未找到', { status: 404 });

  const headers = new Headers({
    'content-type': contentType(key),
    etag: obj.httpEtag,
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-embedder-policy': 'credentialless',
    'cache-control': key.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  return new Response(request.method === 'HEAD' ? null : obj.body, { headers });
}
