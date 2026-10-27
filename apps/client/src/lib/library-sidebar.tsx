/**
 * 资料库和项目的「在侧边栏显示 / 取消在侧边栏显示」（Rei 2026-10-26 18:55）：资料库页的 ··· 菜单、标签右键 / 长按、
 * 编辑资料库列表、侧边栏里那一项的右键都用这里，文案和图标一处改。存储在 core（store.setLibraryInSidebar，同步偏好）。
 */
import { PanelLeft, PanelLeftClose } from 'lucide-react';
import type { Group, Store, TaskType } from '@mindough/core';
import type { MenuAction } from '../ui/primitives';
import { tr } from './i18n';

export function sidebarToggleLabel(on: boolean): string {
  return on ? tr('取消在侧边栏显示') : tr('在侧边栏显示');
}

export function librarySidebarAction(store: Store, type: Pick<TaskType, 'id'>): MenuAction {
  const on = store.isLibraryInSidebar(type.id);
  return {
    id: 'sidebar',
    label: sidebarToggleLabel(on),
    icon: on ? <PanelLeftClose size={16} /> : <PanelLeft size={16} />,
    onAction: () => store.setLibraryInSidebar(type.id, !on),
  };
}

/**
 * 项目「在侧边栏显示 / 取消在侧边栏显示」（Rei 2026-10-28「项目和资料库一样，项目也可以显示在侧边栏」）：
 * 项目页 ··· 菜单、项目列表卡片右键 / 长按、侧边栏里那一项的右键都用这个。存储在 core（store.setGroupInSidebar）。
 */
export function groupSidebarAction(store: Store, group: Pick<Group, 'id'>): MenuAction {
  const on = store.isGroupInSidebar(group.id);
  return {
    id: 'sidebar',
    label: sidebarToggleLabel(on),
    icon: on ? <PanelLeftClose size={16} /> : <PanelLeft size={16} />,
    onAction: () => store.setGroupInSidebar(group.id, !on),
  };
}
