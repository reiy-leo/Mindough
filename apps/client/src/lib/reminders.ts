/**
 * 提醒的排程与通知（算什么时候响在 core reminders.ts）。
 *
 * - 总开关存在本机（每台设备自己决定要不要通知；通知权限本来就是按设备的）：`mindough:reminders`，默认开。
 * - 「已响过」与「稍后再提醒」也存本机（`mindough:reminders:fired` / `:snoozed`），多台设备各响各的。
 * - Web：app 开着时排程（每分钟、数据一变、回到前台时重算，最近的一个用 setTimeout 精确到点）。
 *   页面在前台：只在 app 里弹提示（带「查看」「10 分钟后」）；在后台：发系统通知（有 service worker 就经它发，
 *   Android Chrome 只认这种；点通知回到 app 打开那件任务）。
 * - Tauri 桌面：同 Web（app 开着时排程），系统通知走 tauri-plugin-notification。
 * - Tauri 手机：接下来 48 小时的提醒交给系统排好（Schedule.at），app 关着也会响；每次重算时先取消旧的再排。
 * - 日记提醒（Rei 2026-10-17）：每天 journal.remind_time（默认 21:00）响，写没写都响；journal.remind 关掉就不排。
 *   不属于任务（taskId 空串），点了打开日记（openJournal）。
 */

/** 现在要不要排日记提醒、几点（同步的偏好）。 */
export function journalRemindTime(store: Store): string | null {
  if (store.pref(JOURNAL_PREFS.remind) === false) return null;
  const v = store.pref(JOURNAL_PREFS.remindTime);
  return typeof v === 'string' && v ? v : JOURNAL_REMIND_TIME_DEFAULT;
}
import { dueReminders, journalReminders, pruneFired, reminderBody, upcomingReminders, JOURNAL_PREFS, JOURNAL_REMIND_TIME_DEFAULT, SNOOZE_MS, type Reminder, type Store } from '@mindough/core';
import { isTauri } from '../store/sqlite-tauri';
import { titleOf } from './view';
import { tr } from './i18n';

export type NotifyPermission = 'granted' | 'denied' | 'default' | 'unsupported';

