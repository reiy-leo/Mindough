/**
 * 桌面菜单栏（Tauri，src-tauri/src/menu.rs）：文件 → 导入 → 滴答清单。
 * 菜单在 Rust 里建，文字从这里按界面语言传过去（换语言时整棵界面重新挂载，effect 会再跑一遍）；
 * 点了菜单，Rust 发 `mindough:menu` 给主窗口，这里打开对应的窗口。小窗和 Web 端什么都不做。
 */
import { useEffect } from 'react';
import { isTauri } from '../store/sqlite-tauri';
import { isMiniWindow } from './windows';
import { tr, trc } from './i18n';

export const MENU_EVENT = 'mindough:menu';
export const IMPORT_DIDA = 'import-dida365';

/** 菜单上的文字（和 menu.rs 的 MenuLabels 一一对应）。 */
export function menuLabels() {
  return {
    file: trc('菜单', '文件'),
    import: trc('菜单', '导入'),
    dida365: tr('滴答清单'),
    edit: trc('菜单', '编辑'),
    window: trc('菜单', '窗口'),
    about: tr('关于思想团'),
    services: trc('菜单', '服务'),
    hide: tr('隐藏思想团'),
    hideOthers: tr('隐藏其他'),
    showAll: tr('全部显示'),
    quit: tr('退出思想团'),
    closeWindow: tr('关闭窗口'),
    undo: trc('菜单', '撤销'),
    redo: trc('菜单', '重做'),
    cut: trc('菜单', '剪切'),
    copy: trc('菜单', '拷贝'),
    paste: trc('菜单', '粘贴'),
    selectAll: trc('菜单', '全选'),
    minimize: trc('菜单', '最小化'),
    zoom: trc('菜单', '缩放'),
    fullscreen: tr('进入全屏幕'),
  };
}

export function useAppMenu(handlers: { importDida: () => void }) {
  const { importDida } = handlers;
  useEffect(() => {
    if (!isTauri() || isMiniWindow()) return;
    let dead = false;
    let off: (() => void) | null = null;
    void (async () => {
      const [{ invoke }, { listen }] = await Promise.all([import('@tauri-apps/api/core'), import('@tauri-apps/api/event')]);
      await invoke('set_app_menu', { labels: menuLabels() }).catch(() => {});
      const un = await listen<string>(MENU_EVENT, (e) => {
        if (e.payload === IMPORT_DIDA) importDida();
      });
      if (dead) un();
      else off = un;
    })().catch(() => {});
    return () => {
      dead = true;
      off?.();
    };
  }, [importDida]);
}
