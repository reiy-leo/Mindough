/**
 * 日记（方案见 docs/JOURNAL.md，Rei 2026-10-17 已审）。纯函数：日期 → id、「今天」是哪天、心情、字数、同步保护。
 *
 * - 一天一篇（Rei 2026-10-17）：id 由日期算（journalEntryId），两台设备离线各开了同一天还是同一行。
 * - 「一天从几点开始」（默认 5 点）：凌晨 3 点打开「今天的日记」还是昨天那篇（journalToday）。只用于日记。
 * - 将来的日子不能写（canWriteJournal）。
 * - 心情：唯一的可选字段，12 个，存稳定英文 id（不存序号）。
 * - 同步保护：两台设备都改了同一天、互相没看到对方那版时，赢家内容 + 末尾折叠块收着输掉的那版（mergeJournalConflict），
 *   判断「有没有看到」靠 base_at（这一版是在哪一版别的设备写的内容上改的，见 Store.setJournal / applyRemote）。
 */
import { addDays, parseDateKey, toDateKey } from './dates';
import { parseHlc } from './hlc';
import { tr } from './i18n';
import type { DateKey, JournalEntry } from './types';

// ───────────── id 与日期 ─────────────

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 是不是一个真的日期（2026-02-30 不算）。 */
export function isDateKey(s: unknown): s is DateKey {
  if (typeof s !== 'string') return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1970 || mo < 1 || mo > 12 || d < 1) return false;
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDate() === d;
}

/**
 * 那天日记的 id：UUIDv7 的样子，时间戳段 = 那天 00:00 UTC 的毫秒数，第三段 7000、第四段 8002（打卡分类用的是 8001），其余为 0。
 * 各设备算出来一样；删了再写回同一天也是同一行（墓碑翻回来）。
 */
