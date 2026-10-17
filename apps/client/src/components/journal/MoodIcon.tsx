/**
 * 心情图标（Rei 2026-10-17：「5个太少了，可以生成一组动画svg图标么，点击时显示动画」）。
 *
 * 12 个手写 SVG，风格统一：32×32，一张圆脸（填心情色的淡色）+ 线条五官（currentColor，2px 圆头），
 * 有的带一个小配件（星光、心、z、汗滴、泪滴、怒气）。颜色 = 皮肤令牌 --mood-<id>（三套 × 明暗，见 skin/tokens.css），
 * 由外层 .mood-icon 的 color 给，所以三皮肤、深浅色自动跟着变。
 *
 * 动画：playing 时外层加 .is-playing，各部分（.mi-face / .mi-eyes / .mi-extra …）按心情播一段 0.7s 左右的 keyframes
 * （styles/journal.css）；prefers-reduced-motion 时不播。每次点选换一个 key 重新播。
 */
import type { ReactNode } from 'react';
import { isMoodId, type MoodId } from '@mindough/core';

const eye = (cx: number, cy = 13.5) => <circle cx={cx} cy={cy} r={1.7} className="mi-fill" />;
const dotEyes = (
  <g className="mi-eyes">
    {eye(11.5)}
    {eye(20.5)}
  </g>
);

