/**
 * 日记 Feed 流（Rei 2026-10-28，docs/JOURNAL.md 顶部「2026-10-28 改版：Feed 流」）。纯函数，不碰存储。
 *
 * - 一天能写很多条，每条可以选一个心情；发出去以后不能改正文，也不能改心情（只能删，删了能撤销）。
 * - 旧的一天一篇（journal_entry）转成一条：id 由那篇的 id 算（migratedPostId），各设备转出来一样；冲突折叠块里收着的另一版各转成一条。
 * - 热力图：一天的格子颜色 = 当天各条心情颜色在 OKLab 里取平均（没心情的条目算中性主色），条数越多越深。
 * - 左栏心情列表：每个用过的心情一行，按条数从多到少。
 * - 导出：journal/YYYY/MM/YYYY-MM-DD.md，每条一段（标记注释 + 时间 · 心情 + 正文），导入能读回来。
 */
import { addDays, diffDays, startOfWeek } from './dates';
import { parseHlc } from './hlc';
import { weekStartsOn as localeWeekStart } from './i18n';
import { MOOD_IDS, isMoodId, moodLabel, splitConflictBlocks, type MoodId } from './journal';
import type { DateKey, JournalEntry, JournalPost } from './types';

// ───────────── id ─────────────

const ENTRY_ID = /^([0-9a-f]{8}-[0-9a-f]{4})-7000-8002-0{12}$/;
const MIGRATED_ID = /^([0-9a-f]{8}-[0-9a-f]{4})-7000-8003-([0-9a-f]{12})$/;

/**
 * 旧日记（一天一篇）转成的那条的 id：日期段照抄，第四段 8002 → 8003，最后一段是第几条（0 = 正文，1… = 折叠块里收着的另一版）。
 * 不是 journalEntryId 形状的（不该有）返回 null。
 */
export function migratedPostId(entryId: string, index = 0): string | null {
  const m = ENTRY_ID.exec(entryId);
  if (!m) return null;
  return `${m[1]}-7000-8003-${index.toString(16).padStart(12, '0')}`;
}

/** 这条是不是从旧日记转来的；是就返回那篇的 id（旧日记的附件挂在那个 id 上）。 */
export function entryIdOfPost(postId: string): string | null {
  const m = MIGRATED_ID.exec(postId);
  return m ? `${m[1]}-7000-8002-000000000000` : null;
}

/** HLC / ISO → ISO 时刻；读不出来用 fallback。 */
function isoOf(stamp: string, fallback: string): string {
  if (/^\d{13}-/.test(stamp)) {
    const ms = parseHlc(stamp).ms;
    if (Number.isFinite(ms)) return new Date(ms).toISOString();
  }
  return fallback;
}

/**
 * 一篇旧日记要写成哪几条（不进 outbox：各设备各转一遍结果一样）。
 * - 还没有那条：建；created_at 用旧日记的 updated_at（最后写的时刻），updated_at 也照抄旧日记的，谁后删谁赢照常比。
 * - 已经有、没删、旧日记后来又被旧客户端改了（updated_at 更新）：跟着改成新内容。转来的条目本身不能改，所以 updated_at 还等于当初那篇的，就说明没人动过。
 * - 旧日记删了（墓碑更新）：没删的那几条一起打墓碑。
 * - 删过的条目（墓碑比旧日记新）不再翻回来。
 * hasAttachments：只有附件没有字的日子也转一条（附件跟着它显示）。
 */
export function planJournalMigration(entry: JournalEntry, existing: (id: string) => JournalPost | undefined, hasAttachments = false): JournalPost[] {
  const baseId = migratedPostId(entry.id);
  if (!baseId) return [];
  const { core, kept } = splitConflictBlocks(entry.body_md ?? '');
  const pieces: Array<{ body: string; mood: string | null }> = [];
  if (core || entry.mood || hasAttachments || kept.length) pieces.push({ body: core, mood: entry.mood ?? null });
  for (const k of kept) pieces.push({ body: k, mood: null });
  const created = isoOf(entry.updated_at, entry.created_at);
  const out: JournalPost[] = [];
  if (entry.deleted) {
    for (let i = 0; i < Math.max(1, pieces.length, kept.length + 1); i++) {
      const id = migratedPostId(entry.id, i)!;
      const cur = existing(id);
      if (cur && !cur.deleted && entry.updated_at > cur.updated_at) out.push({ ...cur, deleted: true, updated_at: entry.updated_at });
    }
    return out;
  }
  pieces.forEach((p, i) => {
    const id = migratedPostId(entry.id, i)!;
    const cur = existing(id);
    if (!cur) {
      out.push({ id, updated_at: entry.updated_at, deleted: false, day: entry.date, body_md: p.body, mood: p.mood, created_at: created });
      return;
    }
    if (cur.deleted || !(entry.updated_at > cur.updated_at)) return;
    if (cur.body_md === p.body && cur.mood === p.mood && cur.day === entry.date) return;
    out.push({ ...cur, updated_at: entry.updated_at, day: entry.date, body_md: p.body, mood: p.mood });
  });
  return out;
}

