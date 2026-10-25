// @vitest-environment happy-dom
/**
 * 编辑器里的 GitHub 提示块与数学公式（Rei 2026-10-17）：读入成节点、写回 markdown 原样、手打即变、价格不误判。
 */
import { describe, expect, it } from 'vitest';
import { TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { createMdEditor, roundTrip } from './editor';
import { escapeMathLike } from './gh-syntax';

const same = async (md: string, expected = md) => expect(await roundTrip(md)).toBe(expected.replace(/\s+$/, '') + '\n');
const stable = async (md: string) => expect(await roundTrip(await roundTrip(md))).toBe(await roundTrip(md));

const setup = async (md: string) => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const h = await createMdEditor({ root, value: md, placeholder: '', label: 'x', onChange: () => {} });
  const view = h.view();
  const done = async () => {
    await h.destroy();
    root.remove();
  };
  return { h, view, root, done };
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

describe('提示块往返', () => {
  it('五种提示，原样写回；Rei 的例子', async () => {
    await same('> [!NOTE]\n> 拒绝时提示 $O(n)$ 复杂度的环路径，方便定位。');
    for (const k of ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION']) await same(`> [!${k}]\n> 内容`);
  });

  it('大小写照原样；只有标记；后面接列表不多空行；多段', async () => {
    await same('> [!tip]\n> 小写');
    await same('> [!Warning]');
    await same('> [!WARNING]\n> - a\n> - b');
    await same('> [!NOTE]\n> 第一段\n>\n> 第二段');
  });

  it('旧编辑器存成的 \\[!NOTE] 也认，写回去变成 [!NOTE]', async () => {
    await same('> \\[!NOTE]\n> 旧的', '> [!NOTE]\n> 旧的');
  });

  it('不是提示块：标记后面同一行还有字、不在第一行、普通引用', async () => {
    const { view, done } = await setup('> [!NOTE] 同一行\n\n> 普通引用\n\n> 第一行\n> [!NOTE]');
    expect(nodes(view.state.doc, 'gh_alert')).toHaveLength(0);
    await done();
    await same('> 普通引用');
  });

  it('读成 gh_alert 节点，带图标和标题', async () => {
    const { view, root, done } = await setup('> [!IMPORTANT]\n> 内容');
    const a = nodes(view.state.doc, 'gh_alert');
    expect(a).toHaveLength(1);
    expect(a[0]!.attrs.kind).toBe('important');
    expect(root.querySelector('.md-alert-important .md-alert-title')?.textContent).toBe('重要');
    expect(root.querySelector('.md-alert-important svg')).not.toBeNull();
    await done();
  });

  it('稳定', async () => {
    for (const md of ['> [!NOTE]\n> a $x$ b', '> [!WARNING]\n> - a', '> [!tip]']) await stable(md);
  });
});

describe('公式往返与价格', () => {
  it('行内、块级、$$ 行内、原样写回', async () => {
    await same('拒绝时提示 $O(n)$ 复杂度');
    await same('$$x$$ 和 $a$');
    await same('$$\nx^2 + y^2\n$$');
    await same('文字 $a_1$ 和 $\\frac{1}{2}$');
  });

  it('价格不当公式（GitHub 规则），原文不变、不加反斜杠', async () => {
    for (const md of ['价格 $5 和 $10', '$5和$10', '花了 $5，还剩 $', '$ x $ 不算', 'US$100 和 US$200']) {
      const { view, done } = await setup(md);
      expect(nodes(view.state.doc, 'math_inline')).toHaveLength(0);
      await done();
      await same(md);
    }
  });

  it('原文是 \\$x\\$（转义的）：还是文字，写回保持转义', async () => {
    const { view, done } = await setup('\\$x\\$ 不是公式');
    expect(nodes(view.state.doc, 'math_inline')).toHaveLength(0);
    await done();
    expect(await roundTrip('\\$x\\$ 不是公式')).toBe('\\$x$ 不是公式\n');
    await stable('\\$x\\$ 不是公式');
    expect(escapeMathLike('$5 和 $10')).toBe('$5 和 $10');
    expect(escapeMathLike('$x$')).toBe('\\$x$');
  });

  it('读成节点并渲染 KaTeX；源码在节点里', async () => {
    const { view, root, done } = await setup('看 $O(n)$\n\n$$\nx^2\n$$');
    expect(nodes(view.state.doc, 'math_inline')[0]?.textContent).toBe('O(n)');
    expect(nodes(view.state.doc, 'math_block')[0]?.textContent).toBe('x^2');
    expect(root.querySelector('.md-math-inline .md-math-render .katex')).not.toBeNull();
    expect(root.querySelector('.md-math-block-edit .md-math-render .katex-display')).not.toBeNull();
    await done();
  });

  it('光标进公式：is-editing（显示源码）；离开就没了', async () => {
    const { view, root, done } = await setup('看 $O(n)$ 完');
    let at = -1;
    view.state.doc.descendants((n, pos) => {
      if (n.type.name === 'math_inline') at = pos;
    });
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at + 2)));
    expect(root.querySelector('.md-math-inline.is-editing')).not.toBeNull();
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
    expect(root.querySelector('.md-math-inline.is-editing')).toBeNull();
    await done();
  });

  it('稳定', async () => {
    for (const md of ['价格 $5 和 $10', '$a$ 和 $$b$$', '$$\nx\n$$', '\\$x\\$']) await stable(md);
  });
});

