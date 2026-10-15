/**
 * 界面上把任务属性说成人话的小工具（文案规则见 docs/COPY.md）。纯函数，无 DOM。
 */
import { addDays, diffDays, formatDateZh, parseDateKey, relativeDayZh, weekday } from './dates';
import { COMPLETION_MODE_LABEL, type DateKey, type Task } from './types';

export type DurationUnit = 'min' | 'h';
export const DURATION_UNIT_LABEL: Record<DurationUnit, string> = { min: '分钟', h: '小时' };

const MIN = 60_000;
const HOUR = 3_600_000;

/** 毫秒 → 输入框里的「数 + 单位」：整小时或半小时（≥1 小时）用小时，否则用分钟。 */
export function durationParts(ms: number | null | undefined): { value: number; unit: DurationUnit } | null {
  if (!ms || ms <= 0) return null;
  if (ms >= HOUR && ms % (HOUR / 2) === 0) return { value: ms / HOUR, unit: 'h' };
  return { value: Math.round(ms / MIN), unit: 'min' };
}

/** 「数 + 单位」→ 毫秒；非正数返回 null。 */
export function durationMs(value: number, unit: DurationUnit): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * (unit === 'h' ? HOUR : MIN));
}

/** 目标时长的口语写法：“10 分钟”“16 小时”“1.5 小时”。 */
export function formatTarget(ms: number | null | undefined): string {
  const p = durationParts(ms);
  return p ? `${p.value} ${DURATION_UNIT_LABEL[p.unit]}` : '';
}

/** 倒数日的说法：还有 N 天 / 就是今天 / 已过 N 天。 */
export function countdownPhrase(target: DateKey | null | undefined, today: DateKey): string {
  if (!target) return '还没选日期';
  const n = diffDays(today, target);
  if (n > 0) return `还有 ${n} 天`;
  if (n === 0) return '就是今天';
  return `已过 ${-n} 天`;
}

const NEAR = ['今天', '明天', '后天', '昨天', '前天'];

/** 日期的口语写法：今天 / 明天 / 10月20日 周二；不在今年时带年份。 */
export function friendlyDate(key: DateKey, today: DateKey): string {
  const rel = relativeDayZh(key, today);
  if (!NEAR.includes(rel) && parseDateKey(key).y !== parseDateKey(today).y) return `${parseDateKey(key).y}年${formatDateZh(key)}`;
  return rel;
}

/** 完成方式的一行摘要，用在属性列表里：“勾选完成”“计时 · 每次 10 分钟”“计数 · 目标 8 杯”“倒数日 · 12月20日”。 */
export function describeCompletion(task: Pick<Task, 'completion_mode' | 'target_value' | 'unit' | 'target_date'>, today?: DateKey): string {
  const label = COMPLETION_MODE_LABEL[task.completion_mode];
  switch (task.completion_mode) {
    case 'once':
      return label;
    case 'timer': {
      const t = formatTarget(task.target_value);
      return t ? `${label} · 每次 ${t}` : label;
    }
    case 'count':
      return `${label} · 目标 ${task.target_value ?? 1}${task.unit ? ` ${task.unit}` : ' 次'}`;
    case 'countdown':
      if (!task.target_date) return label;
      return `${label} · ${today ? friendlyDate(task.target_date, today) : formatDateZh(task.target_date, false)}`;
  }
}

export interface QuickDate {
  label: string;
  date: DateKey;
}

/** 日期弹层里的快捷选项：今天、明天、本周末（周六；今天已是周末则下周六）、下周一。 */
export function quickDates(today: DateKey): QuickDate[] {
  const wd = weekday(today); // 0=周日
  const weekend = wd === 6 || wd === 0;
  const toSat = wd === 6 ? 7 : 6 - wd;
  const toMon = (8 - wd) % 7 || 7;
  return [
    { label: '今天', date: today },
    { label: '明天', date: addDays(today, 1) },
    { label: weekend ? '下周末' : '本周末', date: addDays(today, toSat) },
    { label: '下周一', date: addDays(today, toMon) },
  ];
}

/** 「已同步 · 刚刚」后半句：刚刚 / N 分钟前 / N 小时前 / 昨天 HH:mm / M月D日 HH:mm（本机时区）。 */
export function syncedAgo(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '';
  const at = new Date(iso);
  const diff = now.getTime() - at.getTime();
  if (!Number.isFinite(diff)) return '';
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  const hm = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(now) - day(at)) / 86_400_000);
  if (days === 0) return `${Math.floor(diff / 3600_000)} 小时前`;
  if (days === 1) return `昨天 ${hm}`;
  return `${at.getMonth() + 1}月${at.getDate()}日 ${hm}`;
}
