/**
 * 主屏小组件的快照（Android AppWidget / iOS WidgetKit 读，见 docs/WIDGETS.md）：
 * 数据一变（防抖 2 秒）就把 我的一天 + 今天要打卡 写成 JSON，交给 src-tauri/src/widget.rs 存进 app 数据目录。
 * 只在手机 app 里写（桌面用「小窗」，网页没有小组件）。
 */
import { dueToday, myDayItems, toDateKey, type Store } from '@mindough/core';
import { isTauri } from '../store/sqlite-tauri';
import { titleOf } from './view';

export interface WidgetSnapshot {
  version: 1;
  /** 写的时候（ISO）。 */
  at: string;
  date: string;
  myDay: Array<{ id: string; title: string; done: boolean }>;
  checkIns: Array<{ id: string; title: string; done: boolean }>;
}

export function buildWidgetSnapshot(store: Store, now = store.now()): WidgetSnapshot {
  const today = toDateKey(now);
  const tasks = store.list('task');
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const checkIns = store.list('check_in');
  const items = myDayItems(store.list('my_day'), byId, checkIns, today, now);
  const inDay = new Set(items.map((i) => i.task.id));
  const due = store.tasks().filter((t) => dueToday(t, today) && !inDay.has(t.id));
  return {
    version: 1,
    at: now.toISOString(),
    date: today,
    myDay: items.filter((i) => i.task.status !== '关闭').map((i) => ({ id: i.task.id, title: titleOf(store, i.task), done: i.done })),
    checkIns: due.map((t) => ({ id: t.id, title: titleOf(store, t), done: store.progress(t.id, today)?.met ?? false })),
  };
}

export function installWidgetSnapshot(store: Store): () => void {
  if (!isTauri() || !/Android|iPhone|iPad/i.test(navigator.userAgent)) return () => {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last = '';
  const write = async () => {
    const json = JSON.stringify(buildWidgetSnapshot(store));
    if (json === last) return;
    last = json;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('widget_snapshot', { json }).catch(() => {});
  };
  const off = store.subscribe(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void write(), 2000);
  });
  void write();
  return () => {
    off();
    if (timer) clearTimeout(timer);
  };
}
