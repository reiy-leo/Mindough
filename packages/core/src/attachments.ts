/**
 * 附件的纯逻辑（Rei 2026-10-17：「添加附件功能，用户可以拖拽或选择文件作为附件，附件是图片则小图显示点击可放大(有关闭、下载按钮)，其他文件格式上传后显示图标，点击下载」）。
 * - 文件类型 → 图标种类（PDF、文档、表格、演示、压缩包、音频、视频、代码 / 文本、通用；图片单独）
 * - 大小上限（先定 50 MB，待 Rei 确认）、大小的显示
 * - 文件名：改名时保留扩展名、去掉不能放进文件名的字符、导出时同一个文件夹里重名加「 2」
 * 写入在 Store（addAttachment / renameAttachment / removeAttachment / restoreAttachment / attachmentsOf）。
 */
import type { Attachment, AttachmentOwnerType } from './types';
import { tr, trc } from './i18n';

/** 单个附件最大 50 MB（Rei 待确认）。Worker 那边同一个数（apps/server/src/files.ts）。 */
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

export const ATTACHMENT_OWNERS: readonly AttachmentOwnerType[] = ['task', 'journal'];

export type FileKind = 'image' | 'pdf' | 'doc' | 'sheet' | 'slides' | 'archive' | 'audio' | 'video' | 'code' | 'file';
export const FILE_KINDS: readonly FileKind[] = ['image', 'pdf', 'doc', 'sheet', 'slides', 'archive', 'audio', 'video', 'code', 'file'];

const EXT: Record<string, FileKind> = {};
const add = (kind: FileKind, exts: string) => exts.split(' ').forEach((e) => (EXT[e] = kind));
add('image', 'png jpg jpeg gif webp avif bmp svg heic heif ico tif tiff');
add('pdf', 'pdf');
add('doc', 'doc docx odt rtf pages wps');
add('sheet', 'xls xlsx xlsm ods csv tsv numbers et');
add('slides', 'ppt pptx odp key dps');
add('archive', 'zip rar 7z tar gz tgz bz2 xz zst dmg iso');
add('audio', 'mp3 m4a aac wav flac ogg oga opus aiff aif amr wma');
add('video', 'mp4 m4v mov mkv webm avi wmv flv 3gp mpg mpeg');
add(
  'code',
  'txt md markdown json yaml yml toml xml html htm css scss js jsx ts tsx mjs cjs py rb go rs java kt swift c h cpp hpp cs php sh bash zsh ps1 sql ini conf cfg log env vue svelte lua r dart ipynb',
);

/** 扩展名（小写，不带点）；没有为 ''。 */
export function extOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const i = base.lastIndexOf('.');
  return i > 0 && i < base.length - 1 ? base.slice(i + 1).toLowerCase() : '';
}

/** 按 MIME 和扩展名认文件类型（MIME 空着或是 octet-stream 时看扩展名）。 */
export function fileKind(name: string, mime: string): FileKind {
  const m = (mime || '').toLowerCase().split(';')[0]!.trim();
  if (m.startsWith('image/')) return 'image';
  if (m === 'application/pdf') return 'pdf';
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('video/')) return 'video';
  if (/spreadsheet|ms-excel|text\/csv|tab-separated/.test(m)) return 'sheet';
  if (/presentation|powerpoint/.test(m)) return 'slides';
  if (/wordprocessing|msword|opendocument\.text|rtf/.test(m)) return 'doc';
  if (/zip|x-7z|x-rar|x-tar|gzip|x-bzip|x-xz|zstd|diskimage/.test(m)) return 'archive';
  const byExt = EXT[extOf(name)];
  if (byExt) return byExt;
  if (m.startsWith('text/') || /json|xml|javascript|typescript|x-sh|yaml|toml/.test(m)) return 'code';
  return 'file';
}

/** 浏览器能直接显示的图片（网格里显示小图、点开放大）。HEIC / TIFF 这类只在部分系统能看：有缩略图才当图片显示。 */
export function isViewableImage(a: Pick<Attachment, 'file_name' | 'mime' | 'thumb_key'>): boolean {
  if (fileKind(a.file_name, a.mime) !== 'image') return false;
  const m = a.mime.toLowerCase();
  if (/^image\/(png|jpeg|gif|webp|avif|bmp|svg\+xml|x-icon|vnd\.microsoft\.icon)$/.test(m)) return true;
  return !!a.thumb_key;
}