/** 每个心情的五官和配件。 */
const PARTS: Record<MoodId, ReactNode> = {
  happy: (
    <>
      {dotEyes}
      <path className="mi-mouth" d="M10.5 18.5 Q16 24.5 21.5 18.5" />
    </>
  ),
  excited: (
    <>
      <g className="mi-eyes">
        <path className="mi-fill mi-star" d="M11.5 10.6 L12.3 12.7 L14.4 13.5 L12.3 14.3 L11.5 16.4 L10.7 14.3 L8.6 13.5 L10.7 12.7 Z" />
        <path className="mi-fill mi-star" d="M20.5 10.6 L21.3 12.7 L23.4 13.5 L21.3 14.3 L20.5 16.4 L19.7 14.3 L17.6 13.5 L19.7 12.7 Z" />
      </g>
      <path className="mi-mouth mi-fill" d="M10.5 18 H21.5 Q21.5 24.5 16 24.5 Q10.5 24.5 10.5 18 Z" />
      <g className="mi-extra mi-sparkle">
        <path className="mi-fill" d="M27 3.5 L27.6 5.4 L29.5 6 L27.6 6.6 L27 8.5 L26.4 6.6 L24.5 6 L26.4 5.4 Z" />
        <circle className="mi-fill" cx="4.5" cy="6.5" r="1.1" />
      </g>
    </>
  ),
  grateful: (
    <>
      <g className="mi-eyes">
        <path d="M9.5 14 Q11.5 11.5 13.5 14" />
        <path d="M18.5 14 Q20.5 11.5 22.5 14" />
      </g>
      <path className="mi-mouth" d="M11.5 19 Q16 23 20.5 19" />
      <path className="mi-extra mi-heart mi-fill" d="M25.5 27.8 C21.6 25.2 21.6 22 23.6 21.3 C24.6 21 25.3 21.6 25.5 22.3 C25.7 21.6 26.4 21 27.4 21.3 C29.4 22 29.4 25.2 25.5 27.8 Z" />
    </>
  ),
  content: (
    <>
      <g className="mi-eyes">
        <path d="M9.5 13 Q11.5 15.5 13.5 13" />
        <path d="M18.5 13 Q20.5 15.5 22.5 13" />
      </g>
      <g className="mi-blush">
        <ellipse className="mi-fill mi-soft" cx="9.5" cy="18" rx="2" ry="1.3" />
        <ellipse className="mi-fill mi-soft" cx="22.5" cy="18" rx="2" ry="1.3" />
      </g>
      <path className="mi-mouth" d="M12.5 19.5 Q16 22.5 19.5 19.5" />
    </>
  ),
  calm: (
    <>
      <g className="mi-eyes">
        <path d="M9.5 14 Q11.5 15.6 13.5 14" />
        <path d="M18.5 14 Q20.5 15.6 22.5 14" />
      </g>
      <path className="mi-mouth" d="M13 20.5 Q16 21.8 19 20.5" />
    </>
  ),
  okay: (
    <>
      {dotEyes}
      <path className="mi-mouth" d="M12 20.5 H20" />
    </>
  ),
  bored: (
    <>
      <g className="mi-eyes">
        <path d="M9.5 13 H13.5" />
        <path d="M18.5 13 H22.5" />
        <path className="mi-fill" d="M10 13.6 H13 A1.5 1.5 0 0 1 10 13.6 Z" />
        <path className="mi-fill" d="M19 13.6 H22 A1.5 1.5 0 0 1 19 13.6 Z" />
      </g>
      <path className="mi-mouth" d="M12.5 21 L19.5 19.6" />
    </>
  ),
  tired: (
    <>
      <g className="mi-eyes">
        <path d="M9.5 14.5 Q11.5 13 13.5 14.5" />
        <path d="M18.5 14.5 Q20.5 13 22.5 14.5" />
        <path className="mi-soft-line" d="M10 17 Q11.5 17.8 13 17" />
        <path className="mi-soft-line" d="M19 17 Q20.5 17.8 22 17" />
      </g>
      <ellipse className="mi-mouth" cx="16" cy="21.5" rx="1.8" ry="1.4" />
      <g className="mi-extra mi-zzz">
        <path className="mi-z1" d="M23.5 4.5 H27 L23.5 8 H27" />
        <path className="mi-z2 mi-thin" d="M28 1.5 H30 L28 3.5 H30" />
      </g>
    </>
  ),
  anxious: (
    <>
      <g className="mi-brows">
        <path d="M9.5 10.5 L13.5 9.2" />
        <path d="M22.5 10.5 L18.5 9.2" />
      </g>
      <g className="mi-eyes">
        {eye(11.5, 14)}
        {eye(20.5, 14)}
      </g>
      <path className="mi-mouth" d="M11.5 19.5 H20.5 V22.5 H11.5 Z M11.5 21 H20.5" />
      <path className="mi-extra mi-drop mi-fill" d="M26.5 6 Q24.3 9.6 24.3 10.8 A2.2 2.2 0 0 0 28.7 10.8 Q28.7 9.6 26.5 6 Z" />
    </>
  ),
  sad: (
    <>
      {dotEyes}
      <path className="mi-mouth" d="M11 22 Q16 17.5 21 22" />
      <path className="mi-extra mi-tear mi-fill" d="M10.5 16.5 Q9 19 9 19.8 A1.5 1.5 0 0 0 12 19.8 Q12 19 10.5 16.5 Z" />
    </>
  ),
  irritated: (
    <>
      <g className="mi-brows">
        <path d="M9.5 10 L13.5 11.5" />
        <path d="M22.5 10 L18.5 11.5" />
      </g>
      <g className="mi-eyes">
        <path d="M10 14.5 H13" />
        <path d="M19 14.5 H22" />
      </g>
      <path className="mi-mouth" d="M10.5 21 Q12.3 19.2 14.2 21 Q16 22.8 17.8 21 Q19.6 19.2 21.5 21" />
    </>
  ),
  angry: (
    <>
      <g className="mi-brows">
        <path d="M9 10 L14 12.6" />
        <path d="M23 10 L18 12.6" />
      </g>
      <g className="mi-eyes">
        {eye(11.8, 15)}
        {eye(20.2, 15)}
      </g>
      <path className="mi-mouth" d="M11.5 22 Q16 18.8 20.5 22" />
      <g className="mi-extra mi-vein">
        <path d="M23.2 3.5 Q24.6 3.5 24.6 4.9" />
        <path d="M29.2 3.5 Q27.8 3.5 27.8 4.9" />
        <path d="M23.2 9.5 Q24.6 9.5 24.6 8.1" />
        <path d="M29.2 9.5 Q27.8 9.5 27.8 8.1" />
      </g>
    </>
  ),
};

/** 一个心情图标。不认识的 id（新版本加的）画成「一般」的脸。 */
export function MoodIcon({ mood, size = 28, playing = false, className }: { mood: string; size?: number; playing?: boolean; className?: string }) {
  const id: MoodId = isMoodId(mood) ? mood : 'okay';
  return (
    <svg
      className={`mood-icon mood-${id}${playing ? ' is-playing' : ''}${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      <g className="mi-body">
        <circle className="mi-face" cx="16" cy="16" r="12.5" />
        {PARTS[id]}
      </g>
    </svg>
  );
}
