import { useState } from 'react';
import { parseDate, type CalendarDate } from '@internationalized/date';
import { Button as RacButton, Calendar, CalendarCell, CalendarGrid, CalendarGridBody, CalendarGridHeader, CalendarHeaderCell, Heading } from 'react-aria-components';
import { CalendarArrowUp, ChevronLeft, ChevronRight, Sofa, Sun, Sunrise, type LucideIcon } from 'lucide-react';
import {
  LUNAR_FIRST_YEAR,
  LUNAR_LAST_YEAR,
  formatDate,
  lunarDayLabel,
  lunarMonthLabel,
  lunarToSolar,
  lunarYearLabel,
  lunarYearMonths,
  quickDates,
  solarToLunar,
  todayIn,
  type DateKey,
  type LunarDate,
  type QuickDateKind,
} from '@mindough/core';
import { Button, Segmented, Select, TipButton } from '../../ui/primitives';
import { LUNAR_PICK_KEY, useLunar, type DayLunar } from '../../lib/lunar';
import { useStore } from '../../store/StoreProvider';
import { TimeZoneRow } from './TimeZonePicker';

import { tr } from '../../lib/i18n';
function toKey(d: CalendarDate): DateKey {
  return d.toString();
}

type PickMode = 'solar' | 'lunar';

/** 快捷按钮的图标（Rei 2026-10-25：图标按钮 + hover 提示文字）。 */
const QUICK_ICON: Record<QuickDateKind, LucideIcon> = { today: Sun, tomorrow: Sunrise, weekend: Sofa, monday: CalendarArrowUp };

/** 格子下的农历小字 + 放假 / 补班角标（Rei 2026-10-17）。 */
export function LunarMark({ info }: { info: DayLunar }) {
  const { label, sub } = info;
  return (
    <>
      {label && <span className={`lunar-text is-${label.kind}`}>{label.text}</span>}
      {sub?.badge && <span className={`lunar-badge is-${sub.badge}`}>{sub.badge === 'off' ? tr('休') : tr('班')}</span>}
    </>
  );
}

/** 悬停用的完整说法：「农历九月十四 · 霜降 · 国庆节（休）」。 */
export function lunarTitle(info: DayLunar): string | undefined {
  const parts = info.label?.full ? [info.label.full] : [];
  for (const t of info.sub?.titles ?? []) if (!parts.join(' · ').includes(t)) parts.push(t);
  return parts.join(' · ') || undefined;
}

/**
 * 日期面板：上面一排快捷图标按钮（今天 / 明天 / 本周末 / 下周一，悬停 / 长按显示文字），下面一个月历；可清除。
 * 农历界面显示时（本机「中国农历」开着 且 中文界面，useLunar().show）：格子下显示农历小字（订阅的节日 > 传统节日 > 节气 > 初一月名 > 日子），
 * 并可切到「农历」选择模式：按 农历年 - 月（含闰月）- 日 选，换算成公历存。
 */
