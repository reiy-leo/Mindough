/**
 * 多窗口（Tauri 桌面）：主窗口 + 置顶的「小窗」（?window=mini）。
 *
 * 两个窗口各有一份 Store 内存快照，底下是同一个 rusqlite 连接（src-tauri/src/db.rs）。
 * 一个窗口写了什么，经 Tauri 事件 `mindough:changes` 发给另一个，对方用 store.applyRemote 合进内存
 * （LWW、不进 outbox——写的那个窗口已经进过了；落盘是同一行，WHERE updated_at > 不会重复写）。
 * 小窗不跑同步、不排提醒（都交给主窗口）。
 */
import { appName, type Change, type Store } from '@mindough/core';
import { isTauri } from '../store/sqlite-tauri';

export const isMiniWindow = (): boolean => typeof location !== 'undefined' && new URLSearchParams(location.search).get('window') === 'mini';

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
