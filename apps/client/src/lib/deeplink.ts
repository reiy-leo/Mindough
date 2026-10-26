/**
 * 深链接 mindough://（方案见 docs/DEEPLINKS.md，Rei 2026-10-16 审过）。
 * 第一批：task / view / new / checkin；日记 journal/{today|YYYY-MM-DD}（Rei 2026-10-17）。做事的链接不弹确认，直接做 + 提示里可以撤销。
 * auth 由 native-login 处理；其余 host（group、library、person、search、timer、done）跟 M4 一起做。
 *
 * Web 端同样的东西走 hash：#/task/{id}、#/new?text=…、#/checkin-now/{id}（打卡页 #/checkin 已占用）。
 */
import { addDays, BUILTIN_TYPE_IDS, toDateKey, type DateKey } from '@mindough/core';
import { isSettingsSection, type Route } from './router';

export type DeepLinkAction =
  | { kind: 'task'; id: string }
  | { kind: 'view'; route: Route }
  | { kind: 'new'; text: string; date: DateKey | null; end: DateKey | null; myDay: boolean; typeId: string | null; groupId: string | null }
  | { kind: 'checkin'; id: string; amount: number }
  /** 日记：date = 'today' 或 YYYY-MM-DD（不是真日期的也原样带着，执行时提示「没有这一天」）。 */
  | { kind: 'journal'; date: string }
  /** 认得是 mindough:// 但写错了（或者是还没做的 host）：打开 app，提示一句。 */
  | { kind: 'invalid'; url: string };

/** view/{页面} 的页面名 → 路由。 */
const VIEWS: Record<string, Route> = {
  myday: { page: 'myday' },
  inbox: { page: 'backlog' },
  timeline: { page: 'agenda' },
  groups: { page: 'groups' },
  // 界面上「组」改叫「项目」（Rei 2026-10-25）：view/projects 是别名，旧的 view/groups 照样能用
  projects: { page: 'groups' },
  // 关系图页删掉了（Rei 2026-10-23）：旧链接 view/graph 打开默认页「我的一天」，不报错
  graph: { page: 'myday' },
  available: { page: 'doable' },
  checkin: { page: 'checkin' },
  // 倒数日单独一页（Rei 2026-10-26）；countdowns 是别名
  countdown: { page: 'countdown' },
  countdowns: { page: 'countdown' },
  journal: { page: 'journal' },
  library: { page: 'library' },
  people: { page: 'people' },
  // 类型（Rei 2026-10-26 侧栏「管理 → 类型」）；categories 是别名
  types: { page: 'types' },
  categories: { page: 'types' },
  settings: { page: 'settings' },
};

/** new?library=（旧名 type=）的英文短名 → 内置资料库 id；也接受 id 本身。 */
function typeIdOf(name: string | null): string | null {
  if (!name) return null;
  const builtin = (BUILTIN_TYPE_IDS as Record<string, string>)[name.toLowerCase()];
  return builtin && name.toLowerCase() !== 'plain' ? builtin : name.toLowerCase() === 'plain' ? null : name;
}

/** date=today / tomorrow / 2026-10-20。认不出就当没写（进待安排）。 */
export function parseLinkDate(v: string | null, now: Date): DateKey | null {
  if (!v) return null;
  const today = toDateKey(now);
  const s = v.trim().toLowerCase();
  if (s === 'today') return today;
  if (s === 'tomorrow') return addDays(today, 1);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? (s as DateKey) : null;
}

const truthy = (v: string | null) => v === '1' || v === 'true' || v === 'yes';

/**
 * 把 host + 路径段 + 查询参数变成要做的事。mindough:// 和 web hash 共用这一个。
 * 返回 null：不归这里管（auth）。
 */
function toAction(host: string, segs: string[], q: URLSearchParams, now: Date, raw: string): DeepLinkAction | null {
  switch (host) {
    case 'auth':
      return null;
    case 'task':
      return segs[0] ? { kind: 'task', id: segs[0] } : { kind: 'invalid', url: raw };
    case 'view': {
      const route = VIEWS[(segs[0] ?? '').toLowerCase()];
      // view/settings/appearance：直接打开设置的某一项（Rei 2026-10-26 设置分成五项）
      // view/settings/library（或 types）：资料库在「任务」那项里（Rei 2026-10-26 类型改叫资料库）
      const sec0 = (segs[1] ?? '').toLowerCase();
      const sec = sec0 === 'library' || sec0 === 'types' ? 'tasks' : sec0;
      if (route?.page === 'settings' && isSettingsSection(sec)) return { kind: 'view', route: { page: 'settings', section: sec } };
      return route ? { kind: 'view', route } : { kind: 'invalid', url: raw };
    }
    case 'new': {
      const text = (q.get('text') ?? '').trim();
      // 日期段（Rei 2026-10-26）：end= 结束日，写法同 date；没有 date、或不晚于 date 就当没写
      const date = parseLinkDate(q.get('date'), now);
      const end = parseLinkDate(q.get('end'), now);
      return {
        kind: 'new',
        text,
        date,
        end: date && end && end > date ? end : null,
        myDay: truthy(q.get('myday')),
        // library= 是新名字，type= 照旧能用（Rei 2026-10-26 类型改叫资料库）
        typeId: typeIdOf(q.get('library') ?? q.get('type')),
        groupId: q.get('group') || null,
      };
    }
    case 'journal':
      return { kind: 'journal', date: (segs[0] ?? 'today').toLowerCase() };
    case 'checkin': {
      if (!segs[0]) return { kind: 'invalid', url: raw };
      const n = Number(q.get('amount') ?? '1');
      return { kind: 'checkin', id: segs[0], amount: Number.isFinite(n) && n > 0 ? n : 1 };
    }
    default:
      return { kind: 'invalid', url: raw };
  }
}

/** mindough://task/abc、mindough://new?text=…；不是 mindough:// 的返回 null。 */
export function parseDeepLink(url: string, now: Date = new Date()): DeepLinkAction | null {
  const m = /^mindough:\/\/([^/?#]*)([^?#]*)(\?[^#]*)?/i.exec(url.trim());
  if (!m) return null;
  const segs = (m[2] ?? '').split('/').filter(Boolean).map(decodeURIComponent);
  return toAction(m[1]!.toLowerCase(), segs, new URLSearchParams(m[3] ?? ''), now, url);
}

/** Web：#/task/abc、#/new?text=…、#/checkin-now/abc。别的 hash 是普通页面，返回 null。 */
export function parseHashLink(hash: string, now: Date = new Date()): DeepLinkAction | null {
  const h = hash.replace(/^#\/?/, '');
  const qi = h.indexOf('?');
  const path = qi >= 0 ? h.slice(0, qi) : h;
  const q = new URLSearchParams(qi >= 0 ? h.slice(qi + 1) : '');
  const [head, ...segs] = path.split('/').filter(Boolean).map(decodeURIComponent);
  if (head === 'task' || head === 'new') return toAction(head, segs, q, now, hash);
  if (head === 'checkin-now') return toAction('checkin', segs, q, now, hash);
  return null;
}

// ───────── 排队：链接可能在数据库打开之前就到了（冷启动），先存着，App 挂上以后再做 ─────────

const queue: DeepLinkAction[] = [];
const listeners = new Set<() => void>();

export function enqueueDeepLink(a: DeepLinkAction): void {
  queue.push(a);
  listeners.forEach((l) => l());
}

/** 取走排着的全部。 */
export function drainDeepLinks(): DeepLinkAction[] {
  return queue.splice(0, queue.length);
}

export function onDeepLink(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
