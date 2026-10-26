/**
 * 日期段（Rei 2026-10-26「现在的日期只是单个日期，要支持日期段」）。
 *
 * - 任务的开始日是 scheduled_date，结束日是 end_date（可空，SQLite 迁移 v10）。end_date 空 = 单日，老任务都是单日。
 * - 结束日只会晚于开始日：等于开始日、早于开始日、没有开始日时都存 null（normalizeRange）。
 * - 「到期」看结束日：过期、任务链「已过 / 明天」、项目页按到期排序都用 taskEndDate（没有结束日就是开始日）。
 * - 提醒照旧按开始日那天的提醒时间（reminders.ts 不看 end_date）。
 * - 倒数日的目标日（target_date）和日期段无关。
 */
import { addDays, diffDays, formatDate, parseDateKey } from './dates';
import { getLocale, intlLocale, tr } from './i18n';
import { formatTaskDate, relativeDays, zoneOffsetLabel, type TaskDateOpts } from './date-display';
import type { DateKey, Task } from './types';

export interface DateRange {
  start: DateKey | null;
  end: DateKey | null;
}

/** 收拾一对开始 / 结束：没有开始就都空；结束不晚于开始就当单日（end = null）。 */
export function normalizeRange(start: DateKey | null | undefined, end: DateKey | null | undefined): DateRange {
  const s = start || null;
  if (!s) return { start: null, end: null };
  const e = end || null;
  return { start: s, end: e && e > s ? e : null };
}

/** 有没有结束日（是不是日期段）。 */
export function isDateRange(t: Pick<Task, 'scheduled_date' | 'end_date'>): boolean {
  return !!t.scheduled_date && !!t.end_date && t.end_date > t.scheduled_date;
}

/** 结束日：日期段取 end_date，单日就是 scheduled_date；没日期是 null。 */
export function taskEndDate(t: Pick<Task, 'scheduled_date' | 'end_date'>): DateKey | null {
  if (!t.scheduled_date) return null;
  return isDateRange(t) ? t.end_date! : t.scheduled_date;
}

/** 一共几天（含两头）；单日是 1。 */
export function rangeLength(start: DateKey, end: DateKey | null): number {
  return end && end > start ? diffDays(start, end) + 1 : 1;
}

/** day 落在段里时是第几天（从 1 数），不在段里是 null。 */
export function rangeDayIndex(start: DateKey, end: DateKey | null, day: DateKey): { index: number; total: number } | null {
  const last = end && end > start ? end : start;
  if (day < start || day > last) return null;
  return { index: diffDays(start, day) + 1, total: rangeLength(start, end) };
}

/**
 * 日期段的文字：
 * - 中文：同月「10月26日 – 30日」，跨月「10月30日 – 11月2日」，跨年「2026年12月30日 – 2027年1月2日」；
 *   不跨年但不在今年（给了 today 时）开头带年份「2027年3月1日 – 5日」。
 * - 其他语言用 Intl 的 formatRange（英文「Oct 26 – 30」「Oct 30 – Nov 2」「Dec 30, 2026 – Jan 2, 2027」），省略规则由各语言自己定。
 * end 空或不晚于 start 时就是单个日期（不带星期）。
 */
export function formatDateRange(start: DateKey, end: DateKey | null | undefined, today?: DateKey, opts: { year?: boolean } = {}): string {
  const a = parseDateKey(start);
  const crossYear = !!end && end > start && parseDateKey(end).y !== a.y;
  const withYear = !!opts.year || crossYear || (!!today && parseDateKey(today).y !== a.y);
  if (!end || end <= start) return formatDate(start, { weekday: false, year: withYear });
  const b = parseDateKey(end);
  if (getLocale() !== 'zh') {
    const fmt = new Intl.DateTimeFormat(intlLocale(), { timeZone: 'UTC', ...(opts.year ? { dateStyle: 'medium' as const } : { month: 'short' as const, day: 'numeric' as const, ...(withYear ? { year: 'numeric' as const } : {}) }) });
    const da = new Date(Date.UTC(a.y, a.m - 1, a.d));
    const db = new Date(Date.UTC(b.y, b.m - 1, b.d));
    const range = (fmt as Intl.DateTimeFormat & { formatRange?: (x: Date, y: Date) => string }).formatRange;
    return range ? range.call(fmt, da, db) : `${fmt.format(da)} – ${fmt.format(db)}`;
  }
  const head = `${withYear ? `${a.y}年` : ''}${a.m}月${a.d}日`; // i18n-ignore 中文分支
  if (crossYear) return `${head} – ${b.y}年${b.m}月${b.d}日`; // i18n-ignore 中文分支
  if (b.m !== a.m) return `${head} – ${b.m}月${b.d}日`; // i18n-ignore 中文分支
  return `${head} – ${b.d}日`; // i18n-ignore 中文分支
}

