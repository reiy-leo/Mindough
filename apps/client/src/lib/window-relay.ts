/**
 * 窗口之间互相打招呼（Tauri 桌面：主窗口、小窗、设置窗口）。
 *
 * 数据的改动走 lib/windows.ts 的 `mindough:changes`；这里只管不进数据库的东西：
 * - settings：本机设置（皮肤、明暗、布局、农历开关…）改了，别的窗口重新读 localStorage
 * - reminders：「提醒通知」开关改了
 * - account：登录 / 退出了，别的窗口重新查账户
 * - sync-view / sync-view-request / sync-now：同步只在主窗口跑，设置窗口要看状态、按「立即同步」
 * - reload：设置窗口里重置了演示数据，主窗口也要重新载入
 * Web 端不是 Tauri，什么都不发（同一浏览器的别的标签页靠 storage 事件，见 lib/settings.tsx）。
 */
import { isTauri } from '../store/sqlite-tauri';

const EVENT = 'mindough:relay';

export type RelayKind = 'settings' | 'reminders' | 'account' | 'sync-view' | 'sync-view-request' | 'sync-now' | 'reload';

interface RelayMsg {
  from: string;
  kind: RelayKind;
  payload?: unknown;
}

type Handler = (payload: unknown) => void;
const handlers = new Map<RelayKind, Set<Handler>>();
let myLabel = '';
let started: Promise<void> | null = null;

function start(): Promise<void> {
  if (!started) {
    started = (async () => {
      const [{ listen }, { getCurrentWebviewWindow }] = await Promise.all([import('@tauri-apps/api/event'), import('@tauri-apps/api/webviewWindow')]);
      myLabel = getCurrentWebviewWindow().label;
      await listen<RelayMsg>(EVENT, (e) => {
        if (e.payload.from === myLabel) return;
        handlers.get(e.payload.kind)?.forEach((h) => h(e.payload.payload));
      });
    })().catch(() => {});
  }
  return started;
}

/** 告诉别的窗口。不是 Tauri 就什么都不做。 */
export function relay(kind: RelayKind, payload?: unknown): void {
  if (!isTauri()) return;
  void start().then(async () => {
    const { emit } = await import('@tauri-apps/api/event');
    await emit(EVENT, { from: myLabel, kind, payload } satisfies RelayMsg);
  }).catch(() => {});
}

/** 听别的窗口说某件事；返回停止函数。 */
export function onRelay(kind: RelayKind, fn: Handler): () => void {
  if (!isTauri()) return () => {};
  void start();
  let set = handlers.get(kind);
  if (!set) handlers.set(kind, (set = new Set()));
  set.add(fn);
  return () => {
    set.delete(fn);
  };
}
