/**
 * 全局去掉浏览器 / WebView 自带的右键菜单（Rei 2026-10-17「去掉全局右键菜单」）。
 * 输入框、多行文本、Milkdown 编辑器等能打字的地方保留系统菜单（复制粘贴、拼写）；
 * app 自己的右键菜单照常（它们先在 React 里处理，这里只拦浏览器默认那一层）。Tauri 和网页都生效。
 */

/** 能打字的地方：这里右键仍出系统菜单。`data-native-menu` 可以给别的地方单独开。 */
export const NATIVE_MENU_SELECTOR = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [data-native-menu]';

interface ClosestLike {
  closest?: (selector: string) => unknown;
  parentElement?: ClosestLike | null;
}

/** 右键点在这里时要不要保留系统菜单。文字节点按它的父元素算。 */
export function keepsNativeMenu(target: unknown): boolean {
  let el = target as ClosestLike | null | undefined;
  if (el && typeof el.closest !== 'function') el = el.parentElement ?? null;
  if (!el || typeof el.closest !== 'function') return false;
  return el.closest(NATIVE_MENU_SELECTOR) != null;
}

/** 装上全局拦截；返回卸载函数。 */
export function installContextMenuBlock(target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window): () => void {
  const on = (e: Event) => {
    if (keepsNativeMenu(e.target)) return;
    e.preventDefault();
  };
  target.addEventListener('contextmenu', on);
  return () => target.removeEventListener('contextmenu', on);
}
