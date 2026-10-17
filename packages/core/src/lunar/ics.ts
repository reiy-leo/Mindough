/**
 * 订阅日历（ICS / iCalendar）的最小解析：只取全天类事件的「哪天、叫什么、是放假还是补班」，给日期格子和日期标题显示用（只读，不成任务）。
 * 支持：折行、转义、DTSTART / DTEND（VALUE=DATE 或日期时间，取日期部分；DTEND 不含当天）、
 * RRULE 的 FREQ=YEARLY（+ COUNT / UNTIL / INTERVAL，按公历同月同日）、EXDATE、
 * Apple 节假日日历的 X-APPLE-SPECIAL-DAY（WORK-HOLIDAY 放假 / ALTERNATE-WORKDAY 补班），以及标题里的「（休）」「（班）」「补班」「假期」。
 */
import { addDays, diffDays, parseDateKey } from '../dates';
import type { DateKey } from '../types';

export type SubEventKind = 'event' | 'off' | 'work';

export interface SubEvent {
  date: DateKey;
  title: string;
  kind: SubEventKind;
}

/** 一个事件最多铺开多少天、一条重复最多几次、整份最多多少条（防止异常源把本机撑爆）。 */
const MAX_SPAN = 60;
const MAX_REPEAT = 60;
export const MAX_SUB_EVENTS = 20_000;

