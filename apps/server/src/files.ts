/**
 * 附件文件（Rei 2026-10-17）：任务详情、日记里的附件原文件和图片缩略图，放 R2 桶 mindough-assets。
 * 和 /api/assets（资料图，公开读）不同：附件可能是私人的文件，读也要登录，而且只能读自己的。
 *
 * - POST /api/files                 会话（cookie / Bearer）或同步凭据；body 是文件本身（任何格式，≤ 50 MB）
 *                                   → { r2_key, sha256, mime, size }。同一个人的同一份内容只存一份。
 * - GET / HEAD /api/files/<key>[?name=…&dl=1]
 *                                   要登录，key 的前缀（用户哈希）得是自己的，不是一律 404 未找到。
 *                                   安全的图片格式 inline（缩略图、灯箱里显示）；其余、或带 dl=1，一律 attachment 下载，
 *                                   文件名用 ?name=（RFC 5987 编码）。都带 nosniff + CSP sandbox，HTML / SVG 里的脚本不会执行。
 *                                   HEAD 只回头（客户端用它查文件还在不在：404 未找到 = 已经清掉了）。
 * key = <用户哈希 16 位>/f/<内容 SHA-256>。没人用的文件会清掉，见 purge.ts。
 */
import type { AssetBucket, AssetEnv, R2Object } from './assets';
import { requestUser } from './assets';

/** 单个附件最大 50 MB（待 Rei 确认；客户端 core/attachments.ts 的 MAX_ATTACHMENT_BYTES 同一个数）。 */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const FILE_KEY_RE = /^([0-9a-f]{16})\/f\/([0-9a-f]{64})$/;

/** 能直接在页面里显示的图片（其余都当下载）。SVG 也算：CSP sandbox 让它里面的脚本不跑。 */
const INLINE = /^image\/(png|jpeg|gif|webp|avif|bmp|svg\+xml|x-icon|vnd\.microsoft\.icon)$/;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export const ownerHash = async (who: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(who.toLowerCase()))).slice(0, 16);

/** MIME 只留形状正常的（type/subtype），其余当 application/octet-stream。 */
export function cleanMime(raw: string | null): string {
  const m = (raw ?? '').split(';')[0]!.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/.test(m) ? m : 'application/octet-stream';
}

export async function handleFileUpload(req: Request, env: AssetEnv): Promise<Response> {
  const who = await requestUser(req, env);
  if (who instanceof Response) return who;
  if (!env.FILES) return json({ error: '503 服务不可用：文件存储还没配置' }, 503);
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_FILE_BYTES) return json({ error: '413 内容太大：附件不能超过 50 MB' }, 413);
  const buf = await req.arrayBuffer();
  if (buf.byteLength === 0) return json({ error: '400 请求有误：空文件' }, 400);
  if (buf.byteLength > MAX_FILE_BYTES) return json({ error: '413 内容太大：附件不能超过 50 MB' }, 413);
  const mime = cleanMime(req.headers.get('content-type'));
  return json(await storeFile(env.FILES, who, buf, mime));
}

export async function storeFile(files: AssetBucket, who: string, buf: ArrayBuffer, mime: string): Promise<{ r2_key: string; sha256: string; mime: string; size: number }> {
  const sha = hex(await crypto.subtle.digest('SHA-256', buf));
  const key = `${await ownerHash(who)}/f/${sha}`;
  // 同内容同一个 key。已经有了也重写一遍：刷新上传时间，免得刚被清理判成「旧文件」（purge.ts 的 FRESH_UPLOAD_MS），
  // 也让清理后从本机补传回来的文件 key 不变。
  await files.put(key, buf, { httpMetadata: { contentType: mime } });
  return { r2_key: key, sha256: sha, mime, size: buf.byteLength };
}

/** Content-Disposition：ASCII 兜底名 + RFC 5987 的 UTF-8 名。 */
export function contentDisposition(kind: 'inline' | 'attachment', name: string | null): string {
  if (!name) return kind;
  const clean = name.replace(/[\r\n"\\/]/g, '_').slice(0, 200);
  const ascii = clean.replace(/[^\x20-\x7e]/g, '_');
  const star = encodeURIComponent(clean).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${star}`;
}

export async function handleFileGet(req: Request, key: string, env: AssetEnv, url: URL): Promise<Response> {
  const m = FILE_KEY_RE.exec(key);
  if (!m) return json({ error: '404 未找到' }, 404);
  const who = await requestUser(req, env);
  if (who instanceof Response) return who;
  if (m[1] !== (await ownerHash(who))) return json({ error: '404 未找到' }, 404);
  if (!env.FILES) return json({ error: '503 服务不可用：文件存储还没配置' }, 503);
  const head = req.method === 'HEAD';
  const obj = head ? await headObject(env.FILES, key) : await env.FILES.get(key);
  if (!obj) return head ? new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } }) : json({ error: '404 未找到' }, 404);
  const mime = cleanMime(obj.httpMetadata?.contentType ?? null);
  const inline = INLINE.test(mime) && url.searchParams.get('dl') !== '1';
  return new Response(head ? null : (obj as R2Object).body, {
    headers: {
      'content-type': mime,
      'content-length': String(obj.size),
      'content-disposition': contentDisposition(inline ? 'inline' : 'attachment', url.searchParams.get('name')),
      // 内容按 SHA-256 定址，不会变；只给这个人的浏览器缓存。HEAD 不缓存（要知道现在还在不在）
      'cache-control': head ? 'no-store' : 'private, max-age=31536000, immutable',
      'cross-origin-resource-policy': 'cross-origin',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}

/** HEAD：R2 的 head 带大小和类型；测试里的假桶可能只回 {}，那就退回 get。 */
async function headObject(files: AssetBucket, key: string): Promise<{ size: number; httpMetadata?: { contentType?: string } } | null> {
  const h = (await files.head(key)) as { size?: number; httpMetadata?: { contentType?: string } } | null;
  if (!h) return null;
  if (typeof h.size === 'number') return { size: h.size, httpMetadata: h.httpMetadata };
  const o = await files.get(key);
  if (o) await o.body.cancel();
  return o;
}
