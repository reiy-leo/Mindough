/**
 * 任务日期的文字 + 时区小标注（Rei 2026-10-25 任务时区）：「明天」「后天 UTC−4」。
 * 「今天 / 明天」按任务时区的今天说；任务时区和设备那天的偏移不一样时，旁边小字写偏移（core timeZoneBadge）。
 */
import { friendlyDate, relativeDayZh, taskToday, timeZoneBadge, timeZoneLabel, type DateKey, type Task } from '@mindough/core';
import { useStore } from '../store/StoreProvider';
import { tr } from '../lib/i18n';

export function TaskDateText({ task, today, relative = false }: { task: Pick<Task, 'scheduled_date' | 'time_zone'>; today: DateKey; relative?: boolean }) {
  const store = useStore();
  const date = task.scheduled_date;
  if (!date) return null;
  const zoneToday = taskToday(task, store.now(), today);
  const text = relative ? relativeDayZh(date, zoneToday) : friendlyDate(date, zoneToday);
  const badge = timeZoneBadge(task, date);
  return (
    <>
      {text}
      {badge && task.time_zone && (
        <span className="tz-badge" title={tr('时区：{zone}', { zone: timeZoneLabel(task.time_zone, date) })}>
          {badge}
        </span>
      )}
    </>
  );
}
