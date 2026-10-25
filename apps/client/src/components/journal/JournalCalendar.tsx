/**
 * 日记的「情绪月历」（日记改版 B，Rei 2026-10-25「按B实现」）：每格铺满那天心情的淡色，中间画那张脸；
 * 写了没选心情的是中性色，没写的浅灰，今天还没写是虚线加号，将来的日子是虚线格、点不了（Rei 2026-10-17）。
 * 下面是「这个月的心情」分布条和这个月写过的日子（倒序）。
 */
import type { CSSProperties } from 'react';
import { Button as RacButton } from 'react-aria-components';
import { ChevronLeft, ChevronRight, PenLine, Plus } from 'lucide-react';
import { addMonths, formatDate, getLocale, hasJournalContent, intlLocale, isMoodId, journalOfMonth, journalPreview, monthGrid, moodLabel, parseDateKey, weekdayLabel, weekOrder, type JournalEntry, type MonthMoodStats } from '@mindough/core';
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

/** 心情色令牌；不认识的心情按「一般」的颜色。 */
export const moodVar = (mood: string) => `var(--mood-${isMoodId(mood) ? mood : 'okay'})`;

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
  /** 选中的那天；手机月历首页不选（null）。 */
  selected: string | null;
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
        <h2 className="jcal-title" aria-live="polite">
          {monthTitle(month)}
        </h2>
        <RacButton className="icon-btn" aria-label={tr('上个月')} onPress={() => onMonth(addMonths(month, -1))}>
          <ChevronLeft size={18} />
        </RacButton>
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
              if (!d) return <span key={`x${i}`} className="jcal-cellwrap is-blank" role="gridcell" />;
              const e = entries.get(d);
              const written = hasJournalContent(e) || (!!e && (attachments?.(e.id) ?? 0) > 0);
              const mood = written && e?.mood ? e.mood : null;
              const future = d > today;
              const isToday = d === today;
              const info = lunar.show ? lunar.day(d) : null;
              const title = info ? lunarTitle(info) : undefined;
              const base = future
                ? tr('{date}，还没到', { date: formatDate(d) })
                : mood
                  ? tr('{date}，心情：{label}', { date: formatDate(d), label: moodLabel(mood) || mood })
                  : written
                    ? tr('{date}，写了日记', { date: formatDate(d) })
                    : formatDate(d);
              const label = title ? `${base} · ${title}` : base;
              const state = future ? 'is-future' : mood ? 'has-mood' : written ? 'has-entry' : isToday ? 'is-ask' : 'is-missed';
              return (
                <span key={d} role="gridcell" className="jcal-cellwrap">
                  <RacButton
                    className={`jcal-cell ${state}${isToday ? ' is-today' : ''}${d === selected ? ' is-selected' : ''}`}
                    style={mood ? ({ '--cell-mood': moodVar(mood) } as CSSProperties) : undefined}
                    isDisabled={future}
                    aria-label={label}
                    aria-current={d === selected ? 'date' : undefined}
                    onPress={() => onSelect(d)}
                  >
                    <span className="jcal-top">
                      <span className="jcal-num">{parseDateKey(d).d}</span>
                      {info && <LunarMark info={info} />}
                    </span>
                    <span className="jcal-face" aria-hidden>
                      {mood ? <MoodIcon mood={mood} size={24} /> : written ? <PenLine size={14} /> : isToday ? <Plus size={16} /> : null}
                    </span>
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

/**
 * 「这个月的心情」分布条（改版 B 原型里标了「可选」，按原型默认做了，待 Rei 确认）：
 * 每种心情一段，长短按天数；下面是图例「开心 2」；右上角「写了 N 天」。这个月一篇都没有就不显示。
 */
export function MoodSummary({ stats }: { stats: MonthMoodStats }) {
  if (!stats.written) return null;
  const parts: Array<{ key: string; label: string; days: number; color: string }> = stats.moods.map((m) => ({ key: m.id, label: moodLabel(m.id), days: m.days, color: `var(--mood-${m.id})` }));
  if (stats.unknown) parts.push({ key: 'unknown', label: tr('其他'), days: stats.unknown, color: 'var(--mood-okay)' });
  if (stats.noMood) parts.push({ key: 'none', label: tr('没选心情'), days: stats.noMood, color: 'var(--surface-3)' });
  return (
    <section className="jmood" aria-label={tr('这个月的心情')}>
      <div className="jmood-head">
        <span>{tr('这个月的心情')}</span>
        <span className="jmood-days">{tr('写了 {n} 天', { n: stats.written })}</span>
      </div>
      <div className="jmood-bar" role="img" aria-label={parts.map((p) => tr('{label}：{n} 天', { label: p.label, n: p.days })).join(' · ')}>
        {parts.map((p) => (
          <i key={p.key} className={p.key === 'none' ? 'is-none' : undefined} style={{ flexGrow: p.days, background: p.color }} />
        ))}
      </div>
      <ul className="jmood-legend" aria-hidden>
        {parts.map((p) => (
          <li key={p.key}>
            <i className={p.key === 'none' ? 'is-none' : undefined} style={{ background: p.color }} />
            {p.label} {p.days}
          </li>
        ))}
      </ul>
    </section>
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
  selected: string | null;
  onSelect: (date: string) => void;
  /** 那天日记的附件个数（只有附件的日子显示「N 个附件」）。 */
  attachments?: (entryId: string) => number;
}) {
  const list = journalOfMonth(entries, month);
  if (!list.length) return <p className="jlist-empty muted">{tr('这个月还没写日记')}</p>;
  return (
    <ul className="jlist" aria-label={tr('这个月的日记')}>
      {list.map((e) => {
        return (
          <li key={e.id}>
            <RacButton className={`jlist-item${e.date === selected ? ' is-selected' : ''}`} onPress={() => onSelect(e.date)}>
              <span className="jlist-date">{formatDate(e.date)}</span>
              <span className="jlist-mood" title={e.mood ? moodLabel(e.mood) : undefined}>
                {e.mood ? <MoodIcon mood={e.mood} size={20} /> : <span className="jlist-nomood" />}
              </span>
              <span className="jlist-text">
                {journalPreview(e.body_md) || <span className="muted">{e.mood ? moodLabel(e.mood) : tr('{n} 个附件', { n: attachments?.(e.id) ?? 0 })}</span>}
              </span>
            </RacButton>
          </li>
        );
      })}
    </ul>
  );
}
