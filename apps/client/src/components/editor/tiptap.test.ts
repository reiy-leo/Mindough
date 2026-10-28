// @vitest-environment happy-dom
/**
 * 换成 Tiptap 后要守住的行为（Rei 2026-10-25）：老数据打开不写回、只读、粘贴 markdown、粘贴 / 拖进图片上传、
 * 清单手打和回车、撤销重做、全局快捷键（⌘Enter、⌘K）不被吞。
 */
import { describe, expect, it, vi } from 'vitest';
import { TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import fixtures from './markdown.fixtures.json';
import { createMdEditor, type MdEditorOptions } from './editor';
import { dropGoesToEditor } from '../attachments/Attachments';

const setup = (md: string, extra: Partial<MdEditorOptions> = {}) => {
  const root = document.createElement('div');
  root.className = 'md-editor-root';
  document.body.appendChild(root);
  const changes: string[] = [];
  const h = createMdEditor({ root, value: md, placeholder: '', label: 'x', onChange: (m) => changes.push(m), ...extra });
  const view = h.view();
  const done = () => {
    h.destroy();
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
const key = (view: EditorView, k: string, mods: KeyboardEventInit = {}) => {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...mods });
  view.dom.dispatchEvent(ev);
  return ev.defaultPrevented;
};
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('老数据打开不改动、不写回', () => {
  it('190 段样例：打开、挪光标、全选、点开折叠块，都不调 onChange', async () => {
    for (const f of fixtures as { input: string }[]) {
      const { view, root, changes, done } = setup(f.input);
      await flush();
      const size = view.state.doc.content.size;
      for (const pos of [0, Math.floor(size / 2), size]) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos))));
      root.querySelectorAll<HTMLButtonElement>('.md-details-toggle').forEach((b) => b.click());
      view.dispatch(view.state.tr.setSelection(TextSelection.atStart(view.state.doc)));
      expect(changes, f.input).toEqual([]);
      done();
    }
  });

  it('非标准写法（* 列表、__粗__）只看不改也不改写；改一个字才写，写的是新内容', () => {
    const { view, changes, done } = setup('* a\n* b\n\n__粗__');
    view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
    expect(changes).toEqual([]);
    type(view, '!');
    expect(changes).toEqual(['- a\n- b\n\n__粗!__\n']);
    done();
  });

  it('改了又改回去：照样把改回去的内容交出去（不会停在中间那版）', () => {
    const { view, changes, done } = setup('一段');
    view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
    type(view, '话');
    view.dispatch(view.state.tr.delete(view.state.selection.from - 1, view.state.selection.from));
    expect(changes).toEqual(['一段话\n', '一段\n']);
    done();
  });

  it('外面给的新值：换掉内容，不调 onChange，不进撤销', () => {
    const { h, changes, done } = setup('旧的');
    h.setMarkdown('新的 **粗**');
    expect(h.getMarkdown()).toBe('新的 **粗**\n');
    expect(changes).toEqual([]);
    expect(h.editor.can().undo()).toBe(false);
    done();
  });
});

describe('只读', () => {
  it('readOnly：不能改，链接照样能点', () => {
    const opened: string[] = [];
    const { view, h, done } = setup('看 [文档](https://a.com)', { readOnly: true, onLinkOpen: (u) => opened.push(u) });
    expect(view.editable).toBe(false);
    expect(view.dom.getAttribute('contenteditable')).toBe('false');
    view.dom.querySelector('a')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    expect(opened).toEqual(['https://a.com']);
    expect(h.getMarkdown()).toBe('看 [文档](https://a.com)\n');
    done();
  });
});

/** 假的剪贴板 / 拖放数据。 */
const transfer = (data: Record<string, string>, files: File[] = []) =>
  ({
    getData: (t: string) => data[t] ?? '',
    files,
    types: [...Object.keys(data), ...(files.length ? ['Files'] : [])],
    items: files.map((f) => ({ kind: 'file', type: f.type })),
  }) as unknown as DataTransfer;

