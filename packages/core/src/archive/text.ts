/**
 * 导入导出的小工具：front matter 拆分与生成（YAML，用 yaml 库）、文件名安全化与去重、路径、字节 ↔ data URL。
 * 纯逻辑，不依赖 DOM（TextEncoder / atob / btoa 在浏览器与 Node 18+ 都有）。
 */
import { Document, isMap, isSeq, parseDocument, Scalar } from 'yaml';
import { strFromU8, strToU8 } from 'fflate';
import { tr } from '../i18n';

/** 归档里的一个文件：相对路径（用 / 分隔，不带开头的 /）+ 内容。 */
export interface ArchiveFile {
  path: string;
  data: Uint8Array;
}

export const utf8 = (s: string): Uint8Array => strToU8(s);
export const fromUtf8 = (b: Uint8Array): string => strFromU8(b).replace(/^\uFEFF/, '');

// base64 自己写（core 不依赖 DOM 的 atob / btoa）
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX = new Map([...B64].map((c, i) => [c, i]));
export function toBase64(data: Uint8Array): string {
  let out = '';
  for (let i = 0; i < data.length; i += 3) {
    const a = data[i]!, b = data[i + 1], c = data[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + (b === undefined ? '=' : B64[(n >> 6) & 63]!) + (c === undefined ? '=' : B64[n & 63]!);
  }
  return out;
}
export function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = ((B64_INDEX.get(clean[i]!) ?? 0) << 18) | ((B64_INDEX.get(clean[i + 1] ?? 'A') ?? 0) << 12) | ((B64_INDEX.get(clean[i + 2] ?? 'A') ?? 0) << 6) | (B64_INDEX.get(clean[i + 3] ?? 'A') ?? 0);
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (i + 2 < clean.length && o < out.length) out[o++] = (n >> 8) & 255;
    if (i + 3 < clean.length && o < out.length) out[o++] = n & 255;
  }
  return out.subarray(0, o);
}

// ───────────── front matter ─────────────

export interface SplitMarkdown {
  /** front matter 原文（不含 --- 两行）；没有 front matter 时为 null。 */
  front: string | null;
  body: string;
}

/** 拆出开头的 YAML front matter（--- … --- 或 --- … ...）。开头有 --- 却没有收尾的，整篇当正文、front 记成 ''。 */
export function splitFrontMatter(text: string): SplitMarkdown & { unterminated?: boolean } {
  const src = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!/^---[ \t]*\n/.test(src)) return { front: null, body: src };
  const rest = src.slice(src.indexOf('\n') + 1);
  const m = /^(?:---|\.\.\.)[ \t]*$/m.exec(rest);
  if (!m) return { front: '', body: src, unterminated: true };
  const front = rest.slice(0, m.index);
  let body = rest.slice(m.index + m[0].length);
  if (body.startsWith('\n')) body = body.slice(1);
  return { front, body };
}

export type FrontResult = { ok: true; data: Record<string, unknown> } | { ok: false; error: string };

/** 解析 front matter：写错了（YAML 语法错、不是键值对）返回错误，不抛。 */
export function parseFrontMatter(front: string): FrontResult {
  if (!front.trim()) return { ok: true, data: {} };
  try {
    const doc = parseDocument(front, { prettyErrors: true, uniqueKeys: false });
    if (doc.errors.length) {
      // 行号按整个文件算（前面还有一行 ---）；解析器的英文原话不给用户看
      const line = doc.errors[0]!.linePos?.[0]?.line;
      return { ok: false, error: line ? tr('开头的属性（front matter）第 {line} 行写得不对', { line: line + 1 }) : tr('开头的属性（front matter）写得不对') };
    }
    const v: unknown = doc.toJS({ maxAliasCount: 50 });
    if (v === null || v === undefined) return { ok: true, data: {} };
    if (typeof v !== 'object' || Array.isArray(v)) return { ok: false, error: tr('开头的属性（front matter）应该是「键: 值」的列表') };
    return { ok: true, data: v as Record<string, unknown> };
  } catch {
    return { ok: false, error: tr('开头的属性（front matter）写得不对') };
  }
}

/** front matter 里一个值，可以带一句行尾注释（给人看的名字：组名、片名…；导入时忽略）。 */
export class Noted {
  constructor(
    readonly value: unknown,
    readonly note: string,
  ) {}
}
/** 要加引号的字符串（如提醒时间 "08:00"：有的 YAML 1.1 解析器会把它当数字）。 */
export class Quoted {
  constructor(readonly value: string) {}
}

const cleanNote = (s: string) => ' ' + s.replace(/[\r\n]+/g, ' ').trim().slice(0, 60);

function prepare(v: unknown, notes: Array<{ path: Array<string | number>; note: string }>, quoted: Array<Array<string | number>>, path: Array<string | number>): unknown {
  if (v instanceof Noted) {
    if (v.note.trim()) notes.push({ path, note: v.note });
    return prepare(v.value, notes, quoted, path);
  }
  if (v instanceof Quoted) {
    quoted.push(path);
    return v.value;
  }
  if (Array.isArray(v)) return v.map((x, i) => prepare(x, notes, quoted, [...path, i]));
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (x !== undefined) out[k] = prepare(x, notes, quoted, [...path, k]);
    return out;
  }
  return v;
}

