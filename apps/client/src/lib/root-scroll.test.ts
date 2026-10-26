// @vitest-environment happy-dom
/**
 * 整页不滚（Rei 2026-10-26「整个页面居然可以滚动」）：
 * - 样式：html / body / #root / .app 不滚；会滚的列都是 position: relative，里面的绝对定位元素跑不出来
 * - 兜底：桌面布局下外层被滚动就复位；手机、触屏、软键盘弹出时不拦
 * - scrollIntoContainer 只滚最近的那一列
 */
import { existsSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installRootScrollGuard, nearestScroller, resetRootScroll, scrollIntoContainer, shouldResetRootScroll, type RootScrollEnv } from './root-scroll';

// 测试从 apps/client 下跑（pnpm test）；happy-dom 里 import.meta.url 不是 file:，直接按工作目录找
const css = readFileSync(existsSync('src/styles/app.css') ? 'src/styles/app.css' : 'apps/client/src/styles/app.css', 'utf8');

/** 取某个选择器（整条选择器列表要完全一致）对应的声明块。 */
function rule(selectors: string): string {
  const want = selectors.split(',').map((s) => s.trim()).join(',');
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = re.exec(css); m; m = re.exec(css)) {
    const sel = (m[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '').split(',').map((s) => s.trim()).join(',');
    if (sel === want) return m[2] ?? '';
  }
  return '';
}

describe('样式：外层不滚', () => {
  it('html 不滚', () => {
    expect(rule('html')).toMatch(/overflow:\s*hidden/);
  });
  it('body、#root、.app 用 clip（不认 clip 时退回 hidden），不再只写 overflow-x', () => {
    const r = rule('body, #root, .app');
    expect(r).toMatch(/overflow:\s*hidden/);
    expect(r).toMatch(/overflow:\s*clip/);
    expect(r).not.toMatch(/overflow-x:\s*hidden/);
  });
  it('桌面整页不回弹', () => {
    expect(rule("html[data-layout='desktop'], html[data-layout='desktop'] body")).toMatch(/overscroll-behavior:\s*none/);
  });
  it('会滚的列都是绝对定位的参照', () => {
    expect(rule('.sidebar, .nav, .main, .main-scroll, .detail-pane-box, .pane-body, .mini-body')).toMatch(/position:\s*relative/);
  });
  it('外层不用 100vh', () => {
    expect(rule('.mini-window')).not.toMatch(/100vh/);
    expect(rule('html, body, #root')).toMatch(/height:\s*100%/);
  });
});

const desktop: RootScrollEnv = { layout: 'desktop', coarse: false, innerHeight: 800, visualHeight: 800, visualScale: 1 };

describe('shouldResetRootScroll', () => {
  it('桌面、鼠标：复位', () => {
    expect(shouldResetRootScroll(desktop)).toBe(true);
    expect(shouldResetRootScroll({ ...desktop, visualHeight: null, visualScale: null })).toBe(true);
  });
  it('手机布局不拦（软键盘弹出时系统要滚整页）', () => {
    expect(shouldResetRootScroll({ ...desktop, layout: 'mobile' })).toBe(false);
    expect(shouldResetRootScroll({ ...desktop, layout: undefined })).toBe(false);
  });
  it('触屏（平板用桌面布局）不拦', () => {
    expect(shouldResetRootScroll({ ...desktop, coarse: true })).toBe(false);
  });
  it('软键盘把可见区域挤矮、或手指放大时不拦', () => {
    expect(shouldResetRootScroll({ ...desktop, visualHeight: 450 })).toBe(false);
    expect(shouldResetRootScroll({ ...desktop, visualScale: 1.5 })).toBe(false);
  });
});

