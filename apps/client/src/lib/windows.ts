/**
 * 多窗口（Tauri 桌面）：主窗口 + 置顶的「小窗」（?window=mini）+ 设置窗口（?window=settings，Rei 2026-10-26）。
 *
 * 两个窗口各有一份 Store 内存快照，底下是同一个 rusqlite 连接（src-tauri/src/db.rs）。
 * 一个窗口写了什么，经 Tauri 事件 `mindough:changes` 发给另一个，对方用 store.applyRemote 合进内存
 * （LWW、不进 outbox——写的那个窗口已经进过了；落盘是同一行，WHERE updated_at > 不会重复写）。
 * 小窗不跑同步、不排提醒（都交给主窗口）。
 */
import { appName, type Change, type Store } from '@mindough/core';
import { isTauri } from '../store/sqlite-tauri';

const windowParam = (): string | null => (typeof location !== 'undefined' ? new URLSearchParams(location.search).get('window') : null);
export const isMiniWindow = (): boolean => windowParam() === 'mini';
/** 设置窗口（桌面端单独一个窗口）；Web 用 ?window=settings 也能看这个布局（截图、调试）。 */
export const isSettingsWindow = (): boolean => windowParam() === 'settings';
/** 副窗口（小窗、设置窗口）：不跑同步、不排提醒、不传附件，都交给主窗口。 */
export const isAuxWindow = (): boolean => isMiniWindow() || isSettingsWindow();

const EVENT = 'mindough:changes';

/** 窗口之间互相告知写入；返回停止函数。 */
export function installWindowSync(store: Store): () => void {
  if (!isTauri()) return () => {};
  let dead = false;
  let unlisten: (() => void) | null = null;
  let label = '';
  let stopWrites: (() => void) | null = null;
  void (async () => {
    const [{ emit, listen }, { getCurrentWebviewWindow }] = await Promise.all([import('@tauri-apps/api/event'), import('@tauri-apps/api/webviewWindow')]);
    label = getCurrentWebviewWindow().label;
    const off = await listen<{ from: string; changes: Change[] }>(EVENT, (e) => {
      if (e.payload.from !== label) store.applyRemote(e.payload.changes);
    });
    if (dead) return off();
    unlisten = off;
    stopWrites = store.onLocalWrite((changes) => void emit(EVENT, { from: label, changes }));
  })().catch(() => {});
  return () => {
    dead = true;
    unlisten?.();
    stopWrites?.();
  };
}

/** 打开（或叫到前面）小窗：320 × 520，置顶，可以调大小。 */
export async function openMiniWindow(): Promise<void> {
  if (!isTauri()) return;
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const existing = await WebviewWindow.getByLabel('mini');
  if (existing) {
    await existing.show();
    await existing.setFocus();
    return;
  }
  new WebviewWindow('mini', {
    url: 'index.html?window=mini#/mini',
    title: appName(),
    width: 340,
    height: 540,
    minWidth: 280,
    minHeight: 320,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: false,
  });
}

/** 设置窗口里换到某一项（主窗口按 ⌘, 或深链打开时，窗口已经开着就发这个）。 */
export const SETTINGS_NAV_EVENT = 'mindough:settings-nav';
export const SETTINGS_LABEL = 'settings';

let opening: Promise<void> | null = null;

/**
 * 打开（或叫到前面）设置窗口：760 × 560，最小 640 × 440，可以调大小。
 * macOS 和主窗口一样隐藏标题栏，红绿灯浮在左侧边栏上（样式见 styles/settings.css）。
 * 已经开着就聚焦，不开第二个；section 给了就换到那一项。
 */
export function openSettingsWindow(opts: { section?: string; title: string; macOverlay: boolean }): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  // 菜单快捷键和网页里的 ⌘, 可能同时到：一次只开一个
  if (opening) return opening;
  opening = (async () => {
    const [{ WebviewWindow }, { emitTo }, { LogicalPosition }] = await Promise.all([
      import('@tauri-apps/api/webviewWindow'),
      import('@tauri-apps/api/event'),
      import('@tauri-apps/api/dpi'),
    ]);
    const existing = await WebviewWindow.getByLabel(SETTINGS_LABEL);
    if (existing) {
      await existing.unminimize();
      await existing.show();
      await existing.setFocus();
      if (opts.section) await emitTo(SETTINGS_LABEL, SETTINGS_NAV_EVENT, opts.section);
      return;
    }
    const w = new WebviewWindow(SETTINGS_LABEL, {
      url: `index.html?window=settings#/settings${opts.section ? `/${opts.section}` : ''}`,
      title: opts.title,
      width: 760,
      height: 560,
      minWidth: 640,
      minHeight: 440,
      resizable: true,
      center: true,
      ...(opts.macOverlay ? { titleBarStyle: 'overlay' as const, hiddenTitle: true, trafficLightPosition: new LogicalPosition(16, 18) } : {}),
    });
    await new Promise<void>((resolve) => {
      void w.once('tauri://created', () => resolve());
      void w.once('tauri://error', () => resolve());
    });
  })().finally(() => {
    opening = null;
  });
  return opening;
}

/** 小窗里：把主窗口叫到前面（打开某件任务时也用它）。 */
export async function focusMainWindow(): Promise<void> {
  if (!isTauri()) return;
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const main = await WebviewWindow.getByLabel('main');
  await main?.show();
  await main?.unminimize();
  await main?.setFocus();
}

/** 小窗置顶开关。 */
export async function setMiniOnTop(on: boolean): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  await getCurrentWebviewWindow().setAlwaysOnTop(on);
}
