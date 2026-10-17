/**
 * 设置里的「导出…」「导入…」：序列化都在 core（`@mindough/core/archive`，按需加载，yaml + fflate 不进首屏包），
 * 这里只管浏览器那一头：取回远程图片、打 zip 下载、读选进来的 zip / 文件夹、登录时把图片先传到 R2。
 * 附件：导出时取回文件内容放进 attachments/，导入后放进本机上传队列（lib/attachments.ts）。
 * Tauri 端暂时也走 zip 下载（还没装 dialog / fs 插件，见 PLAN「待 Rei 确认」）。
 */
import type { Store } from '@mindough/core';
import type { ArchiveFile, ExportCounts, ExportImage, ImportPlan } from '@mindough/core/archive';
import { getAccount } from './account';
import { uploadImage } from './upload';
import { attachmentBytes, enqueueImported } from './attachments';

export const loadArchive = () => import('@mindough/core/archive');

/** 取一张远程图片（8 秒超时；跨域取不到就算了，导出里照原链接写）。 */
async function fetchImage(url: string): Promise<ExportImage | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(url, { signal: ctl.signal, credentials: 'include' });
    if (!res.ok) return null;
    const mime = res.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream';
    if (!mime.startsWith('image/')) return null;
    return { mime, data: new Uint8Array(await res.arrayBuffer()) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function pool<T>(items: readonly T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]!);
  }));
}

/** 导出全部数据，下载成 zip。返回数了多少。 */
export async function exportToZip(store: Store, onStep?: (step: 'images' | 'attachments' | 'zip') => void): Promise<ExportCounts & { missedImages: number }> {
  const ar = await loadArchive();
  // 附件：本机队列里的、或从 R2 取回（取不到的只写记录）
  const atts = ar.exportableAttachments(store);
  const attachments = new Map<string, Uint8Array>();
  if (atts.length) {
    onStep?.('attachments');
    await pool(atts, 3, async (a) => {
      const b = await attachmentBytes(a);
      if (b) attachments.set(a.id, new Uint8Array(await b.arrayBuffer()));
    });
  }
  const urls = ar.remoteImageUrls(store);
  const images = new Map<string, ExportImage>();
  if (urls.length) {
    onStep?.('images');
    await pool(urls, 4, async (u) => {
      const img = await fetchImage(u);
      if (img) images.set(u, img);
    });
  }
  onStep?.('zip');
  const now = new Date();
  const { files, counts } = ar.exportArchive(store, { now, images, attachments });
  const name = ar.archiveName(now);
  const zip = ar.zipArchive(files, name);
  download(new Blob([zip as BlobPart], { type: 'application/zip' }), `${name}.zip`);
  return { ...counts, missedImages: urls.length - images.size };
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** 选进来的文件 → 归档：一个 .zip 就解开；文件夹（webkitdirectory）按相对路径。 */
export async function readPicked(list: FileList | readonly File[]): Promise<{ files: ArchiveFile[]; name: string }> {
  const ar = await loadArchive();
  const picked = [...list];
  if (picked.length === 1 && /\.zip$/i.test(picked[0]!.name)) {
    const f = picked[0]!;
    return { files: ar.unzipArchive(new Uint8Array(await f.arrayBuffer())), name: f.name.replace(/\.zip$/i, '') };
  }
  const keep = picked.filter((f) => /\.(md|markdown|json)$/i.test(f.name) || ar.isImagePath(f.name));
  const files = await Promise.all(keep.map(async (f) => ({ path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name, data: new Uint8Array(await f.arrayBuffer()) })));
  const root = files[0]?.path.includes('/') ? files[0].path.split('/')[0]! : '';
  return { files, name: root };
}

/** 导入写好后：带着文件、还没有 R2 key 的附件放进本机上传队列（缩略图在这里重新生成）。 */
export async function queueImportedAttachments(store: Store, plan: ImportPlan, files: readonly ArchiveFile[]): Promise<number> {
  if (!plan.attachmentFiles.length) return 0;
  const ar = await loadArchive();
  const { files: norm } = ar.normalizeArchive(files);
  const byPath = new Map(norm.map((f) => [f.path, f]));
  let n = 0;
  for (const { id, path } of plan.attachmentFiles) {
    const row = store.get('attachment', id);
    const f = byPath.get(path);
    if (!row || row.r2_key || !f) continue;
    await enqueueImported(row, new Blob([f.data as BlobPart], { type: row.mime || 'application/octet-stream' }));
    n++;
  }
  return n;
}

/** 登录且在线时：先把要用到的图片传到 R2，返回 路径 → 地址；没登录 / 传不上的不在表里（导入时转成 data URL）。 */
export async function uploadPlanImages(plan: ImportPlan, files: readonly ArchiveFile[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (getAccount().status !== 'in' || navigator.onLine === false || !plan.imagePaths.length) return out;
  const ar = await loadArchive();
  const { files: norm } = ar.normalizeArchive(files);
  const byPath = new Map(norm.map((f) => [f.path, f]));
  await pool(plan.imagePaths, 3, async (p) => {
    const f = byPath.get(p);
    if (!f) return;
    const up = await uploadImage(new Blob([f.data as BlobPart], { type: ar.mimeOfPath(p) ?? 'application/octet-stream' }));
    if (up) out.set(p, up.url);
  });
  return out;
}