export function DatePanel({
  value,
  today,
  onChange,
  clearLabel = tr('不设日期'),
  quick = true,
  timeZone,
  onTimeZoneChange,
}: {
  value: DateKey | null;
  today: DateKey;
  onChange: (d: DateKey | null) => void;
  clearLabel?: string | null;
  quick?: boolean;
  /** 任务时区（空 = 跟着设备）。给了 onTimeZoneChange 才显示「时区」一行（Rei 2026-10-25）。 */
  timeZone?: string | null;
  onTimeZoneChange?: (tz: string) => void;
}) {
  const store = useStore();
  // 快捷「今天 / 明天…」和日历上的「今天」按所选时区的今天算
  const zoneToday = timeZone ? todayIn(timeZone, store.now()) : today;
  const lunar = useLunar(store);
  const [mode, setModeState] = useState<PickMode>(() => (localStorage.getItem(LUNAR_PICK_KEY) === 'lunar' ? 'lunar' : 'solar'));
  const setMode = (m: PickMode) => {
    setModeState(m);
    localStorage.setItem(LUNAR_PICK_KEY, m);
  };
  const lunarMode = lunar.show && mode === 'lunar';
  return (
    <div className={`date-panel${lunar.show ? ' has-lunar' : ''}`}>
      {quick && (
        <div className="date-quick">
          {quickDates(zoneToday).map((q) => {
            const Icon = QUICK_ICON[q.kind];
            return (
              <TipButton key={q.kind} tip={q.label} isPressed={value === q.date} className={`date-quick-item${value === q.date ? ' is-selected' : ''}`} onPress={() => onChange(q.date)}>
                <Icon size={16} aria-hidden />
              </TipButton>
            );
          })}
        </div>
      )}
      {lunar.show && (
        <Segmented<PickMode>
          label={tr('选日期的方式')}
          value={mode}
          onChange={setMode}
          options={[
            { id: 'solar', label: tr('公历') },
            { id: 'lunar', label: tr('农历') },
          ]}
        />
      )}
      {lunarMode ? (
        <LunarPicker value={value} today={zoneToday} onChange={onChange} />
      ) : (
        <Calendar
          aria-label={tr('选择日期')}
          className="calendar"
          firstDayOfWeek="mon"
          value={value ? parseDate(value) : null}
          defaultFocusedValue={parseDate(value ?? zoneToday)}
          onChange={(d) => onChange(toKey(d))}
        >
          <header className="calendar-head">
            <Heading className="calendar-title" />
            <RacButton slot="previous" className="icon-btn" aria-label={tr('上个月')}>
              <ChevronLeft size={16} />
            </RacButton>
            <RacButton slot="next" className="icon-btn" aria-label={tr('下个月')}>
              <ChevronRight size={16} />
            </RacButton>
          </header>
          <CalendarGrid className="calendar-grid" weekdayStyle="narrow">
            <CalendarGridHeader>{(day) => <CalendarHeaderCell className="calendar-dow">{day}</CalendarHeaderCell>}</CalendarGridHeader>
            <CalendarGridBody>
              {(date) => {
                const key = toKey(date);
                const info = lunar.show ? lunar.day(key) : null;
                return (
                  <CalendarCell date={date} className={`calendar-cell${key === zoneToday ? ' is-today' : ''}`} {...(info ? { title: lunarTitle(info) } : {})}>
                    {info ? (
                      <>
                        <span className="calendar-num">{date.day}</span>
                        <LunarMark info={info} />
                      </>
                    ) : (
                      date.day
                    )}
                  </CalendarCell>
                );
              }}
            </CalendarGridBody>
          </CalendarGrid>
        </Calendar>
      )}
      {onTimeZoneChange && <TimeZoneRow value={timeZone ?? null} date={value ?? zoneToday} onChange={onTimeZoneChange} />}
      {clearLabel && value && (
        <RacButton className="date-clear" onPress={() => onChange(null)}>
          {clearLabel}
        </RacButton>
      )}
    </div>
  );
}

const YEARS = Array.from({ length: LUNAR_LAST_YEAR - LUNAR_FIRST_YEAR + 1 }, (_, i) => LUNAR_FIRST_YEAR + i);
const monthId = (m: number, leap: boolean) => `${m}${leap ? 'L' : ''}`;

/** 农历选择：年 / 月（含闰月）/ 日，下面写出对应的公历，点「选这天」才算选好。 */
function LunarPicker({ value, today, onChange }: { value: DateKey | null; today: DateKey; onChange: (d: DateKey) => void }) {
  const [l, setL] = useState<LunarDate>(() => solarToLunar(value ?? today) ?? solarToLunar(today) ?? { year: 2026, month: 1, day: 1, leap: false });
  const months = lunarYearMonths(l.year) ?? [];
  const cur = months.find((m) => m.month === l.month && m.leap === l.leap) ?? months.find((m) => m.month === l.month) ?? months[0]!;
  const day = Math.min(l.day, cur.days);
  const fixed: LunarDate = { year: l.year, month: cur.month, leap: cur.leap, day };
  const solar = lunarToSolar(fixed);
  // 换年时：新的一年没有这个闰月就落到同一个月；三十碰上小月取廿九（选项里也只有 29 天）
  return (
    <div className="lunar-picker">
      <div className="lunar-picker-fields">
        <Select
          label={tr('年')}
          className="lunar-year"
          value={String(l.year)}
          onChange={(v) => setL({ ...fixed, year: Number(v) })}
          options={YEARS.map((y) => ({ id: String(y), label: lunarYearLabel(y) }))}
        />
        <Select
          label={tr('月')}
          className="lunar-month"
          value={monthId(cur.month, cur.leap)}
          onChange={(v) => setL({ ...fixed, month: parseInt(v, 10), leap: v.endsWith('L') })}
          options={months.map((m) => ({ id: monthId(m.month, m.leap), label: lunarMonthLabel(m.month, m.leap) }))}
        />
        <Select
          label={tr('日')}
          className="lunar-day"
          value={String(day)}
          onChange={(v) => setL({ ...fixed, day: Number(v) })}
          options={Array.from({ length: cur.days }, (_, i) => ({ id: String(i + 1), label: lunarDayLabel(i + 1) }))}
        />
      </div>
      <p className="lunar-picker-solar">{solar ? tr('公历 {date}', { date: formatDate(solar, { weekday: true, year: true }) }) : tr('这天不在 1900–2100 年的范围里')}</p>
      <Button variant={solar === value ? 'secondary' : 'primary'} isDisabled={!solar} onPress={() => solar && onChange(solar)}>
        {solar === value ? tr('已选这天') : tr('选这天')}
      </Button>
    </div>
  );
}