/** 能在浏览器里生成缩略图的图片（SVG 不用缩，原图就小）。 */
export function canThumbnail(mime: string): boolean {
  return /^image\/(png|jpeg|gif|webp|avif|bmp|heic|heif)$/i.test(mime);
}

/** 「1.2 MB」「380 KB」「12 字节」：1024 进位，一位小数（整数不带 .0）。 */
export function formatFileSize(bytes: number): string {
  const b = Math.max(0, Math.round(Number.isFinite(bytes) ? bytes : 0));
  if (b < 1024) return tr('{n} 字节', { n: b });
  const units = ['KB', 'MB', 'GB'];
  let v = b / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const num = v >= 100 ? Math.round(v).toString() : (Math.round(v * 10) / 10).toString();
  return `${num} ${units[i]}`;
}

/** 超过上限了吗。 */
export function tooLarge(bytes: number, max = MAX_ATTACHMENT_BYTES): boolean {
  return bytes > max;
}

const BAD = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** 能放进文件名的样子：去掉 \ / : * ? " < > | 和控制字符、首尾空格与点，最长 120 个字；Windows 保留名加 _；空的叫 file。 */
export function safeFileName(name: string): string {
  let s = (name ?? '').replace(BAD, '').replace(/\s+/g, ' ').trim().replace(/^\.+|\.+$/g, '').trim();
  if ([...s].length > 120) {
    const ext = extOf(s);
    const stem = ext ? s.slice(0, -(ext.length + 1)) : s;
    const keep = 120 - (ext ? ext.length + 1 : 0);
    s = [...stem].slice(0, Math.max(1, keep)).join('').trim() + (ext ? `.${ext}` : '');
  }
  const stem = s.replace(/\.[^.]*$/, '');
  if (RESERVED.test(stem)) s = stem + '_' + s.slice(stem.length);
  return s || 'file';
}

/**
 * 改名：用户只改了主干（没写扩展名）时把原来的扩展名补回去；写了别的扩展名就照用户写的。
 * 空的、只剩非法字符的返回 null（不改）。
 */
export function renamedFileName(old: string, input: string): string | null {
  const raw = (input ?? '').trim();
  if (!raw.replace(BAD, '').replace(/^\.+|\.+$/g, '').trim()) return null;
  const oldExt = extOf(old);
  const withExt = oldExt && !extOf(raw) ? `${raw}.${oldExt}` : raw;
  return safeFileName(withExt);
}

/** 文件名主干（改名框里先选中这一段）。 */
export function fileStem(name: string): string {
  const ext = extOf(name);
  return ext ? name.slice(0, -(ext.length + 1)) : name;
}

/** 同一个文件夹里不重名（不分大小写）：「a.pdf」「a 2.pdf」「a 3.pdf」。used 会被更新。 */
export function uniqueFileName(name: string, used: Set<string>): string {
  const safe = safeFileName(name);
  const n = extOf(safe).length;
  const ext = n ? safe.slice(-n) : '';
  const stem = n ? safe.slice(0, -(n + 1)) : safe;
  let out = safe;
  for (let n = 2; used.has(out.toLowerCase()); n++) out = `${stem} ${n}${ext ? `.${ext}` : ''}`;
  used.add(out.toLowerCase());
  return out;
}

/** 附件按添加时间排（同时间按 id）。 */
export function sortAttachments<T extends Pick<Attachment, 'created_at' | 'id'>>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** 文件类型的叫法（图标的无障碍名字、文件列表里的副标题）。 */
export function fileKindLabel(kind: FileKind): string {
  switch (kind) {
    case 'image':
      return trc('文件类型', '图片');
    case 'pdf':
      return 'PDF';
    case 'doc':
      return trc('文件类型', '文档');
    case 'sheet':
      return trc('文件类型', '表格');
    case 'slides':
      return trc('文件类型', '演示文稿');
    case 'archive':
      return trc('文件类型', '压缩包');
    case 'audio':
      return trc('文件类型', '音频');
    case 'video':
      return trc('文件类型', '视频');
    case 'code':
      return trc('文件类型', '代码 / 文本');
    default:
      return trc('文件类型', '文件');
  }
}

/** R2 里附件的 key：用户哈希 / f / 内容 SHA-256（Worker 生成；客户端只做形状检查）。 */
export const FILE_KEY_RE = /^[0-9a-f]{16}\/f\/[0-9a-f]{64}$/;
export const isFileKey = (k: unknown): k is string => typeof k === 'string' && FILE_KEY_RE.test(k);
