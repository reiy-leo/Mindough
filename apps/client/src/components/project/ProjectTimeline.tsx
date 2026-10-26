/**
 * 项目页「时间轴」视图（Rei 2026-10-26「每个项目的视图支持列表、看板、时间轴」）：
 * 每件有日期的任务一行，横条从开始画到到期（字段对应见 lib/project-view）；没有日期的放下面「未定时间」。
 * 能按日 / 周 / 月缩放（本机记住），有今天线；本项目里两件都在时间轴上的前后关系画箭头（前一件的尾 → 后一件的头）。
 * 横向放不下时可以横向滚动，任务名一栏贴在左边不动；打开时滚到今天附近。
 */
import { useEffect, useMemo, useRef } from 'react';
import { Button as RacButton } from 'react-aria-components';
import { formatDate, monthShort, parseDateKey, todayKey, weekStartsOn, type Store, type Task } from '@mindough/core';
import { useUi } from '../../lib/ui';
import { timelineLayout, type TimelineScale } from '../../lib/project-view';
import { STATE_CLASS, titleOf } from '../../lib/view';
import { Section, Segmented } from '../../ui/primitives';
import { TaskRow } from '../TaskRow';

import { tr } from '../../lib/i18n';

const ROW_H = 36;

export function ProjectTimeline({ store, tasks, scale, onScale }: { store: Store; tasks: Task[]; scale: TimelineScale; onScale: (s: TimelineScale) => void }) {
  const ui = useUi();
  const today = todayKey(store.now());
  const layout = useMemo(() => timelineLayout(tasks, today, scale, { weekStartsOn: weekStartsOn() }), [tasks, today, scale]);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const barOf = new Map(layout.bars.map((b) => [b.id, b]));
  const arrows = store.edges().filter((e) => barOf.has(e.pred_id) && barOf.has(e.succ_id));
  const scroller = useRef<HTMLDivElement>(null);
  // 打开 / 换缩放时把今天滚到左边三分之一处
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollLeft = Math.max(0, layout.todayLeft - el.clientWidth / 3);
  }, [layout.todayLeft, scale]);
  const height = layout.bars.length * ROW_H;
  const tickLabel = (date: string, monthStart: boolean) => {
    const { m, d } = parseDateKey(date);
    if (scale === 'month') return monthShort(m);
    if (scale === 'week') return formatDate(date, { weekday: false });
    return monthStart ? formatDate(date, { weekday: false }) : String(d);
  };
  return (
    <div className="timeline">
      <div className="timeline-tools">
        <Segmented<TimelineScale>
          label={tr('时间轴缩放')}
          value={scale}
          onChange={onScale}
          options={[
            { id: 'day', label: tr('日') },
            { id: 'week', label: tr('周') },
            { id: 'month', label: tr('月') },
          ]}
        />
      </div>
      {layout.bars.length > 0 && (
        <div className="tl-scroll" ref={scroller}>
          <div className="tl-grid" style={{ width: `calc(var(--tl-name-w) + ${layout.width}px)` }}>
            <div className="tl-head">
              <div className="tl-name tl-name-head">{tr('任务')}</div>
              <div className="tl-ticks" style={{ width: layout.width }}>
                {layout.ticks.map((tk) => (
                  <span key={tk.date} className={`tl-tick${tk.monthStart ? ' is-month' : ''}${tk.date === today ? ' is-today' : ''}`} style={{ left: tk.left }}>
                    {tickLabel(tk.date, tk.monthStart)}
                  </span>
                ))}
                <span className="tl-today-line" style={{ left: layout.todayLeft }} aria-hidden />
              </div>
            </div>
            <div className="tl-body" style={{ height }}>
              <div className="tl-lanes" style={{ width: layout.width, height }} aria-hidden>
                {layout.ticks.map((tk) => (
                  <span key={tk.date} className={`tl-gridline${tk.monthStart ? ' is-month' : ''}`} style={{ left: tk.left }} />
                ))}
                <span className="tl-today-line" style={{ left: layout.todayLeft }} />
                {arrows.length > 0 && (
                  <svg className="tl-arrows" width={layout.width} height={height}>
                    <defs>
                      <marker id="tl-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                        <path d="M0,0 L8,4 L0,8 z" />
                      </marker>
                    </defs>
                    {arrows.map((e) => {
                      const a = barOf.get(e.pred_id)!;
                      const b = barOf.get(e.succ_id)!;
                      const x1 = a.left + a.width;
                      const y1 = a.row * ROW_H + ROW_H / 2;
                      const x2 = b.left;
                      const y2 = b.row * ROW_H + ROW_H / 2;
                      const bend = Math.max(12, Math.min(40, Math.abs(x2 - x1) / 2));
                      return <path key={`${e.pred_id}>${e.succ_id}`} d={`M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2 - 1},${y2}`} markerEnd="url(#tl-arrow)" />;
                    })}
                  </svg>
                )}
              </div>
              {layout.bars.map((b) => {
                const t = byId.get(b.id)!;
                const title = titleOf(store, t) || tr('任务');
                const state = store.derived().get(t.id)?.state;
                const range = b.start === b.end ? formatDate(b.start) : tr('{from} – {to}', { from: formatDate(b.start), to: formatDate(b.end) });
                return (
                  <div key={b.id} className={`tl-row${ui.editingId === b.id ? ' is-selected' : ''}`} style={{ top: b.row * ROW_H, height: ROW_H }} data-task-id={b.id}>
                    <RacButton className="tl-name" onPress={() => ui.openEditor(b.id)}>
                      <span className="tl-name-text">{title}</span>
                    </RacButton>
                    <RacButton
                      className={`tl-bar ${STATE_CLASS[state ?? ''] ?? ''}${t.status === '进行中' ? ' is-doing' : ''}`}
                      style={{ left: `calc(var(--tl-name-w) + ${b.left}px)`, width: Math.max(b.width - 2, 6) }}
                      onPress={() => ui.openEditor(b.id)}
                      aria-label={`${title} · ${range}`}
                    >
                      {b.width >= 72 && <span className="tl-bar-text">{title}</span>}
                    </RacButton>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
      {layout.bars.length === 0 && <div className="tl-none">{tr('这个项目里的任务都还没有日期')}</div>}
      {layout.undated.length > 0 && (
        <Section title={tr('未定时间 {n}', { n: layout.undated.length })}>
          <div className="task-list plain">
            {layout.undated.map((id) => {
              const t = byId.get(id)!;
              return <TaskRow key={id} store={store} task={t} showGroup={false} showDate />;
            })}
          </div>
        </Section>
      )}
    </div>
  );
}
