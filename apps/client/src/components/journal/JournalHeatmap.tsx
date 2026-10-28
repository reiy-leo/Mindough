/**
 * 日记的活动图（Rei 2026-10-28「两栏，左侧顶部显示activity图，点击可以切换」「activity图的颜色根据心情的颜色mix」）。
 * GitHub 式：一列一周、一行一天，月份标签在下面；默认露出最近一段，能左右滑到更早。
 * 一天的颜色 = 当天各条心情色在 OKLab 里取平均（core dayMoodColor），没心情的算主色；条数越多越深（heatStrength）。
 * 点一个格子只看那天，再点一次回到全部。整张图一个 Tab 停靠点，方向键换天（← → 一周，↑ ↓ 一天），回车 / 空格选中。
 */
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { MOOD_IDS, addDays, buildHeatmap, dayMoodColor, formatDate, heatStrength, moodLabel, type DateKey } from '@mindough/core';
import { useSettings } from '../../lib/settings';
import { tr } from '../../lib/i18n';

export interface DayInfo {
  count: number;
  moods: Array<string | null>;
}

/** 从皮肤令牌读出 12 个心情色和主色（换皮肤、明暗时重新读）。 */
function usePalette(el: HTMLElement | null) {
  const { skin, theme } = useSettings();
  const [palette, setPalette] = useState<{ moods: Record<string, string>; neutral: string } | null>(null);
  useLayoutEffect(() => {
    const cs = getComputedStyle(el ?? document.documentElement);
    const moods: Record<string, string> = {};
    for (const id of MOOD_IDS) moods[id] = cs.getPropertyValue(`--mood-${id}`).trim();
    setPalette({ moods, neutral: cs.getPropertyValue('--accent').trim() || '#888888' });
  }, [el, skin, theme]);
  return palette;
}

export function JournalHeatmap({
  days,
  weeks,
  today,
  selected,
  onSelect,
}: {
  days: ReadonlyMap<DateKey, DayInfo>;
  weeks: number;
  today: DateKey;
  selected: DateKey | null;
  onSelect: (day: DateKey | null) => void;
}) {
  const { layout } = useSettings();
  const box = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const palette = usePalette(host);
  const data = useMemo(() => buildHeatmap({ end: today, weeks, ratioFor: () => null }), [today, weeks]);
  const [focus, setFocus] = useState<DateKey>(selected ?? today);
  useLayoutEffect(() => setFocus(selected ?? today), [selected, today]);

  // 一打开滚到最右（最近）；选中的那天在视野外就滚过去
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [data, layout]);

  const cellPx = layout === 'mobile' ? 13 : 14;
  const colorOf = (d: DateKey): string | null => {
    const info = days.get(d);
    if (!info || !palette) return null;
    const c = dayMoodColor(info.moods, palette.moods, palette.neutral);
    if (!c) return null;
    const pct = Math.round(heatStrength(info.count) * 100);
    return pct >= 100 ? c : `color-mix(in oklab, ${c} ${pct}%, var(--jheat-empty))`;
  };
  const label = (d: DateKey) => {
    const info = days.get(d);
    const date = formatDate(d, { year: true, weekday: true });
    if (!info) return tr('{date}：没写', { date });
    const named = [...new Set(info.moods.filter((m): m is string => !!m))].map((m) => moodLabel(m) || m);
    return [tr('{date}：{n} 条', { date, n: info.count }), named.join(' · ')].filter(Boolean).join(' · ');
  };

  const move = (d: DateKey) => {
    if (d > today || d < data.start) return;
    setFocus(d);
    requestAnimationFrame(() => {
      const btn = box.current?.querySelector<HTMLElement>(`[data-day="${d}"]`);
      btn?.focus();
      btn?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  };
  const onKey = (e: KeyboardEvent) => {
    const step: Record<string, number> = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 };
    if (e.key in step) {
      e.preventDefault();
      move(addDays(focus, step[e.key]!));
    } else if (e.key === 'Home') {
      e.preventDefault();
      move(data.start);
    } else if (e.key === 'End') {
      e.preventDefault();
      move(today);
    }
  };

  return (
    <div
      ref={(el) => {
        box.current = el;
        setHost(el);
      }}
      className="jheat"
      style={{ '--c': `${cellPx}px` } as CSSProperties}
    >
      <div className="jheat-scroll" ref={scroller}>
        <div className="jheat-inner" role="group" aria-label={tr('写日记的日子')} onKeyDown={onKey}>
          <div className="jheat-grid" style={{ gridTemplateColumns: `repeat(${data.columns.length}, var(--c))` }}>
            {data.columns.map((col, c) => (
              <div key={c} className="jheat-col">
                {col.map((cell) => {
                  if (cell.future) return <span key={cell.date} className="jheat-cell is-future" aria-hidden />;
                  const color = colorOf(cell.date);
                  const isSel = selected === cell.date;
                  return (
                    <button
                      key={cell.date}
                      type="button"
                      data-day={cell.date}
                      tabIndex={focus === cell.date ? 0 : -1}
                      aria-pressed={isSel}
                      aria-label={label(cell.date)}
                      title={label(cell.date)}
                      className={`jheat-cell${color ? ' has-posts' : ''}${isSel ? ' is-selected' : ''}${cell.date === today ? ' is-today' : ''}`}
                      style={color ? ({ '--jc': color } as CSSProperties) : undefined}
                      onFocus={() => setFocus(cell.date)}
                      onClick={() => onSelect(isSel ? null : cell.date)}
                    />
                  );
                })}
              </div>
            ))}
          </div>
          <div className="jheat-months" aria-hidden style={{ gridTemplateColumns: `repeat(${data.columns.length}, var(--c))` }}>
            {data.monthLabels.map((m) => (
              <span key={`${m.column}-${m.month}`} style={{ gridColumn: `${m.column + 1} / span 3` }}>
                {m.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
