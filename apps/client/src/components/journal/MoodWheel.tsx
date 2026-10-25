/**
 * 半圆「心情轮」（日记改版 B，Rei 2026-10-25「按B实现」）：12 张脸从左边「开心一点」排到右边「不太好」，
 * 中间放大显示选中的那张。点一下选中，再点一下取消（心情可以不填）。
 *
 * 键盘：整个轮子是一个 Tab 停靠点（radiogroup，roving tabindex）；← → ↑ ↓ 换一张脸（中间先预览），
 * Home / End 跳到两头，回车或空格选中（选中的再按一次取消），Esc 收起（有 onClose 时）。
 * 动效：打开时脸从中间散开、选中时播那张脸自己的动画；系统「减少动效」时都不动（styles/journal.css）。
 */
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Smile } from 'lucide-react';
import { moodLabel, moods } from '@mindough/core';
import { MoodIcon } from './MoodIcon';
import { tr } from '../../lib/i18n';

/** 轮子的几何（单位是设计稿像素，最后换成百分比，跟着容器宽度缩放）。 */
export const WHEEL = { w: 520, h: 300, r: 222, baseY: 262 } as const;

/** 第 i 张脸（共 n 张）的中心位置，百分比。第 0 张在最左边，最后一张在最右边。 */
export function wheelPoint(i: number, n: number): { x: number; y: number } {
  const a = Math.PI - (i * Math.PI) / Math.max(1, n - 1);
  const x = WHEEL.w / 2 + WHEEL.r * Math.cos(a);
  const y = WHEEL.baseY - WHEEL.r * Math.sin(a) * 0.92;
  return { x: (x / WHEEL.w) * 100, y: (y / WHEEL.h) * 100 };
}

/** 方向键换脸：← ↑ 往前，→ ↓ 往后，两头接上；Home / End 到两头。不是这些键返回 null。 */
export function wheelKey(i: number, key: string, n: number): number | null {
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowUp':
      return (i - 1 + n) % n;
    case 'ArrowRight':
    case 'ArrowDown':
      return (i + 1) % n;
    case 'Home':
      return 0;
    case 'End':
      return n - 1;
    default:
      return null;
  }
}

export function MoodWheel({
  value,
  onChange,
  onClose,
  hint,
  autoFocus,
  compact,
  className,
}: {
  value: string | null;
  onChange: (mood: string | null) => void;
  /** Esc 收起。 */
  onClose?: () => void;
  /** 轮子上面一行小字（如「点一下选中，再点一下取消」）。 */
  hint?: string;
  /** 打开就把焦点放到选中的脸（没选就是第一张）。 */
  autoFocus?: boolean;
  /** 窄的地方：脸下面不写名字。 */
  compact?: boolean;
  className?: string;
}) {
  const list = moods();
  const n = list.length;
  const selected = list.findIndex((m) => m.id === value);
  const [focus, setFocus] = useState(selected >= 0 ? selected : 0);
  /** 正在看（悬停 / 键盘移过去）但还没选的那张。 */
  const [preview, setPreview] = useState<number | null>(null);
  const [play, setPlay] = useState(0);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  useEffect(() => {
    if (autoFocus) refs.current[selected >= 0 ? selected : 0]?.focus({ preventScroll: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (i: number) => {
    const m = list[i]!;
    const on = value === m.id;
    onChange(on ? null : m.id);
    if (!on) setPlay((p) => p + 1);
    setPreview(null);
  };
  const onKey = (e: KeyboardEvent, i: number) => {
    if (e.key === 'Escape' && onClose) {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    const next = wheelKey(i, e.key, n);
    if (next === null) return;
    e.preventDefault();
    setFocus(next);
    setPreview(next === selected ? null : next);
    refs.current[next]?.focus();
  };

  const shown = preview ?? (selected >= 0 ? selected : null);
  const center = shown !== null ? list[shown]! : null;
  return (
    <div className={`mood-wheel${compact ? ' is-compact' : ''}${className ? ` ${className}` : ''}`}>
      {hint && <p className="mood-wheel-hint">{hint}</p>}
      <div className="mood-wheel-arc" role="radiogroup" aria-label={tr('心情')} onMouseLeave={() => setPreview(null)}>
        {list.map((m, i) => {
          const p = wheelPoint(i, n);
          const on = i === selected;
          const style = { left: `${p.x}%`, top: `${p.y}%`, '--dx': `${50 - p.x}cqw`, '--dy': `${((70 - p.y) * WHEEL.h) / WHEEL.w}cqw`, '--i': i } as CSSProperties;
          return (
            <button
              key={m.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={on ? tr('心情：{label}（再点一次取消）', { label: m.label }) : tr('心情：{label}', { label: m.label })}
              tabIndex={i === focus ? 0 : -1}
              className={`mood-wheel-face${on ? ' is-selected' : ''}${preview === i ? ' is-preview' : ''}`}
              style={style}
              onClick={() => pick(i)}
              onKeyDown={(e) => onKey(e, i)}
              onFocus={() => setFocus(i)}
              onMouseEnter={() => setPreview(i === selected ? null : i)}
            >
              <MoodIcon mood={m.id} size={40} />
              {!compact && <span className="mood-wheel-label">{m.label}</span>}
            </button>
          );
        })}
        <div className={`mood-wheel-center${center ? '' : ' is-empty'}${preview !== null ? ' is-preview' : ''}`} aria-hidden>
          {center ? (
            <>
              <MoodIcon key={`${center.id}-${play}`} mood={center.id} size={96} playing={preview === null && play > 0} />
              <b className="mood-wheel-name" style={{ color: `var(--mood-${center.id})` }}>
                {center.label}
              </b>
            </>
          ) : (
            <>
              <span className="mood-wheel-empty">
                <Smile size={34} strokeWidth={1.4} />
              </span>
              <span className="mood-wheel-name is-muted">{tr('点一张脸')}</span>
            </>
          )}
        </div>
      </div>
      <div className="mood-wheel-tones" aria-hidden>
        <span>{tr('开心一点')}</span>
        <span>{tr('平平')}</span>
        <span>{tr('不太好')}</span>
      </div>
      <span className="journal-sr" aria-live="polite">
        {value ? tr('心情：{label}', { label: moodLabel(value) || value }) : ''}
      </span>
    </div>
  );
}
