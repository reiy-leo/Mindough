// @vitest-environment happy-dom
/**
 * Markdown 编辑器的往返：存着的 markdown 读进编辑器再写出去，内容不变（只允许格式上的小差异：末尾换行、标题后补空行）。
 */
import { describe, expect, it } from 'vitest';
import { finishMarkdown, prepareMarkdown, roundTrip } from './milkdown';

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
  const press = async (md: string, shift: boolean, place: (doc: import('@milkdown/kit/prose/model').Node) => number) => {
    const { createMdEditor } = await import('./milkdown');
    const { TextSelection } = await import('@milkdown/kit/prose/state');
    const { editorViewCtx } = await import('@milkdown/kit/core');
    const root = document.createElement('div');
    document.body.appendChild(root);
    let out = md;
    const h = await createMdEditor({ root, value: md, placeholder: '', label: 'x', onChange: (m) => (out = m) });
    const view = h.editor.action((ctx) => ctx.get(editorViewCtx));
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, place(view.state.doc))));
    const ev = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true });
    view.dom.dispatchEvent(ev);
    const md2 = h.getMarkdown();
    await h.destroy();
    root.remove();
    return { prevented: ev.defaultPrevented, md: md2, out };
  };
  const posOf = (text: string) => (doc: import('@milkdown/kit/prose/model').Node) => {
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