/** 生成 front matter（含两行 ---）。值是 undefined 的键不写；Noted 值在行尾加注释。 */
export function stringifyFrontMatter(data: Record<string, unknown>): string {
  const notes: Array<{ path: Array<string | number>; note: string }> = [];
  const quoted: Array<Array<string | number>> = [];
  const plain = prepare(data, notes, quoted, []) as Record<string, unknown>;
  const doc = new Document(plain);
  for (const p of quoted) {
    const node = doc.getIn(p, true);
    if (node instanceof Scalar) node.type = Scalar.QUOTE_DOUBLE;
  }
  for (const { path, note } of notes) {
    const node = doc.getIn(path, true) as { comment?: string | null } | undefined;
    if (node && !isMap(node) && !isSeq(node)) node.comment = cleanNote(note);
  }
  const yaml = doc.toString({ lineWidth: 0, minContentWidth: 0, indentSeq: true });
  return `---\n${yaml}---\n`;
}

// ───────────── 文件名与路径 ─────────────

const WIN_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/** 由一行字生成安全的文件 / 文件夹名（不含扩展名）：去掉各系统不允许的字符、首尾空格和点，最长 60 个字。 */
export function safeName(s: string, fallback = tr('无标题')): string {
  let n = s
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '');
  if ([...n].length > 60) n = [...n].slice(0, 60).join('').trim();
  if (!n || WIN_RESERVED.test(n)) n = n ? `${n}_` : fallback;
  return n;
}

/** 同一个文件夹里去重：大小写不同也算重名（macOS / Windows 不分大小写），重名的加「 2」「 3」。 */
export class NameSet {
  private used = new Set<string>();
  constructor(reserved: readonly string[] = []) {
    for (const r of reserved) this.used.add(r.toLowerCase());
  }
  take(base: string, ext = ''): string {
    let name = base + ext;
    for (let i = 2; this.used.has(name.toLowerCase()); i++) name = `${base} ${i}${ext}`;
    this.used.add(name.toLowerCase());
    return name;
  }
}

/** 规范路径：反斜杠改 /，去掉 ./ 和开头的 /，合并 ..。 */
export function normPath(p: string): string {
  const out: string[] = [];
  for (const seg of p.replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out.join('/');
}

export const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
export const baseOf = (p: string) => p.slice(p.lastIndexOf('/') + 1);
export const stemOf = (p: string) => baseOf(p).replace(/\.[^.]+$/, '');

/** 从 fromFile 所在文件夹指向 target 的相对路径（都相对归档根）。 */
export function relativePath(fromFile: string, target: string): string {
  const from = dirOf(fromFile).split('/').filter(Boolean);
  const to = target.split('/');
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
  return [...from.slice(i).map(() => '..'), ...to.slice(i)].join('/');
}

/** 相对 fromFile 写的链接 → 归档根下的路径（链接里的 %20 等先解码）。 */
export function resolveLink(fromFile: string, href: string): string {
  let h = href;
  try {
    h = decodeURI(href);
  } catch {
    /* 原样 */
  }
  return normPath(h.startsWith('/') ? h : `${dirOf(fromFile)}/${h}`);
}

/** markdown 链接里的路径：有空格、括号等就用 <…> 包起来。 */
export const mdHref = (p: string) => (/[\s()<>]/.test(p) ? `<${p}>` : p);

// ───────────── 图片 ─────────────

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/bmp': 'bmp',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'image/tiff': 'tiff',
};
export const extOfMime = (mime: string) => MIME_EXT[mime.toLowerCase().split(';')[0]!.trim()] ?? 'bin';
export function mimeOfPath(p: string): string | null {
  const ext = baseOf(p).toLowerCase().split('.').pop() ?? '';
  const hit = Object.entries(MIME_EXT).find(([, e]) => e === ext || (ext === 'jpeg' && e === 'jpg') || (ext === 'tif' && e === 'tiff'));
  return hit ? hit[0] : null;
}
export const isImagePath = (p: string) => mimeOfPath(p) !== null;

/** data:…;base64,… → 字节与类型；不是 data URL 返回 null。 */
export function decodeDataUrl(url: string): { mime: string; data: Uint8Array } | null {
  const m = /^data:([^;,]*)((?:;[^;,]*)*),(.*)$/s.exec(url);
  if (!m) return null;
  const mime = m[1] || 'text/plain';
  try {
    if (/;base64/i.test(m[2] ?? '')) return { mime, data: fromBase64(m[3]!) };
    return { mime, data: utf8(decodeURIComponent(m[3]!)) };
  } catch {
    return null;
  }
}

export function encodeDataUrl(mime: string, data: Uint8Array): string {
  return `data:${mime};base64,${toBase64(data)}`;
}

/** FNV-1a 32 位（两个种子拼成 16 位十六进制，给图片文件名用）。 */
function fnv(s: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
export const hash16 = (s: string) => fnv(s).toString(16).padStart(8, '0') + fnv(s, 0x2468ace0).toString(16).padStart(8, '0');

/** 确定的 UUID 形状 id（版本位 7、时间戳段 0，和迁移出来的资料同一种写法）：同一份文件导入两次得到同一个 id。 */
export function stableId(key: string): string {
  const hex = [fnv(key), fnv(key, 0x01234567), fnv(key, 0x89abcdef), fnv(key, 0x2468ace0)].map((n) => n.toString(16).padStart(8, '0')).join('');
  return `00000000-${hex.slice(0, 4)}-7${hex.slice(5, 8)}-8${hex.slice(9, 12)}-${hex.slice(12, 24)}`;
}

/** markdown 正文里的图片：![alt](url "title") 与 Obsidian 的 ![[file.png]]。 */
export const MD_IMAGE = /!\[([^\]\n]*)\]\(\s*(<[^>\n]*>|[^\s)]+)(\s+"[^"\n]*")?\s*\)/g;
export const WIKI_IMAGE = /!\[\[([^\]|\n]+)(?:\|([^\]\n]*))?\]\]/g;