const paste = (view: EditorView, dt: DataTransfer) => {
  const ev = new Event('paste', { cancelable: true }) as ClipboardEvent;
  Object.defineProperty(ev, 'clipboardData', { value: dt });
  return view.someProp('handlePaste', (f) => f(view, ev, view.state.doc.slice(0, 0)));
};

describe('粘贴', () => {
  it('纯文字当 markdown 读；网络图片不加载', () => {
    const { view, h, root, done } = setup('');
    expect(paste(view, transfer({ 'text/plain': '**粗** 和 [链接](https://a.com)\n\n- [ ] 清单\n\n![图](https://x.com/a.png)' }))).toBe(true);
    expect(h.getMarkdown()).toBe('**粗** 和 [链接](https://a.com)\n\n- [ ] 清单\n\n![图](https://x.com/a.png)\n');
    expect(root.querySelectorAll('img:not(.ProseMirror-separator)').length).toBe(0);
    done();
  });

  it('一段字粘进段落中间：接在原来那段里，不另起一段', () => {
    const { view, h, done } = setup('前后');
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)));
    paste(view, transfer({ 'text/plain': '*中*' }));
    expect(h.getMarkdown()).toBe('前*中*后\n');
    done();
  });

  it('复制出去是 markdown', () => {
    const { view, done } = setup('**粗** 和 `码`\n\n- a');
    const text = view.someProp('clipboardTextSerializer', (f) => f(view.state.doc.slice(0, view.state.doc.content.size), view));
    expect(text).toBe('**粗** 和 `码`\n\n- a\n');
    done();
  });
});

describe('图片：正文不收新图片（Rei 2026-10-29）', () => {
  const png = () => new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' });

  it('粘贴图片文件：拦下、什么都不插、提示一下', async () => {
    const blocked = vi.fn();
    const { view, h, root, done } = setup('前后', { onImageBlocked: blocked });
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)));
    expect(paste(view, transfer({}, [png()]))).toBe(true);
    await flush();
    expect(h.getMarkdown()).toBe('前后\n');
    expect(root.querySelector('img')).toBeNull();
    expect(blocked).toHaveBeenCalledTimes(1);
    done();
  });

  it('粘贴网页内容：里面的图去掉，字留下', () => {
    const blocked = vi.fn();
    const { view, h, done } = setup('', { onImageBlocked: blocked });
    view.pasteHTML('<p>字<img src="data:image/png;base64,AAAA">尾</p>');
    expect(h.getMarkdown()).toBe('字尾\n');
    expect(blocked).toHaveBeenCalledTimes(1);
    done();
  });

  it('混着别的文件：编辑器不接（交给附件）', () => {
    const pdf = new File(['x'], 'a.pdf', { type: 'application/pdf' });
    const a = setup('');
    expect(paste(a.view, transfer({}, [png(), pdf]))).toBeFalsy();
    a.done();
  });

  it('dropGoesToEditor：只有图片、落在能改的正文上才交给编辑器', () => {
    const { view, done } = setup('一段');
    const ev = (target: Element, files: File[]) => {
      const e = new Event('drop') as DragEvent;
      Object.defineProperty(e, 'target', { value: target });
      Object.defineProperty(e, 'dataTransfer', { value: transfer({}, files) });
      return e;
    };
    const p = view.dom.querySelector('p')!;
    expect(dropGoesToEditor(ev(p, [png()]))).toBe(true);
    expect(dropGoesToEditor(ev(p, [png(), new File(['x'], 'a.pdf', { type: 'application/pdf' })]))).toBe(false);
    expect(dropGoesToEditor(ev(document.body, [png()]))).toBe(false);
    view.setProps({ editable: () => false });
    expect(dropGoesToEditor(ev(view.dom.querySelector('p')!, [png()]))).toBe(false);
    done();
  });
});