// ───────────── 排序、分组、筛选 ─────────────

/** 新的在前（同一刻按 id）。只要没删的。 */
export function sortPosts(posts: readonly JournalPost[]): JournalPost[] {
  return posts.filter((p) => !p.deleted).sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

/** 按天分组：新的日子在上，每天里新的在上。 */
export function groupPostsByDay(posts: readonly JournalPost[]): Array<{ day: DateKey; posts: JournalPost[] }> {
  const map = new Map<DateKey, JournalPost[]>();
  for (const p of sortPosts(posts)) {
    const list = map.get(p.day);
    if (list) list.push(p);
    else map.set(p.day, [p]);
  }
  return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0)).map(([day, list]) => ({ day, posts: list }));
}

export interface PostFilter {
  /** 只看这一天（点热力图的格子）。 */
  day?: DateKey | null;
  /** 只看这个心情（点心情列表的一行）；能和 day 一起用。 */
  mood?: string | null;
}

export function filterPosts(posts: readonly JournalPost[], f: PostFilter): JournalPost[] {
  return sortPosts(posts).filter((p) => (!f.day || p.day === f.day) && (!f.mood || p.mood === f.mood));
}

/** 每天几条、各条的心情（热力图用）。 */
export function postsByDay(posts: readonly JournalPost[]): Map<DateKey, { count: number; moods: Array<string | null> }> {
  const map = new Map<DateKey, { count: number; moods: Array<string | null> }>();
  for (const p of posts) {
    if (p.deleted) continue;
    const cur = map.get(p.day) ?? { count: 0, moods: [] };
    cur.count++;
    cur.moods.push(p.mood ?? null);
    map.set(p.day, cur);
  }
  return map;
}

/**
 * 心情列表（左栏热力图下面）：每个用过的心情一行，按条数从多到少，一样多的按 MOOD_IDS 的顺序（从好到不好）。
 * 只算 [from, to] 这几天（和热力图同一段）；没用过的、不认识的心情不列。
 */
export function moodCounts(posts: readonly JournalPost[], range?: { from: DateKey; to: DateKey }): Array<{ id: MoodId; count: number }> {
  const counts = new Map<MoodId, number>();
  for (const p of posts) {
    if (p.deleted || !isMoodId(p.mood)) continue;
    if (range && (p.day < range.from || p.day > range.to)) continue;
    counts.set(p.mood, (counts.get(p.mood) ?? 0) + 1);
  }
  return MOOD_IDS.filter((id) => counts.has(id))
    .map((id) => ({ id, count: counts.get(id)! }))
    .sort((a, b) => b.count - a.count || MOOD_IDS.indexOf(a.id) - MOOD_IDS.indexOf(b.id));
}

/**
 * 热力图画多少周：至少 minWeeks（默认 26，约 6 个月），最早一条在更早时往前补到它那周（左右滑能看到），最多 maxWeeks。
 * 返回 [from, to] 是整段的第一天和今天，心情列表按同一段数。
 */
export function journalHeatRange(posts: readonly JournalPost[], today: DateKey, opts: { minWeeks?: number; maxWeeks?: number; weekStartsOn?: 0 | 1 } = {}): { weeks: number; from: DateKey; to: DateKey } {
  const min = opts.minWeeks ?? 26;
  const max = opts.maxWeeks ?? 530;
  const ws = opts.weekStartsOn ?? localeWeekStart();
  let earliest: DateKey | null = null;
  for (const p of posts) if (!p.deleted && p.day <= today && (!earliest || p.day < earliest)) earliest = p.day;
  const last = startOfWeek(today, ws);
  let weeks = min;
  if (earliest) weeks = Math.max(min, Math.floor(diffDays(startOfWeek(earliest, ws), last) / 7) + 1);
  weeks = Math.min(max, weeks);
  return { weeks, from: addDays(last, -(weeks - 1) * 7), to: today };
}

// ───────────── 颜色：心情色在 OKLab 里混 ─────────────

type Rgb = [number, number, number];

export function parseHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

const toLin = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const fromLin = (v: number) => {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, c)) * 255);
};

