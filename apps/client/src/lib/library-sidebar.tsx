/**
 * 资料库「在侧边栏显示 / 取消在侧边栏显示」（Rei 2026-10-26 18:55）：资料库页的 ··· 菜单、标签右键 / 长按、
 * 编辑资料库列表、侧边栏里那一项的右键都用这里，文案和图标一处改。存储在 core（store.setLibraryInSidebar，同步偏好）。
 */
import { PanelLeft, PanelLeftClose } from 'lucide-react';
import type { Store, TaskType } from '@mindough/core';
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
