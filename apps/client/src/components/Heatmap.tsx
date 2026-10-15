import { useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react';
import { autoMonthMarker, buildHeatmap, formatDateZh, type DateKey, type MonthMarker } from '@mindough/core';
import { useSettings } from '../lib/settings';

const WEEK_LABELS = ['一', '', '三', '', '五', '', '日'];

/**
 * GitHub 式热力图。格子严格正方形（固定像素，不随容器拉伸）；每月 1 号做标记。
 * 窄屏只露出最近一段（默认滚到最右），可横向滑动看全年。
 */
export function Heatmap({
  end,
  weeks = 53,
  ratioFor,
  color,
  mini,
  label,
  describe,
}: {
  end: DateKey;
  weeks?: number;
  ratioFor: (d: DateKey) => number | null;
  color?: string;
  mini?: boolean;
  label: string;
  describe?: (d: DateKey, ratio: number | null) => string;
}) {
  const { settings, layout } = useSettings();
  const data = useMemo(() => buildHeatmap({ end, weeks, ratioFor }), [end, weeks, ratioFor]);
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [data, layout]);

  const cellPx = mini ? 10 : layout === 'mobile' ? 11 : 14;
  const marker: MonthMarker = settings.monthMarker === 'auto' ? autoMonthMarker(cellPx) : settings.monthMarker;
  const style = { '--heat-color-local': color ?? 'var(--heat-color)', '--c': `${cellPx}px` } as CSSProperties;
  const text = (d: DateKey, r: number | null) =>
    describe ? describe(d, r) : `${formatDateZh(d)}：${r === null ? '无需打卡' : `完成 ${Math.round(Math.min(1, r) * 100)}%`}`;

  return (
    <div className={`heatmap${mini ? ' heatmap-mini' : ''}`} style={style}>
      <div className="heatmap-scroll" ref={scroller}>
        <div className="heatmap-inner">
          {!mini && (
            <div className="heatmap-months" aria-hidden style={{ gridTemplateColumns: `repeat(${weeks}, var(--c))` }}>
              {data.monthLabels.map((m) => (
                <span key={`${m.column}-${m.month}`} style={{ gridColumn: `${m.column + 1} / span 3` }}>
                  {m.label}
                </span>
              ))}
            </div>
          )}
          <div className="heatmap-body">
            {!mini && (
              <div className="heatmap-weekdays" aria-hidden>
                {WEEK_LABELS.map((w, i) => (
                  <span key={i}>{w}</span>
                ))}
              </div>
            )}
            <div className="heatmap-grid" role="grid" aria-label={label} style={{ gridTemplateColumns: `repeat(${weeks}, var(--c))` }}>
              {data.columns.map((col, c) =>
                col.map((cell, r) => (
                  <span
                    key={cell.date}
                    role="gridcell"
                    className={`heat-cell lv-${cell.level}${cell.future ? ' is-future' : ''}${cell.ratio === null ? ' is-free' : ''}${cell.date === end ? ' is-today' : ''}`}
                    style={{ gridColumn: c + 1, gridRow: r + 1 }}
                    title={cell.future ? undefined : text(cell.date, cell.ratio)}
                    aria-label={cell.future ? undefined : text(cell.date, cell.ratio)}
                  >
                    {cell.monthStart !== null && !cell.future && marker === 'number' && <span className="heat-month">{cell.monthStart}</span>}
                    {cell.monthStart !== null && !cell.future && marker === 'dot' && <span className="heat-dot" />}
                  </span>
                )),
              )}
            </div>
          </div>
        </div>
      </div>
      {!mini && (
        <div className="heatmap-legend" aria-hidden>
          <span>少</span>
          {[0, 1, 2, 3].map((l) => (
            <span key={l} className={`heat-cell lv-${l}`} />
          ))}
          <span>达标</span>
        </div>
      )}
    </div>
  );
}
