/**
 * 不可点的小标记 + 悬停提示（Rei 2026-10-27：列表行标题下的状态改成图标，hover 显示文字）。
 * React Aria 的 TooltipTrigger 要可聚焦的触发器，行本身已经是按钮，里面不能再套按钮，所以这里自己画：
 * 鼠标 / 触控笔悬停 400ms 显示，离开就收；触屏不弹（长按留给行菜单），文字同时是 aria-label。
 * 提示挂到 body，用 position: fixed 定位在标记上方，空间不够放下方；外观沿用 .tooltip。
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function HoverTip({ tip, className, style, children }: { tip: string; className?: string; style?: CSSProperties; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number; below: boolean } | null>(null);
  const clear = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clear, []);
  return (
    <span
      ref={ref}
      className={className}
      style={style}
      role="img"
      aria-label={tip}
      onPointerEnter={(e) => {
        if (e.pointerType === 'touch') return;
        clear();
        timer.current = window.setTimeout(() => {
          const r = ref.current?.getBoundingClientRect();
          if (!r) return;
          const below = r.top < 40;
          setPos({ x: r.left + r.width / 2, y: below ? r.bottom + 6 : r.top - 6, below });
        }, 400);
      }}
      onPointerLeave={() => {
        clear();
        setPos(null);
      }}
    >
      {children}
      {pos &&
        createPortal(
          <div
            className="tooltip hover-tip"
            role="tooltip"
            style={{ left: pos.x, top: pos.y, transform: `translate(-50%, ${pos.below ? '0' : '-100%'})` }}
          >
            {tip}
          </div>,
          document.body,
        )}
    </span>
  );
}
