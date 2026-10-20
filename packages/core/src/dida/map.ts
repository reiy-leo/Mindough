/**
 * 滴答清单一行 → Mindough 任务的纯函数：时间（按那一行的时区换算）、提醒、重复规则、正文（标题 + 内容 + 清单 + 标签）。
 * 映射规则见 docs/IMPORT-DIDA.md。
 */
import { tr } from '../i18n';
import { formatRecurrence, parseRecurrence } from '../recurrence';
import type { DateKey } from '../types';
import type { DidaRow } from './parse';

// ───────────── 时间 ─────────────

/** 「2023-05-11T16:00:00+0000」「2023-05-11 16:00:00」「2023-05-11」→ 各部分；认不出 null。 */
const STAMP = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;

export interface LocalTime {
  date: DateKey;
  /** 那一天的第几分钟（0–1439）。 */
  minutes: number;
}

export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** 某一时刻在某时区的日期和时刻。 */
export function inTimeZone(ms: number, timeZone: string): LocalTime {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  const hour = Number(get('hour')) % 24;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: hour * 60 + Number(get('minute')) };
}

/**
 * 滴答清单的时间 → 那一行时区里的日期和时刻。带偏移的（导出里都是 UTC +0000）按时区换算；
 * 不带偏移的当作已经是当地时间。全天任务存的是「当地零点」换成的 UTC，换算回来正好是那一天。
 */
export function didaLocal(stamp: string | null, timeZone: string): LocalTime | null {
  if (!stamp) return null;
  const m = STAMP.exec(stamp.trim());
  if (!m) return null;
  const [, y, mo, d, hh, mm, ss, off] = m;
  if (!off) return { date: `${y}-${mo}-${d}`, minutes: hh ? Number(hh) * 60 + Number(mm) : 0 };
  const sign = off.toUpperCase() === 'Z' ? 0 : off.startsWith('-') ? -1 : 1;
  const offDigits = off.replace(/[^0-9]/g, '');
  const offMin = sign ? sign * (Number(offDigits.slice(0, 2)) * 60 + Number(offDigits.slice(2, 4))) : 0;
  const utc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(hh ?? 0), Number(mm ?? 0), Number(ss ?? 0)) - offMin * 60_000;
  if (!Number.isFinite(utc)) return null;
  return inTimeZone(utc, timeZone);
}

/** 时间 → ISO 时刻（created_at / done_at 用）；认不出 null。 */
export function didaInstant(stamp: string | null): string | null {
  if (!stamp) return null;
  const m = STAMP.exec(stamp.trim());
  if (!m) return null;
  const [, y, mo, d, hh, mm, ss, off] = m;
  let ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(hh ?? 0), Number(mm ?? 0), Number(ss ?? 0));
  if (off && off.toUpperCase() !== 'Z') {
    const sign = off.startsWith('-') ? -1 : 1;
    const digits = off.replace(/[^0-9]/g, '');
    ms -= sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4))) * 60_000;
  }
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO 8601 时长（-PT15M、P0DT9H0M0S、-P1DT15H）→ 分钟；认不出 null。 */
export function durationMinutes(s: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(s.trim());
  if (!m || s.trim().length < 2) return null;
  const [, sign, w, d, h, mi, sec] = m;
  const total = Number(w ?? 0) * 7 * 1440 + Number(d ?? 0) * 1440 + Number(h ?? 0) * 60 + Number(mi ?? 0) + Math.floor(Number(sec ?? 0) / 60);
  return sign === '-' ? -total : total;
}

/**
 * 提醒：Mindough 只能「那天几点」提醒（remind_time）。取第一个落在同一天里的提醒：
 * 全天任务从当天 0 点算（P0DT9H = 9:00），有时刻的从那个时刻算（-PT15M = 提前 15 分钟）。前一天的提醒放不进来。
 */
export function didaRemindTime(reminder: string, base: LocalTime | null, allDay: boolean): string | null {
  if (!reminder || !base) return null;
  for (const part of reminder.split(/[,;\n]/)) {
    const dur = durationMinutes(part.replace(/^\s*TRIGGER\s*[:=]\s*/i, ''));
    if (dur === null) continue;
    const at = (allDay ? 0 : base.minutes) + dur;
    if (at >= 0 && at < 1440) return `${pad(Math.floor(at / 60))}:${pad(at % 60)}`;
  }
  return null;
}

// ───────────── 重复 ─────────────

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/**
 * 滴答清单的 RRULE → Mindough 能照样重复的写法（每天 / 每 N 天 / 每周几 / 每月几号）；做不到的返回 null（写进正文）。
 * 每 N 周、每 N 个月、每年、到某天为止、重复 N 次、跳过节假日这些 Mindough 没有，不硬套。
 */
