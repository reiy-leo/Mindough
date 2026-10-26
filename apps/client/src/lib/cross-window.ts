/**
 * 把主窗口和设置窗口接起来（Tauri 桌面，Rei 2026-10-26 设置做成单独的窗口）。消息怎么发见 lib/window-relay.ts。
 * - 账户：哪个窗口登录 / 退出了，另一个重新查（状态真变了才说，免得两边来回喊）
 * - 同步：只在主窗口跑；主窗口把状态发给设置窗口，设置窗口的「立即同步」转给主窗口
 * - 提醒通知开关、重置后重新载入
 * 本机设置（皮肤、明暗…）由 lib/settings.tsx 自己听。
 */
import { getAccount, refreshAccount, subscribeAccount } from './account';
import { reloadReminderSettings } from './reminders';
import { getSyncView, mirrorSyncFromMain, setSyncNowForwarder, subscribeSyncView, syncNow, type SyncView } from './sync';
import { onRelay, relay } from './window-relay';
import { isMiniWindow, isSettingsWindow } from './windows';
import { isTauri } from '../store/sqlite-tauri';

const accountKey = () => {
  const a = getAccount();
  return a.status === 'in' ? `in:${a.user.email}` : a.status;
};

export function installCrossWindow(): void {
  if (!isTauri() || isMiniWindow()) {
    if (isTauri()) {
      onRelay('reload', () => location.reload());
      onRelay('reminders', reloadReminderSettings);
    }
    return;
  }
  let last = accountKey();
  subscribeAccount(() => {
    const k = accountKey();
    if (k === last) return;
    last = k;
    // 还在查（loading）不算变了
    if (k !== 'loading') relay('account');
  });
  onRelay('account', () => void refreshAccount());
  onRelay('reminders', reloadReminderSettings);
  onRelay('reload', () => location.reload());

  if (isSettingsWindow()) {
    onRelay('sync-view', (v) => mirrorSyncFromMain(v as SyncView));
    setSyncNowForwarder(() => relay('sync-now'));
    relay('sync-view-request');
  } else {
    subscribeSyncView(() => relay('sync-view', getSyncView()));
    onRelay('sync-view-request', () => relay('sync-view', getSyncView()));
    onRelay('sync-now', () => void syncNow());
  }
}