/**
 * 日期段按设置里的「日期显示」写（Rei 2026-10-26，date-display.ts）：
 * - auto：formatDateRange（「10月26日 – 30日」）；
 * - relative：两头都写相对时间「今天 – 4 天后」；两头一样时写「2 个月后，共 4 天」；
 * - ymd：一律带年份「2026年10月26日 – 30日」/「Oct 26 – 30, 2026」；
 * - ymd-tz：ymd 后面带开始那天的时区「GMT+8」。
 * 没有结束日（或不晚于开始）就和 formatTaskDate 一样。
 */
export function formatTaskDateRange(start: DateKey, end: DateKey | null | undefined, opts: TaskDateOpts): string {
  if (!end || end <= start) return formatTaskDate(start, opts);
  switch (opts.mode) {
    case 'relative': {
      const a = relativeDays(diffDays(opts.today, start), opts.locale);
      const b = relativeDays(diffDays(opts.today, end), opts.locale);
      // 远了两头会一样（「2 个月后 – 2 个月后」）：只写一次，带上天数
      return a === b ? tr('{when}，共 {n} 天', { when: a, n: rangeLength(start, end) }) : `${a} – ${b}`;
    }
    case 'ymd':
      return formatDateRange(start, end, opts.today, { year: true });
    case 'ymd-tz':
      return `${formatDateRange(start, end, opts.today, { year: true })} ${zoneOffsetLabel(start, opts.timeZone)}`;
    default:
      return formatDateRange(start, end, opts.today);
  }
}

/** 选择器里的状态：正在改哪一头。 */
export type RangeEdge = 'start' | 'end';

export interface RangePickState {
  start: DateKey | null;
  end: DateKey | null;
  /** 下一次点格子改哪一头。 */
  editing: RangeEdge;
}

/**
 * 日期段选择器点了一天（「点起点再点终点」，也能先点上面的「开始 / 结束」只改一头）：
 * - 改开始：开始 = 这天；原来的结束早于（或等于）新开始就去掉；接着等结束（editing → end）。
 * - 改结束：还没开始就当开始；点在开始之前就把开始挪到这天、继续等结束；点在开始当天或之后就定下结束（当天 = 单日），done。
 * done = 这一段选完了（界面可以关弹层）。
 */
export function pickRangeDay(state: RangePickState, day: DateKey): RangePickState & { done: boolean } {
  if (state.editing === 'start' || !state.start) {
    const end = state.end && state.end > day ? state.end : null;
    return { start: day, end, editing: 'end', done: false };
  }
  if (day < state.start) return { start: day, end: null, editing: 'end', done: false };
  return { start: state.start, end: day > state.start ? day : null, editing: 'start', done: true };
}

/** 快捷日期（今天 / 明天…）在日期段模式下：开始挪到那天，长度不变。 */
export function shiftRangeTo(range: DateRange, start: DateKey): DateRange {
  if (!range.start || !range.end || range.end <= range.start) return { start, end: null };
  return { start, end: addDays(start, diffDays(range.start, range.end)) };
}

/** 格子在段里的位置（画高亮用）：起点 / 终点 / 中间 / 不在。 */
export function rangeCellRole(range: DateRange, day: DateKey): 'start' | 'end' | 'single' | 'middle' | null {
  const { start, end } = normalizeRange(range.start, range.end);
  if (!start) return null;
  if (!end) return day === start ? 'single' : null;
  if (day === start) return 'start';
  if (day === end) return 'end';
  return day > start && day < end ? 'middle' : null;
}

/** 列表（Agenda）里的一行：哪件任务；日期段的话写上是第几天。 */
export interface AgendaItem<T> {
  task: T;
  /** 日期段才有：这一天是第几天 / 共几天。 */
  span?: { index: number; total: number };
}

/**
 * 列表（Agenda）按日期分组（Rei 2026-10-26 日期段）：
 * - 每件任务放在开始那天（from 之前的不放）；
 * - 日期段跨过今天（开始在今天之前、结束在今天或之后）的，今天也放一份，标「第 3/5 天」。
 * 返回 日期 → 行；hiddenPast = 开始在 from 之前、今天也没出现的件数（「更早的 N 条」）。
 */
export function agendaBuckets<T extends Pick<Task, 'scheduled_date' | 'end_date'>>(tasks: readonly T[], from: DateKey, today: DateKey): { byDate: Map<DateKey, AgendaItem<T>[]>; hiddenPast: number } {
  const byDate = new Map<DateKey, AgendaItem<T>[]>();
  const push = (d: DateKey, item: AgendaItem<T>) => byDate.set(d, [...(byDate.get(d) ?? []), item]);
  let hiddenPast = 0;
  for (const t of tasks) {
    const s = t.scheduled_date;
    if (!s) continue;
    const end = isDateRange(t) ? t.end_date! : null;
    const span = end ? rangeDayIndex(s, end, s)! : undefined;
    if (s >= from) push(s, span ? { task: t, span } : { task: t });
    const inToday = end && s < today ? rangeDayIndex(s, end, today) : null;
    if (inToday) push(today, { task: t, span: inToday });
    else if (s < from) hiddenPast++;
  }
  return { byDate, hiddenPast };
}