export function didaRecurrence(repeat: string, anchor: DateKey | null): string | null {
  const raw = repeat.trim();
  if (!raw) return null;
  if (/^ERULE/i.test(raw)) return null; // 自选日期
  const body = raw.replace(/^RRULE\s*:\s*/i, '');
  const parts = new Map<string, string>();
  for (const seg of body.split(';')) {
    const [k, v] = seg.split('=');
    if (k && v !== undefined) parts.set(k.trim().toUpperCase(), v.trim().toUpperCase());
  }
  const known = new Set(['FREQ', 'INTERVAL', 'BYDAY', 'BYMONTHDAY', 'WKST', 'DTSTART']);
  for (const k of parts.keys()) if (!known.has(k)) return null; // COUNT / UNTIL / BYSETPOS / TT_SKIP…
  const freq = parts.get('FREQ');
  const interval = Number(parts.get('INTERVAL') ?? '1');
  if (!Number.isInteger(interval) || interval < 1) return null;
  const wd = anchor ? new Date(`${anchor}T00:00:00Z`).getUTCDay() : null;
  let rule: string | null = null;
  if (freq === 'DAILY') {
    if (parts.has('BYDAY') || parts.has('BYMONTHDAY')) return null;
    if (interval === 1) rule = 'FREQ=DAILY';
    else if (anchor) rule = `FREQ=DAILY;INTERVAL=${interval};DTSTART=${anchor.replace(/-/g, '')}`;
  } else if (freq === 'WEEKLY' && interval === 1) {
    const days = parts.get('BYDAY') ?? (wd !== null ? BYDAY[wd] : '');
    if (days && days.split(',').every((d) => BYDAY.includes(d))) rule = `FREQ=WEEKLY;BYDAY=${days}`;
  } else if (freq === 'MONTHLY' && interval === 1 && !parts.has('BYDAY')) {
    const day = parts.get('BYMONTHDAY') ?? (anchor ? String(Number(anchor.slice(8, 10))) : '');
    if (/^\d{1,2}$/.test(day)) rule = `FREQ=MONTHLY;BYMONTHDAY=${day}`;
  }
  const parsed = parseRecurrence(rule);
  return parsed ? formatRecurrence(parsed) : null;
}

// ───────────── 正文 ─────────────

/** 清单子项：▫ 没勾、▪ 勾了（也认 ☐ ☑ ✓ □ ■）。 */
const CHECK_ITEM = /^(\s*)([▫▪☐☑✓✔□■◻◼])\s?(.*)$/u;
const CHECKED = new Set(['▪', '☑', '✓', '✔', '■', '◼']);

/** 内容里的清单子项 → markdown 待办列表；其余行原样。 */
export function checklistToMarkdown(content: string): string {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let inList = false;
  for (const l of lines) {
    const m = CHECK_ITEM.exec(l);
    if (m) {
      if (!inList && out.length && out[out.length - 1]!.trim()) out.push('');
      out.push(`- [${CHECKED.has(m[2]!) ? 'x' : ' '}] ${m[3]!.trim()}`);
      inList = true;
    } else {
      if (inList && l.trim()) out.push('');
      inList = false;
      out.push(l);
    }
  }
  return out.join('\n');
}

export function priorityTag(p: number): string | null {
  if (p >= 5) return tr('高优先级');
  if (p >= 3) return tr('中优先级');
  if (p >= 1) return tr('低优先级');
  return null;
}

/** #标签：空格换成下划线，免得断开。 */
const hashTag = (t: string) => `#${t.trim().replace(/\s+/g, '_')}`;

/**
 * 正文：标题当第一行，空一行接内容（清单子项转成待办列表），最后几段补上 Mindough 放不进字段的信息：
 * #标签（含优先级）、截止日（和开始不是同一天时）、照样重复不了的重复规则。
 */
export function didaBody(row: DidaRow, extra: { due?: DateKey | null; repeatNote?: string | null } = {}): string {
  const parts: string[] = [];
  const content = row.content.replace(/\r\n?/g, '\n').replace(/^\n+|\s+$/g, '');
  const converted = row.kind === 'CHECKLIST' || row.isChecklist || CHECK_ITEM.test(content.split('\n')[0] ?? '') ? checklistToMarkdown(content) : content;
  if (row.title) parts.push(row.title.replace(/\n+/g, ' '));
  if (converted) parts.push(converted);
  const tags = [...row.tags.map(hashTag)];
  const pt = priorityTag(row.priority);
  if (pt) tags.push(hashTag(pt));
  if (tags.length) parts.push([...new Set(tags)].join(' '));
  if (extra.due) parts.push(tr('截止：{date}', { date: extra.due }));
  if (extra.repeatNote) parts.push(tr('重复（滴答清单的规则，这里没法照样重复）：{rule}', { rule: extra.repeatNote }));
  return parts.join('\n\n');
}
