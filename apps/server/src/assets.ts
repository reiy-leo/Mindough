/**
 * 图片（M2）：上传到 R2 桶 mindough-assets，行里只存地址。
 * - POST /api/assets           会话（cookie / Bearer）或同步凭据；body 是图片本身（content-type image/*，≤ 10 MB）
 *                              → { url, r2_key, sha256, mime, size }
 * - GET  /api/assets/<key>     公开读（key = 用户哈希 / 内容 SHA-256，猜不到），长缓存
 * 同一张图（同内容）只存一份。
 */
import { currentSession, type AuthEnv } from './auth';
import { verify } from './session';

export interface R2Object {
  body: ReadableStream;
  httpMetadata?: { contentType?: string };
  size: number;
}
export interface AssetBucket {
  get(key: string): Promise<R2Object | null>;
  head(key: string): Promise<unknown | null>;
  put(key: string, value: ArrayBuffer, opts?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
}

export interface AssetEnv extends AuthEnv {
  FILES?: AssetBucket;
}

export const MAX_ASSET_BYTES = 10 * 1024 * 1024;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** 请求者：会话（cookie / Bearer）或同步凭据，都要在白名单里；不是就返回 401 / 403 的响应。在线找资料（lookup）也用它。 */
export async function requestUser(req: Request, env: AssetEnv): Promise<string | Response> {
  const s = await currentSession(req, env);
  if (s.status === 200) return s.user.email.toLowerCase();
  if (s.status === 403) return json({ error: '403 无权限' }, 403);
  const bearer = (req.headers.get('authorization') ?? '').match(/^Bearer\s+(.+)$/i)?.[1];
  const claims = env.SESSION_SECRET ? await verify<{ k: string; email: string; exp: number }>(bearer, env.SESSION_SECRET) : null;
  if (claims?.k === 'sync' && typeof claims.email === 'string') return claims.email.toLowerCase();
  return json({ error: '401 未登录' }, 401);
}

export async function handleAssetUpload(req: Request, env: AssetEnv): Promise<Response> {
  const who = await requestUser(req, env);
  if (who instanceof Response) return who;
  if (!env.FILES) return json({ error: '503 服务不可用：图片存储还没配置' }, 503);
  const mime = (req.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (!/^image\/(png|jpeg|gif|webp|avif|svg\+xml|heic|heif)$/.test(mime)) return json({ error: '415 不支持的格式：只收图片' }, 415);
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_ASSET_BYTES) return json({ error: '413 内容太大：图片不能超过 10 MB' }, 413);
  const buf = await req.arrayBuffer();
  if (buf.byteLength === 0) return json({ error: '400 请求有误：空文件' }, 400);
  if (buf.byteLength > MAX_ASSET_BYTES) return json({ error: '413 内容太大：图片不能超过 10 MB' }, 413);
  return json(await storeAsset(env.FILES, who, buf, mime, new URL(req.url).origin));
}

export interface StoredAsset {
  url: string;
  r2_key: string;
  sha256: string;
  mime: string;
  size: number;
}

/** 存进 R2：key = 用户哈希 / 内容 SHA-256，同一张图只存一份。 */
export async function storeAsset(files: AssetBucket, who: string, buf: ArrayBuffer, mime: string, origin: string): Promise<StoredAsset> {
  const sha = hex(await crypto.subtle.digest('SHA-256', buf));
  const owner = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(who))).slice(0, 16);
  const key = `${owner}/${sha}`;
  if (!(await files.head(key))) await files.put(key, buf, { httpMetadata: { contentType: mime } });
  return { url: `${origin}/api/assets/${key}`, r2_key: key, sha256: sha, mime, size: buf.byteLength };
}

export async function handleAssetGet(key: string, env: AssetEnv): Promise<Response> {
  if (!/^[0-9a-f]{16}\/[0-9a-f]{64}$/.test(key)) return json({ error: '404 未找到' }, 404);
  if (!env.FILES) return json({ error: '503 服务不可用：图片存储还没配置' }, 503);
  const obj = await env.FILES.get(key);
  if (!obj) return json({ error: '404 未找到' }, 404);
  return new Response(obj.body, {
    headers: {
      'content-type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
      'cache-control': 'public, max-age=31536000, immutable',
      'cross-origin-resource-policy': 'cross-origin',
      'x-content-type-options': 'nosniff',
      // SVG 里的脚本不执行
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
