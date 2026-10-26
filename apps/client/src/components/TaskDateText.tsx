/**
 * 任务日期的文字 + 时区小标注（Rei 2026-10-25 任务时区）：「明天」「后天 UTC−4」。
 * 「今天 / 明天」按任务时区的今天说；任务时区和设备那天的偏移不一样时，旁边小字写偏移（core timeZoneBadge）。
 * 文字按设置 → 任务 →「日期显示」写（core formatTaskDate，Rei 2026-10-26）；选「年月日+时区」时时区已经写在文字里，不再加小标注。
 */
import { formatTaskDate, formatTaskDateRange, isDateRange, taskToday, timeZoneBadge, timeZoneLabel, type DateKey, type Task } from '@mindough/core';
import { useDateDisplay } from '../lib/date-display';
import { useStore } from '../store/StoreProvider';
import { tr } from '../lib/i18n';

export function TaskDateText({ task, today, relative = false }: { task: Pick<Task, 'scheduled_date' | 'end_date' | 'time_zone'>; today: DateKey; relative?: boolean }) {
  const store = useStore();
  const mode = useDateDisplay();
  const date = task.scheduled_date;
  if (!date) return null;
  const zoneToday = taskToday(task, store.now(), today);
  // 日期段（Rei 2026-10-26）：「10月26日 – 30日」，跨月 / 跨年写全；四种日期显示都支持
  const text = isDateRange(task)
    ? formatTaskDateRange(date, task.end_date, { mode, today: zoneToday, timeZone: task.time_zone })
    : formatTaskDate(date, { mode, today: zoneToday, timeZone: task.time_zone, compact: relative });
  const badge = mode === 'ymd-tz' ? null : timeZoneBadge(task, date);
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

