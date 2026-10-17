/**
 * 文件类型图标（Rei 2026-10-17 附件）：一组手写 SVG，风格统一——
 * 一张折角的纸（描边 = 类型色，填类型色的淡色），中间一个线条图形（2px 圆头，和 lucide / 心情图标同一种线），
 * 下面一行扩展名（PDF、DOCX…，最多 4 个字母）。颜色 = 皮肤令牌 --file-<kind>（三皮肤 × 明暗，skin/tokens.css），
 * 由外层 .file-icon 的 color 给，所以三皮肤、深浅色自动跟着变。
 */
import type { ReactNode } from 'react';
import { extOf, fileKind, fileKindLabel, type FileKind } from '@mindough/core';

const L = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

/** 每种类型中间的图形（画在 32×40 的纸上，图形区大约 x 8–24、y 12–27）。 */
const GLYPH: Record<FileKind, ReactNode> = {
  image: (
    <>
      <rect x="8" y="12" width="16" height="13" rx="2" {...L} />
      <circle cx="12.5" cy="16.2" r="1.6" fill="currentColor" />
      <path d="M9 24 L14 19.5 L17.5 22.5 L20 20.5 L23.5 24" {...L} />
    </>
  ),
  pdf: (
    <>
      <path d="M11 25.5 C13 22 15 16 15.5 12.8 C15.8 11 13.8 11 14 13 C14.4 16.5 18.5 21 22 21.5 C23.6 21.7 23.4 20 21.8 20 C18.5 20 13 22.5 10.5 25 C9.6 26 10.6 27 11 25.5 Z" {...L} strokeWidth={1.7} />
    </>
  ),
  doc: (
    <>
      <path d="M9 13.5 H23 M9 17.5 H23 M9 21.5 H23 M9 25.5 H17" {...L} />
    </>
  ),
  sheet: (
    <>
      <rect x="8" y="12" width="16" height="14" rx="2" {...L} />
      <path d="M8 16.7 H24 M8 21.3 H24 M13.5 12 V26" {...L} />
    </>
  ),
  slides: (
    <>
      <rect x="7.5" y="12" width="17" height="11" rx="2" {...L} />
      <path d="M16 23 V26.5 M12.5 26.5 H19.5" {...L} />
      <path d="M12 20 V18 M16 20 V15.5 M20 20 V17" {...L} />
    </>
  ),
  archive: (
    <>
      <path d="M16 3 V7 M14 7 V11 M18 7 V11 M16 11 V15" {...L} strokeWidth={1.8} />
      <rect x="13" y="16" width="6" height="7" rx="1.5" {...L} />
      <path d="M16 19 V20.5" {...L} />
    </>
  ),
  audio: (
    <>
      <path d="M13.5 23.5 V14 L22 12 V21.5" {...L} />
      <circle cx="11.5" cy="23.5" r="2.2" {...L} />
      <circle cx="20" cy="21.5" r="2.2" {...L} />
    </>
  ),
  video: (
    <>
      <rect x="7.5" y="12.5" width="17" height="13" rx="2.5" {...L} />
      <path d="M14 16 L19.5 19 L14 22 Z" fill="currentColor" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
    </>
  ),
  code: (
    <>
      <path d="M12.5 14.5 L8.5 19 L12.5 23.5 M19.5 14.5 L23.5 19 L19.5 23.5 M17.3 13.5 L14.7 24.5" {...L} />
    </>
  ),
  file: (
    <>
      <path d="M10 15 H22 M10 19 H22 M10 23 H18" {...L} opacity={0.55} />
    </>
  ),
};

export function FileIcon({ name, mime, kind: k, size = 40, className = '' }: { name: string; mime: string; kind?: FileKind; size?: number; className?: string }) {
  const kind = k ?? fileKind(name, mime);
  const ext = extOf(name).toUpperCase().slice(0, 4);
  // 压缩包的拉链从纸顶开始；有扩展名时图形往上挪一点给文字让地方
  const shift = ext ? -1.5 : 1.5;
  return (
    <span className={`file-icon file-${kind} ${className}`} style={{ width: (size * 32) / 40, height: size }} role="img" aria-label={fileKindLabel(kind)}>
      <svg viewBox="0 0 32 40" width="100%" height="100%" aria-hidden focusable="false">
        <path className="fi-page" d="M6 2.5 H20.5 L28.5 10.5 V35 A2.5 2.5 0 0 1 26 37.5 H6 A2.5 2.5 0 0 1 3.5 35 V5 A2.5 2.5 0 0 1 6 2.5 Z" />
        <path className="fi-fold" d="M20.5 2.5 V8 A2.5 2.5 0 0 0 23 10.5 H28.5" />
        <g transform={`translate(0 ${shift})`}>{GLYPH[kind]}</g>
        {ext && (
          <text className="fi-ext" x="16" y="34" textAnchor="middle">
            {ext}
          </text>
        )}
      </svg>
    </span>
  );
}
