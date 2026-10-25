// @vitest-environment happy-dom
/**
 * 编辑器里的折叠块 <details><summary>（Rei 2026-10-17）：读成节点、写回原样 HTML、两遍稳定、工具栏 / 手打 <details> 回车、标题里的键、展开收起不算改动。
 */
import { describe, expect, it } from 'vitest';
import { TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { createMdEditor, roundTrip } from './editor';
import { markdownHtml } from '../../lib/markdown';

const same = async (md: string, expected = md) => expect(await roundTrip(md)).toBe(expected.replace(/\s+$/, '') + '\n');
const stable = async (md: string) => expect(await roundTrip(await roundTrip(md))).toBe(await roundTrip(md));

const setup = async (md: string) => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const changes: string[] = [];
  const h = await createMdEditor({ root, value: md, placeholder: '', label: 'x', onChange: (m) => changes.push(m) });
  const view = h.view();
  const done = async () => {
    await h.destroy();
    root.remove();
  };
  return { h, view, root, changes, done };
};
const type = (view: EditorView, text: string) => {
  for (const ch of text) {
    const { from, to } = view.state.selection;
    const handled = view.someProp('handleTextInput', (f) => f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)));
    if (!handled) view.dispatch(view.state.tr.insertText(ch, from, to));
  }
};
const key = (view: EditorView, k: string) => {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  view.dom.dispatchEvent(ev);
  return ev.defaultPrevented;
};
const nodes = (doc: PMNode, name: string) => {
  const out: PMNode[] = [];
  doc.descendants((n) => {
    if (n.type.name === name) out.push(n);
  });
  return out;
};
/** 光标放到含 text 的文字末尾。 */
const placeAfter = (view: EditorView, text: string) => {
  let at = -1;
  view.state.doc.descendants((n, pos) => {
    if (at < 0 && n.isText && n.text?.includes(text)) at = pos + n.text.indexOf(text) + text.length;
  });
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));
};
const flush = () => new Promise((r) => setTimeout(r, 400));

describe('折叠块：读入', () => {
  it('一行写完：标题 + 正文一段', async () => {
    const { view, done } = await setup('<details><summary>标题</summary>内容</details>');
    const d = nodes(view.state.doc, 'details');
    expect(d).toHaveLength(1);
    expect(d[0]!.firstChild!.type.name).toBe('details_summary');
    expect(d[0]!.firstChild!.textContent).toBe('标题');
    expect(d[0]!.child(1).type.name).toBe('paragraph');
    expect(d[0]!.child(1).textContent).toBe('内容');
    expect(d[0]!.attrs.expanded).toBe(false); // 没有 open：默认收起
    await done();
  });

  it('多行写法：正文是普通块（列表、提示块、公式），可以套折叠块；open 默认展开', async () => {
    const md = '<details open>\n<summary>外</summary>\n\n- a\n- b\n\n<details>\n<summary>内</summary>\n\n> [!NOTE]\n> 注意 $x$\n\n</details>\n\n</details>';
    const { view, root, done } = await setup(md);
    const d = nodes(view.state.doc, 'details');
    expect(d).toHaveLength(2);
    expect(d[0]!.attrs.expanded).toBe(true);
    expect(d[0]!.child(1).type.name).toBe('bulletList');
    expect(nodes(d[1]!, 'gh_alert')).toHaveLength(1);
    expect(nodes(d[1]!, 'math_inline')).toHaveLength(1);
    expect(root.querySelectorAll('.md-details-toggle')).toHaveLength(2);
    await done();
  });

  it('列表项里的折叠块', async () => {
    const { view, done } = await setup('- 项\n\n  <details>\n  <summary>T</summary>\n\n  内容\n\n  </details>');
    expect(nodes(view.state.doc, 'details')).toHaveLength(1);
    await done();
  });

  it('没有结尾的 <details>：照旧当 HTML，不吞后面的字', async () => {
    const { view, done } = await setup('<details>\n<summary>没结尾</summary>\n\n文字');
    expect(nodes(view.state.doc, 'details')).toHaveLength(0);
    expect(view.state.doc.textContent).toContain('文字');
    await done();
  });
});