const KEY = 'mindough:reminders';
const FIRED = 'mindough:reminders:fired';
const SNOOZED = 'mindough:reminders:snoozed';
const SCHEDULED = 'mindough:reminders:scheduled';

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());
export function onReminderSettings(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function remindersEnabled(): boolean {
  return localStorage.getItem(KEY) !== '0';
}

export function setRemindersEnabled(on: boolean): void {
  localStorage.setItem(KEY, on ? '1' : '0');
  emit();
}

function readMap(key: string): Map<string, number> {
  try {
    return new Map(Object.entries(JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, number>));
  } catch {
    return new Map();
  }
}
function writeMap(key: string, m: Map<string, number>): void {
  localStorage.setItem(key, JSON.stringify(Object.fromEntries(m)));
}

const isMobileTauri = () => isTauri() && /Android|iPhone|iPad/i.test(navigator.userAgent);

// ───────── 权限 ─────────

export async function notifyPermission(): Promise<NotifyPermission> {
  if (isTauri()) {
    try {
      const n = await import('@tauri-apps/plugin-notification');
      return (await n.isPermissionGranted()) ? 'granted' : 'default';
    } catch {
      return 'unsupported';
    }
  }
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

export async function requestNotifyPermission(): Promise<NotifyPermission> {
  if (isTauri()) {
    try {
      const n = await import('@tauri-apps/plugin-notification');
      const p = await n.requestPermission();
      emit();
      return p === 'granted' ? 'granted' : p === 'denied' ? 'denied' : 'default';
    } catch {
      return 'unsupported';
    }
  }
  if (typeof Notification === 'undefined') return 'unsupported';
  const p = await Notification.requestPermission();
  emit();
  return p;
}

// ───────── service worker（Web）─────────

let swReg: Promise<ServiceWorkerRegistration | null> | null = null;
function serviceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (swReg) return swReg;
  swReg =
    !isTauri() && 'serviceWorker' in navigator && location.protocol !== 'file:'
      ? navigator.serviceWorker.register('/sw.js').then(
          (r) => r,
          () => null,
        )
      : Promise.resolve(null);
  return swReg;
}

// ───────── 发通知 ─────────

/** 31 位整数 id（Tauri 手机的通知 id 是数字）。 */
export function numericId(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % 2147483647;
}

/** 通知带的数据：任务提醒带 taskId；日记提醒带 journal（点了打开日记）。 */
const extraOf = (r: Pick<Reminder, 'kind' | 'taskId'>) => (r.kind === 'journal' ? { journal: '1' } : { taskId: r.taskId });

async function systemNotify(r: Reminder, title: string, body: string): Promise<void> {
  const id = r.id;
  if (isTauri()) {
    const n = await import('@tauri-apps/plugin-notification');
    n.sendNotification({ id: numericId(id), title, body, extra: extraOf(r) });
    return;
  }
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const reg = await serviceWorker();
  if (reg) {
    await reg.showNotification(title, { body, tag: id, data: extraOf(r), icon: '/favicon.svg' });
    return;
  }
  const n = new Notification(title, { body, tag: id, icon: '/favicon.svg' });
  n.onclick = () => {
    window.focus();
    if (r.kind === 'journal') openJournal?.();
    else openTask?.(r.taskId);
    n.close();
  };
}

let openTask: ((id: string) => void) | null = null;
let openJournal: (() => void) | null = null;

// ───────── 排程 ─────────

export interface SchedulerDeps {
  store: Store;
  /** 前台时在 app 里提示（带「查看」「10 分钟后」）。 */
  inApp: (r: Reminder, title: string, body: string, actions: { open: () => void; snooze: () => void }) => void;
  open: (taskId: string) => void;
  /** 打开日记（今天那篇）。 */
  openJournal: () => void;
}

/** 开始排程；返回停止函数。 */
export function startReminders(deps: SchedulerDeps): () => void {
  const { store } = deps;
  openTask = deps.open;
  openJournal = deps.openJournal;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let dead = false;

  const title = (r: Reminder) => {
    if (r.kind === 'journal') return tr('日记');
    const t = store.get('task', r.taskId);
    return t ? titleOf(store, t) : tr('提醒');
  };

  const deliver = (r: Reminder) => {
    const t = r.kind === 'journal' ? { target_value: null } : store.get('task', r.taskId);
    if (!t) return;
    const name = title(r);
    const body = reminderBody(r, t);
    const visible = document.visibilityState === 'visible' && document.hasFocus();
    if (visible) {
      deps.inApp(r, name, body, {
        open: () => (r.kind === 'journal' ? deps.openJournal() : deps.open(r.taskId)),
        snooze: () => snooze(r),
      });
    } else if (!isMobileTauri()) {
      // 手机上已经交给系统排好了，这里不再发一次
      void systemNotify(r, name, body).catch(() => {});
    }
  };

  const snooze = (r: Reminder) => {
    const s = readMap(SNOOZED);
    s.set(r.id, Date.now() + SNOOZE_MS);
    writeMap(SNOOZED, s);
    plan();
  };

  const plan = () => {
    if (dead) return;
    if (timer) clearTimeout(timer);
    timer = null;
    if (!remindersEnabled()) {
      if (isMobileTauri()) void syncMobileSchedule([]);
      return;
    }
    const now = new Date();
    const fired = pruneFired(readMap(FIRED), now);
    const snoozed = readMap(SNOOZED);
    const opts = { now, fired: new Set(fired.keys()), snoozed };
    const list = [...upcomingReminders(store.list('task'), store.list('check_in'), opts), ...journalReminders(journalRemindTime(store), opts)].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
    const due = dueReminders(list, now);
    if (due.length) {
      for (const r of due) {
        deliver(r);
        fired.set(r.id, now.getTime());
        snoozed.delete(r.id);
      }
      writeMap(SNOOZED, snoozed);
    }
    writeMap(FIRED, fired);
    const rest = list.filter((r) => r.at > now.getTime());
    if (isMobileTauri()) void syncMobileSchedule(rest, (r) => ({ title: title(r), body: reminderBody(r, (r.kind === 'journal' ? undefined : store.get('task', r.taskId)) ?? { target_value: null }) }));
    const next = rest[0];
    // 最多 60 秒重算一次（睡眠唤醒、时区变了也能跟上）
    const wait = Math.min(60_000, next ? Math.max(250, next.at - Date.now()) : 60_000);
    timer = setTimeout(plan, wait);
  };

  const unsub = store.subscribe(() => {
    // 数据一变就重算（打了卡就不该再响、改了提醒时间要重排）；合并到下一帧
    if (timer) clearTimeout(timer);
    timer = setTimeout(plan, 50);
  });
  const offSettings = onReminderSettings(plan);
  const onVis = () => document.visibilityState === 'visible' && plan();
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('focus', plan);

  // Web：点系统通知回到 app 打开那件任务（sw.js 发来的）
  const onSwMessage = (e: MessageEvent) => {
    const d = e.data as { type?: string; taskId?: string } | null;
    if (d?.type === 'open-task' && d.taskId) deps.open(d.taskId);
    if (d?.type === 'open-journal') deps.openJournal();
  };
  if (!isTauri() && 'serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', onSwMessage);
    if (remindersEnabled()) void serviceWorker();
  }
  // Tauri 手机：点通知打开那件任务
  let offAction: (() => void) | null = null;
  if (isTauri()) {
    void import('@tauri-apps/plugin-notification')
      .then((n) =>
        n.onAction((ev) => {
          const extra = (ev as { extra?: { taskId?: string; journal?: string } }).extra;
          if (extra?.journal) deps.openJournal();
          else if (extra?.taskId) deps.open(extra.taskId);
        }),
      )
      .then((l) => {
        offAction = () => void l.unregister();
        if (dead) offAction();
      })
      .catch(() => {});
  }

  plan();
  return () => {
    dead = true;
    if (timer) clearTimeout(timer);
    unsub();
    offSettings();
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('focus', plan);
    if ('serviceWorker' in navigator) navigator.serviceWorker.removeEventListener('message', onSwMessage);
    offAction?.();
    openTask = null;
    openJournal = null;
  };
}

/** Tauri 手机：把接下来的提醒交给系统；已经排过、时间没变的不动，不在列表里的取消。 */
async function syncMobileSchedule(list: readonly Reminder[], text?: (r: Reminder) => { title: string; body: string }): Promise<void> {
  try {
    const n = await import('@tauri-apps/plugin-notification');
    if (!(await n.isPermissionGranted())) return;
    const before = readMap(SCHEDULED); // numericId → at
    const want = new Map(list.map((r) => [String(numericId(r.id)), r] as const));
    const stale = [...before.keys()].filter((k) => !want.has(k) || want.get(k)!.at !== before.get(k));
    if (stale.length) await n.cancel(stale.map(Number));
    const after = new Map<string, number>();
    for (const [k, r] of want) {
      after.set(k, r.at);
      if (before.get(k) === r.at) continue;
      const x = text?.(r) ?? { title: tr('提醒'), body: reminderBody(r, { target_value: null }) };
      n.sendNotification({ id: Number(k), title: x.title, body: x.body, schedule: n.Schedule.at(new Date(r.at), false, true), extra: extraOf(r) });
    }
    writeMap(SCHEDULED, after);
  } catch {
    // 插件不可用：只在 app 里提示
  }
}