describe('清单、撤销、快捷键', () => {
  it('- [ ] 打出清单；清单里回车是新的没勾的一项；点勾切换', () => {
    const { view, h, done } = setup('');
    type(view, '- [x] 做完');
    expect(key(view, 'Enter')).toBe(true);
    type(view, '下一件');
    expect(h.getMarkdown()).toBe('- [x] 做完\n- [ ] 下一件\n');
    done();
  });

  it('行首打 [] / [ ] / [x] 加空格（Notion 式，Rei 2026-10-25）：直接变清单项，存的还是 - [ ]', () => {
    for (const [typed, md] of [
      ['[] 买菜', '- [ ] 买菜\n'],
      ['[ ] 买菜', '- [ ] 买菜\n'],
      ['[x] 买菜', '- [x] 买菜\n'],
      ['[X] 买菜', '- [x] 买菜\n'],
      ['- [] 买菜', '- [ ] 买菜\n'],
    ] as const) {
      const { view, h, done } = setup('');
      type(view, typed);
      expect(h.getMarkdown()).toBe(md);
      done();
    }
    // 回车接着是没勾的清单项
    const { view, h, done } = setup('');
    type(view, '[] 一');
    key(view, 'Enter');
    type(view, '二');
    expect(h.getMarkdown()).toBe('- [ ] 一\n- [ ] 二\n');
    done();
  });

  it('不在行首的 [ ] 、代码块里的 [ ] 不变', () => {
    const a = setup('');
    type(a.view, '看 [ ] 这里');
    expect(a.view.state.doc.textContent).toBe('看 [ ] 这里');
    expect(a.h.getMarkdown()).not.toContain('- [');
    a.done();
    const b = setup('```\n\n```');
    b.view.dispatch(b.view.state.tr.setSelection(TextSelection.create(b.view.state.doc, 1)));
    type(b.view, '[ ] x');
    expect(b.h.getMarkdown()).toBe('```\n[ ] x\n```\n');
    b.done();
  });

  it('撤销 / 重做', () => {
    const { view, h, done } = setup('a');
    view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
    type(view, 'bc');
    expect(h.getMarkdown()).toBe('abc\n');
    h.editor.commands.undo();
    expect(h.getMarkdown()).toBe('a\n');
    h.editor.commands.redo();
    expect(h.getMarkdown()).toBe('abc\n');
    done();
  });

  it('⌘Enter / Ctrl+Enter 不被吃掉（新建面板用它添加）；没开链接框时 ⌘K 也不被吃掉（全局搜索）', () => {
    const { view, done } = setup('一段');
    expect(key(view, 'Enter', { metaKey: true })).toBe(false);
    expect(key(view, 'Enter', { ctrlKey: true })).toBe(false);
    expect(key(view, 'k', { metaKey: true })).toBe(false);
    done();
    const withLink = setup('一段', { onLinkShortcut: () => {} });
    expect(key(withLink.view, 'k', { metaKey: true })).toBe(true);
    withLink.done();
  });

  it('Shift+Enter 是真换行（写成 \\），单换行的老数据仍是单换行', () => {
    const { view, h, done } = setup('第一行\n第二行');
    view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
    key(view, 'Enter', { shiftKey: true });
    type(view, '三');
    expect(h.getMarkdown()).toBe('第一行\n第二行\\\n三\n');
    done();
  });

  it('删除线 ⌘⌥X、列表 ⌘⌥8 / ⌘⌥7（和以前一样）', () => {
    const { view, h, done } = setup('一段');
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 3)));
    const mod = /Mac|iP(hone|[oa]d)/.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true };
    expect(key(view, 'x', { ...mod, altKey: true })).toBe(true);
    expect(key(view, '8', { ...mod, altKey: true })).toBe(true);
    expect(h.getMarkdown()).toBe('- ~~一段~~\n');
    done();
  });
});

describe('编辑器销毁后不崩（Rei 2026-10-27：点任务白屏「WeakMap keys must be objects」）', () => {
  it('销毁后再读写、再 attach 都不抛错', async () => {
    const { h, root } = setup('你好 **世界**');
    const ed = h.editor;
    h.destroy();
    expect(ed.schema).toBeFalsy();
    expect(() => h.getMarkdown()).not.toThrow();
    expect(h.getMarkdown()).toBe('你好 **世界**');
    expect(() => h.setMarkdown('别的')).not.toThrow();
    root.remove();
  });
});
