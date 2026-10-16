/** zip 打包 / 解包（fflate，纯 JS，同步）。 */
import { strFromU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { tr } from '../i18n';
import { normPath, type ArchiveFile } from './text';

/** 打成 zip：所有文件放在 root 文件夹下（解压出来是一个文件夹）。图片已经压缩过，不再压。 */
export function zipArchive(files: readonly ArchiveFile[], root: string): Uint8Array {
  const tree: Zippable = {};
  for (const f of files) {
    const path = root ? `${root}/${f.path}` : f.path;
    tree[path] = [f.data, { level: /\.(png|jpe?g|gif|webp|avif|heic|heif)$/i.test(f.path) ? 0 : 6 }];
  }
  return zipSync(tree, { mtime: new Date('2026-01-01T00:00:00Z') });
}

/** 解 zip；不是 zip / 坏了抛出带说明的错误。文件名没标 UTF-8 时按 UTF-8 试一次（macOS 与 Windows 新版都是 UTF-8）。 */
export function unzipArchive(data: Uint8Array): ArchiveFile[] {
  let out: Record<string, Uint8Array>;
  try {
    out = unzipSync(data);
  } catch (e) {
    throw new Error(tr('这个 zip 打不开：{msg}', { msg: String((e as Error)?.message ?? e) }));
  }
  const files: ArchiveFile[] = [];
  for (const [name, bytes] of Object.entries(out)) {
    if (name.endsWith('/')) continue;
    let path = name;
    // fflate 对没标 UTF-8 的文件名按 latin1 解：试着按 UTF-8 还原
    if (/[\u0080-\u00ff]/.test(name)) {
      try {
        const raw = Uint8Array.from(name, (c) => c.charCodeAt(0));
        const fixed = strFromU8(raw);
        if (!fixed.includes('\ufffd')) path = fixed;
      } catch {
        /* 原样 */
      }
    }
    files.push({ path: normPath(path), data: bytes });
  }
  return files;
}
