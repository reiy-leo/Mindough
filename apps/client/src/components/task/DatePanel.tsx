import { useState } from 'react';
import { parseDate, type CalendarDate } from '@internationalized/date';
import { Button as RacButton, Calendar, CalendarCell, CalendarGrid, CalendarGridBody, CalendarGridHeader, CalendarHeaderCell, Heading } from 'react-aria-components';
import { CalendarArrowUp, ChevronLeft, ChevronRight, Sofa, Sun, Sunrise, type LucideIcon } from 'lucide-react';
import {
  LUNAR_FIRST_YEAR,
  LUNAR_LAST_YEAR,
  formatDate,
  formatDateRange,
  lunarDayLabel,
  lunarMonthLabel,
  lunarToSolar,
  lunarYearLabel,
  lunarYearMonths,
  pickRangeDay,
  quickDates,
  rangeCellRole,
  shiftRangeTo,
  solarToLunar,
  todayIn,
  type DateKey,
  type LunarDate,
  type QuickDateKind,
  type RangeEdge,
  weekStartsOn,
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
/** 单日 / 日期段（Rei 2026-10-26）。 */
type SpanKind = 'single' | 'range';

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
  end = null,
  onRangeChange,
}: {
  value: DateKey | null;
  today: DateKey;
  onChange: (d: DateKey | null) => void;
  clearLabel?: string | null;
  quick?: boolean;
  /** 任务时区（空 = 跟着设备）。给了 onTimeZoneChange 才显示「时区」一行（Rei 2026-10-25）。 */
  timeZone?: string | null;
  onTimeZoneChange?: (tz: string) => void;
  /** 日期段的结束日（空 = 单日）。 */
  end?: DateKey | null;
  /**
   * 给了才能切「单日 / 日期段」（Rei 2026-10-26「现在的日期只是单个日期，要支持日期段」）。
   * 日期段里每点一下都回调一次；done = 这一段选完了（点了结束日、清掉结束日、点了快捷项），弹层可以关。
   */
  onRangeChange?: (start: DateKey | null, end: DateKey | null, done: boolean) => void;
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
  const canRange = !!onRangeChange;
  const [kind, setKind] = useState<SpanKind>(() => (canRange && end && value && end > value ? 'range' : 'single'));
  // 日期段：下一次点格子改哪一头。打开时有开始没结束就等结束，否则从开始选起
  const [editing, setEditing] = useState<RangeEdge>(() => (value && !end ? 'end' : 'start'));
  const ranged = canRange && kind === 'range';
  // 月历显示哪个月：点「开始 / 结束」时跳到那一头所在的月
  const [focused, setFocused] = useState<CalendarDate>(() => parseDate(value ?? zoneToday));
  const editEdge = (e: RangeEdge) => {
    setEditing(e);
    const d = e === 'end' ? (end ?? value) : value;
    if (d) setFocused(parseDate(d));
  };
  const lunarMode = lunar.show && mode === 'lunar';

  const pickDay = (d: DateKey) => {
    if (!ranged) return onChange(d);
    const next = pickRangeDay({ start: value, end, editing }, d);
    setEditing(next.editing);
    onRangeChange!(next.start, next.end, next.done);
  };
  const pickQuick = (d: DateKey) => {
    setFocused(parseDate(d));
    if (!ranged) return onChange(d);
    // 日期段里点快捷项：开始挪到那天，天数不变
    const r = shiftRangeTo({ start: value, end }, d);
    setEditing('start');
    onRangeChange!(r.start, r.end, true);
  };
  const switchKind = (k: SpanKind) => {
    setKind(k);
    if (k === 'single') {
      if (end) onRangeChange!(value, null, false);
    } else setEditing(value ? 'end' : 'start');
  };
  const quickSelected = (d: DateKey) => value === d && (!ranged || !end);

  return (
    <div className={`date-panel${lunar.show ? ' has-lunar' : ''}${ranged ? ' is-range' : ''}`}>
      {quick && (
        <div className="date-quick">
          {quickDates(zoneToday).map((q) => {
            const Icon = QUICK_ICON[q.kind];
            const on = quickSelected(q.date);
            return (
              <TipButton key={q.kind} tip={q.label} isPressed={on} className={`date-quick-item${on ? ' is-selected' : ''}`} onPress={() => pickQuick(q.date)}>
                <Icon size={16} aria-hidden />
              </TipButton>
            );
          })}
        </div>
      )}
      {canRange && (
        <Segmented<SpanKind>
          label={tr('单日还是日期段')}
          value={kind}
          onChange={switchKind}
          options={[
            { id: 'single', label: tr('单日') },
            { id: 'range', label: tr('日期段') },
          ]}
        />
      )}
      {ranged && <RangeEnds start={value} end={end} editing={editing} today={zoneToday} onEdit={editEdge} />}
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
        <LunarPicker key={ranged ? editing : "single"} value={ranged ? (editing === 'end' ? (end ?? value) : value) : value} today={zoneToday} onChange={pickDay} />
      ) : (
        <Calendar
          aria-label={ranged ? (editing === 'start' ? tr('选开始日') : tr('选结束日')) : tr('选择日期')}
          className="calendar"
          firstDayOfWeek={weekStartsOn() === 0 ? 'sun' : 'mon'}
          // 日期段自己画高亮：value 一直是 null，点同一天也会回调
          value={ranged ? null : value ? parseDate(value) : null}
          focusedValue={focused}
          onFocusChange={setFocused}
          onChange={(d) => pickDay(toKey(d))}
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
                const role = ranged ? rangeCellRole({ start: value, end }, key) : null;
                return (
                  <CalendarCell date={date} className={`calendar-cell${key === zoneToday ? ' is-today' : ''}${role ? ` in-range is-range-${role}` : ''}`} {...(info ? { title: lunarTitle(info) } : {})}>
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
      {ranged && value && end && <p className="date-range-sum">{formatDateRange(value, end, zoneToday)}</p>}
      {onTimeZoneChange && <TimeZoneRow value={timeZone ?? null} date={value ?? zoneToday} onChange={onTimeZoneChange} />}
      {ranged && end && (
        <RacButton
          className="date-clear"
          onPress={() => {
            setKind('single');
            setEditing('end');
            onRangeChange!(value, null, true);
          }}
        >
          {tr('去掉结束日')}
        </RacButton>
      )}
      {clearLabel && value && (
        <RacButton className="date-clear" onPress={() => (canRange ? onRangeChange!(null, null, true) : onChange(null))}>
          {clearLabel}
        </RacButton>
      )}
    </div>
  );
}

/** 日期段的两头：「开始 10月26日」「结束 10月30日」，点一个只改那一头。 */
function RangeEnds({ start, end, editing, today, onEdit }: { start: DateKey | null; end: DateKey | null; editing: RangeEdge; today: DateKey; onEdit: (e: RangeEdge) => void }) {
  const text = (d: DateKey | null) => (d ? formatDate(d, { weekday: false, year: d.slice(0, 4) !== today.slice(0, 4) }) : null);
  return (
    <div className="range-ends" role="group" aria-label={tr('日期段')}>
      {(['start', 'end'] as const).map((e) => {
        const d = e === 'start' ? start : end;
        return (
          <RacButton key={e} className={`range-end${editing === e ? ' is-editing' : ''}`} aria-pressed={editing === e} onPress={() => onEdit(e)}>
            <span className="range-end-label">{e === 'start' ? tr('开始') : tr('结束')}</span>
            <span className={`range-end-value${d ? '' : ' is-empty'}`}>{text(d) ?? (e === 'start' ? tr('选开始日') : tr('选结束日'))}</span>
          </RacButton>
        );
      })}
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