export function journalEntryId(date: DateKey): string {
  const { y, m, d } = parseDateKey(date);
  const hex = Date.UTC(y, m - 1, d).toString(16).padStart(12, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7000-8002-000000000000`;
}

/** 「一天从几点开始」的默认值（Rei 2026-10-17：默认 5 点）。 */
export const JOURNAL_DAY_START_DEFAULT = 5;
/** 日记提醒默认时间（Rei 2026-10-17：晚上 9 点）。 */
export const JOURNAL_REMIND_TIME_DEFAULT = '21:00';

/** 同步的偏好键。 */
export const JOURNAL_PREFS = {
  /** 一天从几点开始（0–23 整点）。 */
  dayStart: 'journal.day_start',
  /** 每天提醒写日记（默认开）。 */
  remind: 'journal.remind',
  /** 提醒时间「HH:MM」（默认 21:00）。 */
  remindTime: 'journal.remind_time',
} as const;

/** pref 里存的值 → 0–23 的整点；不像就用默认。 */
export function normalizeDayStart(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : JOURNAL_DAY_START_DEFAULT;
}

/** 「今天的日记」是哪天：还没到「一天从几点开始」就算前一天。按本机时区。 */
export function journalToday(now: Date, dayStartHour: number = JOURNAL_DAY_START_DEFAULT): DateKey {
  const today = toDateKey(now);
  return now.getHours() < normalizeDayStart(dayStartHour) ? addDays(today, -1) : today;
}

/** 将来的日子不能写（Rei 2026-10-17）。 */
export function canWriteJournal(date: DateKey, today: DateKey): boolean {
  return isDateKey(date) && date <= today;
}

/** 将来的日子写不了（Store 抛它，界面接住提示）。 */
export class FutureJournalError extends Error {
  constructor() {
    super(tr('这天还没到，还不能写'));
    this.name = 'FutureJournalError';
  }
}

// ───────────── 心情 ─────────────

/** 心情的稳定 id（存进数据库，不改名）。顺序 = 显示顺序，从好到不好。 */
export const MOOD_IDS = ['happy', 'excited', 'grateful', 'content', 'calm', 'okay', 'bored', 'tired', 'anxious', 'sad', 'irritated', 'angry'] as const;
export type MoodId = (typeof MOOD_IDS)[number];
export type MoodTone = 'positive' | 'neutral' | 'negative';

export interface Mood {
  id: MoodId;
  label: string;
  tone: MoodTone;
}

const MOOD_TONE: Record<MoodId, MoodTone> = {
  happy: 'positive',
  excited: 'positive',
  grateful: 'positive',
  content: 'positive',
  calm: 'neutral',
  okay: 'neutral',
  bored: 'neutral',
  tired: 'negative',
  anxious: 'negative',
  sad: 'negative',
  irritated: 'negative',
  angry: 'negative',
};

/** 心情的名字（按当前语言）。 */
export function moodLabel(id: string | null | undefined): string {
  switch (id) {
    case 'happy':
      return tr('开心');
    case 'excited':
      return tr('兴奋');
    case 'grateful':
      return tr('感恩');
    case 'content':
      return tr('满足');
    case 'calm':
      return tr('平静');
    case 'okay':
      return tr('一般');
    case 'bored':
      return tr('无聊');
    case 'tired':
      return tr('疲惫');
    case 'anxious':
      return tr('焦虑');
    case 'sad':
      return tr('难过');
    case 'irritated':
      return tr('烦躁');
    case 'angry':
      return tr('生气');
    default:
      return '';
  }
}

export function isMoodId(v: unknown): v is MoodId {
  return typeof v === 'string' && (MOOD_IDS as readonly string[]).includes(v);
}

/** 全部心情（按显示顺序）。 */
export function moods(): Mood[] {
  return MOOD_IDS.map((id) => ({ id, label: moodLabel(id), tone: MOOD_TONE[id] }));
}

export function moodTone(id: string | null | undefined): MoodTone | null {
  return isMoodId(id) ? MOOD_TONE[id] : null;
}

// ───────────── 显示 ─────────────

const CJK = /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g;

/** 去掉 markdown 记号（标题、引用、清单、强调、链接地址、HTML 标签）后的纯文字。 */
export function journalPlainText(md: string): string {
  return md
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(^|\n)\s*(#{1,6}|>|[-*+](\s+\[[ xX]\])?|\d+[.)])\s+/g, '$1')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 字数：中日韩文字一个字算一个，其余按词（空格、标点分开）数。只显示不存。 */
export function journalWordCount(md: string): number {
  const text = journalPlainText(md);
  const cjk = text.match(CJK)?.length ?? 0;
  const rest = text.replace(CJK, ' ').match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu)?.length ?? 0;
  return cjk + rest;
}

/** 列表里的第一行（没写返回空串）。 */
export function journalPreview(md: string, max = 80): string {
  const lines = md.split('\n').map((l) => journalPlainText(l)).filter(Boolean);
  const first = lines[0] ?? '';
  return first.length > max ? `${first.slice(0, max)}…` : first;
}

/** 有没有写东西（正文非空或选了心情）。 */
export function hasJournalContent(e: Pick<JournalEntry, 'body_md' | 'mood'> | null | undefined): boolean {
  return !!e && (!!e.body_md.trim() || !!e.mood);
}

// ───────────── 同步保护 ─────────────

/** 保护块的标记属性（编辑器原样保留 <details …> 的属性）。 */
export const CONFLICT_ATTR = 'data-journal="conflict"';
const CONFLICT_BLOCK = /\n*<details data-journal="conflict"[^>]*>\s*<summary[^>]*>[\s\S]*?<\/summary>\s*([\s\S]*?)\s*<\/details>\n*/g;

/** 正文拆成：自己的内容 + 之前收着的保护块里的内容。 */
export function splitConflictBlocks(md: string): { core: string; kept: string[] } {
  const kept: string[] = [];
  const core = md.replace(CONFLICT_BLOCK, (_all, inner: string) => {
    if (inner.trim()) kept.push(inner.trim());
    return '\n\n';
  });
  return { core: core.trim(), kept };
}

/** 比较用：去掉空白和 markdown 记号（编辑器重新写出来时可能换了列表符号、空行）。 */
const squash = (s: string) => s.replace(/[\s*_`~>#\-+[\]()!|\\]/g, '').normalize('NFKC');

/** 「另一台设备上同时写的 · 10-17 14:30」：时间取输掉那版写下的时刻（各设备算出来一样的那一刻）。 */
export function conflictSummary(loserUpdatedAt: string, timeZone?: string): string {
  const ms = parseHlc(loserUpdatedAt).ms;
  const d = Number.isFinite(ms) ? new Date(ms) : new Date(0);
  const p = new Intl.DateTimeFormat('en-US', { ...(timeZone ? { timeZone } : {}), hourCycle: 'h23', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return tr('另一台设备上同时写的 · {time}', { time: `${v('month')}-${v('day')} ${v('hour')}:${v('minute')}` });
}

/**
 * 合并两版：赢家的正文原样，输家里赢家没有的部分（它自己的内容、它收着的保护块）一段一段收进末尾的折叠块。
 * 已经包含的不重复，所以两台设备各合一次、或者合过的再碰上，结果都收敛。返回 null = 不用改（输家的都在赢家里了）。
 */
export function mergeJournalConflict(winnerMd: string, loserMd: string, summary: string): string | null {
  const w = splitConflictBlocks(winnerMd);
  const have = [w.core, ...w.kept].map(squash).filter(Boolean);
  const l = splitConflictBlocks(loserMd);
  const missing: string[] = [];
  for (const piece of [l.core, ...l.kept]) {
    const s = squash(piece);
    if (!s || have.some((h) => h.includes(s))) continue;
    if (missing.some((m) => squash(m).includes(s))) continue;
    missing.push(piece);
    have.push(s);
  }
  if (!missing.length) return null;
  const blocks = missing.map((m) => `<details ${CONFLICT_ATTR}>\n<summary>${summary.replace(/[<>&]/g, '')}</summary>\n\n${m}\n\n</details>`);
  const base = winnerMd.replace(/\s+$/, '');
  return `${base ? `${base}\n\n` : ''}${blocks.join('\n\n')}\n`;
}

/**
 * 拉下来的一版（incoming，比本机这版新）有没有「没看到」本机这版：它是在哪一版别的设备的内容上改的（base_at）早于本机这版，
 * 且两边正文不一样。墓碑不管（删了就是删了）。
 */
export function isJournalConflict(local: JournalEntry, incoming: JournalEntry): boolean {
  if (local.deleted || incoming.deleted) return false;
  if (local.body_md === incoming.body_md) return false;
  if (!local.body_md.trim()) return false;
  return !incoming.base_at || incoming.base_at < local.updated_at;
}

/** 按日期倒序的日记（只要写了东西的）。 */
export function sortedJournal(entries: readonly JournalEntry[]): JournalEntry[] {
  return entries.filter((e) => !e.deleted && hasJournalContent(e)).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** 某个月（YYYY-MM）的日记，按日期倒序。 */
export function journalOfMonth(entries: readonly JournalEntry[], month: string): JournalEntry[] {
  return sortedJournal(entries).filter((e) => e.date.startsWith(`${month}-`));
}

/** 月历：周一开始，前后补齐成整周。null = 不属于这个月的格子。 */
export function monthGrid(month: string): Array<DateKey | null> {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const first = `${month}-01`;
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: Array<DateKey | null> = Array.from({ length: lead }, () => null);
  for (let i = 0; i < days; i++) cells.push(addDays(first, i));
  while (cells.length % 7) cells.push(null);
  return cells;
}

/** YYYY-MM 加减几个月。 */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}