function rgbToOklab([r8, g8, b8]: Rgb): [number, number, number] {
  const r = toLin(r8);
  const g = toLin(g8);
  const b = toLin(b8);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

function oklabToRgb([L, A, B]: [number, number, number]): Rgb {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    fromLin(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLin(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLin(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

const hex2 = (n: number) => n.toString(16).padStart(2, '0');

/** 几种颜色在 OKLab 里取平均（等权）。读不出来的颜色跳过；一个都没有返回 null。 */
export function mixOklab(colors: readonly string[]): string | null {
  const labs = colors.map(parseHex).filter((c): c is Rgb => !!c).map(rgbToOklab);
  if (!labs.length) return null;
  const avg = [0, 1, 2].map((i) => labs.reduce((s, c) => s + c[i]!, 0) / labs.length) as [number, number, number];
  const [r, g, b] = oklabToRgb(avg);
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}

/**
 * 一天的格子颜色（Rei 2026-10-28「activity图的颜色根据心情的颜色mix」）：每条按它的心情色算一份，没心情的（和不认识的心情）算 neutral，取平均。
 * palette：心情 id → 颜色（客户端从皮肤令牌 --mood-* 读出来）。没有条目返回 null。
 */
export function dayMoodColor(moods: ReadonlyArray<string | null>, palette: Readonly<Record<string, string>>, neutral: string): string | null {
  if (!moods.length) return null;
  return mixOklab(moods.map((m) => (m && isMoodId(m) && palette[m]) || neutral));
}

/** 条数 → 深浅（0–1，和空格子的底色混）：1 条 55%、2 条 70%、3 条 85%、4 条以上 100%。 */
export function heatStrength(count: number): number {
  if (count <= 0) return 0;
  return [0.55, 0.7, 0.85][count - 1] ?? 1;
}

// ───────────── 显示 ─────────────

/** 本机时间「14:30」。 */
export function postTime(createdAt: string, timeZone?: string): string {
  const d = new Date(createdAt);
  if (!Number.isFinite(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', { ...(timeZone ? { timeZone } : {}), hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
}

/** 正文空的、也没心情的不能发。 */
export function canSendPost(body: string, mood: string | null | undefined): boolean {
  return !!body.trim() || !!mood;
}

// ───────────── 导出 / 导入 ─────────────

const MARKER = /^<!--\s*mindough:post\s+([^>]*?)\s*-->[ \t]*$/gm;
const ATTR = /(\w+)="([^"]*)"/g;
const HEAD_LINE = /^\*\*\d{1,2}:\d{2}\*\*(?:\s*·[^\n]*)?\n?/;

const esc = (s: string) => s.replace(/["<>]/g, '');

/**
 * 一天的文件正文：每条一段。标记注释记 id、时刻、心情（导入靠它），下面一行「**14:30** · 开心」给人看，再下面是正文。
 * bodyOf：把正文里的图片地址换成相对路径（导出那边的 images.body）。按时间先后排（早的在上，读起来顺）。
 */
export function formatJournalDay(posts: readonly JournalPost[], bodyOf: (md: string) => string = (s) => s, timeZone?: string): string {
  const list = sortPosts(posts).reverse();
  return list
    .map((p) => {
      const attrs = [`id="${esc(p.id)}"`, `created="${esc(p.created_at)}"`, p.mood ? `mood="${esc(p.mood)}"` : ''].filter(Boolean).join(' ');
      const label = p.mood ? moodLabel(p.mood) || p.mood : '';
      const head = `**${postTime(p.created_at, timeZone)}**${label ? ` · ${label}` : ''}`;
      const body = bodyOf(p.body_md).replace(/\s+$/, '');
      return `<!-- mindough:post ${attrs} -->\n${head}\n\n${body}${body ? '\n' : ''}`;
    })
    .join('\n');
}

export interface ParsedPost {
  id: string | null;
  created: string | null;
  mood: string | null;
  body: string;
}

/** 读回 formatJournalDay 写的正文；一个标记都没有（旧格式、别处来的文件）返回 null。 */
export function parseJournalDay(md: string): ParsedPost[] | null {
  const marks = [...md.matchAll(MARKER)];
  if (!marks.length) return null;
  return marks.map((m, i) => {
    const attrs: Record<string, string> = {};
    for (const a of m[1]!.matchAll(ATTR)) attrs[a[1]!] = a[2]!;
    const start = m.index! + m[0].length;
    const end = i + 1 < marks.length ? marks[i + 1]!.index! : md.length;
    const body = md.slice(start, end).replace(/^\n/, '').replace(HEAD_LINE, '').replace(/^\s*\n/, '').replace(/\s+$/, '');
    return { id: attrs.id || null, created: attrs.created || null, mood: attrs.mood || null, body };
  });
}
