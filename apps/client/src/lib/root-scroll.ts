/**
 * 整页不滚（Rei 2026-10-26「整个页面居然可以滚动」）。
 *
 * 样式上 html、body、#root、.app 已经不滚（styles/app.css）。这里是兜底：
 * 万一哪一层还是被滚动了（不认 overflow: clip 的老 WebKit、浏览器自己的查找跳转等），马上复位到 0。
 * 只在桌面布局、鼠标操作时复位；手机和平板弹出软键盘时，系统会滚动整页让输入框露出来，这时不能拦。
 *
 * 另外给列表用的 scrollIntoContainer：只滚最近的那个滚动列，不像 Element.scrollIntoView 那样一路滚到最外层。
 */

/** 整页这几层不该有滚动位置。 */
export const ROOT_SCROLL_SELECTOR = 'html, body, #root, .app';

export interface RootScrollEnv {
  /** html 上的 data-layout：desktop / mobile */
  layout: string | undefined;
  /** 主要输入是不是触屏（pointer: coarse） */
  coarse: boolean;
  innerHeight: number;
  /** visualViewport 的高度和缩放；没有 visualViewport 时给 null */
  visualHeight: number | null;
  visualScale: number | null;
}

/** 这时候整页被滚动了，要不要复位。 */
export function shouldResetRootScroll(env: RootScrollEnv): boolean {
  if (env.layout !== 'desktop') return false;
  if (env.coarse) return false;
  // 手指放大了，或者软键盘把可见区域挤矮了：整页滚动是系统在帮忙，不拦
  if (env.visualScale != null && env.visualScale > 1.01) return false;
  if (env.visualHeight != null && env.visualHeight < env.innerHeight - 40) return false;
  return true;
}

function readEnv(win: Window): RootScrollEnv {
  const vv = win.visualViewport;
  return {
    layout: win.document.documentElement.dataset.layout,
    coarse: typeof win.matchMedia === 'function' && win.matchMedia('(pointer: coarse)').matches,
    innerHeight: win.innerHeight,
    visualHeight: vv ? vv.height : null,
    visualScale: vv ? vv.scale : null,
  };
}

/** 把 window 和外面几层的滚动位置归零。返回是否真的动过。 */
export function resetRootScroll(win: Window = window): boolean {
  let moved = false;
  if (win.scrollX || win.scrollY) {
    win.scrollTo(0, 0);
    moved = true;
  }
  for (const el of win.document.querySelectorAll<HTMLElement>(ROOT_SCROLL_SELECTOR)) {
    if (el.scrollTop) {
      el.scrollTop = 0;
      moved = true;
    }
    if (el.scrollLeft) {
      el.scrollLeft = 0;
      moved = true;
    }
  }
  return moved;
}

function isRootTarget(target: EventTarget | null, doc: Document): boolean {
  if (target === doc || target === doc.defaultView) return true;
  const el = target as Element | null;
  return !!el && typeof el.matches === 'function' && el.matches(ROOT_SCROLL_SELECTOR);
}

/** 装上兜底：外面几层一滚就复位。返回卸载函数。 */
export function installRootScrollGuard(win: Window = window): () => void {
  const doc = win.document;
  const on = (e: Event) => {
    if (!isRootTarget(e.target, doc)) return;
    if (!shouldResetRootScroll(readEnv(win))) return;
    resetRootScroll(win);
  };
  // scroll 事件不冒泡，用捕获阶段才收得到 #root、.app 上的
  win.addEventListener('scroll', on, { capture: true, passive: true });
  return () => win.removeEventListener('scroll', on, { capture: true });
}

/** 最近的会滚的祖先（overflow-y 是 auto / scroll 且内容超出）。外面几层不算。 */
export function nearestScroller(el: Element): HTMLElement | null {
  const view = el.ownerDocument.defaultView;
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (p.matches(ROOT_SCROLL_SELECTOR)) return null;
    const oy = view ? view.getComputedStyle(p).overflowY : '';
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

/**
 * 把 el 滚到它所在那一列里能看见的地方，只动这一列。
 * block: 'nearest' 已经看得见就不动；'center' 放到中间。
 */
export function scrollIntoContainer(el: Element, opts: { block?: 'nearest' | 'center' | 'start'; behavior?: ScrollBehavior } = {}): void {
  const box = nearestScroller(el);
  if (!box) return;
  const block = opts.block ?? 'nearest';
  const r = el.getBoundingClientRect();
  const b = box.getBoundingClientRect();
  const top = r.top - b.top + box.scrollTop; // 元素在滚动内容里的位置
  let next = box.scrollTop;
  if (block === 'center') next = top - (box.clientHeight - r.height) / 2;
  else if (block === 'start') next = top;
  else if (r.top < b.top) next = top;
  else if (r.bottom > b.top + box.clientHeight) next = top + r.height - box.clientHeight;
  next = Math.max(0, Math.min(next, box.scrollHeight - box.clientHeight));
  if (next === box.scrollTop) return;
  if (typeof box.scrollTo === 'function') box.scrollTo({ top: next, behavior: opts.behavior ?? 'auto' });
  else box.scrollTop = next;
}