describe('折叠块：写出', () => {
  it('原样往返', async () => {
    await same('前\n\n<details><summary>标题</summary>内容</details>\n\n后');
    await same('<details><summary>空</summary></details>');
    await same('<details>\n<summary>T</summary>\n\n- a\n- b\n\n</details>');
    await same('<details open>\n<summary>T</summary>\n\n正文 **粗**\n\n</details>');
    await same('- 项\n\n  <details>\n  <summary>T</summary>\n\n  内容\n\n  </details>');
    await same('<details>\n<summary>外</summary>\n\n<details>\n<summary>内</summary>\n\n> [!NOTE]\n> 注意 $x$\n\n</details>\n\n尾\n\n</details>');
  });

  it('中间没空行的多行写法：写成标准写法（正文前后空行），之后不再变', async () => {
    await same('<details open>\n<summary>T</summary>\nbody\n</details>', '<details open>\n<summary>T</summary>\n\nbody\n\n</details>');
  });

  it('两遍稳定', async () => {
    for (const md of [
      '<details><summary>标题</summary>内容</details>',
      '<details>\n<summary>T</summary>\n\n1. 一\n2. 二\n\n```js\nx\n```\n\n</details>',
      '<details>\n<summary>T</summary>\nbody\n</details>',
      '<details>\n\n文字\n\n</details>',
      '- a\n  <details><summary>x</summary>y</details>',
    ])
      await stable(md);
  });

  it('只读显示同样能折叠（原生 details / summary）', () => {
    // （happy-dom 里 DOMPurify 会吞掉开头的 <details>，浏览器里没事；这里看消毒前的）
    const html = markdownHtml('<details>\n<summary>T</summary>\n\n- a\n\n</details>');
    expect(html).toMatch(/<details>\s*<summary>T<\/summary>/);
    expect(html).toContain('<li>a</li>');
  });
});

describe('折叠块：输入与键', () => {
  it('工具栏「折叠块」：这段文字变成标题，再点一次拆开', async () => {
    const { h, view, done } = await setup('要收起来的');
    placeAfter(view, '要收起来的');
    h.run('details');
    const d = nodes(view.state.doc, 'details');
    expect(d).toHaveLength(1);
    expect(d[0]!.firstChild!.textContent).toBe('要收起来的');
    expect(view.state.selection.$from.parent.type.name).toBe('details_summary');
    expect(h.active().has('details')).toBe(true);
    expect(h.getMarkdown()).toBe('<details>\n<summary>要收起来的</summary>\n\n</details>\n');
    h.run('details');
    expect(nodes(view.state.doc, 'details')).toHaveLength(0);
    expect(h.getMarkdown()).toBe('要收起来的\n');
    await done();
  });

  it('选中几段：收进正文，光标在空标题', async () => {
    const { h, view, done } = await setup('一\n\n二\n\n三');
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2, view.state.doc.content.size - 4)));
    h.run('details');
    const d = nodes(view.state.doc, 'details')[0]!;
    expect(d.childCount).toBe(3);
    expect(d.firstChild!.textContent).toBe('');
    type(view, '标');
    expect(h.getMarkdown()).toBe('<details>\n<summary>标</summary>\n\n一\n\n二\n\n</details>\n\n三\n');
    await done();
  });

  it('手打 <details> 回车：变成折叠块，写标题，回车进正文', async () => {
    const { h, view, done } = await setup('');
    type(view, '<details>');
    expect(key(view, 'Enter')).toBe(true);
    expect(nodes(view.state.doc, 'details')).toHaveLength(1);
    type(view, '标题');
    expect(key(view, 'Enter')).toBe(true);
    expect(view.state.selection.$from.parent.type.name).toBe('paragraph');
    type(view, '正文');
    expect(h.getMarkdown()).toBe('<details>\n<summary>标题</summary>\n\n正文\n\n</details>\n');
    await done();
  });

  it('手打 <details open><summary>T</summary> 回车：直接进正文', async () => {
    const { h, view, done } = await setup('');
    type(view, '<details open><summary>T</summary>');
    expect(key(view, 'Enter')).toBe(true);
    type(view, '正文');
    expect(h.getMarkdown()).toBe('<details open>\n<summary>T</summary>\n\n正文\n\n</details>\n');
    await done();
  });

  it('标题开头退格：拆开', async () => {
    const { h, view, done } = await setup('<details><summary>标题</summary>内容</details>');
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)));
    expect(key(view, 'Backspace')).toBe(true);
    expect(h.getMarkdown()).toBe('标题\n\n内容\n');
    await done();
  });

  it('点三角展开 / 收起：不算改动、markdown 不变', async () => {
    const { h, view, root, changes, done } = await setup('<details><summary>标题</summary>内容</details>');
    const before = h.getMarkdown();
    const btn = root.querySelector<HTMLButtonElement>('.md-details-toggle')!;
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    btn.click();
    expect(nodes(view.state.doc, 'details')[0]!.attrs.expanded).toBe(true);
    expect(root.querySelector('.md-details')!.classList.contains('is-open')).toBe(true);
    btn.click();
    expect(nodes(view.state.doc, 'details')[0]!.attrs.expanded).toBe(false);
    await flush();
    expect(h.getMarkdown()).toBe(before);
    expect(changes).toEqual([]);
    await done();
  });

  it('光标进了收起的正文：自动展开', async () => {
    const { view, done } = await setup('<details><summary>标题</summary>内容</details>\n\n后面');
    placeAfter(view, '内容');
    expect(nodes(view.state.doc, 'details')[0]!.attrs.expanded).toBe(true);
    await done();
  });
});