function unfold(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function unescape(v: string): string {
  return v.replace(/\\([\\;,nN])/g, (_, c: string) => (c === 'n' || c === 'N' ? ' ' : c)).trim();
}

/** 「20261001」「20261001T120000Z」→ 2026-10-01。 */
function dateOf(v: string): DateKey | null {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(v.trim());
  if (!m) return null;
  const k = `${m[1]}-${m[2]}-${m[3]}`;
  const { y, m: mo, d } = parseDateKey(k);
  return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y > 1800 ? k : null;
}

const hasTime = (v: string) => /T\d{4}/.test(v);

function kindOf(title: string, special: string | undefined): SubEventKind {
  const s = (special ?? '').toUpperCase();
  if (s === 'WORK-HOLIDAY') return 'off';
  if (s === 'ALTERNATE-WORKDAY') return 'work';
  if (/[（(]班[）)]|补班|调班/.test(title)) return 'work';
  if (/[（(]休[）)]|假期|放假/.test(title)) return 'off';
  return 'event';
}

interface Raw {
  start?: string;
  end?: string;
  summary?: string;
  rrule?: string;
  special?: string;
  exdates: string[];
}

function expand(raw: Raw, out: SubEvent[]): void {
  if (!raw.start || !raw.summary) return;
  const start = dateOf(raw.start);
  if (!start) return;
  const title = unescape(raw.summary);
  if (!title) return;
  let days = 1;
  if (raw.end) {
    const end = dateOf(raw.end);
    if (end) {
      const n = diffDays(start, end);
      // 全天事件 DTEND 不含当天；带时间的事件跨到第二天才算两天
      days = hasTime(raw.end) ? n + 1 : n;
      days = Math.max(1, Math.min(MAX_SPAN, days));
    }
  }
  const kind = kindOf(title, raw.special);
  const ex = new Set(raw.exdates.map(dateOf).filter((x): x is DateKey => !!x));
  const starts: DateKey[] = [start];
  if (raw.rrule) {
    const parts = new Map(raw.rrule.split(';').map((p) => p.split('=') as [string, string]).map(([k, v]) => [k.toUpperCase(), (v ?? '').toUpperCase()]));
    if (parts.get('FREQ') === 'YEARLY' && !parts.has('BYDAY') && !parts.has('RSCALE')) {
      const count = Math.min(MAX_REPEAT, Number(parts.get('COUNT') ?? MAX_REPEAT) || MAX_REPEAT);
      const until = parts.get('UNTIL') ? dateOf(parts.get('UNTIL')!) : null;
      const step = Math.max(1, Number(parts.get('INTERVAL') ?? '1') || 1);
      const { y, m, d } = parseDateKey(start);
      for (let i = 1; starts.length < count; i++) {
        const yy = y + i * step;
        const k = `${yy}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        if (parseDateKey(addDays(k, 0)).m !== m) continue; // 2 月 29 日在平年跳过
        if (until && k > until) break;
        starts.push(k);
      }
    }
  }
  for (const s of starts) {
    if (ex.has(s)) continue;
    for (let i = 0; i < days && out.length < MAX_SUB_EVENTS; i++) out.push({ date: addDays(s, i), title, kind });
  }
}

/** 是不是一份日历（Worker 代拉时也用它把关）。 */
export function looksLikeIcs(text: string): boolean {
  return /^\uFEFF?\s*BEGIN:VCALENDAR/i.test(text);
}

/** 解析整份 ICS，按日期排好（同一天按出现顺序）。不是日历返回 null。 */
export function parseIcs(text: string): { name: string | null; events: SubEvent[] } | null {
  if (!looksLikeIcs(text)) return null;
  const out: SubEvent[] = [];
  let name: string | null = null;
  let cur: Raw | null = null;
  for (const line of unfold(text)) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    const head = line.slice(0, i);
    const value = line.slice(i + 1);
    const prop = head.split(';')[0]!.toUpperCase();
    if (prop === 'BEGIN' && value.trim().toUpperCase() === 'VEVENT') cur = { exdates: [] };
    else if (prop === 'END' && value.trim().toUpperCase() === 'VEVENT') {
      if (cur) expand(cur, out);
      cur = null;
    } else if (!cur) {
      if (prop === 'X-WR-CALNAME' && !name) name = unescape(value) || null;
    } else if (prop === 'DTSTART') cur.start = value;
    else if (prop === 'DTEND') cur.end = value;
    else if (prop === 'SUMMARY') cur.summary = value;
    else if (prop === 'RRULE') cur.rrule = value;
    else if (prop === 'X-APPLE-SPECIAL-DAY') cur.special = value.trim();
    else if (prop === 'EXDATE') cur.exdates.push(...value.split(','));
    if (out.length >= MAX_SUB_EVENTS) break;
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { name, events: out };
}

/** 按日期分组。 */
export function groupSubEvents(events: readonly SubEvent[]): Map<DateKey, SubEvent[]> {
  const m = new Map<DateKey, SubEvent[]>();
  for (const e of events) {
    const list = m.get(e.date);
    if (list) {
      if (!list.some((x) => x.title === e.title)) list.push(e);
    } else m.set(e.date, [e]);
  }
  return m;
}

/** 去掉标题里的「（休）」「（班）」：放假 / 补班另用角标表示。 */
export function plainSubTitle(title: string): string {
  return title.replace(/\s*[（(][休班][）)]\s*$/, '').trim();
}

export interface CellSub {
  /** 格子里显示的节日 / 节气名（替掉本地农历小字）；这天只有放假 / 补班时为 null。 */
  label: string | null;
  /** 放假 / 补班角标。 */
  badge: 'off' | 'work' | null;
  /** 这天所有事件名（提示、日期标题用）。 */
  titles: string[];
}

/**
 * 挑这天格子里显示什么：有普通事件（节日、节气）就用第一个的名字；只有放假 / 补班就不换小字，只加角标。
 * 同一天又放假又是节日（国庆节 + 国庆节（休））：名字用节日，角标「休」。
 */
export function pickCellEvent(list: readonly SubEvent[] | undefined): CellSub | null {
  if (!list?.length) return null;
  const ev = list.find((e) => e.kind === 'event');
  const badge = list.some((e) => e.kind === 'work') ? 'work' : list.some((e) => e.kind === 'off') ? 'off' : null;
  const titles = [...new Set(list.map((e) => e.title))];
  return { label: ev ? ev.title : null, badge, titles };
}
