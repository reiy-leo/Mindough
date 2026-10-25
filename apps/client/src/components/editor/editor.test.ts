// @vitest-environment happy-dom
/**
 * Markdown 编辑器的往返：存着的 markdown 读进编辑器再写出去，内容不变（只允许格式上的小差异：末尾换行、标题后补空行）。
 */
import { describe, expect, it } from 'vitest';
import { finishMarkdown, prepareMarkdown, roundTrip } from './editor';

const same = async (md: string, expected = md) => expect(await roundTrip(md)).toBe(expected.replace(/\s+$/, '') + '\n');
// 读两遍：第二遍和第一遍一样（稳定，不会每打开一次就变一点）
const stable = async (md: string) => expect(await roundTrip(await roundTrip(md))).toBe(await roundTrip(md));

describe('Markdown 编辑器往返', () => {
  it('段落、标题、列表（用 -）、清单', async () => {
    await same('整理要带走的东西，列一张清单\n\n- [x] 书\n- [x] 衣服\n- [ ] 厨具');
    await same('- 第一项\n- 第二项');
    await same('* 星号写的列表\n* 第二项', '- 星号写的列表\n- 第二项');
    await same('1. 一\n2. 二');
    await same('## 想看理由\n\n大银幕看沙漠和沙虫\n\n## 观后感');
  });

  it('标题后紧跟一行：补一个空行（同样的意思）', async () => {
    await same('## 想看理由\n大银幕看沙漠和沙虫', '## 想看理由\n\n大银幕看沙漠和沙虫');
  });

  it('引用、代码块、表格、行内格式、链接', async () => {
    await same('> 给岁月以文明，而不是给文明以岁月。');
    await same('```js\nconst a = 1;\n```');
    await same('| a | b |\n| - | - |\n| 1 | 2 |');
    await same('**粗** *斜* ~~删~~ [链接](https://x.com) `code`');
  });

  it('只有一个换行的两行（老的纯文字备注）照原样', async () => {
    await same('第一行\n第二行');
  });

  it('空的清单项（内置模板里的「- [ ] 」）还是清单', async () => {
    const out = await roundTrip('## 目标\n\n\n## 下一步\n- [ ] \n');
    expect(out).toBe('## 目标\n\n## 下一步\n\n- [ ] \n');
    expect(prepareMarkdown('- [ ] ')).toBe('- [ ] \u200b');
    expect(finishMarkdown('- [ ] \u200b\n\n')).toBe('- [ ] \n');
  });

  it('稳定：读写两遍和一遍一样', async () => {
    for (const md of ['## 目标\n\n\n## 下一步\n- [ ] \n', '第一行\n第二行', '> 引用\n\n- [x] 做完\n- [ ] 没做\n\n| a | b |\n| - | - |\n| 1 | 2 |']) await stable(md);
  });

  it('空文档', async () => {
    expect(await roundTrip('')).toBe('');
  });
});

describe('Tab / Shift+Tab 不让焦点跑出编辑器', () => {
  const press = async (md: string, shift: boolean, place: (doc: import('@tiptap/pm/model').Node) => number) => {
    const { createMdEditor } = await import('./editor');
    const { TextSelection } = await import('@tiptap/pm/state');
    const root = document.createElement('div');
    document.body.appendChild(root);
    let out = md;
    const h = await createMdEditor({ root, value: md, placeholder: '', label: 'x', onChange: (m) => (out = m) });
    const view = h.view();
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, place(view.state.doc))));
    const ev = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true });
    view.dom.dispatchEvent(ev);
    const md2 = h.getMarkdown();
    await h.destroy();
    root.remove();
    return { prevented: ev.defaultPrevented, md: md2, out };
  };
  const posOf = (text: string) => (doc: import('@tiptap/pm/model').Node) => {
    let at = 1;
    doc.descendants((n, pos) => {
      if (n.isText && n.text?.includes(text)) at = pos + 1;
    });
    return at;
  };

  it('第二项 Tab 缩进，焦点留着', async () => {
    const r = await press('- a\n- b', false, posOf('b'));
    expect(r.prevented).toBe(true);
    expect(r.md).toMatch(/- a\n\s+- b/);
  });
  it('第一项缩不动、普通段落、Shift+Tab 到顶：也吃掉 Tab', async () => {
    expect((await press('- a\n- b', false, posOf('a'))).prevented).toBe(true);
    expect((await press('一段话', false, posOf('一段话'))).prevented).toBe(true);
    expect((await press('一段话', true, posOf('一段话'))).prevented).toBe(true);
  });
  it('缩进的项 Shift+Tab 反缩进', async () => {
    const r = await press('- a\n  - b', true, posOf('b'));
    expect(r.prevented).toBe(true);
    expect(r.md).toMatch(/^- a\n- b/);
  });
});

