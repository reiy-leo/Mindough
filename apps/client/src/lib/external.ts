/**
 * 外链：桌面 / 手机 App（Tauri）里点链接一律交给系统浏览器（opener 插件），
 * 不在 app 自己的 WebView 里打开新窗口（那样没有地址栏、也回不来）。Web 端照常新标签页。
 *
 * 做法：document 上捕获阶段监听 click / auxclick，任何 <a href="http(s)|mailto|tel:…"> 指向别的源时拦下来交给 openUrl。
 * 这样 Markdown 渲染出来的链接、资料卡的小标签、编辑器里的链接都不用各自处理。
 */
import { isTauri } from '../store/sqlite-tauri';

const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

/** 这个链接该不该交给系统浏览器：别的源的 http(s)，或 mailto / tel。同源的 #/ 路由不算。 */
export function externalHref(href: string | null | undefined, origin: string): string | null {
  if (!href) return null;
  let url: URL;
  try {
    url = new URL(href, origin);
  } catch {
    return null;
  }
  if (!EXTERNAL_PROTOCOLS.has(url.protocol)) return null;
  if ((url.protocol === 'http:' || url.protocol === 'https:') && url.origin === origin) return null;
  return url.href;
}

/** 在系统浏览器（App 里）或新标签页（Web）打开。 */
export async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

let installed = false;

/** 只在 Tauri 里装：拦下外链点击交给系统浏览器。 */
export function installExternalLinks(): void {
  if (installed || !isTauri()) return;
  installed = true;
  const handler = (e: MouseEvent) => {
    if (e.defaultPrevented) return;
    if (e.type === 'auxclick' && e.button !== 1) return;
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a) return;
    // 编辑器里的链接：点一下是放光标，⌘ / Ctrl + 点才打开（同 Apple 备忘录）
    if (a.closest('[contenteditable="true"]') && !(e as MouseEvent).metaKey && !(e as MouseEvent).ctrlKey) {
      e.preventDefault();
      return;
    }
    const url = externalHref(a.getAttribute('href'), window.location.origin);
    if (!url) return;
    e.preventDefault();
    void openExternal(url).catch((err) => console.error('打开链接失败', err));
  };
  document.addEventListener('click', handler, true);
  document.addEventListener('auxclick', handler, true);
}
