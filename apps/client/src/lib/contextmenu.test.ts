import { describe, expect, it } from 'vitest';
import { installContextMenuBlock, keepsNativeMenu } from './contextmenu';

/** 只认 tag / contenteditable / data-native-menu 的假元素，够测 closest 的选择器。 */
interface FakeEl {
  tag: string;
  attrs: Record<string, string>;
  parentElement: FakeEl | null;
  closest(selector: string): unknown;
}
function el(tag: string, attrs: Record<string, string> = {}, parent: FakeEl | null = null): FakeEl {
  const node: FakeEl = {
    tag,
    attrs,
    parentElement: parent,
    closest(selector: string): unknown {
      for (let n: FakeEl | null = node; n; n = n.parentElement) {
        if (matches(n, selector)) return n;
      }
      return null;
    },
  };
  return node;
}
function matches(n: { tag: string; attrs: Record<string, string> }, selector: string): boolean {
  if (['input', 'textarea', 'select'].includes(n.tag) && selector.includes(n.tag)) return true;
  if ('contenteditable' in n.attrs && n.attrs.contenteditable !== 'false') return true;
  return 'data-native-menu' in n.attrs;
}

describe('全局右键菜单（Rei 2026-10-17）', () => {
  it('普通页面不出系统菜单，能打字的地方保留', () => {
    const page = el('div');
    expect(keepsNativeMenu(el('span', {}, page))).toBe(false);
    expect(keepsNativeMenu(el('input'))).toBe(true);
    expect(keepsNativeMenu(el('textarea'))).toBe(true);
    const editor = el('div', { contenteditable: 'true' }, page);
    expect(keepsNativeMenu(el('p', {}, editor))).toBe(true); // 编辑器里的段落
    expect(keepsNativeMenu(el('div', { contenteditable: 'false' }))).toBe(false);
    expect(keepsNativeMenu(el('code', {}, el('pre', { 'data-native-menu': '' })))).toBe(true);
  });
  it('文字节点按父元素算；没有目标就拦', () => {
    const text = { parentElement: el('textarea') };
    expect(keepsNativeMenu(text)).toBe(true);
    expect(keepsNativeMenu(null)).toBe(false);
  });
  it('拦截只 preventDefault 默认菜单，卸载后不再拦', () => {
    let handler: ((e: Event) => void) | null = null;
    const target = {
      addEventListener: (_: string, h: (e: Event) => void) => (handler = h),
      removeEventListener: () => (handler = null),
    } as unknown as Window;
    const off = installContextMenuBlock(target);
    let prevented = 0;
    handler!({ target: el('div'), preventDefault: () => prevented++ } as unknown as Event);
    handler!({ target: el('input'), preventDefault: () => prevented++ } as unknown as Event);
    expect(prevented).toBe(1);
    off();
    expect(handler).toBeNull();
  });
});