describe('链接（Rei 2026-10-17）', () => {
  const setup = async (md: string, extra: Partial<import('./editor').MdEditorOptions> = {}) => {
    const { createMdEditor } = await import('./editor');
    const root = document.createElement('div');
    document.body.appendChild(root);
    const h = await createMdEditor({ root, value: md, placeholder: '', label: 'x', onChange: () => {}, ...extra });
    const view = h.view();
    const done = async () => {
      await h.destroy();
      root.remove();
    };
    return { h, view, root, done };
  };
  const posOf = (doc: import('@tiptap/pm/model').Node, text: string, offset = 1) => {
    let at = -1;
    doc.descendants((n, pos) => {
      if (at < 0 && n.isText && n.text?.includes(text)) at = pos + n.text.indexOf(text) + offset;
    });
    return at;
  };
  const place = async (view: import('@tiptap/pm/view').EditorView, from: number, to = from) => {
    const { TextSelection } = await import('@tiptap/pm/state');
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
  };
  /** 模拟一个字一个字打进去（走 inputRules 的 handleTextInput）。 */
  const type = (view: import('@tiptap/pm/view').EditorView, text: string) => {
    for (const ch of text) {
      const { from, to } = view.state.selection;
      const handled = view.someProp('handleTextInput', (f) => f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)));
      if (!handled) view.dispatch(view.state.tr.insertText(ch, from, to));
    }
  };

  it('linkRangeAt：同一个链接连着的几段算一段；空光标只认里面', async () => {
    const { linkRangeAt } = await import('./editor');
    const { view, done } = await setup('看 [**粗**和细](https://a.com) 完');
    const doc = view.state.doc;
    const type = view.state.schema.marks.link!;
    const mid = posOf(doc, '和');
    const r = linkRangeAt(doc, mid);
    expect(r?.href).toBe('https://a.com');
    expect(doc.textBetween(r!.from, r!.to)).toBe('粗和细');
    expect(linkRangeAt(doc, r!.from)).toBeNull(); // 起点边上不算
    expect(linkRangeAt(doc, r!.from, false)?.href).toBe('https://a.com');
    expect(linkRangeAt(doc, posOf(doc, '完'))).toBeNull();
    await done();
  });

  it('setLink：改地址（缺协议补 https://）、空地址去掉链接', async () => {
    const { view, h, done } = await setup('[文档](https://old.com)');
    await place(view, posOf(view.state.doc, '档', 0));
    const r = h.linkAtSelection()!;
    h.setLink(r, 'example.org/a');
    expect(h.getMarkdown()).toBe('[文档](https://example.org/a)\n');
    h.setLink(r, '');
    expect(h.getMarkdown()).toBe('文档\n');
    await done();
  });

  it('点链接：交给 onLinkOpen 打开，mousedown 不放光标', async () => {
    const opened: string[] = [];
    const { view, done } = await setup('看 [文档](https://a.com/x)', { onLinkOpen: (u) => opened.push(u) });
    const a = view.dom.querySelector('a')!;
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 });
    a.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    a.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(opened).toEqual(['https://a.com/x']);
    await done();
  });

  it('鼠标移到链接上 / 移开：onLinkHover 给出这段链接 / null', async () => {
    const hovers: (string | null)[] = [];
    const { view, done } = await setup('看 [文档](https://a.com)', { onLinkHover: (r) => hovers.push(r ? `${r.href}:${view.state.doc.textBetween(r.from, r.to)}` : null) });
    const a = view.dom.querySelector('a')!;
    a.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    a.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
    expect(hovers).toEqual(['https://a.com:文档', null]);
    await done();
  });

  it('手打 [文字](网址)：打完右括号就是链接，缺协议补 https://', async () => {
    const { view, h, done } = await setup('');
    type(view, '看 [文档](example.com/a)');
    expect(h.getMarkdown()).toBe('看 [文档](https://example.com/a)\n');
    expect(view.state.doc.textContent).toBe('看 文档');
    // 接着打字不带链接
    type(view, '吧');
    expect(h.getMarkdown()).toBe('看 [文档](https://example.com/a)吧\n');
    await done();
  });

  it('[](网址)：用网址当文字；全角括号也认', async () => {
    const { view, h, done } = await setup('');
    type(view, '[](https://a.com)');
    expect(view.state.doc.textContent).toBe('https://a.com');
    expect(h.getMarkdown()).toMatch(/https:\/\/a\.com/);
    expect(view.state.doc.rangeHasMark(1, 3, view.state.schema.marks.link!)).toBe(true);
    await done();
    const b = await setup('');
    type(b.view, '[文档]（a.com）');
    expect(b.h.getMarkdown()).toBe('[文档](https://a.com)\n');
    await b.done();
  });

  it('![图](网址) 不当链接；代码里不转', async () => {
    const { view, h, done } = await setup('');
    type(view, '![图](https://a.com/x.png)');
    expect(view.state.doc.rangeHasMark(0, view.state.doc.content.size, view.state.schema.marks.link!)).toBe(false);
    expect(view.state.doc.textContent).toBe('![图](https://a.com/x.png)');
    await done();
    const c = await setup('```\nx\n```');
    await place(c.view, 2);
    type(c.view, '[a](b.com)');
    expect(c.view.state.doc.rangeHasMark(0, c.view.state.doc.content.size, c.view.state.schema.marks.link!)).toBe(false);
    await c.done();
    void h;
  });

  it('手打 <网址>、裸网址 + 空格：变成链接（末尾标点不算）', async () => {
    const { view, h, done } = await setup('');
    type(view, '见 <https://a.com/x>');
    expect(view.state.doc.textContent).toBe('见 https://a.com/x');
    expect(h.getMarkdown()).toMatch(/https:\/\/a\.com\/x/);
    expect(view.state.doc.rangeHasMark(3, 6, view.state.schema.marks.link!)).toBe(true);
    await done();
    const b = await setup('');
    type(b.view, '看 https://b.com/y. 吧');
    expect(b.view.state.doc.textContent).toBe('看 https://b.com/y. 吧');
    const linked: string[] = [];
    b.view.state.doc.descendants((n) => {
      if (n.isText && b.view.state.schema.marks.link!.isInSet(n.marks)) linked.push(n.text!);
    });
    expect(linked).toEqual(['https://b.com/y']);
    await b.done();
    const c = await setup('');
    type(c.view, 'www.c.com ');
    let href = '';
    c.view.state.doc.descendants((n) => {
      const m = c.view.state.schema.marks.link!.isInSet(n.marks);
      if (m) href = m.attrs.href;
    });
    expect(href).toBe('https://www.c.com');
    await c.done();
  });

  it('一行 |a|b| 回车：变成表格（这行是表头），光标进第一格；|---| 分隔行不算', async () => {
    const { tableCells } = await import('./editor');
    expect(tableCells('|a|b|')).toEqual(['a', 'b']);
    expect(tableCells('| 名字 | 价格 |  ')).toEqual(['名字', '价格']);
    expect(tableCells('|---|:-:|')).toBeNull();
    expect(tableCells('a|b')).toBeNull();
    const { view, h, done } = await setup('');
    type(view, '|a|b|');
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    view.dom.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    type(view, 'x');
    expect(h.getMarkdown()).toBe('| a | b |\n| - | - |\n| x |   |\n');
    await done();
  });

  it('LINK_INPUT_RE', async () => {
    const { LINK_INPUT_RE, withProtocol } = await import('./editor');
    expect('看 [a](b.com)'.match(LINK_INPUT_RE)?.slice(1)).toEqual(['a', 'b.com']);
    expect('![a](b.png)'.match(LINK_INPUT_RE)).toBeNull();
    expect('[a](b c)'.match(LINK_INPUT_RE)).toBeNull();
    expect(withProtocol('mailto:a@b.c')).toBe('mailto:a@b.c');
    expect(withProtocol('a.com')).toBe('https://a.com');
  });
});