describe('兜底复位', () => {
  let off: () => void = () => {};
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"><div class="app app-desktop"><main class="main"><div class="page"></div></main></div></div>';
    document.documentElement.dataset.layout = 'desktop';
    vi.spyOn(window, 'matchMedia').mockImplementation((q: string) => ({ matches: false, media: q }) as MediaQueryList);
  });
  afterEach(() => {
    off();
    vi.restoreAllMocks();
    delete document.documentElement.dataset.layout;
  });

  it('.app 被滚动了：复位到 0；里面的列不管', () => {
    off = installRootScrollGuard(window);
    const app = document.querySelector<HTMLElement>('.app')!;
    const main = document.querySelector<HTMLElement>('.main')!;
    app.scrollTop = 120;
    main.scrollTop = 300;
    app.dispatchEvent(new Event('scroll'));
    expect(app.scrollTop).toBe(0);
    main.dispatchEvent(new Event('scroll'));
    expect(main.scrollTop).toBe(300);
  });

  it('#root 横向被推开也复位', () => {
    off = installRootScrollGuard(window);
    const root = document.getElementById('root')!;
    root.scrollLeft = 40;
    root.dispatchEvent(new Event('scroll'));
    expect(root.scrollLeft).toBe(0);
  });

  it('手机布局不复位', () => {
    document.documentElement.dataset.layout = 'mobile';
    off = installRootScrollGuard(window);
    const app = document.querySelector<HTMLElement>('.app')!;
    app.scrollTop = 80;
    app.dispatchEvent(new Event('scroll'));
    expect(app.scrollTop).toBe(80);
  });

  it('卸载后不再管', () => {
    installRootScrollGuard(window)();
    const app = document.querySelector<HTMLElement>('.app')!;
    app.scrollTop = 50;
    app.dispatchEvent(new Event('scroll'));
    expect(app.scrollTop).toBe(50);
  });

  it('resetRootScroll 没动过时返回 false', () => {
    expect(resetRootScroll(window)).toBe(false);
  });
});

describe('scrollIntoContainer', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"><div class="app"><main class="main"><ul><li id="t">今天</li></ul></main></div></div>';
  });
  afterEach(() => vi.restoreAllMocks());

  /** happy-dom 不排版：手动给尺寸和 overflow。 */
  function layout(itemTop: number) {
    const main = document.querySelector<HTMLElement>('.main')!;
    const app = document.querySelector<HTMLElement>('.app')!;
    const item = document.getElementById('t')!;
    Object.defineProperty(main, 'clientHeight', { value: 400, configurable: true });
    Object.defineProperty(main, 'scrollHeight', { value: 2000, configurable: true });
    Object.defineProperty(app, 'clientHeight', { value: 600, configurable: true });
    Object.defineProperty(app, 'scrollHeight', { value: 3000, configurable: true });
    const real = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => (el === main || el === app ? ({ overflowY: 'auto' } as CSSStyleDeclaration) : real(el)));
    main.getBoundingClientRect = () => ({ top: 100, bottom: 500, height: 400, left: 0, right: 0, width: 0, x: 0, y: 100, toJSON() {} });
    item.getBoundingClientRect = () => ({ top: itemTop, bottom: itemTop + 40, height: 40, left: 0, right: 0, width: 0, x: 0, y: itemTop, toJSON() {} });
    main.scrollTo = ((o: ScrollToOptions) => { main.scrollTop = o.top ?? 0; }) as typeof main.scrollTo;
    return { main, app, item };
  }

  it('最近的滚动列是 .main，外层 .app 不算', () => {
    const { main, item } = layout(900);
    expect(nearestScroller(item)).toBe(main);
  });

  it('center：只滚 .main，放到中间；.app 不动', () => {
    const { main, app, item } = layout(900);
    scrollIntoContainer(item, { block: 'center' });
    // 元素在内容里的位置 = 900 - 100 + 0 = 800；中间 = 800 - (400 - 40) / 2 = 620
    expect(main.scrollTop).toBe(620);
    expect(app.scrollTop).toBe(0);
  });

  it('nearest：已经看得见就不动', () => {
    const { main, item } = layout(200);
    scrollIntoContainer(item, { block: 'nearest' });
    expect(main.scrollTop).toBe(0);
  });

  it('nearest：在下面看不见，滚到刚好露出底边', () => {
    const { main, item } = layout(700);
    scrollIntoContainer(item, { block: 'nearest' });
    // 600 + 40 - 400 = 240
    expect(main.scrollTop).toBe(240);
  });
});
