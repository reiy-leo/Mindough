/**
 * 任务日期的显示方式（Rei 2026-10-26「设置-任务：支持自定义日期显示格式，相对时间、年月日、年月日+时区、自动等」）：
 * 存在本机设置 dateDisplay 里（不同步，桌面多个窗口经 mindough:relay 跟着变）。组件用 useDateDisplay() 拿当前方式，
 * 再交给 core 的 formatTaskDate / formatTaskTime；换方式时用到它的组件跟着重画。
 */
import { isDateDisplay, type DateDisplay } from '@mindough/core';
import { useSettings } from './settings';

export function useDateDisplay(): DateDisplay {
  const { settings } = useSettings();
  return isDateDisplay(settings.dateDisplay) ? settings.dateDisplay : 'auto';
}