describe('手打', () => {
  it('> 然后 [!NOTE]：变成提示块，接着写内容', async () => {
    const { view, h, done } = await setup('');
    type(view, '> ');
    type(view, '[!note]');
    expect(nodes(view.state.doc, 'gh_alert')).toHaveLength(1);
    type(view, '内容');
    expect(h.getMarkdown()).toBe('> [!NOTE]\n> 内容\n');
    await done();
  });

  it('普通段落里打 [!NOTE] 不变', async () => {
    const { view, h, done } = await setup('');
    type(view, '[!NOTE]');
    expect(nodes(view.state.doc, 'gh_alert')).toHaveLength(0);
    expect(h.getMarkdown()).toMatch(/\[!NOTE]/);
    await done();
  });

  it('$x$ 收尾即变；光标在公式后面接着打', async () => {
    const { view, h, done } = await setup('');
    type(view, '看 $O(n)$ 吧');
    expect(nodes(view.state.doc, 'math_inline')[0]?.textContent).toBe('O(n)');
    expect(h.getMarkdown()).toBe('看 $O(n)$ 吧\n');
    await done();
  });

  it('价格不变：$5 和 $10、$ x $', async () => {
    for (const s of ['$5 和 $10', '花 $5 买 $', '$ x $']) {
      const { view, h, done } = await setup('');
      type(view, s);
      expect(nodes(view.state.doc, 'math_inline')).toHaveLength(0);
      expect(h.getMarkdown()).toBe(`${s}\n`);
      await done();
    }
  });

  it('$5和$ 后面紧跟数字：变回文字（GitHub 也不当公式）', async () => {
    const { view, h, done } = await setup('');
    type(view, '$5和$10');
    expect(nodes(view.state.doc, 'math_inline')).toHaveLength(0);
    expect(h.getMarkdown()).toBe('$5和$10\n');
    await done();
  });

  it('代码里不变；\\$ 不算', async () => {
    const { view, done } = await setup('');
    type(view, '\\$x$');
    expect(nodes(view.state.doc, 'math_inline')).toHaveLength(0);
    await done();
  });

  it('一行 $$ 回车：公式块；最后一行 $$ 回车结束', async () => {
    const { view, h, done } = await setup('');
    type(view, '$$');
    expect(key(view, 'Enter')).toBe(true);
    expect(nodes(view.state.doc, 'math_block')).toHaveLength(1);
    type(view, 'x^2');
    view.dispatch(view.state.tr.insertText('\n'));
    type(view, '$$');
    expect(key(view, 'Enter')).toBe(true);
    type(view, '后面');
    expect(h.getMarkdown()).toBe('$$\nx^2\n$$\n\n后面\n');
    await done();
  });

  it('退格挨着行内公式：进源码，不删掉', async () => {
    const { view, root, done } = await setup('看 $ab$');
    view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
    expect(key(view, 'Backspace')).toBe(true);
    expect(root.querySelector('.md-math-inline.is-editing')).not.toBeNull();
    await done();
  });
});