describe('Tab 不冒泡到弹层的焦点圈（Rei 2026-10-17：ul / ol 里 Tab 焦点跑掉）', () => {
  it('列表里 Tab 缩进、Shift+Tab 反缩进，document 上收不到 Tab', async () => {
    const { createMdEditor } = await import('./editor');
    const { TextSelection } = await import('@tiptap/pm/state');
    for (const md of ['- a\n- b', '1. a\n2. b', '- [ ] a\n- [ ] b']) {
      const root = document.createElement('div');
      document.body.appendChild(root);
      const h = await createMdEditor({ root, value: md, placeholder: '', label: 'x', onChange: () => {} });
      const view = h.view();
      let at = 1;
      view.state.doc.descendants((n, pos) => {
        if (n.isText && n.text === 'b') at = pos + 1;
      });
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));
      let reached = 0;
      const spy = (e: KeyboardEvent) => e.key === 'Tab' && reached++;
      document.addEventListener('keydown', spy);
      const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      view.dom.dispatchEvent(tab);
      expect(tab.defaultPrevented).toBe(true);
      expect(h.getMarkdown()).toMatch(/\n\s+(- |1\. )/);
      const back = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
      view.dom.dispatchEvent(back);
      expect(h.getMarkdown()).not.toMatch(/\n\s+(- |1\. )/);
      // 第一项缩不动：也只吞掉
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)));
      const first = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      view.dom.dispatchEvent(first);
      expect(first.defaultPrevented).toBe(true);
      expect(reached).toBe(0);
      document.removeEventListener('keydown', spy);
      await h.destroy();
      root.remove();
    }
  });
});
