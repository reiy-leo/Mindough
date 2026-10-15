import { parseDate, type CalendarDate } from '@internationalized/date';
import { Button as RacButton, Calendar, CalendarCell, CalendarGrid, CalendarGridBody, CalendarGridHeader, CalendarHeaderCell, Heading } from 'react-aria-components';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { quickDates, type DateKey } from '@mindough/core';

function toKey(d: CalendarDate): DateKey {
  return d.toString();
}

/** 日期面板：上面一排快捷（今天 / 明天 / 本周末 / 下周一），下面一个月历；可清除。 */
export function DatePanel({
  value,
  today,
  onChange,
  clearLabel = '不设日期',
  quick = true,
}: {
  value: DateKey | null;
  today: DateKey;
  onChange: (d: DateKey | null) => void;
  clearLabel?: string | null;
  quick?: boolean;
}) {
  return (
    <div className="date-panel">
      {quick && (
        <div className="date-quick">
          {quickDates(today).map((q) => (
            <RacButton key={q.label} className={`date-quick-item${value === q.date ? ' is-selected' : ''}`} onPress={() => onChange(q.date)}>
              {q.label}
            </RacButton>
          ))}
        </div>
      )}
      <Calendar
        aria-label="选择日期"
        className="calendar"
        firstDayOfWeek="mon"
        value={value ? parseDate(value) : null}
        defaultFocusedValue={parseDate(value ?? today)}
        onChange={(d) => onChange(toKey(d))}
      >
        <header className="calendar-head">
          <Heading className="calendar-title" />
          <RacButton slot="previous" className="icon-btn" aria-label="上个月">
            <ChevronLeft size={16} />
          </RacButton>
          <RacButton slot="next" className="icon-btn" aria-label="下个月">
            <ChevronRight size={16} />
          </RacButton>
        </header>
        <CalendarGrid className="calendar-grid" weekdayStyle="narrow">
          <CalendarGridHeader>{(day) => <CalendarHeaderCell className="calendar-dow">{day}</CalendarHeaderCell>}</CalendarGridHeader>
          <CalendarGridBody>
            {(date) => (
              <CalendarCell date={date} className={`calendar-cell${toKey(date) === today ? ' is-today' : ''}`}>
                {date.day}
              </CalendarCell>
            )}
          </CalendarGridBody>
        </CalendarGrid>
      </Calendar>
      {clearLabel && value && (
        <RacButton className="date-clear" onPress={() => onChange(null)}>
          {clearLabel}
        </RacButton>
      )}
    </div>
  );
}
