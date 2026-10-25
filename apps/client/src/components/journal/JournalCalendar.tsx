/**
 * 日记的月历（周一开始）+ 这个月的列表。写过的日子一个小点（有心情就用心情色），今天描边，
 * 将来的日子灰掉、点不了（Rei 2026-10-17「将来这日子不能写」）。
 */
import { Button as RacButton } from 'react-aria-components';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addMonths, formatDate, getLocale, hasJournalContent, intlLocale, journalOfMonth, journalPreview, journalWordCount, monthGrid, moodLabel, parseDateKey, weekdayLabel, weekOrder, type JournalEntry } from '@mindough/core';
import { MoodIcon } from './MoodIcon';
import { LunarMark, lunarTitle } from '../task/DatePanel';
import { useLunar } from '../../lib/lunar';
import { useStore } from '../../store/StoreProvider';
import { tr } from '../../lib/i18n';

/** 「2026年10月」/「October 2026」。 */
export function monthTitle(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Intl.DateTimeFormat(intlLocale(getLocale()), { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
}

export function JournalCalendar({
  month,
  onMonth,
  selected,
  today,
  entries,
  onSelect,
  attachments,
}: {
  month: string;
  onMonth: (month: string) => void;
  selected: string;
  today: string;
  entries: ReadonlyMap<string, JournalEntry>;
  attachments?: (entryId: string) => number;
  onSelect: (date: string) => void;
}) {
  const todayMonth = today.slice(0, 7);
  const cells = monthGrid(month);
  const lunar = useLunar(useStore());
  return (
    <div className={`jcal${lunar.show ? ' has-lunar' : ''}`}>
      <div className="jcal-head">
        <RacButton className="icon-btn" aria-label={tr('上个月')} onPress={() => onMonth(addMonths(month, -1))}>
          <ChevronLeft size={18} />
        </RacButton>
        <h2 className="jcal-title" aria-live="polite">
          {monthTitle(month)}
        </h2>
        <RacButton className="icon-btn" aria-label={tr('下个月')} isDisabled={month >= todayMonth} onPress={() => onMonth(addMonths(month, 1))}>
          <ChevronRight size={18} />
        </RacButton>
      </div>
      <div className="jcal-grid" role="grid" aria-label={monthTitle(month)}>
        <div className="jcal-row jcal-weekdays" role="row">
          {weekOrder().map((dow) => (
            <span key={dow} className="jcal-wd" role="columnheader" aria-label={weekdayLabel(dow, 'long')}>
              {weekdayLabel(dow, 'narrow')}
            </span>
          ))}
        </div>
        {Array.from({ length: cells.length / 7 }, (_, r) => (
          <div key={r} className="jcal-row" role="row">
            {cells.slice(r * 7, r * 7 + 7).map((d, i) => {
              if (!d) return <span key={`x${i}`} className="jcal-cell is-blank" role="gridcell" />;
              const e = entries.get(d);
              const written = hasJournalContent(e) || (!!e && (attachments?.(e.id) ?? 0) > 0);
              const future = d > today;
              const info = lunar.show ? lunar.day(d) : null;
              const title = info ? lunarTitle(info) : undefined;
              const base = future ? tr('{date}，还没到', { date: formatDate(d) }) : written ? tr('{date}，写了日记', { date: formatDate(d) }) : formatDate(d);
              const label = title ? `${base} · ${title}` : base;
              return (
                <span key={d} role="gridcell" className="jcal-cellwrap">
                  <RacButton
                    className={`jcal-cell${d === today ? ' is-today' : ''}${d === selected ? ' is-selected' : ''}${written ? ' has-entry' : ''}${future ? ' is-future' : ''}`}
                    isDisabled={future}
                    aria-label={label}
                    aria-current={d === selected ? 'date' : undefined}
                    onPress={() => onSelect(d)}
                  >
                    <span className="jcal-num">{parseDateKey(d).d}</span>
                    {info && <LunarMark info={info} />}
                    <span className="jcal-dot" style={e?.mood ? { background: `var(--mood-${e.mood}, var(--accent))` } : undefined} aria-hidden />
                  </RacButton>
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/** 这个月写过的日子（倒序）。 */
export function JournalMonthList({
  month,
  entries,
  selected,
  onSelect,
  attachments,
}: {
  month: string;
  entries: readonly JournalEntry[];
  selected: string;
  onSelect: (date: string) => void;
  /** 那天日记的附件个数（只有附件的日子显示「N 个附件」）。 */
  attachments?: (entryId: string) => number;
}) {
  const list = journalOfMonth(entries, month);
  if (!list.length) return <p className="jlist-empty muted">{tr('这个月还没写日记')}</p>;
  return (
    <ul className="jlist" aria-label={tr('这个月的日记')}>
      {list.map((e) => {
        const words = journalWordCount(e.body_md);
        return (
          <li key={e.id}>
            <RacButton className={`jlist-item${e.date === selected ? ' is-selected' : ''}`} onPress={() => onSelect(e.date)}>
              <span className="jlist-date">{formatDate(e.date)}</span>
              {e.mood && (
                <span className="jlist-mood" title={moodLabel(e.mood)}>
                  <MoodIcon mood={e.mood} size={18} />
                </span>
              )}
              <span className="jlist-text">
                {journalPreview(e.body_md) || <span className="muted">{e.mood ? moodLabel(e.mood) : tr('{n} 个附件', { n: attachments?.(e.id) ?? 0 })}</span>}
              </span>
              {words > 0 && <span className="jlist-count">{tr('{n} 字', { n: words })}</span>}
            </RacButton>
          </li>
        );
      })}
    </ul>
  );
}
