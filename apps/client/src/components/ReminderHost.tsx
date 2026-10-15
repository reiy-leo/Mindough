/** 提醒排程挂在这里（lib/reminders.ts）：到点时前台弹一条带「查看」「10 分钟后」的提示，后台发系统通知。 */
import { useEffect, useRef } from 'react';
import { Bell } from 'lucide-react';
import { startReminders } from '../lib/reminders';
import { useUi } from '../lib/ui';
import { useStore } from '../store/StoreProvider';
import { tr } from '../lib/i18n';

export function ReminderHost() {
  const store = useStore();
  const ui = useUi();
  const uiRef = useRef(ui);
  uiRef.current = ui;
  useEffect(
    () =>
      startReminders({
        store,
        open: (id) => uiRef.current.openEditor(id),
        inApp: (_r, title, body, a) =>
          uiRef.current.toast(
            {
              message: (
                <span className="reminder-toast">
                  <Bell size={15} aria-hidden className="reminder-toast-icon" />
                  <span>
                    <strong>{title}</strong>
                    <span className="muted"> · {body}</span>
                  </span>
                </span>
              ),
              actions: [
                { label: tr('查看'), onPress: a.open },
                { label: tr('10 分钟后'), onPress: a.snooze },
              ],
            },
            12000,
          ),
      }),
    [store],
  );
  return null;
}
